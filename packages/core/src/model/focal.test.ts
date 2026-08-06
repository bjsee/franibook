/**
 * Tests des Fokuspunkts.
 *
 * Die Fälle sind aus dem Spike abgeleitet (`docs/spikes/gesichter.md`): Der
 * Flächenschwerpunkt scheitert an verteilten Gruppen, und genau das prüft der
 * mittlere Block — er ist der Grund, warum hier eine Suche steht und nicht drei
 * Zeilen Mittelwert.
 */
import { describe, expect, it } from 'vitest';
import { coverCrop } from './crop.js';
import { focalForCrop, visibleShare } from './focal.js';
import { type FocusRect, rotateFocusRect } from './photo.js';

/** Ein Querformat 3:2, wie die meisten Fotos im Bestand. */
const QUER = { width: 3000, height: 2000 };
/** Hochformat 2:3. */
const HOCH = { width: 2000, height: 3000 };

/** Gesicht als Quadrat um einen Punkt, in Anteilen der Bildkante. */
function gesicht(x: number, y: number, kante = 0.1): FocusRect {
  return { x: x - kante / 2, y: y - kante / 2, w: kante, h: kante };
}

/** Wie viele der Bereiche im Ausschnitt ganz zu sehen sind. */
function ganzDrin(photo: Parameters<typeof focalForCrop>[0], slotAr: number): number {
  const fokus = focalForCrop(photo, slotAr);
  const crop = coverCrop(photo.width / photo.height, slotAr, fokus);
  return (photo.faces ?? []).filter((f) => visibleShare(f, crop) >= 0.9).length;
}

describe('focalForCrop', () => {
  it('lässt die Mitte, wenn nichts erkannt wurde', () => {
    // Der Fall für jedes Foto aus einem Projekt von vor der Erkennung: Es soll
    // sich nichts ändern, nicht einmal um eine Rundung.
    expect(focalForCrop(QUER, 1)).toBeUndefined();
    expect(focalForCrop({ ...QUER, faces: [] }, 1)).toBeUndefined();
  });

  it('lässt die Mitte, wenn Bild und Platz dieselbe Form haben', () => {
    // Dann ist der Ausschnitt das ganze Bild, und ein Fokuspunkt hätte keine
    // Wirkung — die Funktion soll das erkennen und nicht rechnen.
    expect(focalForCrop({ ...QUER, faces: [gesicht(0.2, 0.2)] }, 1.5)).toBeUndefined();
  });

  it('rückt gerade so weit, dass das Gesicht ganz sichtbar ist', () => {
    // **Nicht** auf die Gesichtsmitte: Bei einem Gesicht bei y = 0,15 und einem
    // Ausschnitt von 0,667 Höhe reicht y = 0,433, und das liegt näher an der
    // Bildmitte als y = 0,333. Beide zeigen das Gesicht ganz, also entscheidet
    // die dritte Bewertungsstufe — und die hält die Bildwirkung ruhig. Der
    // Ausschnitt wandert so wenig wie nötig.
    const oben = { ...HOCH, faces: [gesicht(0.5, 0.15)] };
    const fokus = focalForCrop(oben, 1)!;
    // Quadratischer Platz in einem Hochformat: senkrecht beschnitten, also
    // verschiebt sich y und x bleibt in der Mitte.
    expect(fokus.x).toBe(0.5);
    expect(fokus.y).toBeLessThan(0.5);
    expect(ganzDrin(oben, 1)).toBe(1);
  });

  it('holt einen Kopf in den Ausschnitt, den die Bildmitte anschneidet', () => {
    // Der Fall, um den es geht: Gesicht am oberen Bildrand, quadratischer Platz.
    const photo = { ...HOCH, faces: [gesicht(0.5, 0.1)] };
    const mitte = coverCrop(photo.width / photo.height, 1);
    expect(visibleShare(photo.faces[0]!, mitte)).toBeLessThan(0.9);
    expect(ganzDrin(photo, 1)).toBe(1);
  });

  it('opfert kein Gesicht, wenn alle hineinpassen', () => {
    // Drei Gesichter auf einer waagerechten Linie, Platz 1:1 aus einem
    // Querformat — es passen alle, wenn der Ausschnitt richtig liegt.
    const photo = { ...QUER, faces: [gesicht(0.35, 0.4), gesicht(0.5, 0.4), gesicht(0.62, 0.4)] };
    expect(ganzDrin(photo, 1)).toBe(3);
  });

  it('behält die Mehrheit, wenn nicht alle Gesichter hineinpassen', () => {
    // Zwei Gesichter links, eines weit rechts. Der Flächenschwerpunkt läge
    // zwischen den Gruppen und verlöre womöglich alle drei; die Suche hält die
    // zwei. Das ist die Abwägung aus dem Spike: ein Gesicht für zwei andere.
    const photo = { ...QUER, faces: [gesicht(0.1, 0.5), gesicht(0.2, 0.5), gesicht(0.95, 0.5)] };
    expect(ganzDrin(photo, 0.5)).toBeGreaterThanOrEqual(2);
  });

  it('schlägt den Flächenschwerpunkt bei verteilten Gruppen', () => {
    // Der Vergleich, der die Entwurfsentscheidung trägt. Am Bestand verlor der
    // Schwerpunkt bei hochkanten Plätzen 9 Köpfe und rettete 7.
    const photo = { ...QUER, faces: [gesicht(0.08, 0.5), gesicht(0.5, 0.5), gesicht(0.92, 0.5)] };
    const slotAr = 0.75;
    const ar = photo.width / photo.height;

    const schwerpunkt = { x: 0.5, y: 0.5 };
    const ganzMitSchwerpunkt = photo.faces.filter(
      (f) => visibleShare(f, coverCrop(ar, slotAr, schwerpunkt)) >= 0.9,
    ).length;

    expect(ganzDrin(photo, slotAr)).toBeGreaterThanOrEqual(ganzMitSchwerpunkt);
  });

  it('nimmt die Salienz nur, wenn kein Gesicht erkannt wurde', () => {
    const nurSalienz = { ...HOCH, salience: { x: 0.1, y: 0.05, w: 0.3, h: 0.2 } };
    expect(focalForCrop(nurSalienz, 1)?.y).toBeLessThan(0.5);

    // Mit Gesicht gewinnt das Gesicht: Die Salienzkarte umfasst bei einem
    // Porträt fast die ganze Person und zöge den Fokus vom Kopf zur Körpermitte.
    // Geprüft wird deshalb, dass der Kopf ganz zu sehen ist und der Punkt über
    // der Bildmitte liegt — nicht ein Zahlenwert, der von der Ausschnittshöhe
    // abhängt.
    const beides = {
      ...HOCH,
      faces: [gesicht(0.5, 0.12)],
      salience: { x: 0.2, y: 0.5, w: 0.6, h: 0.5 },
    };
    expect(focalForCrop(beides, 1)!.y).toBeLessThan(0.5);
    expect(ganzDrin(beides, 1)).toBe(1);
  });

  it('übergeht unbrauchbare Rechtecke', () => {
    // Ein von Hand bearbeiteter Projektstand darf den Kern nicht mit NaN
    // rechnen lassen.
    const kaputt = {
      ...QUER,
      faces: [
        { x: Number.NaN, y: 0.5, w: 0.1, h: 0.1 },
        { x: 0.5, y: 0.5, w: 0, h: 0.1 },
        { x: 1.5, y: 0.5, w: 0.1, h: 0.1 },
      ],
    };
    expect(focalForCrop(kaputt, 1)).toBeUndefined();
  });

  it('ist deterministisch', () => {
    // Gleiche Eingabe, gleicher Punkt — sonst wäre jede Anordnung ein anderes
    // Buch (`.claude/rules/kern-rein.md`).
    const photo = { ...QUER, faces: [gesicht(0.3, 0.3), gesicht(0.7, 0.6)] };
    const einmal = focalForCrop(photo, 0.8);
    const nochmal = focalForCrop({ ...photo, faces: [...photo.faces] }, 0.8);
    expect(einmal).toEqual(nochmal);
  });

  it('hält den Fokuspunkt so, dass der Ausschnitt im Bild bleibt', () => {
    // Ein Gesicht am äußersten Rand darf den Ausschnitt nicht hinausschieben —
    // `coverCrop` klemmt zwar selbst, aber dann läge der zurückgegebene Punkt
    // neben dem, was gilt, und ein Aufrufer könnte sich darauf verlassen.
    const photo = { ...QUER, faces: [gesicht(0.99, 0.5, 0.04)] };
    const fokus = focalForCrop(photo, 0.5)!;
    const crop = coverCrop(photo.width / photo.height, 0.5, fokus);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(fokus.x - (crop.x + crop.w / 2))).toBeLessThan(1e-9);
  });
});

