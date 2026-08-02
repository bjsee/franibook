import { describe, expect, it } from 'vitest';
import { ptToMm } from '../geometry/units.js';
import {
  FONT_METRICS,
  TEXT_STYLES,
  textBaselineOffsetMm,
  textFontSizePt,
  textStyle,
} from './typography.js';

/** Versalhöhe, die eine Größe in Punkt tatsächlich ergibt. */
function capHeightMm(fontSizePt: number): number {
  return ptToMm(fontSizePt) * (FONT_METRICS.capHeight / FONT_METRICS.unitsPerEm);
}

describe('Textstile', () => {
  it('setzt die Versalhöhe auf den vom Stil verlangten Anteil der Kastenhöhe', () => {
    const size = textFontSizePt(13, TEXT_STYLES.groupTitle);
    expect(capHeightMm(size)).toBeCloseTo(13 * 0.462, 6);
  });

  it('behält die Größe, mit der vor der Schriftwahl gerechnet wurde', () => {
    // Vorher: fontSizePt = Kastenhöhe in pt × 0,7. Die Umstellung auf die
    // Versalhöhe sollte die Optik nicht verschieben, sondern nur begründen.
    // Alle Kastenhöhen, die die Templatebibliothek tatsächlich verwendet.
    for (const hMm of [13, 14, 18, 20, 44]) {
      const vorher = (hMm / 25.4) * 72 * 0.7;
      expect(textFontSizePt(hMm, TEXT_STYLES.yearLarge)).toBeCloseTo(vorher, 6);
    }
  });

  it('skaliert mit dem Format, weil der Stil keine Punktgröße festschreibt', () => {
    // Dasselbe Template auf 21×21 cm: Der Kasten ist 0,7-mal so hoch, die
    // Schrift muss es auch sein.
    expect(textFontSizePt(9.1, TEXT_STYLES.groupTitle)).toBeCloseTo(
      0.7 * textFontSizePt(13, TEXT_STYLES.groupTitle),
      6,
    );
  });

  it('nimmt für einen unbekannten Stilnamen den Titelstil', () => {
    expect(textStyle('gibtEsNicht')).toBe(TEXT_STYLES.groupTitle);
    expect(textStyle('yearLarge')).toBe(TEXT_STYLES.yearLarge);
  });

  it('unterscheidet Jahreszahl und Gruppentitel im Schnitt', () => {
    expect(TEXT_STYLES.yearLarge.weight).toBe('regular');
    expect(TEXT_STYLES.groupTitle.weight).toBe('semibold');
  });
});

describe('Grundlinie', () => {
  it('legt das Versalband mittig in den Kasten', () => {
    const size = textFontSizePt(13, TEXT_STYLES.groupTitle);
    const baseline = textBaselineOffsetMm(13, size);
    const cap = capHeightMm(size);
    // Gleich viel Luft über den Versalien wie unter der Grundlinie.
    expect(baseline - cap).toBeCloseTo(13 - baseline, 6);
  });

  it('lässt die Oberlängen im Kasten', () => {
    const size = textFontSizePt(44, TEXT_STYLES.yearLarge);
    const baseline = textBaselineOffsetMm(44, size);
    const ascender = ptToMm(size) * (FONT_METRICS.ascender / FONT_METRICS.unitsPerEm);
    // Ein Ä darf nicht über die Kastenoberkante hinausragen – dort liegt bei
    // den Kapitelauftakten der Satzspiegel.
    expect(baseline - ascender).toBeGreaterThanOrEqual(0);
  });

  it('hängt nur an Kastenhöhe und Schriftgröße', () => {
    // Doppelte Kastenhöhe bei gleicher Schrift: Die Grundlinie wandert um die
    // halbe Differenz nach unten, das Versalband bleibt mittig.
    expect(textBaselineOffsetMm(20, 24) - textBaselineOffsetMm(10, 24)).toBeCloseTo(5, 6);
  });
});
