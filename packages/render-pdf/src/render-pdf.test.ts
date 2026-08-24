import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Eine Textbox dicht über dem unteren Rand, wie eine Seitenzahl oder eine
 * Zeitstrahl-Beschriftung sie setzt.
 *
 * pdfkit prüft den Umbruch an seiner eigenen Zeilenhöhe (Ascender + Descender,
 * ohne Rücksicht auf `capHeightMm`) – bei 8 pt sind das gut 4 mm mehr, als die
 * Grundlinie hier von der Boxmitte aus vermuten lässt. 6 mm Abstand zur
 * Unterkante reichen dafür genau, ohne dass die Box selbst über die Seite
 * hinausragt.
 */
function spreadMitTextNahAmRand(): RenderedSpread {
  const bleed = profile.page.bleedMm;
  const hoehe = profile.page.trimHeightMm + 2 * bleed;
  return {
    spreadId: 's0',
    widthMm: 2 * profile.page.trimWidthMm + 2 * bleed,
    heightMm: hoehe,
    bleedMm: bleed,
    gutterXMm: profile.page.trimWidthMm + bleed,
    background: '#ffffff',
    boxes: [
      {
        kind: 'text',
        slotId: 'seitenzahl',
        xMm: 20,
        yMm: hoehe - 6,
        wMm: 20,
        hMm: 4,
        content: '60',
        fontSizePt: 8,
        weight: 'regular',
        align: 'left',
        color: '#3f3f46',
      },
    ],
    guides: [],
  };
}

/** Wie viele Seiten das fertige PDF wirklich hat. */
function blattzahl(pdf: string): number {
  return (pdf.match(/\/MediaBox/g) ?? []).length;
}

describe('renderPdf', () => {
  it('fügt keine leere Seite ein, wenn eine Textbox dicht am unteren Rand steht', async () => {
    const ziel = join(dir, 'text-am-rand.pdf');
    const result = await renderPdf({
      spreads: [spreadMitTextNahAmRand()],
      profile,
      outputPath: ziel,
      resolvePhoto: () => ({ path: unlesbar, orientation: 1 }),
    });

    // Ohne den Griff gegen pdfkits eigenmächtigen Seitenumbruch (siehe
    // `render-pdf.ts`, Kommentar bei `doc.page.height`) legte pdfkit hier eine
    // zweite, unbemalte Seite an – das PDF hatte doppelt so viele Blätter, wie
    // der Zähler des Renderers meldete.
    expect(result.pages).toBe(1);
    const pdf = (await readFile(ziel)).toString('latin1');
    expect(blattzahl(pdf)).toBe(1);
  });

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