describe('rotateFocusRect', () => {
  it('dreht ein Rechteck viermal auf sich selbst zurück', () => {
    const r: FocusRect = { x: 0.1, y: 0.2, w: 0.3, h: 0.15 };
    let gedreht = r;
    for (let i = 0; i < 4; i++) gedreht = rotateFocusRect(gedreht, 1);
    expect(gedreht.x).toBeCloseTo(r.x, 12);
    expect(gedreht.y).toBeCloseTo(r.y, 12);
    expect(gedreht.w).toBeCloseTo(r.w, 12);
    expect(gedreht.h).toBeCloseTo(r.h, 12);
  });

  it('bringt die linke obere Ecke bei einer Vierteldrehung nach rechts oben', () => {
    // Im Uhrzeigersinn: Was oben links war, liegt danach oben rechts.
    const eck: FocusRect = { x: 0, y: 0, w: 0.2, h: 0.1 };
    const gedreht = rotateFocusRect(eck, 1);
    expect(gedreht.x).toBeCloseTo(0.9, 12);
    expect(gedreht.y).toBeCloseTo(0, 12);
    // Breite und Höhe tauschen, wie bei `width`/`height` in `effectivePhoto`.
    expect(gedreht.w).toBeCloseTo(0.1, 12);
    expect(gedreht.h).toBeCloseTo(0.2, 12);
  });

  it('spiegelt bei 180° in beiden Achsen', () => {
    // `toBeCloseTo` und nicht `toEqual`: 1 - (0,2 + 0,4) ergibt in Gleitkomma
    // 0,3999999999999999, und darauf käme es nirgends an.
    const gedreht = rotateFocusRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 2);
    expect(gedreht.x).toBeCloseTo(0.6, 12);
    expect(gedreht.y).toBeCloseTo(0.4, 12);
    expect(gedreht.w).toBeCloseTo(0.3, 12);
    expect(gedreht.h).toBeCloseTo(0.4, 12);
  });

  it('lässt bei 0 alles stehen', () => {
    const r: FocusRect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(rotateFocusRect(r, 0)).toBe(r);
  });
});
