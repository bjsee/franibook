/**
 * Buchgenerator.
 *
 * Führt die Kette zusammen: Struktur → Seitenbudget → Gruppierung →
 * Templatewahl → Slot-Zuordnung → Ausschnitte.
 *
 * Deterministisch: Gleiche Eingaben ergeben exakt dasselbe Buch. Das ist die
 * Voraussetzung für Snapshot-Tests und dafür, dass eine kleine Korrektur an
 * einer Stelle nicht das ganze Buch umwirft.
 */
import { coverCrop } from '../model/crop.js';
import type { PhotoWeight } from '../model/date.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { Template } from '../model/template.js';
import { type PrintProfile, nextValidPageCount } from '../print/profile.js';
import type { Chapter, Segment, Structure } from '../structure/segment.js';
import {
  chapterTemplates,
  supportedSlotCounts,
  templateById,
  groupOpenerTemplates,
  templatesWithTitle,
  templatesWithoutTitle,
} from '../templates/index.js';
import {
  type ChapterBudget,
  budgetByYear,
  distributeBudget,
  groupChapter,
  segmentsById,
} from './grouping.js';
import { type TemplateFit, assign, slotCost, slotGeometry } from './scoring.js';

export interface GenerateOptions {
  structure: Structure;
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  /** Angestrebte Seitenzahl des Innenteils. */
  targetPages: number;
  /** Ob jedes Jahr eine eigene Auftaktdoppelseite bekommt. */
  chapterOpeners?: boolean;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
  /**
   * Aktive Fotogruppen. Nur sie gliedern das Buch – abgeschaltete laufen im
   * normalen chronologischen Fluss mit.
   */
  groups?: readonly {
    id: string;
    photoIds: readonly PhotoId[];
    active: boolean;
    title: string;
    coverPhotoId?: PhotoId;
    /** Auftakt für genau diese Gruppe, unabhängig von der Vorgabe. */
    opener?: boolean;
  }[];
  /**
   * Ob Gruppen eine eigene Auftaktseite bekommen.
   *
   * Jede kostet eine Doppelseite. Bei 61 Gruppen wären das 122 Seiten allein
   * für Auftakte – deshalb bekommen sie nur Gruppen, die es tragen: solche mit
   * einem selbst gewählten Hauptbild oder ab `groupOpenerMinPhotos` Fotos.
   *
   * `'auto'` bedeutet: das Gegenteil von `timeline`. Trägt der Zeitstrahl den
   * Gruppentitel auf jeder Doppelseite der Gruppe, ist eine eigene Auftaktseite
   * dafür entbehrlich – sie benennt dann zum Preis von zwei Seiten, was ohnehin
   * überall steht. Ohne Zeitstrahl bleibt der Auftakt die einzige Stelle, an der
   * die Gruppe vorkommt.
   */
  groupOpeners?: boolean | 'auto';
  /** Ob der Zeitstrahl läuft. Löst `groupOpeners: 'auto'` auf. */
  timeline?: boolean;
  /** Ab wie vielen Fotos eine Gruppe ohne Hauptbild einen Auftakt bekommt. */
  groupOpenerMinPhotos?: number;
  /**
   * Ereignisse je Jahr, die auf dem Jahresauftakt stehen – drei bis fünf
   * Zeilen, von Hand gepflegt.
   *
   * Bewusst Daten und keine Abfrage: Ein Wikipedia-Abruf beim Erzeugen wäre
   * netzabhängig und würde den Determinismus brechen, ein erfundener Satz stünde
   * gedruckt im Buch. Vorschlagswerkzeuge können darüber liegen – gespeichert
   * wird nur, was der Benutzer bestätigt hat.
   */
  yearEvents?: Readonly<Record<number, readonly string[]>>;
  /** Steuert die Auswahl unter gleichwertigen Templates. */
  seed?: number;
}

