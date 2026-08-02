import { describe, expect, it } from 'vitest';
import { MM_PER_INCH, effectiveDpi, mmToPt, mmToPx, ptToMm, pxToMm, targetPx } from './units.js';

describe('mm ↔ pt', () => {
  it('rechnet ein Zoll auf 72 Punkte', () => {
    expect(mmToPt(MM_PER_INCH)).toBeCloseTo(72, 10);
  });

  it('bildet A4-Breite auf die bekannten 595,28 pt ab', () => {
    expect(mmToPt(210)).toBeCloseTo(595.2755905511812, 6);
  });

  it('ist umkehrbar', () => {
    for (const mm of [0, 1, 3.5, 210, 297, 620.5]) {
      expect(ptToMm(mmToPt(mm))).toBeCloseTo(mm, 10);
    }
  });
});

describe('mm ↔ px', () => {
  it('rechnet ein Zoll bei 300 dpi auf 300 Pixel', () => {
    expect(mmToPx(MM_PER_INCH, 300)).toBeCloseTo(300, 10);
  });

  it('ist umkehrbar', () => {
    for (const mm of [0, 1, 90, 305]) {
      expect(pxToMm(mmToPx(mm, 300), 300)).toBeCloseTo(mm, 10);
    }
  });
});

describe('effectiveDpi', () => {
  it('liefert genau die Zielauflösung, wenn die Pixel exakt passen', () => {
    // 90 mm bei 300 dpi entsprechen 1062,99 px
    expect(effectiveDpi(mmToPx(90, 300), 90)).toBeCloseTo(300, 10);
  });

  it('sinkt proportional zum Ausschnitt', () => {
    const fullWidthPx = 6000;
    const slotMm = 150;
    const voll = effectiveDpi(fullWidthPx, slotMm);
    const halbiert = effectiveDpi(fullWidthPx * 0.5, slotMm);
    expect(halbiert).toBeCloseTo(voll / 2, 10);
  });

  it('erkennt ein zu klein aufgelöstes Bild in einem großen Slot', () => {
    // Handyfoto von 2008: 1600 px breit, über eine halbe Doppelseite von 300 mm
    expect(effectiveDpi(1600, 300)).toBeLessThan(150);
  });

  it('behandelt einen Slot ohne Breite als unendlich aufgelöst statt zu teilen', () => {
    expect(effectiveDpi(1000, 0)).toBe(Infinity);
  });
});

describe('targetPx', () => {
  it('rundet auf, damit die Zielauflösung nie unterschritten wird', () => {
    // 90 mm bei 300 dpi = 1062,99… px
    expect(targetPx(90, 300)).toBe(1063);
    expect(effectiveDpi(targetPx(90, 300), 90)).toBeGreaterThanOrEqual(300);
  });
});
