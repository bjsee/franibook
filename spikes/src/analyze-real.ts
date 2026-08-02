/**
 * Analyse des echten Fotobestands.
 *
 * Rein lesend – der Bestand wird unter keinen Umständen verändert.
 *
 * Beantwortet die Fragen, die das Konzept als „erst am realen Bestand
 * beurteilbar" offengelassen hat:
 *   - Reicht die Auflösung für den Druck, und bei welchen Slotgrößen?
 *   - Wie gut sind die Aufnahmedaten wirklich?
 *   - Wie viele Ereignisse findet der Zeitlücken-Detektor?
 *   - Wie verteilen sich Fotos über die Jahre – und damit über das Buch?
 */
import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import { effectiveDpi } from '@franibook/core';
import { fmtMb, fmtMs, mapLimit, timed } from './util.js';

const SRC = process.argv[2] ?? '/Users/nutzer/fotos/buch';
const CONCURRENCY = Math.max(1, availableParallelism() - 1);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.avi']);

/** Slotgrößen, gegen die die Auflösung geprüft wird. Buchformat 30×30 cm. */
const SLOTS = [
  { label: 'volle Doppelseite (600 mm)', mm: 600 },
  { label: 'volle Seite (300 mm)', mm: 300 },
  { label: 'halbe Seite (148 mm)', mm: 148 },
  { label: 'Viertel (96 mm)', mm: 96 },
];

interface Item {
  name: string;
  bytes: number;
  width: number;
  height: number;
  orientation: number;
  date: Date | null;
  dateSource: string;
  gps: boolean;
  camera: string;
  hash: string;
}

