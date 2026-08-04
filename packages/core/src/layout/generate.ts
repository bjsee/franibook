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
import { chapterBackgrounds } from '../render/background.js';
import type { Chapter, Structure } from '../structure/segment.js';
import { isJustified } from '../templates/justified.js';
import { insertKept, keptPhotos } from './keep.js';
import { justifySpread, layoutSpread } from './rebuild.js';
import {
  chapterTemplates,
  supportedSlotCounts,
  templateById,
  groupOpenerTemplates,
  templatesWithoutTitle,
} from '../templates/index.js';
import { type ChapterBudget, budgetByYear, distributeBudget, groupChapter } from './grouping.js';
import { type TemplateFit, assign, slotCost, slotGeometry } from './scoring.js';
import { bookStats } from './stats.js';

export interface GenerateOptions {
  structure: Structure;
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  /** Angestrebte Seitenzahl des Innenteils. */
  targetPages: number;
  /** Ob jedes Jahr eine eigene Auftaktdoppelseite bekommt. */
  chapterOpeners?: boolean;
  /**
   * Ob der Jahresauftakt auch auf der Jahresseite Bilder trägt.
   *
   * Aus: Die linke Seite hält nur Jahreszahl und Ereigniszeilen, der Auftakt
   * trägt sechs Bilder rechts. An: neun Bilder über beide Seiten, die
   * Jahreszahl steht in einem Band, das kein Bild berührt, und größer als sonst
   * (`spread.chapter.dicht.*` in `templates/library.json`).
   *
   * Am echten Bestand sind das je Jahrgang drei Bilder mehr im Auftakt, bei
   * neunzehn Jahrgängen also 57 – rund vier Doppelseiten, die der Fluss nicht
   * mehr braucht. Bezahlt wird das mit der Ruhe an der Kapitelgrenze; deshalb
   * ist es ein Schalter und keine Umstellung.
   */
  chapterOpenersDense?: boolean;
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
  /**
   * Ob jeder Jahrgang eine eigene Hintergrundfarbe bekommt.
   *
   * Die Farbe wechselt dort, wo auch inhaltlich ein Schnitt ist; benachbarte
   * Jahre sind nie gleich. Zufall je Doppelseite wurde verworfen – über achtzig
   * Doppelseiten wirkt er beliebig, und harte Farbsprünge zwischen zwei
   * aufgeschlagenen Seiten fallen auf.
   */
  chapterColors?: boolean;
  /**
   * Doppelseiten, die nicht gebaut, sondern übernommen werden (`locked`).
   *
   * Sie kosten Seitenbudget, ihre Bilder sind vergeben, und ihren Platz im Buch
   * finden sie über ihren Anker – Näheres in `layout/keep.ts`. Der Generator
   * bleibt dabei deterministisch: Die Seiten kommen von außen, gerechnet wird
   * an ihnen nichts.
   */
  kept?: readonly Spread[];
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
    /** Übernommene Doppelseiten, die das Erzeugen nicht angefasst hat. */
    keptSpreads: number;
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
 *
 * Seit die Titel im Zeitstrahl stehen, kommen nur noch Vorlagen ohne
 * Überschriftenstreifen in Frage: Die `mit-titel`-Fassungen räumen 16 mm am
 * oberen Rand frei und setzen die Bilder entsprechend kleiner.
 */
function chooseTemplate(
  group: readonly Photo[],
  recentTemplateIds: readonly string[],
  profile: PrintProfile,
  weightOf: (id: PhotoId) => PhotoWeight,
  rng: () => number,
): TemplateFit | undefined {
  const candidates = templatesWithoutTitle(group.length);
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

    score += wiederholungsstrafe(recentTemplateIds, (id) => id === template.id);

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

/**
 * Aufschlag dafür, dieselbe Anordnung kurz nach der letzten Verwendung erneut
 * zu nehmen: je näher die letzte, desto teurer, nach vier Doppelseiten null.
 *
 * Das Prädikat statt ein Vergleich, weil „dieselbe Anordnung" zweierlei heißt:
 * bei den Vorlagen dieselbe Kennung, bei den justierten Zeilen dieselbe Familie
 * – die tragen für jede Bilderzahl eine andere Kennung und sähen doch gleich aus.
 */
function wiederholungsstrafe(
  recentTemplateIds: readonly string[],
  gleich: (templateId: string) => boolean,
): number {
  for (let i = recentTemplateIds.length - 1; i >= 0; i--) {
    if (gleich(recentTemplateIds[i]!)) {
      return Math.max(0, 1.2 - 0.3 * (recentTemplateIds.length - i));
    }
  }
  return 0;
}

/**
 * Baut die Doppelseite aus Template, Gruppe und Zuordnung.
 *
 * Ohne Überschrift, und das ist eine Entscheidung: Was eine Doppelseite zeigt,
 * benennt der Zeitstrahl an ihrem Fuß – dort steht der Titel der Fotogruppe auf
 * jeder Seite der Gruppe, nicht nur auf ihrer ersten. Eine Überschrift oben
 * wäre auf der Eröffnungsseite eine Dopplung und auf allen folgenden eine
 * Leerstelle. Nur die Auftaktseite einer Gruppe trägt ihren Titel noch groß
 * (`buildGroupOpener`) – sie besteht aus nichts anderem.
 */
function buildSpread(
  id: string,
  index: number,
  template: Template,
  group: readonly Photo[],
  fit: TemplateFit,
  profile: PrintProfile,
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

  return { id, index, templateId: template.id, slots };
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
 * Erzeugt die Auftaktdoppelseite eines Jahres.
 *
 * Links das Jahr und was in ihm geschah, rechts die ersten Fotos des Jahres.
 * Eine ganze Doppelseite nur für eine Jahreszahl wäre bei neunzehn Jahrgängen
 * ein Viertel des Buches – zu viel für eine Zahl und drei Zeilen. Der Auftakt
 * trägt jetzt Bilder mit und kostet damit nichts extra.
 *
 * Mit `dicht` stehen zusätzlich die Fassungen zur Wahl, die auch auf der
 * Jahresseite Bilder tragen (neun statt sechs). Die Wahl unter ihnen läuft über
 * dieselbe Rechnung wie sonst: Plätze müssen zur Bilderzahl passen, und unter
 * den passenden gewinnt die beste Zuordnung.
 *
 * Sind zu wenige Fotos übrig, wird die bildlose Fassung gesetzt statt eine
 * Vorlage mit leeren Plätzen zu füllen.
 */
function buildChapterOpener(
  id: string,
  index: number,
  chapter: Chapter,
  bilder: readonly Photo[],
  profile: PrintProfile,
  weightOf: (photoId: PhotoId) => PhotoWeight,
  /** Ob die Fassungen mit Bildern auf der Jahresseite mitspielen. */
  dicht: boolean,
  /** Ereignisse des Jahres, je Zeile eines. */
  events?: readonly string[],
): { spread: Spread; usedPhotoIds: PhotoId[] } {
  const auftakte = chapterTemplates(dicht);
  // Unter den Fassungen mit passender Bilderzahl die beste – und die Bilder
  // darin optimal verteilt, nicht der Reihe nach.
  //
  // Vorher nahm die Wahl schlicht die erste Vorlage dieser Größe. Weil die
  // Sechserfassung nur Hochformate hatte und am echten Bestand immer greift,
  // standen dort 47 von 108 Bildern in einem Slot der falschen Ausrichtung und
  // verloren dabei bis zu 58 % ihrer Fläche. Es gibt sie deshalb inzwischen
  // dreimal – hoch, quer und gemischt –, und hier wird gewählt.
  const passend = auftakte.filter((t) => t.slots.length === bilder.length);
  const gewaehlt =
    passend.length > 0
      ? layoutSpread({ photos: bilder, profile, weightOf, candidates: passend })
      : undefined;

  const template = gewaehlt
    ? templateById(gewaehlt.templateId)!
    : (auftakte.find((t) => t.slots.length === 0) ?? auftakte[0]!);

  const slots =
    gewaehlt?.slots ??
    template.slots.map((slot) => ({
      slotId: slot.id,
      photoId: null,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    }));

  const verwendet = gewaehlt ? bilder : [];

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
      // Das Jahr steht am Spread und nicht bloß als Inhalt der Jahreszahl: Die
      // Zahl ist editierbar, „2019 – das erste Jahr" wäre keine Zahl mehr, und
      // die Kapitelnavigation soll davon nicht abhängen. Siehe
      // `Spread.chapterYear`.
      chapterYear: chapter.year,
      ...(texts.length > 0 ? { texts } : {}),
    },
    usedPhotoIds: verwendet.map((p) => p.id),
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
  // Aus, solange nichts anderes gesagt wird: Ein bestehendes Buch soll nach
  // einem Neuaufbau aussehen wie vorher.
  const dichteOpeners = opts.chapterOpenersDense ?? false;
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
  // Festgehaltene Doppelseiten: ihre Bilder sind vergeben, bevor irgendetwas
  // verteilt wird. Sonst stünde dasselbe Foto zweimal im Buch – groß auf der
  // selbst gebauten Seite und klein im Fluss.
  const kept = opts.kept ?? [];
  const keptFotos = keptPhotos(kept);
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
  // Gruppenauftakte reservieren ihr Hauptbild: Es soll nicht zwei Seiten später
  // noch einmal klein im Fluss auftauchen. Jahresauftakte tragen kein Bild mehr
  // und nehmen deshalb auch keines heraus.
  const schonVergeben = new Set<PhotoId>(keptFotos);
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

      auftaktBild.set(g.id, cover);
      schonVergeben.add(cover);
    }
  }

