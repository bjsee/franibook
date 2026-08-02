import { describe, expect, it } from 'vitest';
import type { PrintProfile } from '../print/profile.js';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { NaiveDateTime } from '../model/photo.js';
import type { RectBox, RenderBox, TextBox } from './rendered-spread.js';
import { TIMELINE_FOOT_HEIGHT_MM, timelineBoxes, timelineFootTopMm } from './timeline.js';

const profile = saal as PrintProfile;

/** Achse: 3 mm Beschnitt + 8 mm Sicherheitsrand bis 600 mm − 8 mm. */
const AXIS_X0 = 11;
const AXIS_X1 = 595;
const AXIS_LEN = AXIS_X1 - AXIS_X0;
const GUTTER_X = 303;

function boxesOf(dates: string[], extra: Record<string, unknown> = {}): RenderBox[] {
  return timelineBoxes({ dates: dates as NaiveDateTime[], ...extra }, profile);
}

const rects = (boxes: RenderBox[]): RectBox[] =>
  boxes.filter((b): b is RectBox => b.kind === 'rect');
const texts = (boxes: RenderBox[]): TextBox[] =>
  boxes.filter((b): b is TextBox => b.kind === 'text');
/** Die Perle am Median: die einzige quadratische Box mit vollem Eckenradius. */
function perle(boxes: RenderBox[]): RectBox | undefined {
  return rects(boxes).find((r) => r.rxMm !== undefined && r.rxMm === r.hMm / 2 && r.wMm === r.hMm);
}

/** Waagerechte Mitte der Perle. */
function markerX(boxes: RenderBox[]): number {
  const p = perle(boxes);
  if (!p) throw new Error('keine Perle');
  return p.xMm + p.wMm / 2;
}

/** Der Spannbalken: Kapsel von 1,2 mm Höhe. */
const balken = (boxes: RenderBox[]): RectBox[] =>
  rects(boxes).filter((r) => r.hMm === 1.2 && r.wMm > r.hMm);

describe('Zeitstrahl: Fenster und Maßstab', () => {
  it('spannt 18 Monate über die volle Achse zwischen den Sicherheitsrändern', () => {
    const boxes = boxesOf(['2017-06-15T12:00:00']);
    const achse = rects(boxes).filter((r) => r.hMm === 0.3);
    const links = Math.min(...achse.map((r) => r.xMm));
    const rechts = Math.max(...achse.map((r) => r.xMm + r.wMm));
    expect(links).toBeCloseTo(AXIS_X0, 6);
    expect(rechts).toBeCloseTo(AXIS_X1, 6);
  });

  it('legt den 1. Juli auf die Falzachse – das Fenster beginnt am 1. Oktober', () => {
    // Folgt zwingend aus „Kalenderjahr plus drei Monate Vor- und Nachlauf“:
    // Die Achsenmitte liegt neun Monate nach dem 1. Oktober.
    const boxes = boxesOf(['2017-07-01T00:00:00']);
    expect(markerX(boxes)).toBeCloseTo(GUTTER_X, 1);
  });

  it('hält den Maßstab über verschiedene Jahre gleich', () => {
    const abstand = (jahr: number) => {
      const a = markerX(boxesOf([`${jahr}-03-01T00:00:00`]));
      const b = markerX(boxesOf([`${jahr}-04-01T00:00:00`]));
      return b - a;
    };
    // 31 Tage März, in beiden Jahren dieselbe Strecke. Die Fensterlänge
    // unterscheidet sich nur um den Schalttag, deshalb nicht auf die Stelle.
    expect(abstand(2017)).toBeCloseTo(abstand(2023), 1);
    expect(abstand(2017)).toBeGreaterThan(30);
    expect(abstand(2017)).toBeLessThan(34);
  });

  it('springt erst zum 1. Januar, nicht mit jeder Doppelseite', () => {
    const dezember = boxesOf(['2017-12-15T00:00:00']);
    const januar = boxesOf(['2018-01-15T00:00:00']);
    const jahreszahlen = (boxes: RenderBox[]) => texts(boxes).map((t) => t.content);
    expect(jahreszahlen(dezember)).toEqual(['2017', '2018']);
    expect(jahreszahlen(januar)).toEqual(['2018', '2019']);
    // Innerhalb desselben Jahres bleibt das Fenster stehen: Der Marker wandert.
    const januarFrueh = markerX(boxesOf(['2017-01-15T00:00:00']));
    const dezemberSpaet = markerX(dezember);
    expect(dezemberSpaet).toBeGreaterThan(januarFrueh + 300);
  });

  it('setzt die Jahresgrenzen bei einem Sechstel und fünf Sechsteln der Achse', () => {
    const boxes = boxesOf(['2017-06-15T00:00:00']);
    const zahlen = texts(boxes);
    expect(zahlen[0]?.xMm).toBeCloseTo(AXIS_X0 + AXIS_LEN / 6 + 1, 0);
    expect(zahlen[1]?.xMm).toBeCloseTo(AXIS_X0 + (AXIS_LEN * 5) / 6 + 1, 0);
  });
});

