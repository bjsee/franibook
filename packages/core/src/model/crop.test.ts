import { describe, expect, it } from 'vitest';
import {
  MIN_CROP_EDGE,
  coverCrop,
  cropLoss,
  cropToPixels,
  fitCropToAspect,
  panCrop,
  zoomCrop,
} from './crop.js';

describe('coverCrop', () => {
  it('lässt ein passendes Bild unbeschnitten', () => {
    const c = coverCrop(4 / 3, 4 / 3);
    expect(c.w).toBeCloseTo(1, 10);
    expect(c.h).toBeCloseTo(1, 10);
    expect(cropLoss(c)).toBeCloseTo(0, 10);
  });

  it('beschneidet ein breites Bild seitlich, nicht oben und unten', () => {
    const c = coverCrop(16 / 9, 1); // Panorama in quadratischen Slot
    expect(c.h).toBe(1);
    expect(c.w).toBeCloseTo(9 / 16, 10);
    expect(c.y).toBe(0);
  });

  it('beschneidet ein hohes Bild oben und unten', () => {
    const c = coverCrop(3 / 4, 1); // Hochformat in quadratischen Slot
    expect(c.w).toBe(1);
    expect(c.h).toBeCloseTo(3 / 4, 10);
    expect(c.x).toBe(0);
  });

  it('zentriert ohne Fokuspunkt', () => {
    const c = coverCrop(2, 1);
    expect(c.x).toBeCloseTo(0.25, 10); // (1 - 0.5) / 2
  });

  it('verschiebt den Ausschnitt zum Fokuspunkt', () => {
    const c = coverCrop(2, 1, { x: 0.3, y: 0.5 });
    expect(c.x).toBeCloseTo(0.05, 10); // 0.3 - 0.5/2
  });

  it('klemmt den Fokuspunkt am Bildrand', () => {
    const links = coverCrop(2, 1, { x: 0.0, y: 0.5 });
    expect(links.x).toBe(0);
    const rechts = coverCrop(2, 1, { x: 1.0, y: 0.5 });
    expect(rechts.x).toBeCloseTo(0.5, 10); // 1 - w
  });

  it('bleibt für jedes Seitenverhältnis innerhalb des Bildes', () => {
    for (const pa of [0.3, 0.5, 0.75, 1, 1.33, 1.78, 3]) {
      for (const sa of [0.5, 0.8, 1, 1.5, 2.5]) {
        const c = coverCrop(pa, sa);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(1.0000001);
        expect(c.y + c.h).toBeLessThanOrEqual(1.0000001);
      }
    }
  });

  it('erzeugt einen Ausschnitt mit dem Seitenverhältnis des Slots', () => {
    // Der eigentliche Zweck: der beschnittene Bereich muss exakt in den Slot
    // passen, sonst verzerrt eines der beiden Rendering-Ziele.
    for (const [pa, sa] of [
      [4 / 3, 1],
      [3 / 4, 1.5],
      [1, 2],
      [2, 0.5],
    ] as const) {
      const c = coverCrop(pa, sa);
      const resultingAspect = (c.w * pa) / c.h;
      expect(resultingAspect).toBeCloseTo(sa, 8);
    }
  });

  it('behandelt unsinnige Eingaben als vollen Ausschnitt', () => {
    expect(coverCrop(0, 1).w).toBe(1);
    expect(coverCrop(1, 0).w).toBe(1);
    expect(coverCrop(NaN, 1).w).toBe(1);
  });
});