  /**
   * Bilder für die Jahresauftakte: die ersten des Jahres, chronologisch.
   *
   * Sie stehen rechts auf der Auftaktseite und dürfen im Fluss nicht noch
   * einmal auftauchen. Wie viele es sind, gibt die Bibliothek vor – die
   * größte Auftaktvorlage, für die das Jahr genug Bilder übrig hat.
   */
  const auftaktGroessen = chapterTemplates(dichteOpeners)
    .map((t) => t.slots.length)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);

  const jahresBilder = new Map<number, Photo[]>();
  if (useOpeners) {
    for (const chapter of structure.chapters) {
      const frei = chapter.segments
        .flatMap((s) => s.photoIds)
        .filter((id) => !schonVergeben.has(id))
        .map((id) => photos.get(id))
        .filter((p): p is Photo => p !== undefined);

      // Genug muss übrig bleiben, damit das Jahr auch im Fluss noch Bilder hat.
      const groesse = auftaktGroessen.find((n) => frei.length >= n * 2);
      if (groesse === undefined) continue;
      const gewaehlt = frei.slice(0, groesse);
      jahresBilder.set(chapter.year, gewaehlt);
      for (const p of gewaehlt) schonVergeben.add(p.id);
    }
  }

  const ausDemFluss = new Set([
    ...keptFotos,
    ...auftaktBild.values(),
    ...[...jahresBilder.values()].flat().map((p) => p.id),
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
  // Festgehaltene Seiten sind schon gedruckt gedacht und kosten genauso.
  const auftaktSpreads = auftaktBild.size;
  const budgets = distributeBudget(budgetKapitel, {
    targetPages: Math.max(2, zielSeiten - (auftaktSpreads + kept.length) * 2),
    chapterSpreads: useOpeners ? 1 : 0,
    maxPhotosPerSpread: Math.max(...slotCounts, 1),
  });
  const spreadsPerYear = budgetByYear(budgets);

  // Farbe je Jahrgang. Auf den Doppelseiten gesetzt und nicht erst beim
  // Rendern aufgelöst: So steht sie im Layout-Dokument, lässt sich dort ändern
  // und eine von Hand gewählte Farbe unterscheidet sich nicht von einer
  // erzeugten.
  const jahresFarbe =
    (opts.chapterColors ?? true)
      ? chapterBackgrounds(
          structure.chapters.map((c) => c.year),
          opts.seed ?? 1,
        )
      : new Map<number, string>();

  const spreads: Spread[] = [];
  const placed = new Set<PhotoId>(keptFotos);
  const recentTemplates: string[] = [];
  let chapterOpenerCount = 0;

  for (const chapter of structure.chapters) {
    const farbe = jahresFarbe.get(chapter.year);
    const abHier = spreads.length;

    if (useOpeners) {
      const { spread, usedPhotoIds } = buildChapterOpener(
        `spread-${spreads.length}`,
        spreads.length,
        chapter,
        jahresBilder.get(chapter.year) ?? [],
        profile,
        weightOf,
        dichteOpeners,
        opts.yearEvents?.[chapter.year],
      );
      spreads.push(spread);
      chapterOpenerCount++;
      for (const id of usedPhotoIds) placed.add(id);
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

      // Eröffnet diese Doppelseite eine benannte Gruppe? Dann kommt hier ihre
      // Auftaktseite hin.
      //
      // Maßgeblich ist die Gruppe mit den meisten Fotos, nicht die des ersten.
      // Vorher entschied allein das erste Foto: Lag dort ein Bild einer anderen
      // Gruppe – oder war das Auftaktbild bereits aus dem Fluss genommen –,
      // wurde die Gruppe nicht erkannt, ihr reservierter Auftakt nie gebaut und
      // das reservierte Bild landete in keiner Doppelseite. Gemessen fehlten so
      // neun Fotos.
      const gruppenId = mehrheitsGruppe(groupPhotos, groupOf);
      const eroeffnet = gruppenId !== undefined && !gruppenGesehen.has(gruppenId);
      const gruppenTitel = eroeffnet ? titelVonGruppe.get(gruppenId) : undefined;
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
        }
      }

      const fit = chooseTemplate(groupPhotos, recentTemplates, profile, weightOf, rng);
      if (!fit) continue;

      // Trägt keine Vorlage diese Mischung gut, rechnet die Seite ihre Plätze
      // selbst. Das ist der Ausweg aus einem Zielkonflikt der Bibliothek: Ein
      // Mosaik aus dreizehn Bildern legt dreizehn Formen fest, und die Mischung
      // aus Hoch- und Querformat, die dazu passt, kommt selten genau so vor.
      //
      // Die Wiederholungsstrafe gilt auch hier, und sie muss es: Justierte
      // Zeilen sind eine Familie, nicht eine Vorlage – ohne sie liefen ganze
      // Serien von Gitterseiten hintereinander, weil dieselbe Mischung meist
      // mehrere Doppelseiten füllt.
      const justiert = justifySpread({
        photos: groupPhotos,
        profile,
        weightOf,
        beatScore: fit.score - wiederholungsstrafe(recentTemplates, isJustified),
      });

      let spread: Spread | undefined;
      if (justiert) {
        spread = {
          id: `spread-${spreads.length}`,
          index: spreads.length,
          templateId: justiert.templateId,
          slots: justiert.slots,
        };
      } else {
        const template = templateById(fit.templateId);
        if (!template) continue;
        spread = buildSpread(
          `spread-${spreads.length}`,
          spreads.length,
          template,
          groupPhotos,
          fit,
          profile,
        );
      }
      spreads.push(spread);

      for (const p of groupPhotos) placed.add(p.id);

      recentTemplates.push(spread.templateId);
      if (recentTemplates.length > 4) recentTemplates.shift();
    }

    // Alle Doppelseiten dieses Jahrgangs tragen dessen Farbe.
    if (farbe !== undefined) {
      for (let i = abHier; i < spreads.length; i++) spreads[i]!.background = farbe;
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
      if (farbe !== undefined) opener.background = farbe;
      spreads.push(opener);
      groupOpenerCount++;
      placed.add(coverId);
    }
  }

  // Die festgehaltenen Seiten kommen zurück an ihren Platz, bevor irgendetwas
  // gezählt wird: Die Kennzahlen sollen das Buch beschreiben, das entsteht,
  // nicht nur den Teil, den die Engine gebaut hat.
  const alle = insertKept(spreads, kept);

  // Auswertung
  const allPhotoIds = structure.chapters.flatMap((c) => c.segments.flatMap((s) => s.photoIds));
  const unplaced = allPhotoIds.filter((id) => !placed.has(id));

  // Dieselbe Rechnung wie nach einer punktuellen Änderung – die Kennzahlen
  // eines generierten und eines von Hand nachbearbeiteten Buchs entstehen
  // damit auf genau einem Weg.
  const stats = bookStats({ spreads: alle, photos, profile });

  // Was die Engine noch zu verteilen hatte: ohne die Bilder, die auf
  // festgehaltenen Seiten schon liegen.
  const platzierbar =
    structure.chapters.reduce((n, c) => n + c.photoCount, 0) -
    allPhotoIds.filter((id) => keptFotos.has(id)).length;

  return {
    spreads: alle,
    budgets,
    report: {
      photoCount: structure.photoCount,
      placedCount: stats.placedCount,
      spreadCount: alle.length,
      pageCount: alle.length * 2,
      targetPages,
      effectiveTargetPages: zielSeiten,
      chapterOpeners: chapterOpenerCount,
      groupOpeners: groupOpenerCount,
      keptSpreads: kept.length,
      unplaced,
      worstDpi: stats.worstDpi,
      belowTargetDpi: stats.belowTargetDpi,
      belowMinDpi: stats.belowMinDpi,
      photosPerSpread: stats.photosPerSpread,
      feasibility: checkFeasibility(
        platzierbar,
        Math.max(2, zielSeiten - kept.length * 2),
        slotCounts,
        structure.chapters.length,
        useOpeners,
      ),
    },
  };
}
