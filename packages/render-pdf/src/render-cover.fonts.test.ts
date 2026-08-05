/**
 * Prüft für den Umschlag dasselbe wie `render-pdf.fonts.test.ts` für den
 * Innenteil: dass die Buchschrift wirklich eingebettet ist und pdfkit nicht
 * stillschweigend auf eine seiner 14 nicht eingebetteten Basisschriften
 * zurückfällt (Helvetica war der Anlass für Issue #5). `renderCoverPdf` hatte
 * dafür keine eigene Registrierung – ein separater Test, weil der Fehler sonst
 * unbemerkt zurückkehren könnte, ohne dass der Test für den Innenteil etwas
 * davon merkt.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultProfile, renderCover } from '@franibook/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderCoverPdf } from './render-cover.js';

const profile = defaultProfile();

/** Titel, Untertitel, Rücken- und Rückseitentext – kein Foto nötig für die Schriftfrage. */
const design = {
  title: 'Frani',
  subtitle: '2008 – 2026',
  spineText: 'Frani · 2008 – 2026',
  // Umlaute und ß: Sie müssen die Kodierung in die PDF-Datei überleben.
  backText: 'Achtzehn Jahre in Süderstapel – Fußmärsche und mehr',
};

let bytes: Buffer;
let verzeichnis: string;

beforeAll(async () => {
  const cover = renderCover(design, { profile, pageCount: 160, photos: new Map() });

  verzeichnis = await mkdtemp(join(tmpdir(), 'franibook-cover-pdf-'));
  const outputPath = join(verzeichnis, 'cover.pdf');
  const result = await renderCoverPdf({
    cover,
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

describe('Umschlag-PDF mit Text', () => {
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
    // pdfkits Vorgabe war Helvetica – der Anlass für Issue #5, hier für den
    // Umschlag statt den Innenteil.
    expect(alsText()).not.toMatch(/Helvetica|Times-Roman|Courier/);
  });
});