describe('cropToPixels', () => {
  it('rechnet den vollen Ausschnitt auf die Bildmaße', () => {
    const p = cropToPixels({ x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' }, 2048, 1536);
    expect(p).toEqual({ left: 0, top: 0, width: 2048, height: 1536 });
  });

  it('rechnet einen Teilausschnitt korrekt um', () => {
    const p = cropToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5, mode: 'manual' }, 2000, 1000);
    expect(p).toEqual({ left: 500, top: 500, width: 1000, height: 500 });
  });

  it('greift nie über den Bildrand hinaus', () => {
    // Ein Ausschnitt, der durch Rundung über den Rand laufen könnte
    const p = cropToPixels({ x: 0.9999, y: 0.9999, w: 1, h: 1, mode: 'manual' }, 100, 100);
    expect(p.left + p.width).toBeLessThanOrEqual(100);
    expect(p.top + p.height).toBeLessThanOrEqual(100);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
  });

  it('liefert auch bei winzigen Ausschnitten mindestens ein Pixel', () => {
    const p = cropToPixels({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001, mode: 'manual' }, 100, 100);
    expect(p.width).toBeGreaterThanOrEqual(1);
    expect(p.height).toBeGreaterThanOrEqual(1);
  });
});

describe('panCrop', () => {
  it('verschiebt und markiert als manuell', () => {
    const c = panCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5, mode: 'auto-cover' }, 0.1, -0.1);
    expect(c.x).toBeCloseTo(0.3, 10);
    expect(c.y).toBeCloseTo(0.1, 10);
    expect(c.mode).toBe('manual');
  });

  it('lässt den Ausschnitt nicht aus dem Bild wandern', () => {
    const c = panCrop({ x: 0.4, y: 0, w: 0.5, h: 1, mode: 'manual' }, 0.5, 0);
    expect(c.x).toBeCloseTo(0.5, 10);
    expect(c.w).toBe(0.5);
  });
});

describe('zoomCrop', () => {
  it('zoomt um die Mitte hinein', () => {
    const c = zoomCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5, mode: 'auto-cover' }, 0.5);
    expect(c.w).toBeCloseTo(0.25, 10);
    expect(c.h).toBeCloseTo(0.25, 10);
    // Mittelpunkt bleibt bei 0,5 / 0,5
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 10);
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 10);
    expect(c.mode).toBe('manual');
  });

  it('behält beim Zoomen das Seitenverhältnis des Ausschnitts', () => {
    // Der eigentliche Zweck: der Ausschnitt muss weiter genau in den Slot
    // passen, sonst verzerrt eines der beiden Rendering-Ziele.
    const vorher = { x: 0.1, y: 0.2, w: 0.6, h: 0.3, mode: 'manual' as const };
    const nachher = zoomCrop(vorher, 1.3);
    expect(nachher.w / nachher.h).toBeCloseTo(vorher.w / vorher.h, 10);
  });

  it('zoomt höchstens bis zum vollen Bild heraus', () => {
    const c = zoomCrop({ x: 0.2, y: 0, w: 0.5, h: 1, mode: 'manual' }, 4);
    expect(c.w).toBeCloseTo(0.5, 10); // Höhe war schon voll, also kein Spielraum
    expect(c.h).toBe(1);
  });

  it('zoomt nicht unter die kleinste zulässige Kante hinein', () => {
    const c = zoomCrop({ x: 0.4, y: 0.4, w: 0.2, h: 0.1, mode: 'manual' }, 0.01);
    expect(Math.min(c.w, c.h)).toBeCloseTo(MIN_CROP_EDGE, 10);
  });

  it('bleibt bei jedem Faktor innerhalb des Bildes', () => {
    for (const f of [0.1, 0.5, 0.9, 1, 1.1, 2, 10]) {
      const c = zoomCrop({ x: 0.6, y: 0.05, w: 0.35, h: 0.7, mode: 'manual' }, f);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1.0000001);
      expect(c.y + c.h).toBeLessThanOrEqual(1.0000001);
    }
  });

  it('lässt unsinnige Faktoren unbeachtet', () => {
    const vorher = { x: 0.1, y: 0.1, w: 0.5, h: 0.5, mode: 'manual' as const };
    expect(zoomCrop(vorher, 0)).toBe(vorher);
    expect(zoomCrop(vorher, NaN)).toBe(vorher);
  });
});

