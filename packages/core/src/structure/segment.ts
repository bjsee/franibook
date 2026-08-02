/**
 * Gliederung des Bestands.
 *
 * Ursprünglich sah das Konzept zeitliche Lücken als Hauptquelle der
 * Gliederung vor. Am echten Bestand trägt das nicht: Er ist bereits
 * vorausgewählt, die Median-Lücke zwischen zwei Fotos beträgt 1,2 Tage, und
 * eine lückenbasierte Segmentierung zerfällt in 502 Gruppen, davon 338 mit
 * einem einzigen Foto.
 *
 * Deshalb gliedert der Kalender:
 *
 *   Jahr    → Kapitel (19 Stück, im Schnitt 44 Fotos, 4–5 Doppelseiten)
 *   Monat   → Segment (weiche Gruppierung, bestimmt Seitenumbrüche)
 *   Tag     → Serie (hält Aufnahmen einer Stunde auf derselben Doppelseite)
 *
 * Messwerte in docs/spikes/bestandsanalyse.adoc.
 */
import type { NaiveDateTime, PhotoId } from '../model/photo.js';

export interface DatedPhoto {
  id: PhotoId;
  date: NaiveDateTime;
}

export interface Serie {
  /** Fotos, die zeitlich eng zusammengehören. */
  photoIds: PhotoId[];
  from: NaiveDateTime;
  to: NaiveDateTime;
}

export interface Segment {
  id: string;
  year: number;
  /** 1..12 */
  month: number;
  photoIds: PhotoId[];
  from: NaiveDateTime;
  to: NaiveDateTime;
  /** Serien innerhalb des Segments – die Layout-Engine hält sie zusammen. */
  series: Serie[];
  /** Titelvorschlag eines Detektors. Immer nur ein Vorschlag. */
  title?: string;
  titleSource?: string;
}

export interface Chapter {
  year: number;
  segments: Segment[];
  photoCount: number;
  from: NaiveDateTime;
  to: NaiveDateTime;
}

export interface Structure {
  chapters: Chapter[];
  /** Fotos ohne verwertbares Datum. Müssen vor dem Export einsortiert werden. */
  undated: PhotoId[];
  photoCount: number;
}

const HOUR_MS = 3_600_000;

function parse(v: NaiveDateTime): number {
  return Date.parse(`${v}Z`);
}

function yearOf(v: NaiveDateTime): number {
  return Number(v.slice(0, 4));
}

function monthOf(v: NaiveDateTime): number {
  return Number(v.slice(5, 7));
}

function dayKey(v: NaiveDateTime): string {
  return v.slice(0, 10);
}

/**
 * Zerlegt die Fotos eines Segments in Serien.
 *
 * Innerhalb eines Tages trennt eine Lücke von mehr als `gapHours`; ein
 * Tageswechsel trennt immer. Anders als bei der verworfenen Gesamtgliederung
 * ist die Zeitlücke hier sinnvoll: Sie sagt nichts über Ereignisgrenzen, aber
 * viel darüber, welche Aufnahmen nebeneinander gut aussehen.
 */
function buildSeries(photos: readonly DatedPhoto[], gapHours: number): Serie[] {
  if (photos.length === 0) return [];

  const series: Serie[] = [];
  let current: DatedPhoto[] = [photos[0]!];

  for (let i = 1; i < photos.length; i++) {
    const prev = photos[i - 1]!;
    const curr = photos[i]!;
    const gap = parse(curr.date) - parse(prev.date);
    const sameDay = dayKey(curr.date) === dayKey(prev.date);

    if (!sameDay || gap > gapHours * HOUR_MS) {
      series.push(toSerie(current));
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  series.push(toSerie(current));
  return series;
}

function toSerie(photos: DatedPhoto[]): Serie {
  return {
    photoIds: photos.map((p) => p.id),
    from: photos[0]!.date,
    to: photos.at(-1)!.date,
  };
}

export interface StructureOptions {
  /** Lücke, ab der innerhalb eines Tages eine neue Serie beginnt. */
  serieGapHours?: number;
}

/**
 * Baut die Kapitel- und Segmentstruktur aus datierten Fotos.
 *
 * Erwartet die Fotos chronologisch sortiert; undatierte werden getrennt
 * gesammelt statt ans Ende einsortiert – sie brauchen eine Entscheidung, keine
 * stillschweigende Platzierung.
 */
export function buildStructure(
  dated: readonly DatedPhoto[],
  undated: readonly PhotoId[] = [],
  opts: StructureOptions = {},
): Structure {
  const gapHours = opts.serieGapHours ?? 3;
  const sorted = [...dated].sort((a, b) => a.date.localeCompare(b.date));

  // Nach Jahr und Monat bündeln
  const byMonth = new Map<string, DatedPhoto[]>();
  for (const p of sorted) {
    const key = `${yearOf(p.date)}-${String(monthOf(p.date)).padStart(2, '0')}`;
    const list = byMonth.get(key);
    if (list) list.push(p);
    else byMonth.set(key, [p]);
  }

  const segments: Segment[] = [];
  for (const [key, photos] of byMonth) {
    segments.push({
      id: `seg-${key}`,
      year: yearOf(photos[0]!.date),
      month: monthOf(photos[0]!.date),
      photoIds: photos.map((p) => p.id),
      from: photos[0]!.date,
      to: photos.at(-1)!.date,
      series: buildSeries(photos, gapHours),
    });
  }

  segments.sort((a, b) => a.from.localeCompare(b.from));

  const byYear = new Map<number, Segment[]>();
  for (const s of segments) {
    const list = byYear.get(s.year);
    if (list) list.push(s);
    else byYear.set(s.year, [s]);
  }

  const chapters: Chapter[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, segs]) => ({
      year,
      segments: segs,
      photoCount: segs.reduce((n, s) => n + s.photoIds.length, 0),
      from: segs[0]!.from,
      to: segs.at(-1)!.to,
    }));

  return {
    chapters,
    undated: [...undated],
    photoCount: sorted.length + undated.length,
  };
}

/** Alle Segmente eines Buches in Buchreihenfolge. */
export function allSegments(structure: Structure): Segment[] {
  return structure.chapters.flatMap((c) => c.segments);
}

/** Deutscher Monatsname – für Titel und Beschriftungen. */
export const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

export function monthLabel(segment: Segment): string {
  return `${MONTH_NAMES[segment.month - 1]} ${segment.year}`;
}