export interface GenerateResult {
  spreads: Spread[];
  budgets: ChapterBudget[];
  /** Nachvollziehbarkeit: warum sieht das Buch aus, wie es aussieht. */
  report: {
    photoCount: number;
    placedCount: number;
    spreadCount: number;
    pageCount: number;
    /** Wie angefordert. */
    targetPages: number;
    /**
     * Zielseitenzahl, die die Engine tatsächlich ansteuert.
     *
     * Die Anforderung wird auf das Druckprofil eingerastet: Vielfaches von
     * `pageCount.step`, nicht unter `min`, nicht über `max`. Eine Vorgabe von
     * 200 Seiten wird bei Saal zu 160, weil mehr nicht gebunden wird.
     */
    effectiveTargetPages: number;
    chapterOpeners: number;
    /** Auftaktseiten für Fotogruppen. */
    groupOpeners: number;
    /** Fotos, die nicht platziert werden konnten. */
    unplaced: PhotoId[];
    worstDpi: number;
    belowTargetDpi: number;
    /**
     * Slots unterhalb der Mindestauflösung.
     *
     * Sie entstehen, wenn ein Foto für jeden verfügbaren Slot zu klein ist –
     * im Zielbestand gibt es Bilder mit 348 px langer Kante, die selbst in den
     * kleinsten Slot nicht mit 240 dpi passen. Die Engine platziert sie
     * trotzdem und meldet sie; sie stillschweigend wegzulassen wäre die
     * schlechtere Entscheidung.
     */
    belowMinDpi: { photoId: PhotoId; spreadIndex: number; slotId: string; dpi: number }[];
    /** Durchschnittliche Fotodichte je Doppelseite. */
    photosPerSpread: number;
    feasibility: Feasibility;
  };
}

/**
 * Ob die Zielseitenzahl mit dem Bestand und der Bibliothek überhaupt
 * erreichbar ist.
 *
 * Die Rechnung ist einfach und wird trotzdem gern übersehen: 831 Fotos auf 160
 * Seiten sind 13,6 Fotos je Doppelseite. Bietet die Bibliothek höchstens acht
 * Slots, ist das Ziel unerreichbar – die Engine würde stumm ein doppelt so
 * dickes Buch bauen. Deshalb wird die Machbarkeit vorab geprüft und gemeldet.
 */
export interface Feasibility {
  achievable: boolean;
  /** Fotos je Doppelseite, die das Ziel verlangt. */
  requiredPerSpread: number;
  /** Was die Bibliothek höchstens hergibt. */
  maxPerSpread: number;
  /** Seitenzahl, die mit dieser Bibliothek mindestens nötig ist. */
  minimumPages: number;
  hint?: string;
}

export function checkFeasibility(
  photoCount: number,
  targetPages: number,
  slotCounts: readonly number[],
  chapterCount: number,
  useOpeners: boolean,
): Feasibility {
  const maxPerSpread = Math.max(...slotCounts, 1);
  const openerSpreads = useOpeners ? chapterCount : 0;
  const availableSpreads = Math.max(1, Math.floor(targetPages / 2) - openerSpreads);
  const requiredPerSpread = photoCount / availableSpreads;
  const minimumSpreads = Math.ceil(photoCount / maxPerSpread) + openerSpreads;
  const minimumPages = minimumSpreads * 2;

  const achievable = requiredPerSpread <= maxPerSpread;

  return {
    achievable,
    requiredPerSpread,
    maxPerSpread,
    minimumPages,
    ...(achievable
      ? {}
      : {
          hint:
            `${photoCount} Fotos auf ${targetPages} Seiten verlangen ` +
            `${requiredPerSpread.toFixed(1)} Fotos je Doppelseite, die Bibliothek bietet ` +
            `höchstens ${maxPerSpread}. Mindestens ${minimumPages} Seiten nötig` +
            (useOpeners ? ` (davon ${openerSpreads * 2} für Jahresauftakte).` : '.'),
        }),
  };
}

/**
 * Kleiner, reproduzierbarer Zufallsgenerator.
 *
 * Wird nur gebraucht, um unter gleichwertigen Templates zu wählen. Ein echter
 * Zufallsgenerator würde den Determinismus brechen, auf den die Snapshot-Tests
 * und das erneute Generieren bauen.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sucht das beste Template für eine Gruppe.
 *
 * Bewertet alle Templates mit passender Slotzahl, jeweils mit optimaler
 * Zuordnung der Fotos. Zusätzlich wird bestraft, wenn dasselbe Template kurz
 * zuvor schon verwendet wurde – sonst wiederholen sich Doppelseiten, was beim
 * Durchblättern sofort auffällt.
 */
