import { describe, expect, it } from 'vitest';
import {
  type ColorMatrix,
  IDENTITAET,
  farbmatrix,
  gleicheAnpassung,
  normalisiereAdjust,
  wirktAdjust,
} from './adjust.js';

/** Wendet eine Farbmatrix auf ein Pixel in 0..1 an – ohne Klemmen. */
function anwenden(m: ColorMatrix, px: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map(
    (zeile) =>
      m.m[zeile * 3]! * px[0] +
      m.m[zeile * 3 + 1]! * px[1] +
      m.m[zeile * 3 + 2]! * px[2] +
      m.o[zeile]!,
  ) as [number, number, number];
}

const GRAU = [0.5, 0.5, 0.5] as const;
const BUNT = [0.2, 0.7, 0.35] as const;

describe('farbmatrix', () => {
  it('gibt ohne Anpassung die Identität zurück', () => {
    expect(farbmatrix()).toBe(IDENTITAET);
    expect(farbmatrix({})).toBe(IDENTITAET);
    expect(farbmatrix({ brightness: 0, contrast: 0 })).toBe(IDENTITAET);
  });

  it('lässt ein Pixel unverändert, wenn nichts eingestellt ist', () => {
    expect(anwenden(farbmatrix(), BUNT)).toEqual([...BUNT]);
  });

  it('multipliziert die Helligkeit', () => {
    const hell = anwenden(farbmatrix({ brightness: 50 }), BUNT);
    expect(hell).toEqual(BUNT.map((v) => v * 1.5));
  });

  it('dreht den Kontrast um Mittelgrau', () => {
    const m = farbmatrix({ contrast: 60 });
    // Mittelgrau ist der Drehpunkt und bleibt liegen.
    anwenden(m, GRAU).forEach((v) => expect(v).toBeCloseTo(0.5, 10));
    // Alles darüber steigt, alles darunter fällt.
    expect(anwenden(m, [0.8, 0.8, 0.8])[0]).toBeGreaterThan(0.8);
    expect(anwenden(m, [0.2, 0.2, 0.2])[0]).toBeLessThan(0.2);
  });

  it('nimmt bei voller Entsättigung alle Farbe heraus', () => {
    const [r, g, b] = anwenden(farbmatrix({ saturation: -100 }), BUNT);
    expect(g).toBeCloseTo(r, 10);
    expect(b).toBeCloseTo(r, 10);
  });

  it('erhält bei Entsättigung die Luminanz', () => {
    const [r] = anwenden(farbmatrix({ saturation: -100 }), BUNT);
    expect(r).toBeCloseTo(0.2126 * 0.2 + 0.7152 * 0.7 + 0.0722 * 0.35, 10);
  });

  it('hebt bei Wärme das Rot und senkt das Blau, ohne Grün anzufassen', () => {
    const [r, g, b] = anwenden(farbmatrix({ warmth: 100 }), GRAU);
    expect(r).toBeCloseTo(0.5 * 1.25, 10);
    expect(g).toBeCloseTo(0.5, 10);
    expect(b).toBeCloseTo(0.5 * 0.75, 10);
    // Und kühl ist genau die Gegenrichtung.
    const kuehl = anwenden(farbmatrix({ warmth: -100 }), GRAU);
    expect(kuehl[0]).toBeCloseTo(0.5 * 0.75, 10);
    expect(kuehl[2]).toBeCloseTo(0.5 * 1.25, 10);
  });

  describe('Tonung', () => {
    it('macht schwarzweiß aus jeder Farbe einen neutralen Grauwert', () => {
      const [r, g, b] = anwenden(farbmatrix({ tone: 'sw' }), BUNT);
      expect(g).toBeCloseTo(r, 10);
      expect(b).toBeCloseTo(r, 10);
    });

    it('trägt den Farbstich der bekannten Sepia-Matrix', () => {
      // Die Werte, die jeder Browser für `sepia(1)` einsetzt. Ihre drei Zeilen
      // sind zueinander proportional – die Matrix ist eine Luminanz mal einem
      // Farbstich, und geprüft wird hier dieser Stich. Die Zahlen selbst
      // stimmen nicht überein, weil die CSS-Fassung mit BT.601 grau rechnet
      // und unsere mit BT.709; die Begründung steht in `adjust.ts`.
      const CSS_SEPIA_ZEILENSUMMEN = [1.351, 1.203, 0.937];
      const { m } = farbmatrix({ tone: 'sepia' });
      for (let zeile = 0; zeile < 3; zeile++) {
        const summe = m[zeile * 3]! + m[zeile * 3 + 1]! + m[zeile * 3 + 2]!;
        expect(summe).toBeCloseTo(CSS_SEPIA_ZEILENSUMMEN[zeile]!, 3);
      }
    });

    it('ist bei Sepia eine reine Luminanzrampe – gleicher Grauwert, gleiche Farbe', () => {
      // Anders gesagt: Zwei Farben mit derselben Helligkeit werden zu genau
      // demselben Sepiaton. Das ist es, was eine Tonung ausmacht.
      const m = farbmatrix({ tone: 'sepia' });
      const a = anwenden(m, [0.6, 0.2, 0.1]);
      const gleicheLuminanz = 0.2126 * 0.6 + 0.7152 * 0.2 + 0.0722 * 0.1;
      const b = anwenden(m, [gleicheLuminanz, gleicheLuminanz, gleicheLuminanz]);
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 10));
    });

    it('legt die Cyanotypie ins Blaue', () => {
      const [r, g, b] = anwenden(farbmatrix({ tone: 'cyanotypie' }), GRAU);
      expect(b).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(r);
    });

    it('setzt bei der Cyanotypie den Farbstich in die Schatten, nicht in die Lichter', () => {
      // Der Grund für den Fuß der Rampe, an der Oberfläche gesehen: Ohne ihn
      // klemmt Blau in den Lichtern am Anschlag und jede helle Fläche kippt ins
      // Knallcyan. Ein Blaudruck macht es andersherum — Schatten tiefblau,
      // Lichter Papier.
      const m = farbmatrix({ tone: 'cyanotypie' });
      const [, , schwarzB] = anwenden(m, [0, 0, 0]);
      const weiss = anwenden(m, [1, 1, 1]);
      // Tiefstes Schwarz ist deutlich blau …
      expect(schwarzB).toBeGreaterThan(0.25);
      // … und Weiß bleibt nahezu Weiß, statt am Blauanschlag zu cyanen.
      weiss.forEach((v) => expect(v).toBeGreaterThan(0.8));
      expect(Math.max(...weiss) - Math.min(...weiss)).toBeLessThan(0.2);
    });

    it('lässt die Sättigung wirkungslos, weil sie vor der Tonung liegt', () => {
      const ohne = farbmatrix({ tone: 'sw' });
      const mit = farbmatrix({ tone: 'sw', saturation: 100 });
      // Kein exakter Vergleich: Die Sättigungsmatrix läuft mit, ihr Ergebnis
      // ist nach der Luminanzbildung aber wieder dasselbe.
      anwenden(mit, BUNT).forEach((v, i) => expect(v).toBeCloseTo(anwenden(ohne, BUNT)[i]!, 10));
    });
  });

  describe('Reihenfolge der Verkettung', () => {
    it('lässt den Kontrast bei Sepia auf die Tonwerte wirken, nicht auf den Farbstich', () => {
      // Der Grund für „Tonung zuletzt": Mittelgrau ist der Drehpunkt des
      // Kontrasts und bleibt es auch getont – die Sepia-Rampe wird nicht
      // auseinandergezogen. Andersherum stiege Rot hier auf 0,82, während Blau
      // auf 0,34 fiele, und der Regler machte das Bild bunter statt
      // kontrastreicher.
      const m = farbmatrix({ tone: 'sepia', contrast: 80 });
      const nur = farbmatrix({ tone: 'sepia' });
      anwenden(m, GRAU).forEach((v, i) => expect(v).toBeCloseTo(anwenden(nur, GRAU)[i]!, 10));
    });

    it('lässt Helligkeit und Tonung in beiden Reihenfolgen dasselbe ergeben', () => {
      // Die Helligkeit ist rein multiplikativ und vertauscht deshalb mit der
      // Tonung. Festgehalten, weil daraus folgt, dass an dieser Stelle der
      // Kette nichts zu entscheiden war.
      const m = farbmatrix({ tone: 'sepia', brightness: 40 });
      const einzeln = anwenden(farbmatrix({ tone: 'sepia' }), BUNT).map((v) => v * 1.4);
      anwenden(m, BUNT).forEach((v, i) => expect(v).toBeCloseTo(einzeln[i]!, 10));
    });

    it('verkettet Helligkeit und Kontrast in dieser Reihenfolge', () => {
      const m = farbmatrix({ brightness: 100, contrast: 100 });
      // erst ×2, dann ×2 um 0,5 gedreht: 0,3 → 0,6 → 0,7
      expect(anwenden(m, [0.3, 0.3, 0.3])[0]).toBeCloseTo(0.7, 10);
    });
  });

  describe('Wertebereich', () => {
    it('klemmt Regler jenseits von ±100', () => {
      expect(farbmatrix({ brightness: 500 })).toEqual(farbmatrix({ brightness: 100 }));
      expect(farbmatrix({ contrast: -500 })).toEqual(farbmatrix({ contrast: -100 }));
    });

    it('behandelt Unfug als nicht gesetzt', () => {
      expect(farbmatrix({ brightness: Number.NaN, tone: 'sw' })).toEqual(
        farbmatrix({ tone: 'sw' }),
      );
    });

    it('übergeht eine unbekannte Tonung, statt beim Rendern zu scheitern', () => {
      // Der Typ sagt `ToneId`, aber der Wert kommt aus einem gespeicherten
      // Projekt. Wer eine Datei öffnet, die eine spätere Fassung mit einer
      // neuen Tonung geschrieben hat, soll ein Bild ohne Tonung sehen und
      // keinen Absturz — vorher warf das hier einen TypeError, und der nahm die
      // ganze Doppelseite samt PDF-Export mit.
      expect(() => farbmatrix({ tone: 'daguerreotypie' } as never)).not.toThrow();
      expect(farbmatrix({ tone: 'daguerreotypie' } as never)).toBe(IDENTITAET);
      // Die übrigen Regler wirken trotzdem.
      expect(farbmatrix({ tone: 'daguerreotypie', contrast: 40 } as never)).toEqual(
        farbmatrix({ contrast: 40 }),
      );
    });

    it('macht bei voller Rücknahme der Helligkeit alles schwarz', () => {
      expect(anwenden(farbmatrix({ brightness: -100 }), BUNT)).toEqual([0, 0, 0]);
    });
  });
});

