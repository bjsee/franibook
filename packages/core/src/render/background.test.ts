import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import {
  BACKGROUND_COLORS,
  BACKGROUND_MIN_DPI,
  backgroundFit,
  chapterBackgrounds,
  isBackgroundColor,
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
    // 546 × 276 mm brauchen bei 150 dpi 3225 px lange Kante.
    const fit = backgroundFit(photo(3225, 1630), profile);
    expect(fit.benoetigtPx).toBe(3225);
    expect(fit.dpi).toBeGreaterThanOrEqual(BACKGROUND_MIN_DPI);
    expect(fit.taugt).toBe(true);
  });

  it('verwirft die Bilder des Zielbestands – 2048 px reichen nicht', () => {
    // Der Median des Bestands. Formatfüllend auf 546 mm ergibt das 95 dpi.
    const fit = backgroundFit(photo(2048, 1536), profile);
    expect(Math.round(fit.dpi)).toBe(95);
    expect(fit.taugt).toBe(false);
  });

  it('bewertet nach der Kante, die stärker vergrößert werden muss', () => {
    // Ein Panorama hat die Breite, scheitert aber an der Höhe.
    const panorama = backgroundFit(photo(6000, 1200), profile);
    expect(panorama.taugt).toBe(false);
    expect(Math.round(panorama.dpi)).toBe(Math.round((1200 / 276) * 25.4));
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

describe('isBackgroundColor', () => {
  it('erkennt jeden Ton der Palette, unabhängig von der Groß-/Kleinschreibung', () => {
    for (const farbe of BACKGROUND_COLORS) {
      expect(isBackgroundColor(farbe.hex)).toBe(true);
      expect(isBackgroundColor(farbe.hex.toUpperCase())).toBe(true);
    }
  });

  it('weist eine freie Farbe außerhalb der Palette ab', () => {
    expect(isBackgroundColor('#123456')).toBe(false);
    expect(isBackgroundColor(undefined)).toBe(false);
    expect(isBackgroundColor(42)).toBe(false);
  });
});

describe('Farbe je Jahrgang', () => {
  const jahre = Array.from({ length: 19 }, (_, i) => 2008 + i);

  it('gibt benachbarten Jahren nie denselben Ton', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const farben = chapterBackgrounds(jahre, seed);
      for (let i = 1; i < jahre.length; i++) {
        expect(farben.get(jahre[i]!)).not.toBe(farben.get(jahre[i - 1]!));
      }
    }
  });

  it('nutzt jeden Ton der Kapitelpalette', () => {
    const farben = new Set(chapterBackgrounds(jahre, 1).values());
    expect(farben.size).toBe(6);
    // Weiß und die dunklen Töne gehören nicht dazu.
    expect(farben.has('#ffffff')).toBe(false);
    expect(farben.has('#1c1917')).toBe(false);
  });

  it('liefert bei gleichem Seed dasselbe Ergebnis', () => {
    const a = chapterBackgrounds(jahre, 5);
    const b = chapterBackgrounds([...jahre].reverse(), 5);
    for (const jahr of jahre) expect(a.get(jahr)).toBe(b.get(jahr));
  });

  it('verschiebt die Folge mit dem Seed', () => {
    const a = chapterBackgrounds(jahre, 1);
    const b = chapterBackgrounds(jahre, 2);
    expect(a.get(2008)).not.toBe(b.get(2008));
  });
});
