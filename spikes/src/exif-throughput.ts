/**
 * Spike: Wie schnell lassen sich die Metadaten von 900 Fotos lesen?
 *
 * Konzeptannahme: unter 30 Sekunden für den kompletten Metadatenlauf.
 * Gemessen werden drei Varianten, weil der Produktivpfad beide Quellen
 * kombiniert:
 *   1. exiftool-vendored im Batchmodus (Aufnahmedatum, GPS, Hersteller)
 *   2. sharp.metadata() (verlässliche Pixelmaße und Orientierung)
 *   3. beides zusammen, wie im echten Import
 *
 * Zusätzlich gemessen: der Inhaltshash über Dateigröße plus erste und letzte
 * 64 KiB, weil er beim Import an jeder Datei anfällt und die Foto-ID liefert.
 */
import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import { OUT_DIR, fmtMs, mapLimit, timed } from './util.js';

const BULK = join(OUT_DIR, 'fixtures', 'bulk');
const CONCURRENCY = Math.max(1, availableParallelism() - 1);
const HASH_WINDOW = 64 * 1024;

/** Foto-ID: Dateigröße plus SHA-256 über Kopf und Ende der Datei. */
async function contentHash(path: string): Promise<string> {
  const { size } = await stat(path);
  const fh = await open(path, 'r');
  try {
    const head = Buffer.allocUnsafe(Math.min(HASH_WINDOW, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(HASH_WINDOW, Math.max(0, size - head.length));
    const tail = Buffer.allocUnsafe(tailLen);
    if (tailLen > 0) await fh.read(tail, 0, tailLen, size - tailLen);
    return createHash('sha256')
      .update(String(size))
      .update(head)
      .update(tail)
      .digest('hex')
      .slice(0, 24);
  } finally {
    await fh.close();
  }
}

async function main() {
  const files = (await readdir(BULK))
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => join(BULK, f))
    .sort();

  if (files.length === 0) {
    console.error('Kein Testbestand gefunden. Erst `pnpm --filter @franibook/spikes fixtures`.');
    process.exit(1);
  }

  console.log(`${files.length} Dateien, Nebenläufigkeit ${CONCURRENCY}\n`);

  // 1. exiftool im Batchmodus
  const [exifResults, exifMs] = await timed(() =>
    mapLimit(files, CONCURRENCY, (f) => exiftool.read(f)),
  );
  const mitDatum = exifResults.filter((t) => t.DateTimeOriginal != null).length;
  console.log(
    `exiftool (Batch):     ${fmtMs(exifMs)}  → ${(exifMs / files.length).toFixed(1)} ms/Datei`,
  );
  console.log(`                      ${mitDatum}/${files.length} mit DateTimeOriginal`);

  // 2. sharp.metadata()
  const [sharpResults, sharpMs] = await timed(() =>
    mapLimit(files, CONCURRENCY, (f) => sharp(f).metadata()),
  );
  const mitMassen = sharpResults.filter((m) => m.width && m.height).length;
  console.log(
    `sharp.metadata():     ${fmtMs(sharpMs)}  → ${(sharpMs / files.length).toFixed(1)} ms/Datei`,
  );
  console.log(`                      ${mitMassen}/${files.length} mit Pixelmaßen`);

  // 3. Inhaltshash
  const [hashes, hashMs] = await timed(() => mapLimit(files, CONCURRENCY, contentHash));
  const eindeutig = new Set(hashes).size;
  console.log(
    `Inhaltshash:          ${fmtMs(hashMs)}  → ${(hashMs / files.length).toFixed(2)} ms/Datei`,
  );
  console.log(`                      ${eindeutig}/${files.length} eindeutig`);

  // 4. Kombiniert, wie im echten Import
  const [, kombiMs] = await timed(() =>
    mapLimit(files, CONCURRENCY, async (f) => {
      const [tags, meta, hash] = await Promise.all([
        exiftool.read(f),
        sharp(f).metadata(),
        contentHash(f),
      ]);
      return { tags, meta, hash };
    }),
  );
  console.log(
    `\nKombinierter Import:  ${fmtMs(kombiMs)}  → ${(kombiMs / files.length).toFixed(1)} ms/Datei`,
  );

  // Nach der ersten Messung von 30 s auf 10 s verschärft – siehe
  // docs/spikes/phase-0.adoc.
  const ziel = 10_000;
  console.log(
    `\nBudget laut Konzept: ${fmtMs(ziel)} für 900 Fotos → ` +
      (kombiMs <= ziel
        ? `eingehalten (${((kombiMs / ziel) * 100).toFixed(0)} %)`
        : 'ÜBERSCHRITTEN'),
  );

  await exiftool.end();
}

await main();