async function contentHash(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const win = 64 * 1024;
    const head = Buffer.allocUnsafe(Math.min(win, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(win, Math.max(0, size - head.length));
    const tail = Buffer.allocUnsafe(tailLen);
    if (tailLen > 0) await fh.read(tail, 0, tailLen, size - tailLen);
    return createHash('sha256')
      .update(String(size))
      .update(head)
      .update(tail)
      .digest('hex')
      .slice(0, 16);
  } finally {
    await fh.close();
  }
}

/** exiftool liefert je nach Tag Strings oder ExifDateTime-Objekte. */
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
    }
  }
  return null;
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)} %`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

async function main() {
  console.log(`Analysiere ${SRC}\n`);

  const entries = await readdir(SRC);
  const images: string[] = [];
  const videos: string[] = [];
  const other: string[] = [];

  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const ext = extname(e).toLowerCase();
    if (IMAGE_EXT.has(ext)) images.push(e);
    else if (VIDEO_EXT.has(ext)) videos.push(e);
    else other.push(e);
  }

  console.log(`Bilder: ${images.length}   Videos: ${videos.length}   Sonstiges: ${other.length}`);
  if (videos.length) console.log(`  Videos: ${videos.join(', ')}`);
  if (other.length) console.log(`  Sonstiges: ${other.slice(0, 10).join(', ')}`);

  const [items, ms] = await timed(() =>
    mapLimit(images, CONCURRENCY, async (name): Promise<Item | null> => {
      const path = join(SRC, name);
      try {
        const [st, tags, meta] = await Promise.all([
          stat(path),
          exiftool.read(path),
          sharp(path).metadata(),
        ]);
        const hash = await contentHash(path, st.size);

        // Orientierungsnormalisierte Maße
        const orientation = meta.orientation ?? 1;
        const raw = { w: meta.width ?? 0, h: meta.height ?? 0 };
        const swap = orientation >= 5 && orientation <= 8;

        let date = toDate(tags.DateTimeOriginal);
        let dateSource = 'exif';
        if (!date) {
          date = toDate(tags.CreateDate);
          dateSource = date ? 'exifSecondary' : dateSource;
        }
        if (!date) {
          date = toDate(tags.GPSDateTime);
          dateSource = date ? 'exifSecondary' : dateSource;
        }
        if (!date) {
          const m = name.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
          if (m) {
            date = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
            dateSource = 'filename';
          }
        }
        if (!date) {
          date = st.mtime;
          dateSource = 'file';
        }

        return {
          name,
          bytes: st.size,
          width: swap ? raw.h : raw.w,
          height: swap ? raw.w : raw.h,
          orientation,
          date,
          dateSource,
          gps: tags.GPSLatitude != null,
          camera: [tags.Make, tags.Model].filter(Boolean).join(' ') || '—',
          hash,
        };
      } catch (err) {
        console.error(`  Fehler bei ${name}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );

  const ok = items.filter((i): i is Item => i !== null);
  console.log(`\nEingelesen in ${fmtMs(ms)} (${(ms / ok.length).toFixed(1)} ms/Datei)\n`);

  // ---- Auflösung -------------------------------------------------------
  console.log('=== Auflösung ===');
  const mp = ok.map((i) => (i.width * i.height) / 1e6).sort((a, b) => a - b);
  const widths = ok.map((i) => Math.max(i.width, i.height)).sort((a, b) => a - b);
  console.log(
    `  Megapixel:  min ${mp[0]!.toFixed(1)}  Median ${quantile(mp, 0.5).toFixed(1)}  max ${mp.at(-1)!.toFixed(1)}`,
  );
  console.log(
    `  lange Kante: min ${widths[0]}  Median ${quantile(widths, 0.5).toFixed(0)}  max ${widths.at(-1)}`,
  );
  console.log(
    `  Dateigröße: Median ${fmtMb(
      quantile(
        ok.map((i) => i.bytes).sort((a, b) => a - b),
        0.5,
      ),
    )}`,
  );

  console.log('\n  Anteil mit mindestens 300 dpi bzw. 200 dpi je Slotgröße:');
  for (const slot of SLOTS) {
    const at300 = ok.filter(
      (i) => effectiveDpi(Math.max(i.width, i.height), slot.mm) >= 300,
    ).length;
    const at200 = ok.filter(
      (i) => effectiveDpi(Math.max(i.width, i.height), slot.mm) >= 200,
    ).length;
    console.log(
      `    ${slot.label.padEnd(28)} 300 dpi: ${pct(at300, ok.length).padStart(7)}   200 dpi: ${pct(at200, ok.length).padStart(7)}`,
    );
  }

  // ---- Seitenverhältnisse ---------------------------------------------
  console.log('\n=== Format ===');
  const buckets = { hoch: 0, quer: 0, quadratisch: 0, panorama: 0 };
  for (const i of ok) {
    const ar = i.width / i.height;
    if (ar > 2.2 || ar < 1 / 2.2) buckets.panorama++;
    else if (Math.abs(ar - 1) < 0.05) buckets.quadratisch++;
    else if (ar > 1) buckets.quer++;
    else buckets.hoch++;
  }
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(13)} ${String(v).padStart(4)}  ${pct(v, ok.length)}`);
  }

  // ---- Datumsqualität --------------------------------------------------
  console.log('\n=== Datumsquellen ===');
  const bySource = new Map<string, number>();
  for (const i of ok) bySource.set(i.dateSource, (bySource.get(i.dateSource) ?? 0) + 1);
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}  ${pct(v, ok.length)}`);
  }

  console.log('\n=== Plausibilitätsprüfungen ===');
  const now = new Date();
  const dated = ok.filter((i) => i.date) as (Item & { date: Date })[];
  const checks: [string, number][] = [
    ['Datum in der Zukunft', dated.filter((i) => i.date > now).length],
    ['vor 2008', dated.filter((i) => i.date.getFullYear() < 2008).length],
    [
      'Epoch-/Reset-Datum',
      dated.filter((i) => [1970, 1980, 2000].includes(i.date.getFullYear())).length,
    ],
    [
      'exakt Mitternacht',
      dated.filter(
        (i) => i.date.getHours() === 0 && i.date.getMinutes() === 0 && i.date.getSeconds() === 0,
      ).length,
    ],
  ];
  // Mehrfach identische Sekunde
  const bySecond = new Map<number, number>();
  for (const i of dated) {
    const s = Math.floor(i.date.getTime() / 1000);
    bySecond.set(s, (bySecond.get(s) ?? 0) + 1);
  }
  const bulk = [...bySecond.values()].filter((n) => n > 15).reduce((a, b) => a + b, 0);
  checks.push(['mehr als 15 in derselben Sekunde', bulk]);

  for (const [label, n] of checks) {
    const mark = n === 0 ? '✅' : '⚠️ ';
    console.log(`  ${mark} ${label.padEnd(34)} ${String(n).padStart(4)}  ${pct(n, ok.length)}`);
  }

  // Duplikate
  const byHash = new Map<string, string[]>();
  for (const i of ok) byHash.set(i.hash, [...(byHash.get(i.hash) ?? []), i.name]);
  const dupes = [...byHash.values()].filter((v) => v.length > 1);
  console.log(
    `  ${dupes.length === 0 ? '✅' : '⚠️ '} Duplikate (gleicher Inhalt)        ${String(dupes.length).padStart(4)}`,
  );
  for (const d of dupes.slice(0, 5)) console.log(`       ${d.join(' = ')}`);

  console.log(
    `\n  GPS vorhanden: ${ok.filter((i) => i.gps).length}  (${pct(ok.filter((i) => i.gps).length, ok.length)})`,
  );

  // ---- Kameras ---------------------------------------------------------
  console.log('\n=== Kameras ===');
  const byCam = new Map<string, number>();
  for (const i of ok) byCam.set(i.camera, (byCam.get(i.camera) ?? 0) + 1);
  for (const [k, v] of [...byCam].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(4)}  ${pct(v, ok.length)}`);
  }

  // ---- Verteilung über die Jahre --------------------------------------
  console.log('\n=== Fotos je Jahr ===');
  const byYear = new Map<number, number>();
  for (const i of dated)
    byYear.set(i.date.getFullYear(), (byYear.get(i.date.getFullYear()) ?? 0) + 1);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const maxCount = Math.max(...byYear.values());
  for (const y of years) {
    const n = byYear.get(y)!;
    const bar = '█'.repeat(Math.max(1, Math.round((n / maxCount) * 40)));
    console.log(`  ${y}  ${String(n).padStart(4)}  ${bar}`);
  }

  // ---- Ereigniserkennung ----------------------------------------------
  console.log('\n=== Zeitlücken-Detektor (Heuristik aus dem Konzept) ===');
  const sorted = [...dated].sort((a, b) => a.date.getTime() - b.date.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime());
  }
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const WINDOW = 20;

  const boundaries: number[] = [];
  for (let i = 0; i < gaps.length; i++) {
    const from = Math.max(0, i - WINDOW / 2);
    const local = [...gaps.slice(from, from + WINDOW)].sort((a, b) => a - b);
    const median = local[Math.floor(local.length / 2)] ?? HOUR;
    const threshold = Math.min(Math.max(6 * median, 3 * HOUR), 5 * DAY);
    const crossesNight =
      gaps[i]! > 6 * HOUR && sorted[i]!.date.getDate() !== sorted[i + 1]!.date.getDate();
    if (gaps[i]! > threshold || crossesNight) boundaries.push(i + 1);
  }

  const segments: number[] = [];
  let prev = 0;
  for (const b of [...boundaries, sorted.length]) {
    segments.push(b - prev);
    prev = b;
  }
  const segSorted = [...segments].sort((a, b) => a - b);
  console.log(`  Segmente:      ${segments.length}`);
  console.log(
    `  Fotos je Segment: min ${segSorted[0]}  Median ${quantile(segSorted, 0.5).toFixed(0)}  max ${segSorted.at(-1)}`,
  );
  console.log(`  Einzelfoto-Segmente: ${segments.filter((s) => s === 1).length}`);
  console.log(`  Segmente unter 3 Fotos: ${segments.filter((s) => s < 3).length}`);
  console.log(`  Segmente über 30 Fotos: ${segments.filter((s) => s > 30).length}`);

  // ---- Seitenbudget ----------------------------------------------------
  console.log('\n=== Hochrechnung Buchumfang ===');
  for (const target of [140, 160, 180]) {
    const proSeite = ok.length / target;
    console.log(
      `  ${target} Seiten → ${proSeite.toFixed(1)} Fotos/Seite, ${(proSeite * 2).toFixed(1)} je Doppelseite`,
    );
  }

  await exiftool.end();
}

await main();
