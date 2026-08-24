/**
 * Der Umschlag als erste Seite derselben Datei (`RenderPdfOptions.cover`).
 *
 * Ein eigener Test und nicht ein weiterer Fall in `render-pdf.test.ts`: Hier
 * geht es um das Zusammenspiel von Umschlag und Innenteil in einem Dokument,
 * nicht um den Innenteil allein.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FULL_CROP,
  type PhotoId,
  type RenderedSpread,
  defaultProfile,
  mmToPt,
  renderCover,
} from '@franibook/core';
import { renderPdf } from './render-pdf.js';

const profile = defaultProfile();

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-pdf-cover-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function spread(id: string): RenderedSpread {
  const bleed = profile.page.bleedMm;
  return {
    spreadId: id,
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

/** Wie viele Seiten das fertige PDF wirklich hat. */
function blattzahl(pdf: string): number {
  return (pdf.match(/\/MediaBox/g) ?? []).length;
}

describe('renderPdf mit Umschlag', () => {
  it('stellt den Umschlag als erste Seite derselben Datei voran', async () => {
    const cover = renderCover(
      {
        title: 'Franziska',
        subtitle: '2008 – 2026',
        spineText: 'Franziska · 2008 – 2026',
        backText: 'Achtzehn Jahre',
      },
      { profile, pageCount: 160, photos: new Map() },
    );

    const outputPath = join(dir, 'gesamt.pdf');
    const result = await renderPdf({
      spreads: [spread('s0'), spread('s1')],
      profile,
      cover,
      outputPath,
      resolvePhoto: () => undefined,
    });

    // Ein Blatt mehr als Doppelseiten – der Umschlag zählt als eigene Seite.
    expect(result.pages).toBe(3);

    const pdf = (await readFile(outputPath)).toString('latin1');
    expect(blattzahl(pdf)).toBe(3);

    // Die erste MediaBox im Dokument ist die des Umschlagbogens, nicht die
    // einer Doppelseite – genau das erwartet der Uploadweg, für den diese
    // Option gebaut ist.
    const boxen = pdf.match(/\/MediaBox \[[^\]]*\]/g) ?? [];
    expect(boxen).toHaveLength(3);
    const coverBreite = mmToPt(cover.widthMm).toFixed(6);
    const coverHoehe = mmToPt(cover.heightMm).toFixed(6);
    expect(boxen[0]).toBe(`/MediaBox [0 0 ${coverBreite} ${coverHoehe}]`);
  });

  it('bleibt beim Innenteil allein, wenn kein Umschlag angegeben ist', async () => {
    const outputPath = join(dir, 'ohne-umschlag.pdf');
    const result = await renderPdf({
      spreads: [spread('s0')],
      profile,
      outputPath,
      resolvePhoto: () => undefined,
    });

    expect(result.pages).toBe(1);
    const pdf = (await readFile(outputPath)).toString('latin1');
    expect(blattzahl(pdf)).toBe(1);
  });
});
