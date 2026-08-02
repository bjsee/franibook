/**
 * Verteilung der Fotos auf Doppelseiten.
 *
 * Zwei Schritte:
 *   1. Seitenbudget – wie viele Doppelseiten bekommt jedes Jahr?
 *   2. Gruppierung  – wie werden die Fotos eines Segments auf sie verteilt?
 *
 * Die Reihenfolge ist chronologisch fixiert. Gesucht ist deshalb nicht eine
 * beliebige Aufteilung, sondern die beste *Segmentierung* einer geordneten
 * Liste – ein Problem, das sich mit dynamischer Programmierung exakt lösen
 * lässt statt gierig zu raten.
 */
import type { Chapter, Segment, Structure } from '../structure/segment.js';

export interface BudgetOptions {
  /** Angestrebte Gesamtseitenzahl des Innenteils. */
  targetPages: number;
  /** Doppelseiten, die für Kapitelauftakte reserviert werden. */
  chapterSpreads?: number;
  /**
   * Dämpfung der Verteilung. Ein Exponent unter 1 sorgt dafür, dass ein Jahr
   * mit 111 Fotos nicht elfmal so viel Raum bekommt wie eines mit 10 – große
   * Jahre vertragen eine dichtere Belegung, kleine Momente würden sonst auf
   * halbe Seiten zusammenschrumpfen.
   */
  exponent?: number;
  /** Mindestzahl Doppelseiten je Jahr. */
  minSpreadsPerChapter?: number;
}

export interface ChapterBudget {
  year: number;
  photoCount: number;
  /** Doppelseiten für Fotos, ohne Kapitelauftakt. */
  spreads: number;
}

/**
 * Verteilt die verfügbaren Doppelseiten auf die Jahre.
 *
 * Am echten Bestand liegt das Verhältnis zwischen stärkstem und schwächstem
 * Jahr bei 11:1 (2024 mit 111 Fotos, 2012 mit 10). Der Exponent dämpft das auf
 * etwa 7:1.
 */
export function distributeBudget(
  chapters: readonly Chapter[],
  opts: BudgetOptions,
): ChapterBudget[] {
  const exponent = opts.exponent ?? 0.85;
  const minSpreads = opts.minSpreadsPerChapter ?? 1;
  const chapterSpreads = opts.chapterSpreads ?? 0;

  // Eine Doppelseite sind zwei Seiten
  const totalSpreads = Math.floor(opts.targetPages / 2) - chapterSpreads * chapters.length;
  if (totalSpreads <= 0 || chapters.length === 0) {
    return chapters.map((c) => ({ year: c.year, photoCount: c.photoCount, spreads: minSpreads }));
  }

  const weights = chapters.map((c) => Math.pow(c.photoCount, exponent));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // Erste Zuteilung proportional zum gedämpften Gewicht
  const raw = chapters.map((c, i) => (weights[i]! / weightSum) * totalSpreads);
  const budgets: ChapterBudget[] = chapters.map((c, i) => ({
    year: c.year,
    photoCount: c.photoCount,
    spreads: Math.max(minSpreads, Math.floor(raw[i]!)),
  }));

  // Rest nach größtem Nachkommaanteil verteilen, damit die Summe stimmt
  let used = budgets.reduce((n, b) => n + b.spreads, 0);
  const remainders = chapters
    .map((_, i) => ({ i, frac: raw[i]! - Math.floor(raw[i]!) }))
    .sort((a, b) => b.frac - a.frac);

  let k = 0;
  while (used < totalSpreads && remainders.length > 0) {
    budgets[remainders[k % remainders.length]!.i]!.spreads++;
    used++;
    k++;
  }

  // Bei Überbuchung dort abziehen, wo die Belegung am dünnsten ist
  while (used > totalSpreads) {
    const kandidat = budgets
      .filter((b) => b.spreads > minSpreads)
      .sort((a, b) => a.photoCount / a.spreads - b.photoCount / b.spreads)[0];
    if (!kandidat) break;
    kandidat.spreads--;
    used--;
  }

  return budgets;
}

export interface GroupingOptions {
  /** Gruppengrößen, für die es Templates gibt. */
  slotCounts: readonly number[];
  /** Wie viele Doppelseiten dem Kapitel zustehen. */
  targetSpreads: number;
}

export interface PhotoGroup {
  photoIds: string[];
  /** Aus welchem Segment das erste Foto der Gruppe stammt. */
  segmentId: string;
  /** Ob die Gruppe ein Segment eröffnet – Kandidat für einen Titel. */
  startsSegment: boolean;
}

/**
 * Zerlegt die Fotos eines ganzen Jahres in Gruppen passender Größe.
 *
 * Bewusst über das Kapitel und nicht über einzelne Monate: Am echten Bestand
 * stehen 167 Monatssegmente rund 85 Doppelseiten gegenüber. Würde jedes
 * Segment mindestens eine eigene Doppelseite bekommen, käme ein Buch mit über
 * 500 Doppelseiten heraus. Der Monat ist eine *weiche* Gruppierung: Er wird
 * als Schnittpunkt bevorzugt, aber nicht erzwungen.
 *
 * Dynamische Programmierung über die Kostenfunktion: Für jede Präfixlänge wird
 * die günstigste Zerlegung gespeichert und am Ende zurückverfolgt. Exakt statt
 * gierig, und bei einigen hundert Fotos je Jahr in Millisekunden erledigt.
 */
