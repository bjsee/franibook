/**
 * Tests der Bildaufbereitung, mit Blick auf die Dateigröße des Exports.
 *
 * Der erste vollständige Export ergab 404 MB für 153 Doppelseiten (Issue #3);
 * das heutige Buch mit 84 Doppelseiten wiegt 160 MB statt 288 MB.
 * Die Gegenmaßnahmen — Chroma-Subsampling, niedrigere Qualitätsstufe,
 * Trellis-Quantisierung — sind alle unsichtbar, solange niemand die Bytes
 * zählt. Genau das tun diese Tests, und sie halten gleichzeitig fest, was
 * dabei *nicht* nachgeben darf: die Zielauflösung und das Baseline-Format.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { type Crop, type PrintProfile, defaultProfile, targetPx } from '@franibook/core';
import { prepareImage } from './prepare-image.js';

const profile = defaultProfile();

/** Slot einer Bildhälfte einer 300-mm-Seite, wie in der Messung zu #3. */
const SLOT_MM = 148;

const crop: Crop = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' };

/**
 * Deterministisches Testbild: ein farbiger Verlauf mit überlagerten Wellen.
 * Kein Rauschen — Rauschen ist für JPEG der Worst Case und würde die
 * Größenverhältnisse in eine Richtung verzerren, die im Bestand nicht vorkommt.
 * Die Wellen liefern trotzdem genug Detail, dass die Qualitätsstufe wirkt.
 */
async function testbild(kante = 2000): Promise<Buffer> {
  const pixel = Buffer.alloc(kante * kante * 3);
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const i = (y * kante + x) * 3;
      pixel[i] = (x / kante) * 200 + Math.sin(x / 7) * 25 + 30;
      pixel[i + 1] = (y / kante) * 180 + Math.sin((x + y) / 11) * 30 + 40;
      pixel[i + 2] = 120 + Math.sin(x / 13) * 40 + Math.cos(y / 9) * 30;
    }
  }
  return sharp(pixel, { raw: { width: kante, height: kante, channels: 3 } })
    .png()
    .toBuffer();
}

describe('prepareImage — Zielauflösung', () => {
  it('skaliert genau auf die Pixelzahl, die der Slot bei Zielauflösung braucht', async () => {
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });

    // 148 mm bei 300 dpi sind 1748 px. Diese Zahl ist die Grenze, an der beim
    // Verkleinern der Datei nicht gespart werden darf: Sie liegt über der
    // Mindestauflösung des Profils und muss dort bleiben.
    expect(prepared.widthPx).toBe(targetPx(SLOT_MM, profile.resolution.targetDpi));
    expect((prepared.widthPx / SLOT_MM) * 25.4).toBeGreaterThanOrEqual(profile.resolution.minDpi);
  });

  it('skaliert kleine Ausschnitte nicht hoch', async () => {
    const prepared = await prepareImage(await testbild(800), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    expect(prepared.widthPx).toBe(800);
  });
});

describe('prepareImage — Kodierung', () => {
  it('bettet Baseline-JPEG ein, nicht progressives', async () => {
    // Progressive JPEGs sparen weitere 2 %, aber wie ein Druck-RIP sie im
    // DCTDecode-Stream behandelt, ist unerprobt. Dieser Test schlägt an, sobald
    // jemand `mozjpeg: true` setzt — das schaltet über `optimiseScans`
    // progressiv ein.
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    const meta = await sharp(prepared.buffer).metadata();
    expect(meta.isProgressive).toBe(false);
  });

  it('übernimmt Chroma-Subsampling und Qualitätsstufe aus dem Druckprofil', async () => {
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    const meta = await sharp(prepared.buffer).metadata();
    expect(meta.chromaSubsampling).toBe(profile.encoding.chromaSubsampling);

    // Gegenprobe mit den alten Vorgaben (92 / 4:4:4). Am Bestand brachten
    // Qualitätsstufe und Chroma zusammen 35 %; die Trellis-Quantisierung steckt
    // in beiden Zweigen und ist hier deshalb nicht mitgemessen.
    const alt: PrintProfile = {
      ...profile,
      encoding: { jpegQuality: 92, chromaSubsampling: '4:4:4' },
    };
    const vorher = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile: alt,
    });
    expect(prepared.buffer.length).toBeLessThan(vorher.buffer.length * 0.75);
  });
});
