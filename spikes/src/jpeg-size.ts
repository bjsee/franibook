/**
 * Nachbohren zum PDF-Spike.
 *
 * Der Speichertest lieferte ein 2,3-GB-PDF für 180 Seiten. Das liegt zum
 * großen Teil an den Testdaten: reines Rauschen ist der schlechteste Fall für
 * JPEG. Für die Vorgabewerte des Druckprofils ist trotzdem wichtig zu wissen,
 * wie stark Qualität und Chroma-Subsampling durchschlagen und wo eine
 * realistische Erwartung liegt.
 *
 * Gemessen wird an zwei Motiven:
 *   - Rauschen: der pessimistische Fall (die Fixtures)
 *   - weichgezeichnetes Rauschen: grobe Näherung an ein echtes Foto, das
 *     überwiegend aus flächigen Bereichen mit wenigen Kanten besteht
 */
import { join } from 'node:path';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { targetPx } from '@franibook/core';
import { OUT_DIR, fmtMb } from './util.js';

const LARGE = join(OUT_DIR, 'fixtures', 'large', 'LARGE_0.jpg');
const DPI = 300;
const PAGES = 180;
const IMAGES_PER_PAGE = 5;

/** Repräsentativer Slot: eine Bildhälfte einer 300-mm-Seite. */
const SLOT = { w: 148, h: 148 };

const VARIANTS = [
  { quality: 95, chromaSubsampling: '4:4:4' as const },
  { quality: 92, chromaSubsampling: '4:4:4' as const },
  { quality: 92, chromaSubsampling: '4:2:0' as const },
  { quality: 88, chromaSubsampling: '4:2:0' as const },
  { quality: 85, chromaSubsampling: '4:2:0' as const },
  { quality: 80, chromaSubsampling: '4:2:0' as const },
];

async function measure(base: Sharp, label: string) {
  const px = targetPx(SLOT.w, DPI);
  console.log(`\n=== ${label} (${px}×${targetPx(SLOT.h, DPI)} px bei ${DPI} dpi) ===`);
  console.log('  Qualität  Chroma   pro Bild    → 180 Seiten à 5 Bilder');

  for (const v of VARIANTS) {
    const buf = await base
      .clone()
      .resize({ width: px, height: targetPx(SLOT.h, DPI), fit: 'fill' })
      .jpeg(v)
      .toBuffer();
    const total = buf.length * PAGES * IMAGES_PER_PAGE;
    console.log(
      `  ${String(v.quality).padStart(8)}  ${v.chromaSubsampling}  ${fmtMb(buf.length).padStart(9)}    ${fmtMb(total).padStart(10)}`,
    );
  }
}

async function main() {
  // Pessimistisch: die Rauschfixtures selbst
  await measure(sharp(LARGE), 'Rauschen (Fixtures, Worst Case)');

  // Näherung an ein echtes Foto: flächige Bereiche, wenige harte Kanten
  await measure(sharp(LARGE).blur(3), 'weichgezeichnet (Näherung an echtes Foto)');

  console.log(
    '\nHinweis: echte Fotos liegen zwischen beiden Werten, näher am zweiten.\n' +
      'Der belastbare Wert ergibt sich erst am realen Bestand in Phase 2.',
  );
}

await main();
