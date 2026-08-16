import { describe, expect, it } from 'vitest';
import { textAlsSvg, verbinde, zielAusText } from './ziel.js';

/** Anteil der Zellen, in denen überhaupt eine Kachel läge. */
function belegung(cells: readonly { alpha: number }[]): number {
  return cells.filter((c) => c.alpha >= 0.15).length / cells.length;
}

describe('Text als Konturen', () => {
  it('macht aus jeder Ziffer einen Pfad', () => {
    const svg = textAlsSvg('18');
    expect(svg.match(/<path/g)).toHaveLength(2);
  });

  it('nennt Breite und Höhe', () => {
    // Ohne sie nimmt librsvg eine eigene Vorgabegröße an und bildet die viewBox
    // darauf ab — gemessen kam von einer „18" nur der untere Rand im Bild an.
    const svg = textAlsSvg('18');
    expect(svg).toMatch(/<svg[^>]*\swidth="\d+"/);
    expect(svg).toMatch(/<svg[^>]*\sheight="\d+"/);
  });

  it('behält das Seitenverhältnis der Tintenfläche', () => {
    const svg = textAlsSvg('18');
    const w = Number(/\swidth="(\d+)"/.exec(svg)?.[1]);
    const h = Number(/\sheight="(\d+)"/.exec(svg)?.[1]);
    const box = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
    expect(box).not.toBeNull();
    expect(w / h).toBeCloseTo(Number(box![3]) / Number(box![4]), 2);
  });

  it('meldet einen Text ohne darstellbares Zeichen', () => {
    expect(() => textAlsSvg('')).toThrow();
  });
});

describe('Zielraster aus Text', () => {
  it('füllt einen erheblichen Teil der Fläche, aber nicht alles', async () => {
    // Rechnerisch: Die Tintenfläche der „18" belegt rund drei Viertel der
    // quadratischen Fläche, und die Ziffern selbst gut die Hälfte davon — am
    // Bestand gemessen 577 von 1600 Zellen. Die Grenzen fangen genau den
    // Fehler, der schon zweimal auftrat: eine Form, von der zu wenig ankam.
    const ziel = await zielAusText('18', { cols: 40, rows: 40, areaAspect: 1 });
    expect(ziel.cells).toHaveLength(1600);
    expect(belegung(ziel.cells)).toBeGreaterThan(0.25);
    expect(belegung(ziel.cells)).toBeLessThan(0.5);
  });

  it('kehrt die Belegung um, wenn es soll', async () => {
    const gerade = await zielAusText('18', { cols: 30, rows: 30, areaAspect: 1 });
    const gekehrt = await zielAusText('18', {
      cols: 30,
      rows: 30,
      areaAspect: 1,
      invertiert: true,
    });
    expect(belegung(gekehrt.cells)).toBeGreaterThan(belegung(gerade.cells));
  });

  it('verzerrt die Form nicht, wenn Fläche und Raster verschiedene Formen haben', async () => {
    // Der Fehler, den `zwischenmasse` verhindert: Ein quadratisches Raster auf
    // einer doppelt so breiten Fläche hat flache Zellen — die Ziffer muss dann
    // im Raster **schmaler** stehen, nicht gleich breit.
    const quadrat = await zielAusText('1', { cols: 40, rows: 40, areaAspect: 1 });
    const breit = await zielAusText('1', { cols: 40, rows: 40, areaAspect: 2 });
    expect(belegung(breit.cells)).toBeLessThan(belegung(quadrat.cells) * 0.75);
  });

  it('lässt die Farbe offen — die Form sagt nur, wo eine Kachel liegt', async () => {
    const ziel = await zielAusText('8', { cols: 20, rows: 20, areaAspect: 1 });
    expect(ziel.cells.every((c) => c.color === undefined)).toBe(true);
  });
});

describe('Form und Farben verbinden', () => {
  it('nimmt die Deckung von der Form und die Farbe von der Vorlage', () => {
    const form = { cols: 2, rows: 1, cells: [{ alpha: 1 }, { alpha: 0 }] };
    const farben = {
      cols: 2,
      rows: 1,
      cells: [
        { alpha: 1, color: [10, 20, 30] as const },
        { alpha: 1, color: [40, 50, 60] as const },
      ],
    };
    const verbunden = verbinde(form, farben);
    expect(verbunden.cells[0]).toEqual({ alpha: 1, color: [10, 20, 30] });
    expect(verbunden.cells[1]).toEqual({ alpha: 0, color: [40, 50, 60] });
  });

  it('lässt die Farbe weg, wenn die Raster nicht zusammenpassen', () => {
    // Die Form entscheidet, wo etwas steht — ihr Raster gewinnt, und eine
    // Farbe aus einem anders geformten Gitter zeigte auf die falsche Zelle.
    const form = { cols: 2, rows: 1, cells: [{ alpha: 1 }, { alpha: 1 }] };
    const farben = { cols: 3, rows: 1, cells: [{ alpha: 1, color: [1, 2, 3] as const }] };
    const verbunden = verbinde(form, farben);
    expect(verbunden.cols).toBe(2);
    expect(verbunden.cells.every((c) => c.color === undefined)).toBe(true);
  });
});
