import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COVER_MOSAIC,
  MAX_MOSAIC_COLS,
  MIN_MOSAIC_COLS,
  MOSAIC_ID_PREFIX,
  istMosaikId,
  pruefeCoverMosaic,
} from './cover.js';

describe('Anweisung für ein Titelmosaik prüfen', () => {
  it('lässt die Vorgabe durch', () => {
    expect(pruefeCoverMosaic(DEFAULT_COVER_MOSAIC)).toBeUndefined();
  });

  it('nimmt die Rasterweiten an beiden Grenzen an', () => {
    expect(pruefeCoverMosaic({ cols: MIN_MOSAIC_COLS })).toBeUndefined();
    expect(pruefeCoverMosaic({ cols: MAX_MOSAIC_COLS })).toBeUndefined();
  });

  it('weist eine Rasterweite ab, die den Server umbrächte', () => {
    // Der Fall, um den es geht: Die Zellenzahl wächst quadratisch, 20 000
    // Spalten wären 400 Millionen Zellen. Die Oberfläche deckelt, die Route
    // muss es auch — ihr Rumpf kommt ungeprüft aus dem Netz.
    expect(pruefeCoverMosaic({ cols: 20000 })).toMatch(/Rasterweite/);
    expect(pruefeCoverMosaic({ cols: MAX_MOSAIC_COLS + 1 })).toMatch(/Rasterweite/);
  });

  it('weist eine zu grobe Rasterweite ab', () => {
    expect(pruefeCoverMosaic({ cols: 1 })).toMatch(/Rasterweite/);
  });

  it('erkennt Zahlen, die keine sind', () => {
    // Über JSON kommt kein `NaN` an, wohl aber `null` oder ein Text — beides
    // wird beim Rechnen zu `NaN` und ergäbe ein leeres Raster ohne Fehlermeldung.
    expect(pruefeCoverMosaic({ cols: NaN })).toBeDefined();
    expect(pruefeCoverMosaic({ cols: Infinity })).toBeDefined();
    expect(pruefeCoverMosaic({ cols: 44, seed: NaN })).toBeDefined();
  });

  it('hält Anteile zwischen null und eins', () => {
    expect(pruefeCoverMosaic({ cols: 44, gap: 1.5 })).toMatch(/Fuge/);
    expect(pruefeCoverMosaic({ cols: 44, tint: -0.1 })).toMatch(/Einfärbung/);
    expect(pruefeCoverMosaic({ cols: 44, padding: 2 })).toMatch(/Rand/);
    expect(pruefeCoverMosaic({ cols: 44, gap: 0, tint: 1, padding: 0.5 })).toBeUndefined();
  });

  it('lässt die Vielfalt nicht negativ werden', () => {
    expect(pruefeCoverMosaic({ cols: 44, reuseCost: -1 })).toMatch(/Vielfalt/);
    // Nach oben offen: Ein sehr hoher Zuschlag verteilt nur gleichmäßiger, er
    // kostet nichts.
    expect(pruefeCoverMosaic({ cols: 44, reuseCost: 100 })).toBeUndefined();
  });

  it('begrenzt die Länge der Form', () => {
    expect(pruefeCoverMosaic({ cols: 44, text: 'x'.repeat(41) })).toMatch(/40 Zeichen/);
    expect(pruefeCoverMosaic({ cols: 44, text: '18' })).toBeUndefined();
    // Leer ist erlaubt und heißt „keine Form".
    expect(pruefeCoverMosaic({ cols: 44, text: '' })).toBeUndefined();
  });
});

describe('Kennung eines gebackenen Mosaiks', () => {
  it('erkennt sie am Präfix', () => {
    expect(istMosaikId(`${MOSAIC_ID_PREFIX}0z0auzw`)).toBe(true);
  });

  it('hält eine Fotokennung davon auseinander', () => {
    // Fotokennungen sind Hexadezimal-Hashes; ein Doppelpunkt kann darin nicht
    // vorkommen. Genau darauf beruht die Trennung.
    expect(istMosaikId('5bcdb11e6918abbe')).toBe(false);
    expect(istMosaikId('')).toBe(false);
  });
});