function chooseTemplate(
  group: readonly Photo[],
  recentTemplateIds: readonly string[],
  profile: PrintProfile,
  weightOf: (id: PhotoId) => PhotoWeight,
  rng: () => number,
  /** Am Anfang einer Gruppe nur Vorlagen, die den Titel aufnehmen können. */
  needsTitle = false,
): TemplateFit | undefined {
  // Gibt es für diese Bilderzahl keine titelfähige Vorlage, wird lieber ohne
  // Titel gesetzt als die Doppelseite umzubauen – der Gruppenname steht dann
  // erst auf der nächsten Seite der Gruppe.
  const mitTitel = needsTitle ? templatesWithTitle(group.length) : [];
  const candidates = mitTitel.length > 0 ? mitTitel : templatesWithoutTitle(group.length);
  if (candidates.length === 0) return undefined;

  const fits: TemplateFit[] = [];

  for (const template of candidates) {
    const geometries = template.slots.map((s) => slotGeometry(s, profile));

    const cost = group.map((photo) =>
      template.slots.map(
        (slot, j) => slotCost(photo, slot, geometries[j]!, { profile, weightOf }).total,
      ),
    );

    const assignment = assign(cost);

    const breakdowns = group.map((photo, i) => {
      const slotIndex = assignment[i]!;
      return slotCost(photo, template.slots[slotIndex]!, geometries[slotIndex]!, {
        profile,
        weightOf,
      });
    });

    let score = breakdowns.reduce((sum, b) => sum + b.total, 0);

    // Wiederholungsstrafe: je näher die letzte Verwendung, desto teurer
    const lastUse = recentTemplateIds.lastIndexOf(template.id);
    if (lastUse >= 0) {
      const abstand = recentTemplateIds.length - lastUse;
      score += Math.max(0, 1.2 - 0.3 * abstand);
    }

    // Winziger Zufallsanteil, damit gleichwertige Templates nicht immer in
    // Bibliotheksreihenfolge gewinnen. Deterministisch über den Seed.
    score += rng() * 0.01;

    fits.push({
      templateId: template.id,
      score,
      assignment,
      breakdowns,
      worstDpi: Math.min(...breakdowns.map((b) => b.dpi)),
    });
  }

  fits.sort((a, b) => a.score - b.score);
  return fits[0];
}

/** Baut die Doppelseite aus Template, Gruppe und Zuordnung. */
function buildSpread(
  id: string,
  index: number,
  template: Template,
  group: readonly Photo[],
  fit: TemplateFit,
  profile: PrintProfile,
  segment?: Segment,
  /** Gruppentitel, wenn diese Doppelseite eine Gruppe eröffnet. */
  groupTitle?: string,
): Spread {
  const slots = template.slots.map((slot, slotIndex) => {
    // `assignment[i]` ist der Slot für Foto i – gesucht ist die Umkehrung.
    const photoIndex = fit.assignment.indexOf(slotIndex);
    const photo = photoIndex >= 0 ? group[photoIndex] : undefined;

    if (!photo) {
      return {
        slotId: slot.id,
        photoId: null,
        crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
      };
    }

    const geometry = slotGeometry(slot, profile);
    return {
      slotId: slot.id,
      photoId: photo.id,
      crop: coverCrop(photo.width / photo.height, geometry.widthMm / geometry.heightMm),
    };
  });

  const spread: Spread = { id, index, templateId: template.id, slots };

  // Überschrift nur, wenn die Vorlage einen Platz dafür hat. Der Gruppentitel
  // geht vor: Er ist vom Benutzer gesetzt, der Segmenttitel nur geraten.
  const titel = groupTitle ?? segment?.title;
  const textSlot = template.textSlots?.find((t) => t.role === 'eventTitle');
  if (titel && textSlot) {
    spread.texts = [
      {
        id: `${id}-title`,
        role: 'eventTitle',
        content: titel,
        slotId: textSlot.id,
      },
    ];
  }

  return spread;
}

/**
 * Auftaktdoppelseite einer Fotogruppe.
 *
 * Zeigt das Hauptbild groß und den Gruppentitel darunter. Vollflächig
 * randabfallend nur, wenn das Bild genug Pixel hat – im Zielbestand trifft das
 * auf 16 von 820 Fotos zu; für alle anderen wird es so groß gesetzt, wie die
 * Mindestauflösung zulässt.
 */
