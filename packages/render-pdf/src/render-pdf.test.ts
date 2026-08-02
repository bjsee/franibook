/**
 * Prüft, was am PDF von außen prüfbar ist, ohne es zu rastern: dass die Schrift
 * wirklich in der Datei steckt.
 *
 * Der Parity-Test vergleicht Vorschau und PDF Pixel für Pixel, kann aber nicht
 * sehen, ob die Schrift eingebettet oder nur benannt ist – beim Rastern liegt
 * sie ohnehin lokal vor. Saal verlangt die Einbettung; also gehört sie hier
 * geprüft.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RenderedSpread, TEXT_STYLES, defaultProfile, textFontSizePt } from '@franibook/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdf } from './render-pdf.js';

const profile = defaultProfile();

/** Eine Doppelseite mit je einem Text in beiden Schnitten, ohne Bilder. */
function textSpread(): RenderedSpread {
  const style = TEXT_STYLES.yearLarge;
  const titel = TEXT_STYLES.groupTitle;
  return {
    spreadId: 'test',
    widthMm: 606,
    heightMm: 306,
    bleedMm: 3,
    gutterXMm: 303,
    background: '#ffffff',
    boxes: [
      {
        kind: 'text',
        xMm: 25,
        yMm: 25,
        wMm: 200,
        hMm: 44,
        slotId: 'jahr',
        content: '2024',
        fontSizePt: textFontSizePt(44, style),
        weight: style.weight,
        align: 'left',
        color: style.color,
      },
      {
        kind: 'text',
        xMm: 25,
        yMm: 90,
        wMm: 250,
        hMm: 13,
        slotId: 'titel',
        // Umlaute und ß: Sie müssen die Kodierung in die PDF-Datei überleben.
        content: 'Ostern in Süderstapel – Fußmärsche',
        fontSizePt: textFontSizePt(13, titel),
        weight: titel.weight,
        align: 'left',
        color: titel.color,
      },
    ],
    guides: [],
  };
}

let bytes: Buffer;
let verzeichnis: string;

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), 'franibook-pdf-'));
  const outputPath = join(verzeichnis, 'text.pdf');
  const result = await renderPdf({
    spreads: [textSpread()],
    profile,
    resolvePhoto: () => undefined,
    outputPath,
  });
  expect(result.images).toBe(0);
  bytes = await readFile(outputPath);
});

afterAll(async () => {
  await rm(verzeichnis, { recursive: true, force: true });
});

describe('PDF-Export mit Text', () => {
  const alsText = () => bytes.toString('latin1');

  it('bettet beide Schnitte der Buchschrift ein', () => {
    const inhalt = alsText();
    // FontFile2 ist der eingebettete TrueType-Datenstrom. Ohne ihn steht im PDF
    // nur ein Schriftname, und der Druckdienstleister setzt, was er findet.
    expect(inhalt.match(/\/FontFile2/g) ?? []).toHaveLength(2);
    expect(inhalt).toMatch(/FranibookSans-Regular/);
    expect(inhalt).toMatch(/FranibookSans-SemiBold/);
  });

  it('verwendet keine der nicht eingebetteten PDF-Basisschriften', () => {
    // pdfkits Vorgabe war Helvetica – der Anlass für Issue #5.
    expect(alsText()).not.toMatch(/Helvetica|Times-Roman|Courier/);
  });

  it('schreibt beide Seiten der Doppelseite', async () => {
    const result = await renderPdf({
      spreads: [textSpread()],
      profile,
      resolvePhoto: () => undefined,
      outputPath: join(verzeichnis, 'zweite.pdf'),
    });
    // Das Standardprofil exportiert Einzelseiten; Text darf daran nichts ändern.
    expect(result.pages).toBe(profile.spreadExport === 'single' ? 2 : 1);
    expect(result.skipped).toHaveLength(0);
  });
});
