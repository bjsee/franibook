/**
 * Titelvorschläge für Segmente.
 *
 * Nach der Bestandsanalyse ist dies der wertvollste Detektor überhaupt: Weil
 * zeitliche Lücken bei einem vorausgewählten Bestand keine Ereignisgrenzen
 * mehr markieren, sind Kalendermarken die einzige inhaltliche Gliederung, die
 * sich ohne Bildanalyse verlässlich setzen lässt.
 *
 * Für ein Buch zum 18. Geburtstag liefert allein die Geburtstagserkennung 18
 * sichere Ankerpunkte.
 *
 * Alle Titel sind Vorschläge. Die Oberfläche kennzeichnet sie als solche, und
 * ein Klick übernimmt oder verwirft sie.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { Segment, Serie } from './segment.js';

export interface DetectionContext {
  /** Geburtsdatum der Person, um die das Buch geht. */
  birthDate?: string;
  name?: string;
}

export interface TitleSuggestion {
  title: string;
  source: string;
  /** 0..1 – wie sicher der Vorschlag ist. */
  confidence: number;
  /** Fotos, auf die sich der Vorschlag stützt. */
  photoIds: string[];
}

export interface SegmentDetector {
  id: string;
  detect(segment: Segment, ctx: DetectionContext): TitleSuggestion[];
}

function dayOf(v: NaiveDateTime): { month: number; day: number } {
  return { month: Number(v.slice(5, 7)), day: Number(v.slice(8, 10)) };
}

function yearOf(v: NaiveDateTime): number {
  return Number(v.slice(0, 4));
}

/**
 * Ostersonntag nach der anonymen gregorianischen Berechnung.
 *
 * Ostern verschiebt sich jedes Jahr, ein fester Kalendereintrag reicht also
 * nicht. Die Formel ist für alle Jahre des gregorianischen Kalenders gültig.
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Fotos eines Segments, die auf einen bestimmten Kalendertag fallen. */
function photosOnDays(
  segment: Segment,
  matches: (d: { month: number; day: number }) => boolean,
): string[] {
  const ids: string[] = [];
  for (const serie of segment.series) {
    // Serien sind kurz; from genügt zur Tagesbestimmung
    if (matches(dayOf(serie.from))) ids.push(...serie.photoIds);
  }
  return ids;
}

/**
 * Geburtstage.
 *
 * Der wertvollste Detektor für diesen Anwendungsfall. Das Alter wird aus dem
 * Jahresabstand berechnet, wobei ein Geburtstag vor dem eigentlichen Tag noch
 * zum Vorjahr zählt.
 */
export const birthdayDetector: SegmentDetector = {
  id: 'calendar:birthday',
  detect(segment, ctx) {
    if (!ctx.birthDate) return [];
    const birth = dayOf(ctx.birthDate);
    const birthYear = yearOf(ctx.birthDate);

    const ids = photosOnDays(segment, (d) => {
      // ± 3 Tage: Feiern finden am Wochenende statt, nicht am Stichtag
      const sameMonth = d.month === birth.month;
      const nearDay = Math.abs(d.day - birth.day) <= 3;
      return sameMonth && nearDay;
    });

    if (ids.length === 0) return [];

    const age = segment.year - birthYear;
    if (age < 0 || age > 120) return [];

    return [
      {
        title: age === 0 ? 'Geburt' : `${age}. Geburtstag`,
        source: this.id,
        confidence: ids.length >= 3 ? 0.9 : 0.7,
        photoIds: ids,
      },
    ];
  },
};

export const christmasDetector: SegmentDetector = {
  id: 'calendar:christmas',
  detect(segment) {
    if (segment.month !== 12) return [];
    const ids = photosOnDays(segment, (d) => d.month === 12 && d.day >= 24 && d.day <= 26);
    if (ids.length === 0) return [];
    return [
      {
        title: `Weihnachten ${segment.year}`,
        source: this.id,
        confidence: 0.85,
        photoIds: ids,
      },
    ];
  },
};

export const newYearDetector: SegmentDetector = {
  id: 'calendar:newyear',
  detect(segment) {
    const ids = photosOnDays(
      segment,
      (d) => (d.month === 12 && d.day === 31) || (d.month === 1 && d.day === 1),
    );
    if (ids.length === 0) return [];
    return [
      {
        title: segment.month === 12 ? `Silvester ${segment.year}` : `Neujahr ${segment.year}`,
        source: this.id,
        confidence: 0.8,
        photoIds: ids,
      },
    ];
  },
};

export const easterDetector: SegmentDetector = {
  id: 'calendar:easter',
  detect(segment) {
    const easter = easterSunday(segment.year);
    const ids = photosOnDays(segment, (d) => {
      if (d.month !== easter.month) return false;
      // Karfreitag bis Ostermontag
      return d.day >= easter.day - 2 && d.day <= easter.day + 1;
    });
    if (ids.length < 2) return [];
    return [
      {
        title: `Ostern ${segment.year}`,
        source: this.id,
        confidence: 0.6,
        photoIds: ids,
      },
    ];
  },
};

/**
 * Auffällig dichte Tage ohne Kalenderbezug.
 *
 * Wo an einem einzelnen Tag ungewöhnlich viele Fotos entstanden, war
 * offensichtlich etwas los – auch wenn der Kalender nichts dazu sagt. Der
 * Detektor vergibt keinen Titel, sondern markiert den Tag, damit die
 * Layout-Engine ihm mehr Raum geben kann.
 */
export const busyDayDetector: SegmentDetector = {
  id: 'density:busy-day',
  detect(segment) {
    const byDay = new Map<string, Serie[]>();
    for (const serie of segment.series) {
      const key = serie.from.slice(0, 10);
      const list = byDay.get(key);
      if (list) list.push(serie);
      else byDay.set(key, [serie]);
    }

    const suggestions: TitleSuggestion[] = [];
    for (const [day, series] of byDay) {
      const ids = series.flatMap((s) => s.photoIds);
      // Mehr als ein Drittel des Monats an einem Tag, und mindestens fünf
      if (ids.length >= 5 && ids.length > segment.photoIds.length / 3) {
        suggestions.push({
          title: formatDay(day),
          source: this.id,
          confidence: 0.4,
          photoIds: ids,
        });
      }
    }
    return suggestions;
  },
};

function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${Number(d)}. ${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

const MONTHS_SHORT = [
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

export const DEFAULT_DETECTORS: SegmentDetector[] = [
  birthdayDetector,
  christmasDetector,
  newYearDetector,
  easterDetector,
  busyDayDetector,
];

/**
 * Führt alle Detektoren aus und setzt den besten Vorschlag als Segmenttitel.
 *
 * Verändert die Segmente nicht, sondern liefert eine neue Liste – die
 * Gliederung selbst bleibt Sache von `buildStructure`.
 */
export function suggestTitles(
  segments: readonly Segment[],
  ctx: DetectionContext,
  detectors: readonly SegmentDetector[] = DEFAULT_DETECTORS,
): Segment[] {
  return segments.map((segment) => {
    const all = detectors.flatMap((d) => d.detect(segment, ctx));
    if (all.length === 0) return segment;

    // Bester Vorschlag: höchste Konfidenz, bei Gleichstand der mit mehr Fotos
    const best = all.sort(
      (a, b) => b.confidence - a.confidence || b.photoIds.length - a.photoIds.length,
    )[0]!;

    return { ...segment, title: best.title, titleSource: best.source };
  });
}
