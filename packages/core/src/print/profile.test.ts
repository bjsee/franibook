import { describe, expect, it } from 'vitest';
import saal from './profiles/format-28x28.json' with { type: 'json' };
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
import { allProfiles } from './profiles/index.js';

const profile = saal as PrintProfile;

describe('Saal-Profil 28×28', () => {
  it('lädt und hat die erwartete Grundgeometrie', () => {
    // 270 und nicht 280: Der Produktname des Anbieters ist gerundet. Das
    // Rohformat der Doppelseite sind 6449 × 3260 px bei 300 dpi, also
    // 546 × 276 mm; abzüglich zweimal 3 mm Beschnitt bleiben 270 je Seite.
    expect(profile.page.trimWidthMm).toBe(270);
    expect(profile.page.trimHeightMm).toBe(270);
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

  it('ist gegen die Angaben des Anbieters geprüft', () => {
    // Am 05.08.2026 aus seinem Profibereich abgelesen. Wer die Maße ändert,
    // ohne sie erneut dort zu prüfen, setzt verifiedAt zurück.
    expect(profile.provenance.verifiedAt).toBe('2026-08-05');
    expect(profile.provenance.source).toContain('Profibereich');
  });
});

describe('Die Formatreihe', () => {
  it('führt acht Formate mit eindeutigen Kennungen', () => {
    const ids = allProfiles().map((p) => p.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(ids[0]).toBe('format-28x28');
  });

  it('hält bei jedem Format Seitenzahl und Umschlag beisammen', () => {
    for (const p of allProfiles()) {
      // Zwei Seiten je Blatt, und die Grenzen sind selbst gültige Zahlen.
      expect(p.pageCount.step).toBe(2);
      expect(isValidPageCount(p, p.pageCount.min)).toBe(true);
      expect(isValidPageCount(p, p.pageCount.max)).toBe(true);
      // Der Rücken bei der kleinsten Auflage ist die Untergrenze, nicht weniger.
      expect(spineWidthMm(p, p.pageCount.min)).toBeCloseTo(p.cover.spine.minMm, 1);
      // Der Falzbereich ist die weitere Zone, das Gelenk das schmale Feld darin.
      expect(p.cover.hingeSafeMm).toBeGreaterThanOrEqual(p.cover.hingeMm);
      // Der Umschlag ist breiter als die beiden Deckel zusammen.
      expect(coverWidthMm(p, p.pageCount.max)).toBeGreaterThan(2 * p.page.trimWidthMm);
    }
  });
});

describe('Doppelseitengeometrie', () => {
  it('rechnet Breite und Höhe einschließlich Beschnitt', () => {
    expect(spreadWidthMm(profile)).toBe(546); // 2 × 270 + 2 × 3
    expect(spreadHeightMm(profile)).toBe(276); // 270 + 2 × 3
  });
});

describe('Buchrücken', () => {
  it('wächst mit der Seitenzahl', () => {
    const { pageThicknessMm, baseMm } = profile.cover.spine;
    expect(spineWidthMm(profile, 160)).toBeCloseTo(160 * pageThicknessMm + baseMm, 6);
    expect(spineWidthMm(profile, 200)).toBeGreaterThan(spineWidthMm(profile, 160));
  });

  it('trifft die Tabelle des Anbieters an ihren Stützstellen', () => {
    // Er gibt 142 px bei 26 Seiten und 425 px bei 160 an, beides bei 300 dpi.
    expect(spineWidthMm(profile, 26)).toBeCloseTo(12.02, 1);
    expect(spineWidthMm(profile, 160)).toBeCloseTo(35.98, 1);
  });

  it('unterschreitet die Mindestbreite nicht', () => {
    expect(spineWidthMm(profile, 0)).toBe(profile.cover.spine.minMm);
  });

  it('verbreitert das Cover entsprechend', () => {
    const schmal = coverWidthMm(profile, 100);
    const breit = coverWidthMm(profile, 200);
    expect(breit - schmal).toBeCloseTo(100 * profile.cover.spine.pageThicknessMm, 6);
  });

  it('berechnet die Coverhöhe unabhängig von der Seitenzahl', () => {
    const { overhang, bleed } = profile.cover;
    expect(coverHeightMm(profile)).toBeCloseTo(270 + 2 * overhang.topMm + 2 * bleed.topMm, 6);
  });
});

describe('maxSlotMm — die Grenze der Templatebibliothek', () => {
  it('ergibt für den Medianfall des Bestands rund 216 mm', () => {
    // 2048 px lange Kante bei 240 dpi
    expect(maxSlotMm(profile, 2048)).toBeCloseTo(216.75, 2);
  });

  it('lässt eine volle Seite für diesen Bestand nicht zu', () => {
    // Bei 270 mm Seitenbreite ist der Abstand kleiner als beim früheren
    // 300er-Profil, aber die Aussage bleibt: 2048 px füllen keine ganze Seite.
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
    expect(isValidPageCount(profile, 24)).toBe(false); // unter dem Minimum
    expect(isValidPageCount(profile, 162)).toBe(false); // über dem Maximum
  });

  it('rundet auf die nächste zulässige Seitenzahl auf', () => {
    expect(nextValidPageCount(profile, 161)).toBe(160); // auf das Maximum begrenzt
    expect(nextValidPageCount(profile, 160)).toBe(160);
    expect(nextValidPageCount(profile, 10)).toBe(26);
    expect(nextValidPageCount(profile, 500)).toBe(160);
  });
});
