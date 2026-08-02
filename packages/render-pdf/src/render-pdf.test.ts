import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FULL_CROP, type PhotoId, type RenderedSpread, defaultProfile } from '@franibook/core';
import { type PhotoSource, renderPdf } from './render-pdf.js';

const profile = defaultProfile();

let dir: string;
/** Datei, an der sharp scheitert – der Fall aus dem echten Bestand. */
let unlesbar: string;
/** Das Konvertat, das die Rückfallebene liefert. */
let ersatz: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-pdf-'));
  unlesbar = join(dir, 'kaputt.png');
  ersatz = join(dir, 'kaputt.jpg');

  // Ein PNG-Signaturkopf mit Müll dahinter: Die Endung verspricht ein Bild,
  // der Decoder steigt aus – genau die Lage, die im Bestand ein Bild kostete.
  await writeFile(unlesbar, Buffer.from('89504e470d0a1a0a4d75656c6c', 'hex'));
  await sharp({
    create: { width: 900, height: 900, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toFile(ersatz);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function spreadMitEinemBild(): RenderedSpread {
  const bleed = profile.page.bleedMm;
  return {
    spreadId: 's0',
    widthMm: 2 * profile.page.trimWidthMm + 2 * bleed,
    heightMm: profile.page.trimHeightMm + 2 * bleed,
    bleedMm: bleed,
    gutterXMm: profile.page.trimWidthMm + bleed,
    background: '#ffffff',
    boxes: [
      {
        kind: 'image',
        slotId: 'a',
        photoId: 'p1' as PhotoId,
        crop: FULL_CROP,
        effectiveDpi: 300,
        warnings: [],
        xMm: 20,
        yMm: 20,
        wMm: 60,
        hMm: 60,
      },
    ],
    guides: [],
  };
}

describe('renderPdf', () => {
  it('meldet ein unlesbares Bild ohne Rückfallebene als übersprungen', async () => {
    const result = await renderPdf({
      spreads: [spreadMitEinemBild()],
      profile,
      outputPath: join(dir, 'ohne.pdf'),
      resolvePhoto: () => ({ path: unlesbar, orientation: 1 }),
    });

    expect(result.images).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('rettet ein unlesbares Bild über die Rückfallebene', async () => {
    const gründe: string[] = [];
    const result = await renderPdf({
      spreads: [spreadMitEinemBild()],
      profile,
      outputPath: join(dir, 'mit.pdf'),
      resolvePhoto: () => ({ path: unlesbar, orientation: 1 }),
      recoverPhoto: (_photoId, reason): Promise<PhotoSource | undefined> => {
        gründe.push(reason);
        return Promise.resolve({ path: ersatz, orientation: 1 });
      },
    });

    expect(result.skipped).toEqual([]);
    expect(result.images).toBe(1);
    // Der Renderer sagt dem Aufrufer, woran es lag – erst das erlaubt ihm zu
    // entscheiden, ob ein Rettungsversuch überhaupt lohnt.
    expect(gründe).toHaveLength(1);
    expect(gründe[0]).toBeTruthy();
  });

  it('nennt beide Gründe, wenn auch die Rückfallebene nicht trägt', async () => {
    const result = await renderPdf({
      spreads: [spreadMitEinemBild()],
      profile,
      outputPath: join(dir, 'zweimal.pdf'),
      resolvePhoto: () => ({ path: unlesbar, orientation: 1 }),
      recoverPhoto: () => Promise.resolve({ path: join(dir, 'auch-weg.png'), orientation: 1 }),
    });

    expect(result.images).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('Rettungsversuch');
  });
});