function buildGroupOpener(
  id: string,
  index: number,
  title: string,
  cover: Photo,
  profile: PrintProfile,
): Spread | undefined {
  const kandidaten = groupOpenerTemplates().filter((t) => {
    const slot = t.slots[0];
    if (!slot) return false;
    const geometry = slotGeometry(slot, profile);
    const cost = slotCost(cover, slot, geometry, { profile, weightOf: () => 'hero' });
    return cost.dpi >= profile.resolution.minDpi;
  });

  if (kandidaten.length === 0) return undefined;

  // Größtes Bild gewinnt: vollflächig, wenn die Auflösung reicht.
  const template = kandidaten.sort(
    (a, b) => b.slots[0]!.w * b.slots[0]!.h - a.slots[0]!.w * a.slots[0]!.h,
  )[0]!;

  const slot = template.slots[0]!;
  const geometry = slotGeometry(slot, profile);
  const textSlot = template.textSlots?.find((t) => t.role === 'eventTitle');

  return {
    id,
    index,
    templateId: template.id,
    slots: [
      {
        slotId: slot.id,
        photoId: cover.id,
        crop: coverCrop(cover.width / cover.height, geometry.widthMm / geometry.heightMm),
      },
    ],
    ...(textSlot
      ? {
          texts: [
            { id: `${id}-title`, role: 'eventTitle' as const, content: title, slotId: textSlot.id },
          ],
        }
      : {}),
  };
}

/**
 * Trägt dieses Bild eine Auftaktseite?
 *
 * Muss vor der Gruppierung feststehen und mit der späteren Entscheidung
 * übereinstimmen: Das Auftaktbild wird aus dem Fluss genommen: Käme der
 * Auftakt dann doch nicht zustande, fiele das Foto ganz aus dem Buch. Genau
 * das ist passiert – acht Fotos fehlten.
 */
function kannAuftaktTragen(
  photo: Photo,
  profile: PrintProfile,
  templates: readonly Template[],
): boolean {
  return templates.some((t) => {
    const slot = t.slots[0];
    if (!slot) return false;
    const cost = slotCost(photo, slot, slotGeometry(slot, profile), {
      profile,
      weightOf: () => 'hero',
    });
    return cost.dpi >= profile.resolution.minDpi;
  });
}

/**
 * Bestes Bild eines Jahres für dessen Auftaktseite – und die Vorlage dazu.
 *
 * Bild und Vorlage müssen gemeinsam gewählt werden. Vorher entschied die
 * Auswahl nur über die *erste* Auftaktvorlage mit Bild, und `buildChapterOpener`
 * zog danach eine beliebige; seit es eine Hochformatfassung gibt, wäre in der
 * Hälfte der Fälle ein Querformat in einem Hochformatslot gelandet.
 *
 * Die Zufallszahl je Vorlage ist nötig, nicht kosmetisch: Ein 4:3-Bild im
 * 4:3-Slot kostet 0, ein 3:4-Bild im 3:4-Slot 0,002 – ohne Streuung gewinnt
 * die Querformatfassung jedes der 19 Jahre, und das Buch hätte 19 identische
 * Auftakte. 0,05 ist so bemessen, dass die vier Auftaktfassungen konkurrieren,
 * ein wirklich schlechter Ausschnitt (0,2 und mehr) aber trotzdem verliert.
 */
function pickChapterCover(
  chapter: Chapter,
  photos: ReadonlyMap<PhotoId, Photo>,
  profile: PrintProfile,
  rng: () => number,
): { photoId: PhotoId; templateId: string } | undefined {
  const kandidatenBilder = chapter.segments
    .flatMap((s) => s.photoIds)
    .map((id) => photos.get(id))
    .filter((p): p is Photo => p !== undefined);
  if (kandidatenBilder.length === 0) return undefined;

  let beste: { photoId: PhotoId; templateId: string; kosten: number } | undefined;
  for (const template of chapterTemplates()) {
    const slot = template.slots[0];
    if (!slot) continue;
    const geometry = slotGeometry(slot, profile);
    const streuung = rng() * 0.05;

    let besteImTemplate: { photoId: PhotoId; kosten: number } | undefined;
    for (const photo of kandidatenBilder) {
      const cost = slotCost(photo, slot, geometry, { profile, weightOf: () => 'normal' });
      if (cost.dpi < profile.resolution.minDpi) continue;
      if (!besteImTemplate || cost.total < besteImTemplate.kosten) {
        besteImTemplate = { photoId: photo.id, kosten: cost.total };
      }
    }
    if (!besteImTemplate) continue;

    const kosten = besteImTemplate.kosten + streuung;
    if (!beste || kosten < beste.kosten) {
      beste = { photoId: besteImTemplate.photoId, templateId: template.id, kosten };
    }
  }
  return beste ? { photoId: beste.photoId, templateId: beste.templateId } : undefined;
}

