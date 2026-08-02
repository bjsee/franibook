/**
 * Spike: Wie verhält sich der Speicher beim PDF-Export eines ganzen Buches?
 *
 * Das Konzept entscheidet sich gegen pdf-lib und für pdfkit mit der Begründung,
 * dass pdf-lib das gesamte Dokument im Speicher hält, während pdfkit
 * inkrementell in einen Stream schreibt. Bei rund 800 eingebetteten Bildern ist
 * das der Unterschied zwischen beherrschbar und grenzwertig. Hier wird diese
 * Annahme gemessen statt geglaubt.
 *
 * Aufbau entspricht dem Zielfall: 180 Seiten à 5 Bilder, Endformat 300×300 mm
 * plus 3 mm Beschnitt, Zielauflösung 300 dpi. Die Bilder werden – wie im
 * Produktivpfad – vor dem Einbetten mit sharp auf exakt die benötigte
 * Pixelzahl gebracht, nicht in Originalgröße eingebettet.
 */
import { createWriteStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { mmToPt, targetPx } from '@franibook/core';
import { OUT_DIR, ensureDir, fmtMb, fmtMs, timed, watchRss } from './util.js';

const LARGE_DIR = join(OUT_DIR, 'fixtures', 'large');
const WORK = join(OUT_DIR, 'pdf');

const PAGES = 180;
const IMAGES_PER_PAGE = 5;
const TRIM_MM = 300;
const BLEED_MM = 3;
const PAGE_MM = TRIM_MM + 2 * BLEED_MM;
const DPI = 300;
const JPEG_QUALITY = 92;

/** Fünf Slots je Seite, grob wie ein 5er-Collagetemplate. Maße in mm. */
const SLOTS = [
  { x: 3, y: 3, w: 180, h: 148 },
  { x: 189, y: 3, w: 114, h: 148 },
  { x: 3, y: 157, w: 96, h: 146 },
  { x: 105, y: 157, w: 96, h: 146 },
  { x: 207, y: 157, w: 96, h: 146 },
];

interface PreparedImage {
  buffer: Buffer;
  slot: (typeof SLOTS)[number];
}

/**
 * Bereitet ein Bild genau so auf, wie es der Exporter tut: Ausschnitt wählen,
 * auf die für den Slot benötigte Pixelzahl skalieren, als JPEG kodieren.
 */
async function prepareImage(src: string, slot: (typeof SLOTS)[number], variant: number) {
  const meta = await sharp(src).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;

  // Cover-Fit: größtes Rechteck im Seitenverhältnis des Slots
  const slotAr = slot.w / slot.h;
  let cropW = srcW;
  let cropH = Math.round(srcW / slotAr);
  if (cropH > srcH) {
    cropH = srcH;
    cropW = Math.round(srcH * slotAr);
  }
  // Etwas Versatz je Variante, damit nicht jedes Bild identisch komprimiert
  const left = Math.min(srcW - cropW, Math.round((variant % 7) * (srcW - cropW) * 0.14));
  const top = Math.min(srcH - cropH, Math.round((variant % 5) * (srcH - cropH) * 0.2));

  const buffer = await sharp(src)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: targetPx(slot.w, DPI), height: targetPx(slot.h, DPI), fit: 'fill' })
    .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return { buffer, slot } satisfies PreparedImage;
}

async function sources(): Promise<string[]> {
  const files = (await readdir(LARGE_DIR)).filter((f) => f.endsWith('.jpg')).sort();
  if (files.length === 0) {
    throw new Error('Kein Testbestand. Erst `pnpm --filter @franibook/spikes fixtures`.');
  }
  return files.map((f) => join(LARGE_DIR, f));
}

/** Variante A: pdfkit, schreibt inkrementell in einen Stream. */
async function runPdfkit(srcs: string[], out: string) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [mmToPt(PAGE_MM), mmToPt(PAGE_MM)],
    margin: 0,
    compress: true,
  });
  const write = pipeline(doc as unknown as NodeJS.ReadableStream, createWriteStream(out));

  for (let page = 0; page < PAGES; page++) {
    doc.addPage({ size: [mmToPt(PAGE_MM), mmToPt(PAGE_MM)], margin: 0 });

    // TrimBox setzen – der Drucker schneidet auf diese Kante. Die Typen von
    // pdfkit kennen nur die Standardschlüssel des Seitenwörterbuchs, deshalb
    // der Cast.
    const pageDict = doc.page.dictionary.data as unknown as Record<string, unknown>;
    pageDict['TrimBox'] = [
      mmToPt(BLEED_MM),
      mmToPt(BLEED_MM),
      mmToPt(BLEED_MM + TRIM_MM),
      mmToPt(BLEED_MM + TRIM_MM),
    ];
    pageDict['BleedBox'] = [0, 0, mmToPt(PAGE_MM), mmToPt(PAGE_MM)];

    for (let i = 0; i < IMAGES_PER_PAGE; i++) {
      const slot = SLOTS[i % SLOTS.length]!;
      const src = srcs[(page * IMAGES_PER_PAGE + i) % srcs.length]!;
      const { buffer } = await prepareImage(src, slot, page + i);
      doc.image(buffer, mmToPt(slot.x), mmToPt(slot.y), {
        width: mmToPt(slot.w),
        height: mmToPt(slot.h),
      });
    }
  }

  doc.end();
  await write;
}

