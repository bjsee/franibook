/**
 * Vertiefung der Bestandsanalyse. Rein lesend.
 *
 * Der erste Durchgang hat zwei Konzeptannahmen erschüttert:
 *
 *  1. Auflösung – Median 2048 px lange Kante. Ganzseitige Layouts wären
 *     für fast den gesamten Bestand unbrauchbar. Hier wird geprüft, wie sich
 *     das verteilt und ob es an bestimmten Jahren oder Kameras hängt.
 *
 *  2. Ereigniserkennung – die Zeitlücken-Heuristik zerlegt 831 Fotos in 502
 *     Segmente, davon 338 mit nur einem Foto. Bei einem *vorausgewählten*
 *     Bestand liegen zwischen zwei Fotos regelmäßig Tage, weil pro Anlass nur
 *     ein oder zwei Bilder übrig geblieben sind. Hier werden alternative
 *     Gruppierungen gegen denselben Bestand gerechnet.
 */
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import { effectiveDpi } from '@franibook/core';
import { mapLimit } from './util.js';

const SRC = process.argv[2] ?? '/Users/see/nas/dokumente/Franziska/buch';
const CONCURRENCY = Math.max(1, availableParallelism() - 1);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff']);

const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Item {
  name: string;
  longEdge: number;
  width: number;
  height: number;
  date: Date;
  camera: string;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function bar(n: number, max: number, width = 34): string {
  return '█'.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)} %`;
}

/** Gruppiert eine chronologische Liste, wenn die Lücke die Schwelle übersteigt. */
function segmentByGap(sorted: Item[], thresholdMs: number): number[] {
  const sizes: number[] = [];
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime() > thresholdMs) {
      sizes.push(current);
      current = 1;
    } else current++;
  }
  sizes.push(current);
  return sizes;
}

/** Gruppiert nach Kalendereinheit. */
function segmentByCalendar(sorted: Item[], unit: 'day' | 'week' | 'month' | 'quarter'): number[] {
  const key = (d: Date): string => {
    switch (unit) {
      case 'day':
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      case 'week': {
        const onejan = new Date(d.getFullYear(), 0, 1);
        const week = Math.floor((d.getTime() - onejan.getTime()) / (7 * DAY));
        return `${d.getFullYear()}-w${week}`;
      }
      case 'month':
        return `${d.getFullYear()}-${d.getMonth()}`;
      case 'quarter':
        return `${d.getFullYear()}-q${Math.floor(d.getMonth() / 3)}`;
    }
  };
  const counts = new Map<string, number>();
  for (const i of sorted) counts.set(key(i.date), (counts.get(key(i.date)) ?? 0) + 1);
  return [...counts.values()];
}

function describe(label: string, sizes: number[], total: number) {
  const sorted = [...sizes].sort((a, b) => a - b);
  const singles = sizes.filter((s) => s === 1).length;
  const tiny = sizes.filter((s) => s < 3).length;
  const usable = sizes.filter((s) => s >= 3 && s <= 12).length;
  const big = sizes.filter((s) => s > 12).length;
  console.log(
    `  ${label.padEnd(26)} ${String(sizes.length).padStart(4)} Gruppen   ` +
      `Median ${String(sorted[Math.floor(sorted.length / 2)]).padStart(2)}   ` +
      `max ${String(sorted.at(-1)).padStart(3)}   ` +
      `1er: ${String(singles).padStart(3)} (${pct(singles, sizes.length).padStart(6)})   ` +
      `nutzbar 3–12: ${String(usable).padStart(3)}   >12: ${big}`,
  );
  void tiny;
  void total;
}

async function main() {
  const entries = (await readdir(SRC)).filter(
    (e) => !e.startsWith('.') && IMAGE_EXT.has(extname(e).toLowerCase()),
  );

  const raw = await mapLimit(entries, CONCURRENCY, async (name): Promise<Item | null> => {
    const path = join(SRC, name);
    try {
      const [tags, meta] = await Promise.all([exiftool.read(path), sharp(path).metadata()]);
      const date = toDate(tags.DateTimeOriginal) ?? toDate(tags.CreateDate);
      if (!date) return null;
      const orientation = meta.orientation ?? 1;
      const swap = orientation >= 5 && orientation <= 8;
      const width = swap ? (meta.height ?? 0) : (meta.width ?? 0);
      const height = swap ? (meta.width ?? 0) : (meta.height ?? 0);
      return {
        name,
        width,
        height,
        longEdge: Math.max(width, height),
        date,
        camera: [tags.Make, tags.Model].filter(Boolean).join(' ') || '—',
      };
    } catch {
      return null;
    }
  });

  const items = raw.filter((i): i is Item => i !== null);
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  await stat(SRC);

  // ================= Auflösung ==========================================
  console.log(`=== Auflösung: Verteilung der langen Kante (${items.length} Fotos) ===`);
  const edgeBuckets: [string, (n: number) => boolean][] = [
    ['< 1000 px', (n) => n < 1000],
    ['1000–1599', (n) => n >= 1000 && n < 1600],
    ['1600–2047', (n) => n >= 1600 && n < 2048],
    ['genau 2048', (n) => n === 2048],
    ['2049–2999', (n) => n > 2048 && n < 3000],
    ['3000–3999', (n) => n >= 3000 && n < 4000],
    ['>= 4000 px', (n) => n >= 4000],
  ];
  const edgeCounts = edgeBuckets.map(([, f]) => items.filter((i) => f(i.longEdge)).length);
  const maxEdge = Math.max(...edgeCounts);
  edgeBuckets.forEach(([label], idx) => {
    const n = edgeCounts[idx]!;
    console.log(
      `  ${label.padEnd(12)} ${String(n).padStart(4)}  ${pct(n, items.length).padStart(7)}  ${bar(n, maxEdge)}`,
    );
  });

  console.log('\n=== Größter Slot, der 300 dpi hält (Buchformat 30×30 cm) ===');
  const slotFor = (px: number) => (px / 300) * 25.4;
  const slotSizes = items.map((i) => slotFor(i.longEdge)).sort((a, b) => a - b);
  const q = (p: number) => slotSizes[Math.floor((slotSizes.length - 1) * p)]!;
  console.log(`  10 %-Quantil: ${q(0.1).toFixed(0)} mm`);
  console.log(`  Median:       ${q(0.5).toFixed(0)} mm`);
  console.log(`  90 %-Quantil: ${q(0.9).toFixed(0)} mm`);
  console.log(`  Maximum:      ${q(1).toFixed(0)} mm`);
  console.log(`\n  Zum Vergleich: volle Seite 300 mm, halbe Seite 148 mm, Viertel 96 mm.`);

  console.log('\n=== Wie viele Fotos taugen für ein großes Layout? ===');
  for (const mm of [300, 210, 180, 148, 120, 96]) {
    const at300 = items.filter((i) => effectiveDpi(i.longEdge, mm) >= 300).length;
    const at240 = items.filter((i) => effectiveDpi(i.longEdge, mm) >= 240).length;
    console.log(
      `  ${String(mm).padStart(3)} mm Slot:  300 dpi ${String(at300).padStart(3)} (${pct(at300, items.length).padStart(6)})   ` +
        `240 dpi ${String(at240).padStart(3)} (${pct(at240, items.length).padStart(6)})`,
    );
  }

  console.log('\n=== Auflösung nach Jahr (Median lange Kante) ===');
  const byYear = new Map<number, number[]>();
  for (const i of items) {
    const y = i.date.getFullYear();
    byYear.set(y, [...(byYear.get(y) ?? []), i.longEdge]);
  }
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const v = byYear.get(y)!.sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)]!;
    const maxSlot = slotFor(med);
    console.log(
      `  ${y}  n=${String(v.length).padStart(3)}  Median ${String(med).padStart(4)} px  → max ${maxSlot.toFixed(0)} mm bei 300 dpi`,
    );
  }

  // ================= Zeitlücken =========================================
  console.log('\n\n=== Zeitlücken zwischen aufeinanderfolgenden Fotos ===');
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime());
  }
  const gapBuckets: [string, (n: number) => boolean][] = [
    ['< 1 min', (n) => n < 60_000],
    ['1–10 min', (n) => n >= 60_000 && n < 10 * 60_000],
    ['10 min – 1 h', (n) => n >= 10 * 60_000 && n < HOUR],
    ['1–6 h', (n) => n >= HOUR && n < 6 * HOUR],
    ['6–24 h', (n) => n >= 6 * HOUR && n < DAY],
    ['1–7 Tage', (n) => n >= DAY && n < 7 * DAY],
    ['1–4 Wochen', (n) => n >= 7 * DAY && n < 28 * DAY],
    ['> 4 Wochen', (n) => n >= 28 * DAY],
  ];
  const gapCounts = gapBuckets.map(([, f]) => gaps.filter(f).length);
  const maxGap = Math.max(...gapCounts);
  gapBuckets.forEach(([label], idx) => {
    const n = gapCounts[idx]!;
    console.log(
      `  ${label.padEnd(14)} ${String(n).padStart(4)}  ${pct(n, gaps.length).padStart(7)}  ${bar(n, maxGap)}`,
    );
  });

  const gapsSorted = [...gaps].sort((a, b) => a - b);
  const gq = (p: number) => gapsSorted[Math.floor((gapsSorted.length - 1) * p)]!;
  console.log(
    `\n  Median-Lücke: ${(gq(0.5) / DAY).toFixed(1)} Tage   ` +
      `25 %: ${(gq(0.25) / HOUR).toFixed(1)} h   75 %: ${(gq(0.75) / DAY).toFixed(1)} Tage`,
  );

  // ================= Gruppierungsvarianten ==============================
  console.log('\n=== Gruppierungsvarianten im Vergleich ===');
  console.log('  Ziel: möglichst wenige Einzelfoto-Gruppen, Median 4–10 Fotos je Gruppe\n');

  describe('Lücke > 3 h', segmentByGap(sorted, 3 * HOUR), items.length);
  describe('Lücke > 12 h', segmentByGap(sorted, 12 * HOUR), items.length);
  describe('Lücke > 1 Tag', segmentByGap(sorted, DAY), items.length);
  describe('Lücke > 3 Tage', segmentByGap(sorted, 3 * DAY), items.length);
  describe('Lücke > 7 Tage', segmentByGap(sorted, 7 * DAY), items.length);
  describe('Lücke > 14 Tage', segmentByGap(sorted, 14 * DAY), items.length);
  describe('Lücke > 30 Tage', segmentByGap(sorted, 30 * DAY), items.length);
  console.log('');
  describe('Kalendertag', segmentByCalendar(sorted, 'day'), items.length);
  describe('Kalenderwoche', segmentByCalendar(sorted, 'week'), items.length);
  describe('Kalendermonat', segmentByCalendar(sorted, 'month'), items.length);
  describe('Quartal', segmentByCalendar(sorted, 'quarter'), items.length);

  await exiftool.end();
}

await main();