/** Erzeugt eine Kapitel-Auftaktdoppelseite für ein Jahr. */
function buildChapterOpener(
  id: string,
  index: number,
  chapter: Chapter,
  photos: ReadonlyMap<PhotoId, Photo>,
  profile: PrintProfile,
  /** Vorab bestimmtes Auftaktbild samt Vorlage, damit es aus dem Fluss fällt. */
  vorgegeben?: { photoId: PhotoId; templateId: string },
  /** Ereignisse des Jahres, je Zeile eines. */
  events?: readonly string[],
): { spread: Spread; usedPhotoId?: PhotoId } {
  const templates = chapterTemplates();
  const withoutImage = templates.filter((t) => t.slots.length === 0);

  let template = withoutImage[0] ?? templates[0]!;
  let usedPhotoId: PhotoId | undefined;

  // Bild und Vorlage kommen als Paar aus `pickChapterCover`; wird nichts
  // vorgegeben, bleibt der ruhige Auftakt ohne Bild. Eine eigene Zufallszahl
  // braucht es hier nicht mehr – vorher zog sie die Vorlage, jetzt entscheidet
  // die Passung zum Bild.
  const gewaehlt = vorgegeben ? photos.get(vorgegeben.photoId) : undefined;
  const gewaehlteVorlage = vorgegeben ? templateById(vorgegeben.templateId) : undefined;
  if (gewaehlt && gewaehlteVorlage) {
    template = gewaehlteVorlage;
    usedPhotoId = gewaehlt.id;
  }

  const slots = template.slots.map((slot) => {
    const photo = usedPhotoId ? photos.get(usedPhotoId) : undefined;
    if (!photo) {
      return {
        slotId: slot.id,
        photoId: null,
        crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
      };
    }
    const geometry = slotGeometry(slot, profile);
    return {
      slotId: slot.id,
      photoId: photo.id,
      crop: coverCrop(photo.width / photo.height, geometry.widthMm / geometry.heightMm),
    };
  });

  const yearSlot = template.textSlots?.find((t) => t.role === 'year');
  const eventSlot = template.textSlots?.find((t) => t.id === 't-events');

  // Ereignisse des Jahres als ein Textelement mit Zeilenumbrüchen. Die Zerlegung
  // in Zeilen und deren Abstände rechnet der Renderer nicht selbst, sondern
  // `renderSpread` – siehe dort.
  const texts = [
    ...(yearSlot
      ? [
          {
            id: `${id}-year`,
            role: 'year' as const,
            content: String(chapter.year),
            slotId: yearSlot.id,
          },
        ]
      : []),
    ...(eventSlot && events && events.length > 0
      ? [
          {
            id: `${id}-events`,
            role: 'freeText' as const,
            content: events.join('\n'),
            slotId: eventSlot.id,
          },
        ]
      : []),
  ];

  return {
    spread: {
      id,
      index,
      templateId: template.id,
      slots,
      ...(texts.length > 0 ? { texts } : {}),
    },
    ...(usedPhotoId ? { usedPhotoId } : {}),
  };
}

/**
 * Welche Gruppe stellt die meisten Fotos dieser Doppelseite?
 *
 * Bei Gleichstand gewinnt die zuerst auftretende – sonst hinge das Ergebnis an
 * der Aufzählungsreihenfolge einer Map und das Buch wäre nicht mehr
 * deterministisch.
 */
export function mehrheitsGruppe(
  fotos: readonly Photo[],
  groupOf: ReadonlyMap<PhotoId, string>,
): string | undefined {
  const zaehler = new Map<string, number>();
  for (const foto of fotos) {
    const id = groupOf.get(foto.id);
    if (id === undefined) continue;
    zaehler.set(id, (zaehler.get(id) ?? 0) + 1);
  }
  let beste: string | undefined;
  let meiste = 0;
  for (const [id, n] of zaehler) {
    if (n > meiste) {
      meiste = n;
      beste = id;
    }
  }
  return beste;
}

/**
 * Erzeugt das komplette Buch.
 */