/** Variante B: pdf-lib, baut das Dokument vollständig im Speicher. */
async function runPdfLib(srcs: string[], out: string) {
  const { PDFDocument: LibDoc } = await import('pdf-lib');
  const pdf = await LibDoc.create();

  for (let page = 0; page < PAGES; page++) {
    const p = pdf.addPage([mmToPt(PAGE_MM), mmToPt(PAGE_MM)]);
    for (let i = 0; i < IMAGES_PER_PAGE; i++) {
      const slot = SLOTS[i % SLOTS.length]!;
      const src = srcs[(page * IMAGES_PER_PAGE + i) % srcs.length]!;
      const { buffer } = await prepareImage(src, slot, page + i);
      const img = await pdf.embedJpg(buffer);
      p.drawImage(img, {
        x: mmToPt(slot.x),
        // pdf-lib rechnet von unten, pdfkit von oben
        y: mmToPt(PAGE_MM - slot.y - slot.h),
        width: mmToPt(slot.w),
        height: mmToPt(slot.h),
      });
    }
  }

  await writeFile(out, await pdf.save());
}

async function measure(label: string, out: string, fn: () => Promise<void>) {
  if (global.gc) global.gc();
  const rss = watchRss(50);
  const baseline = process.memoryUsage.rss() / 1024 / 1024;
  const [, ms] = await timed(fn);
  const { peakMb } = rss.stop();
  const { size } = await stat(out);

  console.log(`\n=== ${label} ===`);
  console.log(`  Laufzeit:       ${fmtMs(ms)}`);
  console.log(`  Peak RSS:       ${peakMb.toFixed(0)} MB (Start ${baseline.toFixed(0)} MB)`);
  console.log(`  Dateigröße:     ${fmtMb(size)}`);
  console.log(`  pro Seite:      ${(ms / PAGES).toFixed(0)} ms, ${fmtMb(size / PAGES)}`);
  return { ms, peakMb, size };
}

async function main() {
  await ensureDir(WORK);
  const srcs = await sources();

  console.log(
    `${PAGES} Seiten à ${IMAGES_PER_PAGE} Bilder = ${PAGES * IMAGES_PER_PAGE} Einbettungen`,
  );
  console.log(`Seitenformat ${PAGE_MM}×${PAGE_MM} mm (${TRIM_MM} mm Endformat + ${BLEED_MM} mm Beschnitt)`);
  console.log(`Zielauflösung ${DPI} dpi, JPEG-Qualität ${JPEG_QUALITY}`);
  console.log(`Quellbilder: ${srcs.length} × 6000×4000`);

  const kit = await measure('pdfkit (Stream)', join(WORK, 'pdfkit.pdf'), () =>
    runPdfkit(srcs, join(WORK, 'pdfkit.pdf')),
  );
  const lib = await measure('pdf-lib (im Speicher)', join(WORK, 'pdf-lib.pdf'), () =>
    runPdfLib(srcs, join(WORK, 'pdf-lib.pdf')),
  );

  console.log('\n=== Vergleich ===');
  console.log(`  Speicher:  pdfkit ${kit.peakMb.toFixed(0)} MB vs. pdf-lib ${lib.peakMb.toFixed(0)} MB`);
  console.log(`  Laufzeit:  pdfkit ${fmtMs(kit.ms)} vs. pdf-lib ${fmtMs(lib.ms)}`);
  console.log(`  Größe:     pdfkit ${fmtMb(kit.size)} vs. pdf-lib ${fmtMb(lib.size)}`);

  console.log('\n=== Budget laut Konzept ===');
  console.log(
    `  Laufzeit < 10 min:  ${kit.ms < 600_000 ? 'eingehalten' : 'ÜBERSCHRITTEN'} (${fmtMs(kit.ms)})`,
  );
  console.log(
    `  RSS < 1,5 GB:       ${kit.peakMb < 1536 ? 'eingehalten' : 'ÜBERSCHRITTEN'} (${kit.peakMb.toFixed(0)} MB)`,
  );
}

await main();
