import { describe, expect, it } from 'vitest';
import saal from './profiles/saal-30x30.json' with { type: 'json' };
import {
  type PrintProfile,
  coverHeightMm,
  coverWidthMm,
  isValidPageCount,
  maxSlotMm,
  nextValidPageCount,
  spineWidthMm,
  spreadHeightMm,
  spreadWidthMm,
} from './profile.js';

const profile = saal as PrintProfile;

describe('Saal-Profil 30×30', () => {
  it('lädt und hat die erwartete Grundgeometrie', () => {
    expect(profile.page.trimWidthMm).toBe(300);
    expect(profile.page.trimHeightMm).toBe(300);
    expect(profile.resolution.minDpi).toBe(240);
  });

  it('kodiert mit den auf Uploadgröße gemessenen Werten', () => {
    // Issue #3: 404 MB für 153 Doppelseiten waren zu viel. 88 / 4:2:0 samt
    // Trellis-Quantisierung im Encoder drückt dasselbe Buch von 288 auf 160 MB,
    // ohne die Zielauflösung anzutasten – die bleibt bei 300 dpi, über minDpi.
    expect(profile.encoding.jpegQuality).toBe(88);
    expect(profile.encoding.chromaSubsampling).toBe('4:2:0');
    expect(profile.resolution.targetDpi).toBe(300);
  });

  it('ist als unverifiziert markiert, solange die Maße nicht aus der Vorlage stammen', () => {
    // Schlägt bewusst fehl, sobald jemand verifiedAt setzt, ohne den Test
    // anzupassen – dann muss auch geprüft worden sein.
    expect(profile.provenance.verifiedAt).toBeNull();
  });
});

describe('Doppelseitengeometrie', () => {
  it('rechnet Breite und Höhe einschließlich Beschnitt', () => {
    expect(spreadWidthMm(profile)).toBe(606); // 2 × 300 + 2 × 3
    expect(spreadHeightMm(profile)).toBe(306); // 300 + 2 × 3
  });
});

describe('Buchrücken', () => {
  it('wächst mit der Seitenzahl', () => {
    expect(spineWidthMm(profile, 160)).toBeCloseTo(160 * 0.13 + 4, 6);
    expect(spineWidthMm(profile, 200)).toBeGreaterThan(spineWidthMm(profile, 160));
  });

  it('unterschreitet die Mindestbreite nicht', () => {
    expect(spineWidthMm(profile, 0)).toBe(profile.cover.spine.minMm);
  });

  it('verbreitert das Cover entsprechend', () => {
    const schmal = coverWidthMm(profile, 100);
    const breit = coverWidthMm(profile, 200);
    expect(breit - schmal).toBeCloseTo(100 * 0.13, 6);
  });

  it('berechnet die Coverhöhe unabhängig von der Seitenzahl', () => {
    expect(coverHeightMm(profile)).toBe(300 + 2 * 15 + 2 * 3);
  });
});

describe('maxSlotMm — die Grenze der Templatebibliothek', () => {
  it('ergibt für den Medianfall des Bestands rund 216 mm', () => {
    // 2048 px lange Kante bei 240 dpi
    expect(maxSlotMm(profile, 2048)).toBeCloseTo(216.75, 2);
  });

  it('lässt eine volle Seite von 300 mm für diesen Bestand nicht zu', () => {
    expect(maxSlotMm(profile, 2048)).toBeLessThan(profile.page.trimWidthMm);
  });

  it('gibt hochauflösenden Fotos die volle Seite frei', () => {
    // 3000 px reichen bei 240 dpi für 317 mm
    expect(maxSlotMm(profile, 3000)).toBeGreaterThan(profile.page.trimWidthMm);
  });
});

describe('Seitenzahlregeln', () => {
  it('akzeptiert nur Vielfache der Schrittweite im gültigen Bereich', () => {
    expect(isValidPageCount(profile, 160)).toBe(true);
    expect(isValidPageCount(profile, 161)).toBe(false);
    expect(isValidPageCount(profile, 22)).toBe(false); // unter dem Minimum
    expect(isValidPageCount(profile, 162)).toBe(false); // über dem Maximum
  });

  it('rundet auf die nächste zulässige Seitenzahl auf', () => {
    expect(nextValidPageCount(profile, 161)).toBe(160); // auf das Maximum begrenzt
    expect(nextValidPageCount(profile, 160)).toBe(160);
    expect(nextValidPageCount(profile, 10)).toBe(24);
    expect(nextValidPageCount(profile, 500)).toBe(160);
  });
});