describe('fitCropToAspect', () => {
  /** Das Verhältnis, in dem der ausgeschnittene Bereich tatsächlich gedruckt wird. */
  const gedruckt = (c: { w: number; h: number }, photoAspect: number) => (c.w / c.h) * photoAspect;

  it('lässt einen passenden Ausschnitt unangetastet', () => {
    // Zeichen für Zeichen derselbe Wert: Sonst liefe jede Rundung in die
    // Parity-Messung, obwohl sich nichts geändert hat.
    const c = panCrop(coverCrop(4 / 3, 1), 0.1, 0);
    expect(fitCropToAspect(c, 4 / 3, 1)).toBe(c);
  });

  it('dreht einen manuellen Ausschnitt in die Form des Kastens', () => {
    // Ein quadratischer Ausschnitt in einem 3:2 breiten Kasten wäre gestaucht.
    const c = { x: 0.2, y: 0.2, w: 0.6, h: 0.6, mode: 'manual' as const };
    const neu = fitCropToAspect(c, 1, 1.5);
    expect(gedruckt(neu, 1)).toBeCloseTo(1.5, 10);
  });

  it('hält die Fläche und damit die Auflösung', () => {
    const c = { x: 0.2, y: 0.2, w: 0.6, h: 0.6, mode: 'manual' as const };
    const neu = fitCropToAspect(c, 1, 1.5);
    expect(neu.w * neu.h).toBeCloseTo(c.w * c.h, 10);
  });

  it('zoomt über mehrere Änderungen hinweg nicht immer weiter hinein', () => {
    // Der Grund für die Flächenregel: Wer am Griff zieht, ändert das
    // Seitenverhältnis dutzendfach. Würde jedes Mal die kürzere Kante gelten,
    // wäre am Ende ein Ausschnitt von wenigen Prozent übrig.
    let c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8, mode: 'manual' as const };
    for (let i = 0; i < 20; i++) {
      c = { ...fitCropToAspect(c, 1, i % 2 === 0 ? 1.6 : 0.7), mode: 'manual' as const };
    }
    // 0,64 war die Fläche am Anfang. Sie schrumpft einmal auf 0,625, weil ein
    // 1,6:1-Ausschnitt dieser Fläche breiter als das Bild wäre und am Rand
    // geklemmt wird – danach bleibt sie stehen. Genau das ist der Unterschied
    // zur Regel „kürzere Kante behalten", die hier bei 0,03 gelandet wäre.
    expect(c.w * c.h).toBeGreaterThan(0.6);
  });

  it('bleibt im Bild, auch wenn der Kasten extrem breit wird', () => {
    const c = { x: 0, y: 0, w: 1, h: 1, mode: 'manual' as const };
    const neu = fitCropToAspect(c, 1, 4);
    expect(neu.w).toBeLessThanOrEqual(1);
    expect(neu.h).toBeLessThanOrEqual(1);
    expect(neu.x).toBeGreaterThanOrEqual(0);
    expect(neu.y).toBeGreaterThanOrEqual(0);
    expect(neu.x + neu.w).toBeLessThanOrEqual(1.0000001);
    expect(neu.y + neu.h).toBeLessThanOrEqual(1.0000001);
    expect(gedruckt(neu, 1)).toBeCloseTo(4, 10);
  });

  it('behält den Mittelpunkt, solange das Bild es zulässt', () => {
    const c = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, mode: 'manual' as const };
    const neu = fitCropToAspect(c, 1, 1.2);
    expect(neu.x + neu.w / 2).toBeCloseTo(0.5, 10);
    expect(neu.y + neu.h / 2).toBeCloseTo(0.5, 10);
  });

  it('behält den Modus – aus einem Handausschnitt wird keine Automatik', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' as const };
    expect(fitCropToAspect(c, 1, 2).mode).toBe('manual');
  });

  it('weist unsinnige Seitenverhältnisse ab, statt eine leere Fläche zu liefern', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' as const };
    expect(fitCropToAspect(c, 0, 2)).toBe(c);
    expect(fitCropToAspect(c, 1, Number.NaN)).toBe(c);
  });
});