export function groupChapter(chapter: Chapter, opts: GroupingOptions): PhotoGroup[] {
  const photoIds = chapter.segments.flatMap((s) => s.photoIds);
  const n = photoIds.length;
  if (n === 0) return [];

  const counts = [...opts.slotCounts].sort((a, b) => a - b);
  const maxCount = counts.at(-1)!;
  const idealSize = opts.targetSpreads > 0 ? n / opts.targetSpreads : maxCount;

  // Zuordnungen, die die Kostenfunktion braucht
  const serieOf = new Map<string, string>();
  const segmentOf = new Map<string, string>();
  const segmentStart = new Map<string, number>();

  let position = 0;
  for (const segment of chapter.segments) {
    segmentStart.set(segment.id, position);
    for (const serie of segment.series) {
      for (const id of serie.photoIds) serieOf.set(id, `${segment.id}#${serie.from}`);
    }
    for (const id of segment.photoIds) segmentOf.set(id, segment.id);
    position += segment.photoIds.length;
  }

  const bestCost = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const backtrack = new Array<number>(n + 1).fill(0);
  bestCost[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (const k of counts) {
      if (k > i) break;
      const prev = bestCost[i - k]!;
      if (!Number.isFinite(prev)) continue;

      const cost = prev + groupCost(photoIds, i - k, k, idealSize, serieOf, segmentOf);
      if (cost < bestCost[i]!) {
        bestCost[i] = cost;
        backtrack[i] = k;
      }
    }
  }

  // Zurückverfolgen
  const sizes: number[] = [];
  let pos = n;
  while (pos > 0) {
    const k = backtrack[pos]!;
    if (k === 0) break; // Schutz gegen eine Endlosschleife bei unerreichbarem Zustand
    sizes.unshift(k);
    pos -= k;
  }

  const groups: PhotoGroup[] = [];
  const gesehen = new Set<string>();
  let offset = 0;

  for (const size of sizes) {
    const ids = photoIds.slice(offset, offset + size);
    const segmentId = segmentOf.get(ids[0]!) ?? chapter.segments[0]!.id;
    const startsSegment = !gesehen.has(segmentId);
    gesehen.add(segmentId);
    groups.push({ photoIds: ids, segmentId, startsSegment });
    offset += size;
  }

  return groups;
}

/**
 * Kosten einer Gruppe.
 *
 * Bewertet ausschließlich die Zusammenstellung, nicht das Layout – die
 * Templatewahl kommt danach und kennt diese Kosten nicht.
 */
function groupCost(
  photoIds: readonly string[],
  start: number,
  size: number,
  idealSize: number,
  serieOf: ReadonlyMap<string, string>,
  segmentOf: ReadonlyMap<string, string>,
): number {
  const ids = photoIds.slice(start, start + size);

  // 1. Abweichung von der Zielgröße. Quadratisch, damit Ausreißer wehtun, und
  //    deutlich gewichtet: Die Budgettreue entscheidet über die Seitenzahl des
  //    ganzen Buches und wiegt damit schwerer als die Monatsreinheit einer
  //    einzelnen Doppelseite. Ohne diese Gewichtung drückt die Monatsstrafe
  //    die Gruppen systematisch zu klein und das Buch wird zu dick.
  const sizeDeviation = 3 * Math.pow((size - idealSize) / Math.max(1, idealSize), 2);

  // 2. Zerrissene Serien: eine Gruppe, die mitten in einer Aufnahmefolge
  //    beginnt oder endet, trennt Zusammengehöriges auf zwei Doppelseiten.
  let serieBreaks = 0;
  const first = ids[0]!;
  const last = ids.at(-1)!;
  const before = start > 0 ? photoIds[start - 1] : undefined;
  const after = photoIds[start + size];
  if (before && serieOf.get(before) === serieOf.get(first)) serieBreaks++;
  if (after && serieOf.get(after) === serieOf.get(last)) serieBreaks++;

  // 3. Monatsvermischung: Der Monat ist eine weiche Grenze. Eine Doppelseite
  //    darf zwei Monate zeigen – muss sie bei kleinen Monaten sogar –, aber
  //    ein sauberer Schnitt ist die bessere Wahl, wenn er sonst nichts kostet.
  const monate = new Set(ids.map((id) => segmentOf.get(id))).size;
  const monthMix = Math.max(0, monate - 1) * 0.25;

  // 4. Vermengung unzusammenhängender Momente
  const serien = new Set(ids.map((id) => serieOf.get(id))).size;
  const mixPenalty = Math.max(0, serien - 3) * 0.1;

  return sizeDeviation + serieBreaks * 0.4 + monthMix + mixPenalty;
}

/** Gesamtzahl Doppelseiten einer Gruppierung. */
export function countSpreads(groups: readonly PhotoGroup[]): number {
  return groups.length;
}

/** Nachschlagetabelle Kapitelbudget je Jahr. */
export function budgetByYear(budgets: readonly ChapterBudget[]): Map<number, number> {
  return new Map(budgets.map((b) => [b.year, b.spreads]));
}

/** Alle Segmente eines Kapitels als Nachschlagetabelle. */
export function segmentsById(structure: Structure): Map<string, Segment> {
  return new Map(structure.chapters.flatMap((c) => c.segments).map((s) => [s.id, s]));
}