describe('Zeitstrahl: Marker', () => {
  it('zeigt bei einem Tag Spanne nur die Perle', () => {
    // Ein Balken von einem halben Millimeter läge vollständig unter ihr.
    const boxes = boxesOf(['2017-06-15T08:00:00', '2017-06-15T20:00:00']);
    expect(balken(boxes)).toHaveLength(0);
    expect(perle(boxes)).toBeDefined();
  });

  it('zieht den Balken über die ganze Spanne einer breiten Doppelseite', () => {
    // 11,7 Monate ist die breiteste gemessene Doppelseite des Bestands.
    const boxes = boxesOf(['2012-01-10T00:00:00', '2012-06-01T00:00:00', '2012-12-28T00:00:00']);
    const kapsel = balken(boxes)[0];
    expect(kapsel!.wMm).toBeGreaterThan(340);
    expect(kapsel!.wMm).toBeLessThan(390);
    // Runde Enden: der Radius ist die halbe Höhe.
    expect(kapsel!.rxMm).toBe(0.6);
  });

  it('setzt die Perle auf den Median, nicht auf die Mitte der Spanne', () => {
    const boxes = boxesOf(['2017-02-01T00:00:00', '2017-02-05T00:00:00', '2017-11-01T00:00:00']);
    const kapsel = balken(boxes)[0]!;
    const mitteDerSpanne = kapsel.xMm + kapsel.wMm / 2;
    expect(markerX(boxes)).toBeLessThan(mitteDerSpanne - 100);
  });

  it('lässt den Marker weg, wenn die Doppelseite kein belastbares Datum hat', () => {
    const boxes = boxesOf([], { fallbackYear: 2019 });
    expect(perle(boxes)).toBeUndefined();
    // Achse und Jahreszeitenbänder bleiben, damit die Reihe nicht reißt.
    expect(rects(boxes).length).toBeGreaterThan(10);
    expect(texts(boxes).map((t) => t.content)).toEqual(['2019', '2020']);
  });

  it('zeichnet auf Kapitelauftakten die Achse ohne Marker', () => {
    const boxes = boxesOf(['2017-08-13T00:00:00'], { markerless: true, label: 'Deichbrand' });
    expect(perle(boxes)).toBeUndefined();
    expect(texts(boxes).map((t) => t.content)).toEqual(['2017', '2018']);
  });

  it('bleibt leer, wenn sich kein Jahr bestimmen lässt', () => {
    expect(boxesOf([])).toEqual([]);
  });
});

