import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import {
  BACKGROUND_COLORS,
  BACKGROUND_MIN_DPI,
  backgroundArea,
  backgroundFit,
  chapterBackgrounds,
  isBackgroundColor,
  isTextBlockColor,
  TEXT_BLOCK_COLORS,
  TIMELINE_ACCENTS,
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
    // 546 × 276 mm brauchen bei 150 dpi 3225 × 1630 px. Ein Bild in genau
    // diesen Maßen besteht – am Endformat (540 mm) gemessen wären es 3189, und
    // die Prüfung ließe ein zu grobes Bild durch.
    const fit = backgroundFit(photo(3225, 1630), profile);
    expect(fit.dpi).toBeGreaterThanOrEqual(BACKGROUND_MIN_DPI);
    expect(fit.taugt).toBe(true);
  });

  it('nennt die Kante, die klemmt – und was das Bild dort hat', () => {
    // 2048 × 1536 gegen 546 × 276: Die Breite muss stärker vergrößert werden,
    // also ist sie der Engpass. Vorher nannte die Auskunft die lange Kante der
    // Fläche und die lange Kante des Fotos – zwei verschiedene Kanten in einem
    // Satz, der dadurch beruhigend klang.
    const quer = backgroundFit(photo(2048, 1536), profile);
    expect(quer.benoetigtPx).toBe(3225);
    expect(quer.vorhandenPx).toBe(2048);

    // Über eine Buchseite klemmt bei demselben Bild die Höhe.
    const halb = backgroundFit(photo(2048, 1536), profile, 'left');
    expect(halb.benoetigtPx).toBe(1630);
    expect(halb.vorhandenPx).toBe(1536);
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

describe('Hintergrundbild auf einer einzelnen Buchseite', () => {
  it('deckt die halbe Breite, aber dieselbe Höhe', () => {
    const links = backgroundArea(profile, 'left');
    const rechts = backgroundArea(profile, 'right');
    const beide = backgroundArea(profile);

    // Eine Buchseite hat nur außen Beschnitt: 270 + 3 mm.
    expect(links).toEqual({ xMm: 0, yMm: 0, wMm: 273, hMm: 276 });
    // Die rechte beginnt an der Falzachse und endet am äußeren Beschnitt.
    expect(rechts).toEqual({ xMm: 273, yMm: 0, wMm: 273, hMm: 276 });
    expect(rechts.xMm + rechts.wMm).toBe(beide.wMm);
  });

  it('verdoppelt die Auflösung eines Querformats fast', () => {
    // 2048 × 1536 – der Median des Bestands. Über beide Seiten sind es 95 dpi,
    // über eine Buchseite begrenzt die Höhe: 1536 px auf 276 mm.
    const eine = backgroundFit(photo(2048, 1536), profile, 'left');
    expect(Math.round(eine.dpi)).toBe(141);
    // Und bleibt damit knapp unter der Schwelle – genau die Kante, an der
    // dieser Bestand liegt (`background.ts`, Kopfkommentar).
    expect(eine.taugt).toBe(false);
  });

  it('lässt ein Bild bestehen, dessen kurze Kante reicht', () => {
    // 1630 px auf 276 mm sind 150 dpi; die Breite von 273 mm verlangt weniger.
    const fit = backgroundFit(photo(2000, 1631), profile, 'right');
    expect(fit.taugt).toBe(true);
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

describe('Farben eines Textblocks', () => {
  it('führt `auto` voran und kennt es nicht als Farbwert', () => {
    expect(TEXT_BLOCK_COLORS[0]?.value).toBe('auto');
    // „Keine Farbe" ist ein fehlendes Feld und kein speicherbarer Wert.
    expect(isTextBlockColor('auto')).toBe(false);
  });

  it('nimmt nur Töne aus der Palette', () => {
    expect(isTextBlockColor('#ffffff')).toBe(true);
    expect(isTextBlockColor('#FFFFFF')).toBe(true);
    expect(isTextBlockColor('#ff00ff')).toBe(false);
    expect(isTextBlockColor(undefined)).toBe(false);
  });

  it('teilt die Akzenttöne mit dem Zeitstrahl, statt sie zu wiederholen', () => {
    for (const akzent of TIMELINE_ACCENTS.filter((a) => a.value !== 'auto')) {
      expect(isTextBlockColor(akzent.value)).toBe(true);
    }
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