describe('wirktAdjust', () => {
  it('erkennt eine leere Anpassung', () => {
    expect(wirktAdjust()).toBe(false);
    expect(wirktAdjust({})).toBe(false);
    expect(wirktAdjust({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 })).toBe(false);
  });

  it('erkennt jede gesetzte Angabe', () => {
    expect(wirktAdjust({ brightness: 1 })).toBe(true);
    expect(wirktAdjust({ tone: 'sw' })).toBe(true);
    expect(wirktAdjust({ warmth: -5 })).toBe(true);
  });
});

describe('normalisiereAdjust', () => {
  it('gibt für eine wirkungslose Anpassung nichts zurück', () => {
    // Genau eine Schreibweise für „nichts eingestellt": kein Eintrag.
    expect(normalisiereAdjust(undefined)).toBeUndefined();
    expect(normalisiereAdjust(null)).toBeUndefined();
    expect(normalisiereAdjust({})).toBeUndefined();
    expect(normalisiereAdjust({ brightness: 0, contrast: 0 })).toBeUndefined();
  });

  it('lässt Nullwerte weg, statt sie zu speichern', () => {
    expect(normalisiereAdjust({ brightness: 20, contrast: 0 })).toEqual({ brightness: 20 });
  });

  it('rundet und klemmt die Regler', () => {
    expect(normalisiereAdjust({ brightness: 17.6, warmth: 500 })).toEqual({
      brightness: 18,
      warmth: 100,
    });
  });

  it('übernimmt nur bekannte Tonungen', () => {
    expect(normalisiereAdjust({ tone: 'sepia' })).toEqual({ tone: 'sepia' });
    expect(normalisiereAdjust({ tone: 'daguerreotypie' })).toBeUndefined();
  });

  it('hält Unfug vom Netz aus dem Projekt heraus', () => {
    // Der Wert kommt aus dem Anfragekörper; die Prüfung steht deshalb hier und
    // nicht ein zweites Mal im Server.
    expect(normalisiereAdjust('sepia')).toBeUndefined();
    expect(normalisiereAdjust(42)).toBeUndefined();
    expect(normalisiereAdjust({ brightness: 'viel', tone: 'sw' })).toEqual({ tone: 'sw' });
  });
});

describe('gleicheAnpassung', () => {
  it('erkennt zwei leere Anpassungen als gleich', () => {
    expect(gleicheAnpassung(undefined, undefined)).toBe(true);
    expect(gleicheAnpassung({ brightness: 10 }, undefined)).toBe(false);
  });

  it('vergleicht jeden Regler und die Tonung', () => {
    expect(gleicheAnpassung({ brightness: 10, tone: 'sw' }, { brightness: 10, tone: 'sw' })).toBe(
      true,
    );
    expect(gleicheAnpassung({ brightness: 10 }, { brightness: 11 })).toBe(false);
    expect(gleicheAnpassung({ tone: 'sw' }, { tone: 'sepia' })).toBe(false);
  });
});
