import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import {
  BACKGROUND_COLORS,
  BACKGROUND_MIN_DPI,
  backgroundFit,
  luminance,
  textColorOn,
} from './background.js';

const profile = saal as PrintProfile;

function photo(width: number, height: number): Photo {
  return {
    id: 'p',
    relPath: 'p.jpg',
    fileName: 'p.jpg',
    bytes: 1,
    width,
    height,
    orientation: 1,
  };
}

describe('Hintergrundbild', () => {
  it('rechnet auf die Beschnittfläche, nicht auf das Endformat', () => {
    // 606 × 306 mm brauchen bei 150 dpi 3579 px lange Kante.
    const fit = backgroundFit(photo(3579, 1808), profile);
    expect(fit.benoetigtPx).toBe(3579);
    expect(fit.dpi).toBeGreaterThanOrEqual(BACKGROUND_MIN_DPI);
    expect(fit.taugt).toBe(true);
  });

  it('verwirft die Bilder des Zielbestands – 2048 px reichen nicht', () => {
    // Der Median des Bestands. Formatfüllend auf 606 mm ergibt das 86 dpi.
    const fit = backgroundFit(photo(2048, 1536), profile);
    expect(Math.round(fit.dpi)).toBe(86);
    expect(fit.taugt).toBe(false);
  });

  it('bewertet nach der Kante, die stärker vergrößert werden muss', () => {
    // Ein Panorama hat die Breite, scheitert aber an der Höhe.
    const panorama = backgroundFit(photo(6000, 1200), profile);
    expect(panorama.taugt).toBe(false);
    expect(Math.round(panorama.dpi)).toBe(Math.round((1200 / 306) * 25.4));
  });
});

describe('Textfarbe auf dem Hintergrund', () => {
  it('lässt dunklen Text auf hellen Farben stehen', () => {
    for (const farbe of BACKGROUND_COLORS.filter((c) => luminance(c.hex) > 0.45)) {
      expect(textColorOn(farbe.hex, '#3f3f46')).toBe('#3f3f46');
    }
  });

  it('kehrt die Helligkeit auf dunklen Farben um', () => {
    // Ohne diese Regel stünde die Jahreszahl schwarz auf Anthrazit.
    const dunkel = BACKGROUND_COLORS.filter((c) => luminance(c.hex) <= 0.45);
    expect(dunkel.length).toBeGreaterThan(0);
    for (const farbe of dunkel) {
      const hell = textColorOn(farbe.hex, '#3f3f46');
      expect(luminance(hell)).toBeGreaterThan(0.7);
    }
  });

  it('wiegt Grün stärker als Blau, wie das Auge', () => {
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff'));
  });
});
