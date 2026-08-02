/**
 * Erzeugt den Testbestand für die Phase-0-Spikes.
 *
 * Drei Gruppen:
 *  - `bulk/`   900 mittelgroße JPEGs mit EXIF – für den exiftool-Durchsatz
 *  - `large/`  wenige hochauflösende JPEGs – für den PDF-Speichertest
 *  - `heic/`   ein HEIC, über sips aus einem JPEG erzeugt – für den HEIC-Spike
 *
 * Die Bilder tragen Rauschen, damit die JPEG-Kompression realistische
 * Dateigrößen erzeugt. Ein Verlaufsbild würde auf wenige Kilobyte komprimieren
 * und die Messung wertlos machen.
 */
import { execFile } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { OUT_DIR, ensureDir, fmtMb, fmtMs, mapLimit, timed } from './util.js';

const execFileAsync = promisify(execFile);

const BULK_COUNT = 900;
const BULK_SIZE = { width: 3000, height: 2000 };
const LARGE_COUNT = 8;
const LARGE_SIZE = { width: 6000, height: 4000 };

const FIXTURES = join(OUT_DIR, 'fixtures');

/** Rauschbild mit einem farbigen Balken, damit die Bilder unterscheidbar bleiben. */
async function noiseJpeg(width: number, height: number, seed: number, quality: number) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  // Billiger, aber ausreichend streuender PRNG – die Bilder müssen nur
  // schlecht komprimierbar sein, nicht kryptografisch zufällig.
  let s = seed * 2654435761 + 1;
  for (let i = 0; i < pixels.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (s >> 16) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .withExif({
      IFD0: { Make: 'Franibook', Model: `Spike-${seed % 5}` },
      IFD2: {
        DateTimeOriginal: exifDate(seed),
        ExposureTime: '1/125',
        ISO: String(100 * ((seed % 8) + 1)),
      },
    })
    .toBuffer();
}

/** Streut die Aufnahmedaten über 2008–2026, wie im echten Bestand. */
function exifDate(seed: number): string {
  const year = 2008 + (seed % 19);
  const month = 1 + ((seed * 7) % 12);
  const day = 1 + ((seed * 13) % 28);
  const hour = (seed * 5) % 24;
  const minute = (seed * 11) % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}:${p(month)}:${p(day)} ${p(hour)}:${p(minute)}:00`;
}

async function main() {
  await ensureDir(join(FIXTURES, 'bulk'));
  await ensureDir(join(FIXTURES, 'large'));
  await ensureDir(join(FIXTURES, 'heic'));

  console.log(`Erzeuge ${BULK_COUNT} Bilder à ${BULK_SIZE.width}×${BULK_SIZE.height} …`);
  const [bulkBytes, bulkMs] = await timed(async () => {
    const sizes = await mapLimit(
      Array.from({ length: BULK_COUNT }, (_, i) => i),
      11,
      async (i) => {
        const buf = await noiseJpeg(BULK_SIZE.width, BULK_SIZE.height, i, 82);
        await writeFile(join(FIXTURES, 'bulk', `IMG_${String(i).padStart(4, '0')}.jpg`), buf);
        return buf.length;
      },
    );
    return sizes.reduce((a, b) => a + b, 0);
  });
  console.log(
    `  ${fmtMs(bulkMs)}, gesamt ${fmtMb(bulkBytes)}, im Mittel ${fmtMb(bulkBytes / BULK_COUNT)}`,
  );

  console.log(`Erzeuge ${LARGE_COUNT} Bilder à ${LARGE_SIZE.width}×${LARGE_SIZE.height} …`);
  const [largeBytes, largeMs] = await timed(async () => {
    const sizes = await mapLimit(
      Array.from({ length: LARGE_COUNT }, (_, i) => i),
      4,
      async (i) => {
        const buf = await noiseJpeg(LARGE_SIZE.width, LARGE_SIZE.height, 1000 + i, 90);
        await writeFile(join(FIXTURES, 'large', `LARGE_${i}.jpg`), buf);
        return buf.length;
      },
    );
    return sizes.reduce((a, b) => a + b, 0);
  });
  console.log(
    `  ${fmtMs(largeMs)}, gesamt ${fmtMb(largeBytes)}, im Mittel ${fmtMb(largeBytes / LARGE_COUNT)}`,
  );

  console.log('Erzeuge HEIC über sips …');
  const heicSrc = join(FIXTURES, 'large', 'LARGE_0.jpg');
  const heicOut = join(FIXTURES, 'heic', 'IMG_0001.heic');
  try {
    await execFileAsync('sips', [
      '-s',
      'format',
      'heic',
      '-s',
      'formatOptions',
      '80',
      heicSrc,
      '--out',
      heicOut,
    ]);
    const s = await stat(heicOut);
    console.log(`  ${heicOut} (${fmtMb(s.size)})`);
  } catch (err) {
    console.error('  sips konnte kein HEIC erzeugen:', err);
    process.exitCode = 1;
  }

  console.log(`\nFertig. Testbestand unter ${FIXTURES}`);
}

await main();
