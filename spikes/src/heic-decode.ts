/**
 * Spike: Lässt sich HEIC auf dieser Maschine zuverlässig decodieren?
 *
 * Dies ist die einzige Stelle der Pipeline, deren Machbarkeit von einer
 * Umgebungseigenschaft abhängt: `sharp` bringt HEIF je nach Build nicht mit
 * (Lizenzfragen rund um die HEVC-Patente). Das Konzept sieht deshalb eine
 * dreistufige Kette vor, die hier gemessen wird:
 *
 *   1. sharp mit libheif      – schnellster Weg, wenn verfügbar
 *   2. macOS `sips`           – auf jedem Mac vorhanden, unabhängig vom Build
 *   3. heic-decode (WASM)     – plattformunabhängige Notlösung
 *
 * Ergänzend geprüft: liest exiftool die Metadaten direkt aus der HEIC-Datei,
 * ohne dass sie vorher konvertiert werden muss?
 */
import { execFile } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import { OUT_DIR, ensureDir, fmtMb, fmtMs, timed } from './util.js';

const execFileAsync = promisify(execFile);

const HEIC_DIR = join(OUT_DIR, 'fixtures', 'heic');
const LARGE_DIR = join(OUT_DIR, 'fixtures', 'large');
const WORK = join(OUT_DIR, 'heic-work');

const RUNS = 5;

/** Erzeugt bei Bedarf mehrere HEIC-Dateien, damit sich sinnvoll mitteln lässt. */
async function ensureHeicFixtures(): Promise<string[]> {
  await ensureDir(HEIC_DIR);
  let files = (await readdir(HEIC_DIR)).filter((f) => f.endsWith('.heic'));

  if (files.length < RUNS) {
    const sources = (await readdir(LARGE_DIR)).filter((f) => f.endsWith('.jpg')).sort();
    if (sources.length === 0) {
      throw new Error('Kein Testbestand. Erst `pnpm --filter @franibook/spikes fixtures`.');
    }
    for (let i = files.length; i < RUNS; i++) {
      const src = join(LARGE_DIR, sources[i % sources.length]!);
      const dst = join(HEIC_DIR, `IMG_${String(i).padStart(4, '0')}.heic`);
      await execFileAsync('sips', ['-s', 'format', 'heic', src, '--out', dst]);
    }
    files = (await readdir(HEIC_DIR)).filter((f) => f.endsWith('.heic'));
  }

  return files.sort().map((f) => join(HEIC_DIR, f));
}

/** Stufe 1: sharp mit libheif. */
async function decodeViaSharp(src: string): Promise<Buffer> {
  return sharp(src).jpeg({ quality: 98 }).toBuffer();
}

/** Stufe 2: macOS sips. Schreibt über den Umweg einer Datei. */
async function decodeViaSips(src: string, index: number): Promise<number> {
  const dst = join(WORK, `sips-${index}.jpg`);
  await execFileAsync('sips', [
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '98',
    src,
    '--out',
    dst,
  ]);
  const { size } = await stat(dst);
  await unlink(dst);
  return size;
}

/**
 * Stufe 3: reine JS-Notlösung, nur wenn installiert.
 *
 * Der Modulname steht bewusst in einer Variablen: heic-decode ist keine
 * Abhängigkeit des Projekts, und ein statisch auflösbarer Import würde den
 * Typecheck brechen.
 */
async function decodeViaWasm(src: string): Promise<Buffer | null> {
  const moduleName = 'heic-decode';
  try {
    const { default: decode } = await import(moduleName);
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(src);
    const { width, height, data } = await decode({ buffer: buf });
    return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
      .jpeg({ quality: 98 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== sharp-Build ===');
  const heif = sharp.format.heif;
  console.log(`libvips:            ${sharp.versions.vips}`);
  console.log(`heif input.file:    ${heif?.input?.file ?? false}`);
  console.log(`heif input.buffer:  ${heif?.input?.buffer ?? false}`);
  console.log(`heif output.file:   ${heif?.output?.file ?? false}`);

  const files = await ensureHeicFixtures();
  await ensureDir(WORK);
  const srcSize = (await stat(files[0]!)).size;
  console.log(`\n${files.length} HEIC-Testdateien, je rund ${fmtMb(srcSize)}\n`);

  console.log('=== Stufe 1: sharp ===');
  let sharpOk = false;
  try {
    const [buf, ms] = await timed(() => decodeViaSharp(files[0]!));
    // Aufwärmlauf verworfen, jetzt messen
    const [, totalMs] = await timed(async () => {
      for (const f of files) await decodeViaSharp(f);
    });
    sharpOk = true;
    console.log(`  funktioniert, Ergebnis ${fmtMb(buf.length)} (erster Lauf ${fmtMs(ms)})`);
    console.log(`  ${fmtMs(totalMs / files.length)} pro Bild`);
  } catch (err) {
    console.log(`  nicht verfügbar: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }

  console.log('\n=== Stufe 2: sips ===');
  let sipsOk = false;
  try {
    const size = await decodeViaSips(files[0]!, 0);
    const [, totalMs] = await timed(async () => {
      for (const [i, f] of files.entries()) await decodeViaSips(f, i);
    });
    sipsOk = true;
    console.log(`  funktioniert, Ergebnis ${fmtMb(size)}`);
    console.log(`  ${fmtMs(totalMs / files.length)} pro Bild`);
  } catch (err) {
    console.log(`  nicht verfügbar: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }

  console.log('\n=== Stufe 3: heic-decode (WASM) ===');
  const wasm = await decodeViaWasm(files[0]!);
  if (wasm) {
    const [, ms] = await timed(() => decodeViaWasm(files[0]!));
    console.log(`  funktioniert, Ergebnis ${fmtMb(wasm.length)}, ${fmtMs(ms)} pro Bild`);
  } else {
    console.log('  nicht installiert (wird nur gebraucht, wenn Stufe 1 und 2 ausfallen)');
  }

  console.log('\n=== Metadaten direkt aus HEIC ===');
  const tags = await exiftool.read(files[0]!);
  console.log(`  DateTimeOriginal: ${tags.DateTimeOriginal ?? '—'}`);
  console.log(`  CreateDate:       ${tags.CreateDate ?? '—'}`);
  console.log(`  Maße:             ${tags.ImageWidth}×${tags.ImageHeight}`);
  console.log(`  Make/Model:       ${tags.Make ?? '—'} / ${tags.Model ?? '—'}`);

  console.log('\n=== Ergebnis ===');
  if (sharpOk) {
    console.log('  Stufe 1 trägt. sips bleibt als Rückfallebene.');
  } else if (sipsOk) {
    console.log('  Stufe 1 fällt aus, Stufe 2 trägt. Produktivpfad läuft über sips.');
  } else {
    console.log('  Stufe 1 und 2 fallen aus – heic-decode wird zur Pflichtabhängigkeit.');
    process.exitCode = 1;
  }

  await exiftool.end();
}

await main();