export function generateBook(opts: GenerateOptions): GenerateResult {
  const { structure, photos, profile, targetPages } = opts;
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);
  const useOpeners = opts.chapterOpeners ?? true;
  const rng = mulberry32(opts.seed ?? 1);

  // Zielseitenzahl auf das Druckprofil einrasten. Vorher rechnete die Engine mit
  // der rohen Vorgabe und konnte ein Buch erzeugen, das der Dienstleister nicht
  // bindet: 172 Seiten bei einem Maximum von 160.
  const zielSeiten = nextValidPageCount(profile, targetPages);

  const slotCounts = supportedSlotCounts();

  // Nur aktive Gruppen gliedern. Abgeschaltete – typischerweise der Wohnort –
  // sollen den Fluss nicht zerschneiden.
  const groupOf = new Map<PhotoId, string>();
  const titelVonGruppe = new Map<string, string>();
  for (const g of opts.groups ?? []) {
    if (!g.active) continue;
    titelVonGruppe.set(g.id, g.title);
    for (const id of g.photoIds) groupOf.set(id, g.id);
  }
  const coverVonGruppe = new Map<string, PhotoId>();
  const groesseVonGruppe = new Map<string, number>();
  for (const g of opts.groups ?? []) {
    if (!g.active) continue;
    groesseVonGruppe.set(g.id, g.photoIds.length);
    if (g.coverPhotoId) coverVonGruppe.set(g.id, g.coverPhotoId);
  }
  const openerMinPhotos = opts.groupOpenerMinPhotos ?? 6;
  const gruppenGesehen = new Set<string>();
  /**
   * Vorgabe für Gruppenauftakte, aufgelöst.
   *
   * Vorrang: Entscheidung der Gruppe über Vorgabe. `'auto'` ist das Gegenteil
   * des Zeitstrahls.
   */
  const globalOpeners = opts.groupOpeners ?? 'auto';
  const timelineAn = opts.timeline ?? true;
  const auftaktGewuenscht = (gruppe: { opener?: boolean }): boolean =>
    gruppe.opener ?? (globalOpeners === 'auto' ? !timelineAn : globalOpeners);
  let groupOpenerCount = 0;

  /**
   * Welches Bild eröffnet welche Gruppe?
   *
   * Muss vor der Gruppierung feststehen: Das Auftaktbild wird aus dem Fluss
   * genommen, sonst stünde es zweimal im Buch – einmal groß auf der
   * Auftaktseite und gleich darauf noch einmal klein.
   */
  const auftaktBild = new Map<string, PhotoId>();
  /**
   * Auftaktbilder der Jahre.
   *
   * Dieselbe Überlegung wie bei den Gruppen: Ein Bild, das groß auf der
   * Auftaktseite steht, soll nicht zwei Seiten später noch einmal klein
   * auftauchen.
   */
  const jahresBild = new Map<number, { photoId: PhotoId; templateId: string }>();
  if (useOpeners && chapterTemplates().some((t) => t.slots.length > 0)) {
    for (const chapter of structure.chapters) {
      const kandidat = pickChapterCover(chapter, photos, profile, rng);
      if (kandidat) jahresBild.set(chapter.year, kandidat);
    }
  }

  // Gruppenauftakte danach – und kein Bild zweimal. Ein selbst gewähltes
  // Hauptbild gilt trotzdem: Es dem Jahresauftakt zu überlassen wäre gegen
  // die ausdrückliche Entscheidung des Benutzers.
  const schonVergeben = new Set([...jahresBild.values()].map((j) => j.photoId));
  {
    for (const g of opts.groups ?? []) {
      if (!g.active) continue;
      if (!auftaktGewuenscht(g)) continue;
      const verdient = g.coverPhotoId !== undefined || g.photoIds.length >= openerMinPhotos;
      if (!verdient) continue;

      const cover =
        g.coverPhotoId ?? g.photoIds.find((id) => !schonVergeben.has(id)) ?? g.photoIds[0];
      if (cover === undefined) continue;

      // Nur reservieren, wenn der Auftakt auch wirklich gebaut werden kann.
      const coverPhoto = photos.get(cover);
      if (!coverPhoto || !kannAuftaktTragen(coverPhoto, profile, groupOpenerTemplates())) {
        continue;
      }

      // Ein gewähltes Hauptbild sticht den Jahresauftakt aus
      if (g.coverPhotoId !== undefined && schonVergeben.has(g.coverPhotoId)) {
        for (const [jahr, bild] of jahresBild) {
          if (bild.photoId === g.coverPhotoId) jahresBild.delete(jahr);
        }
      }

      auftaktBild.set(g.id, cover);
      schonVergeben.add(cover);
    }
  }

  const ausDemFluss = new Set([
    ...auftaktBild.values(),
    ...[...jahresBild.values()].map((j) => j.photoId),
  ]);

  // Zu welchem Jahr gehört ein Foto? Gebraucht für die Nachlese der Auftakte.
  const jahrVonFoto = new Map<PhotoId, number>();
  for (const c of structure.chapters) {
    for (const seg of c.segments) {
      for (const id of seg.photoIds) jahrVonFoto.set(id, c.year);
    }
  }

  // Auftaktbilder stehen nicht mehr im Fluss. Das Budget muss mit den Fotos
  // rechnen, die wirklich verteilt werden – sonst bekommt ein Jahr eine
  // Doppelseite zugeteilt, für die es kein Foto mehr hat, und das Buch bleibt
  // unter der Zielzahl.
  const budgetKapitel = structure.chapters.map((c) => {
    const ausgenommen = c.segments.reduce(
      (n, s) => n + s.photoIds.filter((id) => ausDemFluss.has(id)).length,
      0,
    );
    return { ...c, photoCount: Math.max(0, c.photoCount - ausgenommen) };
  });

  // Gruppenauftakte gehen vom selben Kontingent ab wie alles andere. Ohne sie
  // einzurechnen, plante das Budget 61 Doppelseiten und das Buch wurde 68 lang.
  const auftaktSpreads = auftaktBild.size;
  const budgets = distributeBudget(budgetKapitel, {
    targetPages: Math.max(2, zielSeiten - auftaktSpreads * 2),
    chapterSpreads: useOpeners ? 1 : 0,
    maxPhotosPerSpread: Math.max(...slotCounts, 1),
  });
  const spreadsPerYear = budgetByYear(budgets);
  const segments = segmentsById(structure);

  const spreads: Spread[] = [];
  const placed = new Set<PhotoId>();
  const recentTemplates: string[] = [];
  let chapterOpenerCount = 0;

  for (const chapter of structure.chapters) {
    if (useOpeners) {
      const { spread, usedPhotoId } = buildChapterOpener(
        `spread-${spreads.length}`,
        spreads.length,
        chapter,
        photos,
        profile,
        jahresBild.get(chapter.year),
        opts.yearEvents?.[chapter.year],
      );
      spreads.push(spread);
      chapterOpenerCount++;
      if (usedPhotoId) placed.add(usedPhotoId);
    }

    // Über das ganze Jahr gruppieren, nicht je Monat: Monatsgrenzen sind
    // bevorzugte Schnittpunkte, keine harten.
    const groups = groupChapter(chapter, {
      slotCounts,
      targetSpreads: spreadsPerYear.get(chapter.year) ?? 1,
      ...(groupOf.size > 0 ? { groupOf, groupSizes: groesseVonGruppe } : {}),
      ...(ausDemFluss.size > 0 ? { exclude: ausDemFluss } : {}),
    });

    // Reservierte Auftaktbilder dieses Jahres, die in der Schleife nicht zum
    // Zuge kamen. Das betrifft Gruppen, deren Fotos vollständig aus dem Fluss
    // genommen wurden – bei einer Gruppe mit selbst gewähltem Hauptbild und nur
    // diesem einen Foto. Ohne diese Nachlese wäre das Bild nirgends im Buch.
    const offeneAuftakte = new Map(
      [...auftaktBild].filter(([, coverId]) => jahrVonFoto.get(coverId) === chapter.year),
    );

    for (const group of groups) {
      const groupPhotos = group.photoIds
        .map((id) => photos.get(id))
        .filter((p): p is Photo => p !== undefined);
      if (groupPhotos.length === 0) continue;

      // Eröffnet diese Doppelseite eine benannte Gruppe? Dann trägt sie deren
      // Titel – und braucht eine Vorlage, die Platz dafür hat.
      //
      // Maßgeblich ist die Gruppe mit den meisten Fotos, nicht die des ersten.
      // Vorher entschied allein das erste Foto: Lag dort ein Bild einer anderen
      // Gruppe – oder war das Auftaktbild bereits aus dem Fluss genommen –,
      // wurde die Gruppe nicht erkannt, ihr reservierter Auftakt nie gebaut und
      // das reservierte Bild landete in keiner Doppelseite. Gemessen fehlten so
      // neun Fotos.
      const gruppenId = mehrheitsGruppe(groupPhotos, groupOf);
      const eroeffnet = gruppenId !== undefined && !gruppenGesehen.has(gruppenId);
      let gruppenTitel = eroeffnet ? titelVonGruppe.get(gruppenId) : undefined;
      if (gruppenId !== undefined) gruppenGesehen.add(gruppenId);

      // Eigene Auftaktseite, sofern gewünscht und ein Hauptbild vorliegt.
      const coverId = gruppenId !== undefined ? auftaktBild.get(gruppenId) : undefined;

      if (eroeffnet && gruppenTitel && coverId !== undefined) {
        const cover = photos.get(coverId);
        const opener = cover
          ? buildGroupOpener(
              `spread-${spreads.length}`,
              spreads.length,
              gruppenTitel,
              cover,
              profile,
            )
          : undefined;
        if (opener && cover) {
          spreads.push(opener);
          groupOpenerCount++;
          placed.add(cover.id);
          offeneAuftakte.delete(gruppenId!);
          // Der Titel steht jetzt auf dem Auftakt; die folgende Doppelseite
          // braucht ihn nicht noch einmal.
          gruppenTitel = undefined;
        }
      }

      const fit = chooseTemplate(
        groupPhotos,
        recentTemplates,
        profile,
        weightOf,
        rng,
        gruppenTitel !== undefined,
      );
      if (!fit) continue;

      const template = templateById(fit.templateId);
      if (!template) continue;

      const spread = buildSpread(
        `spread-${spreads.length}`,
        spreads.length,
        template,
        groupPhotos,
        fit,
        profile,
        group.startsSegment ? segments.get(group.segmentId) : undefined,
        gruppenTitel,
      );
      spreads.push(spread);

      for (const p of groupPhotos) placed.add(p.id);

      recentTemplates.push(fit.templateId);
      if (recentTemplates.length > 4) recentTemplates.shift();
    }

    // Nachlese: Auftakte, die in der Schleife nicht zum Zuge kamen, weil die
    // Gruppe im Fluss dieses Jahres gar nicht mehr vorkommt – etwa eine Gruppe
    // aus einem einzigen Foto, das als Hauptbild reserviert wurde. Sie stehen
    // am Ende des Jahres statt an ihrer chronologischen Stelle; das ist die
    // schwächere Lösung, aber ungleich besser, als das Bild zu verlieren.
    for (const [gruppenId, coverId] of offeneAuftakte) {
      const cover = photos.get(coverId);
      const titel = titelVonGruppe.get(gruppenId);
      if (!cover || titel === undefined || placed.has(coverId)) continue;
      const opener = buildGroupOpener(
        `spread-${spreads.length}`,
        spreads.length,
        titel,
        cover,
        profile,
      );
      if (!opener) continue;
      spreads.push(opener);
      groupOpenerCount++;
      placed.add(coverId);
    }
  }

  // Auswertung
  const allPhotoIds = structure.chapters.flatMap((c) => c.segments.flatMap((s) => s.photoIds));
  const unplaced = allPhotoIds.filter((id) => !placed.has(id));

  let worstDpi = Number.POSITIVE_INFINITY;
  let belowTarget = 0;
  const belowMinDpi: { photoId: PhotoId; spreadIndex: number; slotId: string; dpi: number }[] = [];

  for (const spread of spreads) {
    const template = templateById(spread.templateId);
    if (!template) continue;
    for (const assignment of spread.slots) {
      if (!assignment.photoId) continue;
      const photo = photos.get(assignment.photoId);
      const slot = template.slots.find((s) => s.id === assignment.slotId);
      if (!photo || !slot) continue;
      const geometry = slotGeometry(slot, profile);
      const cost = slotCost(photo, slot, geometry, { profile, weightOf });
      worstDpi = Math.min(worstDpi, cost.dpi);
      if (cost.dpi < profile.resolution.targetDpi) belowTarget++;
      if (cost.dpi < profile.resolution.minDpi) {
        belowMinDpi.push({
          photoId: photo.id,
          spreadIndex: spread.index,
          slotId: slot.id,
          dpi: cost.dpi,
        });
      }
    }
  }

  const platzierbar = structure.chapters.reduce((n, c) => n + c.photoCount, 0);

  return {
    spreads,
    budgets,
    report: {
      photoCount: structure.photoCount,
      placedCount: placed.size,
      spreadCount: spreads.length,
      pageCount: spreads.length * 2,
      targetPages,
      effectiveTargetPages: zielSeiten,
      chapterOpeners: chapterOpenerCount,
      groupOpeners: groupOpenerCount,
      unplaced,
      worstDpi: Number.isFinite(worstDpi) ? worstDpi : 0,
      belowTargetDpi: belowTarget,
      belowMinDpi,
      photosPerSpread: spreads.length > 0 ? placed.size / spreads.length : 0,
      feasibility: checkFeasibility(
        platzierbar,
        zielSeiten,
        slotCounts,
        structure.chapters.length,
        useOpeners,
      ),
    },
  };
}
