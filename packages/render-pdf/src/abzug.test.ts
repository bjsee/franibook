/**
 * Der Korrekturabzug im PDF.
 *
 * Geprüft wird, was den Abzug vom Druck unterscheidet – Blattmaß, Blattzahl,
 * fehlende Schnittmarken, Dateigröße. Die Blattgeometrie selbst prüft
 * `core/pruefung/abzug.test.ts`; hier geht es nur darum, dass der Adapter sie
 * auch umsetzt.
 */
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FULL_CROP,
  abzugsblatt,
  defaultProfile,
  linkeSeitenzahl,
  mmToPt,
  type PhotoId,
  type PrintProfile,
  type RenderedSpread,
} from '@franibook/core';
import { renderPdf } from './render-pdf.js';

const profile = defaultProfile();

let dir: string;
let bild: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-abzug-'));
  bild = join(dir, 'bild.jpg');
  await rauschbild(2000).toFile(bild);
});

/**
 * Ein Bild, das sich schlecht komprimieren lässt.
 *
 * Eine einfarbige Fläche schrumpft in jedem JPEG auf wenige Kilobyte – der
 * Unterschied zwischen Druck und Abzug verschwände dann im Rauschen der
 * PDF-Struktur. Das Muster ist gerechnet und nicht gewürfelt, damit derselbe
 * Lauf dieselbe Datei ergibt.
 */
function rauschbild(kante: number) {
  const daten = Buffer.alloc(kante * kante * 3);
  for (let i = 0; i < daten.length; i++) {
    daten[i] = (i * 2654435761) % 251;
  }
  return sharp(daten, { raw: { width: kante, height: kante, channels: 3 } }).jpeg();
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function spread(id: string): RenderedSpread {
  const bleed = profile.page.bleedMm;
  const hoehe = profile.page.trimHeightMm + 2 * bleed;
  return {
    spreadId: id,
    widthMm: 2 * profile.page.trimWidthMm + 2 * bleed,
    heightMm: hoehe,
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
        wMm: 120,
        hMm: 120,
      },
      // Eine Zeile im Fußraum, wie sie der Zeitstrahl auf jeder Doppelseite
      // setzt. Sie steht tiefer, als ein A4-Blatt hoch ist – der Fall, an dem
      // pdfkit von sich aus umbrechen wollte.
      {
        kind: 'text',
        slotId: 'zeitstrahl',
        xMm: 20,
        yMm: hoehe - 12,
        wMm: 60,
        hMm: 4,
        content: '2019',
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

function alsAbzug(p: PrintProfile) {
  return (index: number) => abzugsblatt(p, { linkeSeite: linkeSeitenzahl(index) });
}

describe('Korrekturabzug', () => {
  it('macht ein Blatt je Doppelseite, in DIN A4 quer', async () => {
    const ziel = join(dir, 'abzug.pdf');
    const ergebnis = await renderPdf({
      spreads: [spread('s0'), spread('s1')],
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: ziel,
      abzug: alsAbzug(profile),
    });

    expect(ergebnis.pages).toBe(2);
    expect(ergebnis.images).toBe(2);

    const pdf = (await readFile(ziel)).toString('latin1');
    // pdfkit schreibt Seitenmaße mit sechs Nachkommastellen aus.
    const breite = mmToPt(297).toFixed(6);
    const hoehe = mmToPt(210).toFixed(6);
    expect(pdf).toContain(`/MediaBox [0 0 ${breite} ${hoehe}]`);

    // Die gezählte Zahl **und** die im Dokument: pdfkit legt bei einer Zeile
    // unterhalb des Satzspiegels von sich aus eine Seite nach, und der Zähler
    // des Renderers merkt davon nichts. Am echten Buch waren das 154 Blatt für
    // 52 Doppelseiten, alle drei Blatt zwei davon leer.
    expect(blattzahl(pdf)).toBe(2);
  });

  it('bleibt auch dann bei einem Blatt, wenn das Profil Einzelseiten verlangt', async () => {
    // Wer durchsieht, will die Doppelseite sehen – aufgeteilt wird erst für die
    // Druckerei.
    const einzeln: PrintProfile = { ...profile, spreadExport: 'single' };

    const geteilt = await renderPdf({
      spreads: [spread('s0')],
      profile: einzeln,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: join(dir, 'druck.pdf'),
    });
    const abzug = await renderPdf({
      spreads: [spread('s0')],
      profile: einzeln,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: join(dir, 'abzug.pdf'),
      abzug: alsAbzug(einzeln),
    });

    expect(geteilt.pages).toBe(2);
    expect(abzug.pages).toBe(1);
    expect(blattzahl((await readFile(join(dir, 'abzug.pdf'))).toString('latin1'))).toBe(1);
  });

  it('trägt keine Schnittmarken – er ist keine Druckdatei', async () => {
    const ziel = join(dir, 'abzug.pdf');
    await renderPdf({
      spreads: [spread('s0')],
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: ziel,
      abzug: alsAbzug(profile),
    });

    const pdf = (await readFile(ziel)).toString('latin1');
    expect(pdf).not.toContain('/TrimBox');
    expect(pdf).not.toContain('/BleedBox');
  });

  it('bleibt deutlich unter der Größe der Druckdatei', async () => {
    const seiten = [spread('s0'), spread('s1'), spread('s2'), spread('s3')];
    const druck = join(dir, 'druck.pdf');
    const abzug = join(dir, 'abzug.pdf');
    await renderPdf({
      spreads: seiten,
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: druck,
    });
    await renderPdf({
      spreads: seiten,
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: abzug,
      abzug: alsAbzug(profile),
    });

    // Ein Zehntel ist die gemessene Größenordnung und keine Wunschzahl: Die
    // Auflösung fällt von 240 dpi auf 150 dpi des verkleinerten Blattes (Faktor
    // 6,7 in der Pixelzahl), die Qualitätsstufe von 88 auf 65. Vier Doppelseiten,
    // damit die eingebettete Schrift der Seitenzahlen – ein fester Aufschlag,
    // den nur der Abzug trägt – die Messung nicht bestimmt.
    const klein = (await stat(abzug)).size;
    const groß = (await stat(druck)).size;
    expect(klein).toBeLessThan(groß / 10);
  });

  it('setzt die Seitenzahlen fortlaufend über die Doppelseiten', async () => {
    const ziel = join(dir, 'abzug.pdf');
    const zahlen: string[] = [];

    await renderPdf({
      spreads: [spread('s0'), spread('s1'), spread('s2')],
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: ziel,
      abzug: (index) => {
        const blatt = abzugsblatt(profile, { linkeSeite: linkeSeitenzahl(index) });
        for (const box of blatt.boxen) {
          if (box.kind === 'text') zahlen.push(box.content);
        }
        return blatt;
      },
    });

    // Je Blatt zwei Zahlen; `registerFonts` fragt die Blätter vorab ein
    // zweites Mal ab, deshalb die Menge statt der Liste.
    expect([...new Set(zahlen)]).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});