describe('Zeitstrahl: Falzband', () => {
  it('legt achtzehn Jahreszeitenbänder lückenlos über die Achse', () => {
    // Sie ersetzen die Monatsticks: ein Band je Monatsfeld, eingefärbt nach
    // Jahreszeit. Lückenlos, weil eine Fuge im Druck das Papier zeigen würde.
    const boxes = boxesOf(['2017-06-15T00:00:00']);
    const baender = rects(boxes).filter((r) => r.hMm === 3.4);
    expect(baender).toHaveLength(18);
    expect(Math.min(...baender.map((b) => b.xMm))).toBeCloseTo(AXIS_X0, 6);
    expect(Math.max(...baender.map((b) => b.xMm + b.wMm))).toBeGreaterThanOrEqual(AXIS_X1);
    // Vier Töne, jeder mehrfach – das Fenster deckt anderthalb Jahre ab.
    expect(new Set(baender.map((b) => b.fill)).size).toBe(4);
  });

  it('färbt das Juli-Feld sommerlich und das Januar-Feld winterlich', () => {
    const boxes = boxesOf(['2017-06-15T00:00:00']);
    const baender = rects(boxes).filter((r) => r.hMm === 3.4);
    // Feld 0 ist der Oktober des Vorjahres, Feld 9 der Juli.
    expect(baender[9]!.fill).toBe('#f7e9c9');
    expect(baender[3]!.fill).toBe('#dde3ec');
  });

  it('lässt Achse und Balken durch den Falz laufen', () => {
    const boxes = boxesOf(['2017-06-01T00:00:00', '2017-08-01T00:00:00']);
    const kapsel = balken(boxes)[0]!;
    expect(kapsel.xMm).toBeLessThan(GUTTER_X);
    expect(kapsel.xMm + kapsel.wMm).toBeGreaterThan(GUTTER_X);
  });

  it('führt das Label am Falz vorbei, statt es zu zerschneiden', () => {
    const boxes = boxesOf(['2017-07-02T00:00:00'], { label: 'Deichbrand 2017' });
    const label = texts(boxes).find((t) => t.slotId === 'timeline-label');
    expect(label).toBeDefined();
    const rechts = label!.xMm + label!.wMm;
    const stoert =
      label!.xMm < GUTTER_X + profile.page.gutterSafeMm &&
      rechts > GUTTER_X - profile.page.gutterSafeMm;
    expect(stoert).toBe(false);
  });

  it('zentriert das Label sonst unter dem Marker', () => {
    const boxes = boxesOf(['2017-03-15T00:00:00'], { label: 'Ostern' });
    const label = texts(boxes).find((t) => t.slotId === 'timeline-label')!;
    expect(label.align).toBe('center');
    // Um den halben Sperrungsausgleich versetzt: Beide Renderer setzen die
    // Sperrung auch hinter das letzte Zeichen.
    expect(label.xMm + label.wMm / 2 - label.letterSpacingMm! / 2).toBeCloseTo(markerX(boxes), 6);
  });

  it('lässt eine Jahreszahl weg, wenn der Marker sie überdeckt', () => {
    const boxes = boxesOf(['2017-01-03T00:00:00']);
    expect(texts(boxes).map((t) => t.content)).toEqual(['2018']);
  });
});

describe('Zeitstrahl: Platz im Fußraum', () => {
  it('bleibt zwischen Templateende und Sicherheitsrand', () => {
    const boxes = boxesOf(['2017-06-15T00:00:00'], { label: 'Irgendwo' });
    const top = timelineFootTopMm(profile);
    const unten = profile.page.bleedMm + profile.page.trimHeightMm - profile.page.safetyMm;
    expect(top).toBe(281); // 3 + 300 − 8 − 14
    expect(TIMELINE_FOOT_HEIGHT_MM).toBe(14);

    for (const box of boxes) {
      const kanten =
        box.kind === 'polygon' ? box.pointsMm.map((p) => p.yMm) : [box.yMm, box.yMm + box.hMm];
      for (const y of kanten) {
        expect(y).toBeGreaterThanOrEqual(top);
        expect(y).toBeLessThanOrEqual(unten);
      }
    }
  });

  it('setzt die Randmonate schwächer als das Kapiteljahr', () => {
    const boxes = boxesOf(['2017-06-15T00:00:00']);
    const achse = rects(boxes).filter((r) => r.hMm === 0.3);
    expect(achse).toHaveLength(3);
    expect(achse[0]!.fill).not.toBe(achse[1]!.fill);
    expect(achse[0]!.fill).toBe(achse[2]!.fill);
  });
});
