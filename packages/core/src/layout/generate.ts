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
import type { PrintProfile } from '../print/profile.js';
import type { Chapter, Segment, Structure } from '../structure/segment.js';
import {
  chapterTemplates,
  supportedSlotCounts,
  templateById,
  templatesWithSlotCount,
  templatesWithTitle,
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
  groups?: readonly { id: string; photoIds: readonly PhotoId[]; active: boolean; title: string }[];
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
    targetPages: number;
    chapterOpeners: number;
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
  const candidates = mitTitel.length > 0 ? mitTitel : templatesWithSlotCount(group.length);
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

/** Erzeugt eine Kapitel-Auftaktdoppelseite für ein Jahr. */
function buildChapterOpener(
  id: string,
  index: number,
  chapter: Chapter,
  photos: ReadonlyMap<PhotoId, Photo>,
  profile: PrintProfile,
  rng: () => number,
): { spread: Spread; usedPhotoId?: PhotoId } {
  const templates = chapterTemplates();
  // Bevorzugt die Variante mit Bild, sofern ein geeignetes Foto vorhanden ist
  const withImage = templates.filter((t) => t.slots.length > 0);
  const withoutImage = templates.filter((t) => t.slots.length === 0);

  // Kandidat: das Foto mit der höchsten Auflösung im Jahr
  const candidates = chapter.segments
    .flatMap((s) => s.photoIds)
    .map((pid) => photos.get(pid))
    .filter((p): p is Photo => p !== undefined);

  let template = withoutImage[0] ?? templates[0]!;
  let usedPhotoId: PhotoId | undefined;

  if (withImage.length > 0 && candidates.length > 0) {
    const template2 = withImage[Math.floor(rng() * withImage.length)]!;
    const slot = template2.slots[0]!;
    const geometry = slotGeometry(slot, profile);

    // Bestes Foto für diesen Slot
    const best = candidates
      .map((photo) => ({
        photo,
        cost: slotCost(photo, slot, geometry, { profile, weightOf: () => 'normal' }),
      }))
      .filter((c) => c.cost.dpi >= profile.resolution.minDpi)
      .sort((a, b) => a.cost.total - b.cost.total)[0];

    if (best) {
      template = template2;
      usedPhotoId = best.photo.id;
    }
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

  return {
    spread: {
      id,
      index,
      templateId: template.id,
      slots,
      ...(yearSlot
        ? {
            texts: [
              {
                id: `${id}-year`,
                role: 'year' as const,
                content: String(chapter.year),
                slotId: yearSlot.id,
              },
            ],
          }
        : {}),
    },
    ...(usedPhotoId ? { usedPhotoId } : {}),
  };
}

/**
 * Erzeugt das komplette Buch.
 */
export function generateBook(opts: GenerateOptions): GenerateResult {
  const { structure, photos, profile, targetPages } = opts;
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);
  const useOpeners = opts.chapterOpeners ?? true;
  const rng = mulberry32(opts.seed ?? 1);

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
  const gruppenGesehen = new Set<string>();

  const budgets = distributeBudget(structure.chapters, {
    targetPages,
    chapterSpreads: useOpeners ? 1 : 0,
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
        rng,
      );
      spreads.push(spread);
      chapterOpenerCount++;
      // Das Auftaktfoto bleibt im Fluss – es doppelt zu zeigen ist gewollter
      // Wiedererkennungswert, kein Fehler.
      void usedPhotoId;
    }

    // Über das ganze Jahr gruppieren, nicht je Monat: Monatsgrenzen sind
    // bevorzugte Schnittpunkte, keine harten.
    const groups = groupChapter(chapter, {
      slotCounts,
      targetSpreads: spreadsPerYear.get(chapter.year) ?? 1,
      ...(groupOf.size > 0 ? { groupOf } : {}),
    });

    for (const group of groups) {
      const groupPhotos = group.photoIds
        .map((id) => photos.get(id))
        .filter((p): p is Photo => p !== undefined);
      if (groupPhotos.length === 0) continue;

      // Eröffnet diese Doppelseite eine benannte Gruppe? Dann trägt sie deren
      // Titel – und braucht eine Vorlage, die Platz dafür hat.
      const gruppenId = groupOf.get(groupPhotos[0]!.id);
      const eroeffnet = gruppenId !== undefined && !gruppenGesehen.has(gruppenId);
      const gruppenTitel = eroeffnet ? titelVonGruppe.get(gruppenId) : undefined;
      if (gruppenId !== undefined) gruppenGesehen.add(gruppenId);

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
      chapterOpeners: chapterOpenerCount,
      unplaced,
      worstDpi: Number.isFinite(worstDpi) ? worstDpi : 0,
      belowTargetDpi: belowTarget,
      belowMinDpi,
      photosPerSpread: spreads.length > 0 ? placed.size / spreads.length : 0,
      feasibility: checkFeasibility(
        platzierbar,
        targetPages,
        slotCounts,
        structure.chapters.length,
        useOpeners,
      ),
    },
  };
}
