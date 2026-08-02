/**
 * Nachbohren zum HEIC-Spike.
 *
 * Erstbefund: sharp bringt HEIF mit, scheitert aber an
 *   "Number of references in iref box (42) exceeds the security limits of 16"
 *
 * Das ist relevant, weil Apple HEICs gekachelt speichert – ein 6000×4000-Bild
 * zerfällt in viele Kacheln, die über die iref-Box referenziert werden. Wenn
 * das Limit an der Bildgröße hängt, betrifft es reale iPhone-Fotos genauso und
 * ist kein Artefakt der Testdaten.
 *
 * Geprüft werden drei Fragen:
 *   1. Hilft sharps `unlimited: true`?
 *   2. Hängt der Fehler an der Bildgröße, also an der Kachelzahl?
 *   3. Wie viele Kacheln hat die Datei tatsächlich?
 */
import { execFile } from 'node:child_process';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { SharpOptions } from 'sharp';
import { OUT_DIR, ensureDir, fmtMb, fmtMs, timed } from './util.js';

const execFileAsync = promisify(execFile);
const HEIC_DIR = join(OUT_DIR, 'fixtures', 'heic');
const LARGE_DIR = join(OUT_DIR, 'fixtures', 'large');
const WORK = join(OUT_DIR, 'heic-work');

/** Erzeugt ein HEIC in der gewünschten Größe über sips. */
async function makeHeic(widthPx: number, label: string): Promise<string> {
  const src = join(LARGE_DIR, 'LARGE_0.jpg');
  const scaled = join(WORK, `scaled-${label}.jpg`);
  const heic = join(WORK, `tiles-${label}.heic`);
  await sharp(src).resize({ width: widthPx }).jpeg({ quality: 92 }).toFile(scaled);
  await execFileAsync('sips', ['-s', 'format', 'heic', scaled, '--out', heic]);
  await unlink(scaled);
  return heic;
}

async function trySharp(path: string, opts: SharpOptions = {}): Promise<string> {
  try {
    const [buf, ms] = await timed(() => sharp(path, opts).jpeg({ quality: 98 }).toBuffer());
    return `ok – ${fmtMb(buf.length)} in ${fmtMs(ms)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return `FEHLER – ${msg}`;
  }
}

async function main() {
  await ensureDir(WORK);

  const existing = (await readdir(HEIC_DIR)).filter((f) => f.endsWith('.heic')).sort();
  const sample = join(HEIC_DIR, existing[0]!);

  console.log('=== Frage 1: hilft unlimited/failOn? ===');
  console.log(`  Standard:                 ${await trySharp(sample)}`);
  console.log(`  { unlimited: true }:      ${await trySharp(sample, { unlimited: true })}`);
  console.log(`  { failOn: 'none' }:       ${await trySharp(sample, { failOn: 'none' })}`);
  console.log(
    `  beides:                   ${await trySharp(sample, { unlimited: true, failOn: 'none' })}`,
  );

  console.log('\n=== Frage 2: hängt es an der Bildgröße? ===');
  for (const width of [1024, 2048, 3000, 4000, 6000]) {
    const path = await makeHeic(width, String(width));
    const result = await trySharp(path);
    console.log(`  ${String(width).padStart(4)} px breit: ${result}`);
  }

  console.log('\n=== Frage 3: Kachelstruktur der 6000-px-Datei ===');
  try {
    const { stdout } = await execFileAsync('exiftool', [
      '-G1',
      '-a',
      '-s',
      '-ImageWidth',
      '-ImageHeight',
      '-CompressionType',
      '-ImageSpatialExtent',
      '-PrimaryItemReference',
      sample,
    ]);
    console.log(
      stdout
        .trim()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
  } catch {
    console.log('  exiftool lieferte keine Kachelinformationen');
  }

  // Klärt, ob libheif in diesem sharp-Build grundsätzlich untauglich ist oder
  // nur mit Apple-erzeugten Dateien nicht zurechtkommt. Für die Frage, ob der
  // sips-Pfad die Regel oder die Ausnahme wird, macht das den Unterschied.
  console.log('\n=== Frage 4: kann sharp seine eigenen HEIF-Dateien lesen? ===');
  const own = join(WORK, 'sharp-written.heic');
  try {
    await sharp(join(LARGE_DIR, 'LARGE_0.jpg'))
      .resize({ width: 3000 })
      .heif({ quality: 80, compression: 'av1' })
      .toFile(own);
    console.log(`  schreiben: ok`);
    console.log(`  lesen:     ${await trySharp(own)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`  schreiben fehlgeschlagen: ${msg}`);
  }

  // Der sips-Pfad ist nur brauchbar, wenn das Konvertat maßhaltig ist und die
  // Metadaten erhalten bleiben – sonst wäre die Orientierung nach der
  // Konvertierung verloren.
  console.log('\n=== Frage 5: taugt das sips-Konvertat? ===');
  const converted = join(WORK, 'sips-check.jpg');
  await execFileAsync('sips', [
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '95',
    sample,
    '--out',
    converted,
  ]);
  const [heicTags, jpgMeta, jpgTags] = await Promise.all([
    execFileAsync('exiftool', ['-s3', '-ImageWidth', '-ImageHeight', '-Orientation#', sample]),
    sharp(converted).metadata(),
    execFileAsync('exiftool', ['-s3', '-DateTimeOriginal', '-Make', '-Model', converted]),
  ]);
  const [hW, hH, hOrient] = heicTags.stdout.trim().split('\n');
  console.log(`  HEIC:  ${hW}×${hH}, Orientation ${hOrient ?? '—'}`);
  console.log(`  JPEG:  ${jpgMeta.width}×${jpgMeta.height}, Orientation ${jpgMeta.orientation ?? '—'}`);
  console.log(`  Maße erhalten: ${jpgMeta.width === Number(hW) && jpgMeta.height === Number(hH)}`);
  console.log(`  EXIF im Konvertat: ${jpgTags.stdout.trim().split('\n').join(' | ') || '—'}`);
}

await main();
