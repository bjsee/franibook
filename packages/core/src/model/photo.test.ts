import { describe, expect, it } from 'vitest';
import type { Rgb } from './farbe.js';
import { TONE_GRID, type PhotoTone, rotatePhotoTone } from './photo.js';

/** Neun unterscheidbare Felder: Der Rotkanal trägt den Index. */
const RASTER: PhotoTone = {
  mean: [128, 128, 128],
  grid: Array.from({ length: TONE_GRID * TONE_GRID }, (_, i): Rgb => [i, 0, 0]),
};

/** Nur die Indizes, damit die Erwartung lesbar bleibt. */
function indizes(tone: PhotoTone): number[] {
  return tone.grid.map((f) => f[0]);
}

describe('Farbraster drehen', () => {
  it('lässt es ohne Drehung unangetastet', () => {
    expect(rotatePhotoTone(RASTER, 0)).toBe(RASTER);
  });

  it('schiebt bei einer Vierteldrehung die obere linke Ecke nach oben rechts', () => {
    // 0 1 2        6 3 0
    // 3 4 5   →    7 4 1
    // 6 7 8        8 5 2
    expect(indizes(rotatePhotoTone(RASTER, 1))).toEqual([6, 3, 0, 7, 4, 1, 8, 5, 2]);
  });

  it('kehrt bei einer halben Drehung die Reihenfolge um', () => {
    expect(indizes(rotatePhotoTone(RASTER, 2))).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('kommt nach vier Vierteldrehungen wieder heraus, wo es anfing', () => {
    let tone = RASTER;
    for (let i = 0; i < 4; i++) tone = rotatePhotoTone(tone, 1);
    expect(indizes(tone)).toEqual(indizes(RASTER));
  });

  it('lässt die Mitte in der Mitte', () => {
    for (const turns of [1, 2, 3] as const) {
      expect(rotatePhotoTone(RASTER, turns).grid[4]).toEqual([4, 0, 0]);
    }
  });

  it('rührt ein Raster falscher Länge nicht an', () => {
    // Ein alter Projektstand könnte ein anders geformtes Raster tragen. Es
    // stillschweigend umzusortieren wäre schlimmer als es zu belassen.
    const krumm: PhotoTone = { mean: [0, 0, 0], grid: [[1, 1, 1]] };
    expect(rotatePhotoTone(krumm, 1)).toBe(krumm);
  });

  it('nimmt die mittlere Farbe unverändert mit', () => {
    expect(rotatePhotoTone(RASTER, 3).mean).toEqual(RASTER.mean);
  });
});
