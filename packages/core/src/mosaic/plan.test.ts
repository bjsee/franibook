import { describe, expect, it } from 'vitest';
import type { Rgb } from '../model/farbe.js';
import { TONE_GRID, type Photo, type PhotoId } from '../model/photo.js';
import {
  type MosaicCell,
  type MosaicTarget,
  cellAt,
  mosaicWarningText,
  vollesRaster,
} from './mosaic.js';
import { mosaicFingerprint, planMosaic } from './plan.js';

const ROT: Rgb = [220, 30, 30];
const BLAU: Rgb = [30, 30, 220];
const GRUEN: Rgb = [30, 200, 30];

/** Ein Foto, dessen neun Felder alle dieselbe Farbe tragen. */
function foto(id: string, farbe: Rgb, zusatz: Partial<Photo> = {}): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 1000,
    width: 4000,
    height: 3000,
    orientation: 1,
    tone: {
      mean: farbe,
      grid: Array.from({ length: TONE_GRID * TONE_GRID }, () => farbe),
    },
    ...zusatz,
  };
}

function bestand(...fotos: Photo[]): ReadonlyMap<PhotoId, Photo> {
  return new Map(fotos.map((f) => [f.id, f]));
}

/** Ein Raster aus vorgegebenen Wunschfarben, eine Zeile. */
function zeile(...farben: (Rgb | undefined)[]): MosaicTarget {
  const cells: MosaicCell[] = farben.map((color) => ({ alpha: 1, ...(color ? { color } : {}) }));
  return { cols: farben.length, rows: 1, cells };
}

const FLAECHE = { areaAspect: 1 };

describe('Kachelwahl nach Farbe', () => {
  it('legt in jede Zelle das farblich nächste Foto', () => {
    const plan = planMosaic(zeile(ROT, BLAU), {
      photos: bestand(foto('r', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    expect(plan.tiles.map((t) => t.photoId)).toEqual(['r', 'b']);
  });

  it('nimmt das nächstbeste, wenn die Wunschfarbe im Bestand fehlt', () => {
    // Ein leicht violettes Ziel: Rot liegt näher als Grün.
    const plan = planMosaic(zeile([200, 40, 90]), {
      photos: bestand(foto('r', ROT), foto('g', GRUEN)),
      ...FLAECHE,
    });
    expect(plan.tiles[0]?.photoId).toBe('r');
  });

  it('wählt bei "feld" die passende Stelle im Bild statt des Mittelwerts', () => {
    // Ein Bild, halb Himmel halb Wald: Der Mittelwert träfe keine der beiden
    // Wunschfarben, die Felder treffen beide.
    const oben = [BLAU, BLAU, BLAU];
    const mitte = [BLAU, BLAU, BLAU];
    const unten = [GRUEN, GRUEN, GRUEN];
    const zweifarbig: Photo = {
      ...foto('z', [90, 110, 120]),
      tone: { mean: [90, 110, 120], grid: [...oben, ...mitte, ...unten] },
    };

    const himmel = planMosaic(zeile(BLAU), {
      photos: bestand(zweifarbig),
      ...FLAECHE,
      crop: 'feld',
    });
    const wald = planMosaic(zeile(GRUEN), {
      photos: bestand(zweifarbig),
      ...FLAECHE,
      crop: 'feld',
    });

    // Derselbe Bestand, dasselbe Foto — aber ein anderer Ausschnitt.
    expect(himmel.tiles[0]?.crop.y).toBeLessThan(wald.tiles[0]!.crop.y);
    expect(himmel.tiles[0]?.crop.mode).toBe('manual');
  });

  it('lässt bei "ganz" das Bild ganz und schneidet nur auf Kachelform', () => {
    const plan = planMosaic(zeile(ROT), {
      photos: bestand(foto('r', ROT)),
      ...FLAECHE,
      crop: 'ganz',
    });
    const crop = plan.tiles[0]!.crop;
    // Quadratische Kachel aus einem 4:3-Bild: volle Höhe, seitlich beschnitten.
    expect(crop.h).toBe(1);
    expect(crop.w).toBeCloseTo(0.75, 6);
    expect(crop.mode).toBe('auto-cover');
  });
});

describe('Wiederholungen', () => {
  it('weicht innerhalb einer Farbfläche auf weitere Fotos aus', () => {
    // Drei fast gleich rote Fotos auf zwölf roten Zellen. Der Farbabstand
    // zwischen ihnen liegt unter einer Lab-Einheit — ohne den Zuschlag gewinnt
    // deshalb zwölfmal dasselbe Bild, und genau das ist der Fehler, den der
    // Zuschlag verhindert.
    const target = { cols: 4, rows: 3, cells: Array(12).fill({ alpha: 1, color: ROT }) };
    const photos = bestand(
      foto('a', [220, 30, 30]),
      foto('b', [222, 32, 30]),
      foto('c', [218, 28, 32]),
    );

    const ohne = planMosaic(target, { photos, ...FLAECHE, reuseCost: 0, spreadRadius: 0 });
    const mit = planMosaic(target, { photos, ...FLAECHE });

    expect(ohne.usage).toHaveLength(1);
    expect(mit.usage).toHaveLength(3);
    // Gleichverteilt ist es dabei nicht, und soll es auch nicht sein: Der
    // Mindestabstand darf ein Bild zweimal mehr einsetzen, wenn es dadurch
    // weiter von seinesgleichen wegkommt.
    expect(Math.min(...mit.usage.map((u) => u.count))).toBeGreaterThanOrEqual(2);
  });

  it('hebt den Mindestabstand auf, wenn sonst eine Lücke bliebe', () => {
    // Ein einziges Foto auf neun Zellen: Die Sperre kann nicht eingehalten
    // werden, und eine leere Fläche wäre die schlechtere Antwort als eine
    // sichtbare Wiederholung.
    const plan = planMosaic(vollesRaster(3, 3), {
      photos: bestand(foto('a', ROT)),
      ...FLAECHE,
      spreadRadius: 10,
    });
    expect(plan.tiles).toHaveLength(9);
  });

  it('setzt dasselbe Foto nicht auf benachbarte Kacheln', () => {
    const target = { cols: 6, rows: 6, cells: Array(36).fill({ alpha: 1, color: ROT }) };
    // Zwölf Fotos auf 36 Zellen, also drei Abzüge je Bild. Mit nur vier Fotos
    // wären es neun, und dann lässt sich der Mindestabstand in einem 6×6-Feld
    // gar nicht mehr durchhalten — die Sperre fiele reihenweise auf den Ersatz
    // zurück, und der Test prüfte nichts.
    const photos = bestand(...Array.from({ length: 12 }, (_, i) => foto(`f${i}`, ROT)));

    const naechster = (plan: { tiles: { photoId: string; col: number; row: number }[] }) => {
      const lage = new Map<string, { col: number; row: number }[]>();
      for (const t of plan.tiles) {
        lage.set(t.photoId, [...(lage.get(t.photoId) ?? []), { col: t.col, row: t.row }]);
      }
      let kleinster = Infinity;
      for (const stellen of lage.values()) {
        for (let i = 0; i < stellen.length; i++) {
          for (let j = i + 1; j < stellen.length; j++) {
            const a = stellen[i]!;
            const b = stellen[j]!;
            kleinster = Math.min(kleinster, Math.hypot(a.col - b.col, a.row - b.row));
          }
        }
      }
      return kleinster;
    };

    // Der Mindestabstand ist eine Sperre, keine Abwägung — er gilt, solange
    // genug Kandidaten übrig bleiben. Neun Abzüge je Foto auf 36 Zellen lassen
    // das zu.
    const plan = planMosaic(target, { photos, ...FLAECHE, spreadRadius: 2 });
    expect(naechster(plan)).toBeGreaterThanOrEqual(2);

    // Und es ist die Sperre, die das leistet, nicht der Zufall.
    const ohne = planMosaic(target, { photos, ...FLAECHE, spreadRadius: 0 });
    expect(naechster(plan)).toBeGreaterThan(naechster(ohne));
  });

  it('zählt, wie oft jedes Bild vorkommt', () => {
    const plan = planMosaic(vollesRaster(4, 4), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    const summe = plan.usage.reduce((s, u) => s + u.count, 0);
    expect(summe).toBe(plan.tiles.length);
    expect(plan.usage[0]!.count).toBeGreaterThanOrEqual(plan.usage[1]!.count);
  });
});

describe('Deckung und Geometrie', () => {
  it('lässt Zellen unter der Mindestdeckung leer', () => {
    const target: MosaicTarget = {
      cols: 3,
      rows: 1,
      cells: [{ alpha: 1 }, { alpha: 0.05 }, { alpha: 1 }],
    };
    const plan = planMosaic(target, { photos: bestand(foto('a', ROT)), ...FLAECHE });
    expect(plan.tiles.map((t) => t.col)).toEqual([0, 2]);
  });

  it('verkleinert die Kachel an einer weichen Kante flächenproportional', () => {
    const voll = planMosaic(zeile(undefined), {
      photos: bestand(foto('a', ROT)),
      ...FLAECHE,
      gap: 0,
    });
    const halb = planMosaic(
      { cols: 1, rows: 1, cells: [{ alpha: 0.25 }] },
      { photos: bestand(foto('a', ROT)), ...FLAECHE, gap: 0 },
    );
    // Ein Viertel Deckung heißt ein Viertel Fläche, also die halbe Kante.
    expect(halb.tiles[0]!.w).toBeCloseTo(voll.tiles[0]!.w / 2, 6);
    expect(halb.tiles[0]!.h).toBeCloseTo(voll.tiles[0]!.h / 2, 6);
  });

  it('zentriert die Kachel in ihrer Zelle', () => {
    const plan = planMosaic(vollesRaster(2, 2), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
      gap: 0.2,
    });
    for (const t of plan.tiles) {
      expect(t.x + t.w / 2).toBeCloseTo((t.col + 0.5) / 2, 6);
      expect(t.y + t.h / 2).toBeCloseTo((t.row + 0.5) / 2, 6);
    }
  });

  it('hält alle Kacheln innerhalb der Fläche', () => {
    const plan = planMosaic(vollesRaster(5, 4), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    for (const t of plan.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('leitet die Kachelform aus Fläche und Raster ab', () => {
    // Doppelt so breite Fläche, gleich viele Spalten wie Zeilen: Die Kachel ist
    // quer.
    const plan = planMosaic(vollesRaster(4, 4), {
      photos: bestand(foto('a', ROT)),
      areaAspect: 2,
    });
    expect(plan.cellAspect).toBeCloseTo(2, 6);
  });
});

describe('Einfärbung zur Wunschfarbe', () => {
  it('trägt sie an jede Kachel, die eine Wunschfarbe hat', () => {
    const plan = planMosaic(zeile(ROT, BLAU), {
      photos: bestand(foto('r', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    expect(plan.tiles[0]?.tint).toEqual({ color: ROT, amount: 0.5 });
    expect(plan.tiles[1]?.tint).toEqual({ color: BLAU, amount: 0.5 });
  });

  it('lässt sie weg, wo keine Farbe vorgegeben ist', () => {
    // Die bloße Ziffernform: Jede Tönung wäre eine Behauptung über eine Farbe,
    // die niemand vorgegeben hat.
    const plan = planMosaic(vollesRaster(2, 2), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    expect(plan.tiles.every((t) => t.tint === undefined)).toBe(true);
  });

  it('lässt sie weg, wenn der Anteil auf null steht', () => {
    const plan = planMosaic(zeile(ROT), {
      photos: bestand(foto('r', ROT)),
      ...FLAECHE,
      tint: 0,
    });
    expect(plan.tiles[0]?.tint).toBeUndefined();
  });

  it('klemmt einen Anteil außerhalb von null bis eins', () => {
    const plan = planMosaic(zeile(ROT), { photos: bestand(foto('r', ROT)), ...FLAECHE, tint: 5 });
    expect(plan.tiles[0]?.tint?.amount).toBe(1);
  });
});

describe('Determinismus', () => {
  it('ergibt bei gleicher Eingabe zeichengleich denselben Plan', () => {
    const eingabe = {
      photos: bestand(foto('a', ROT), foto('b', BLAU), foto('c', GRUEN)),
      ...FLAECHE,
    };
    const a = planMosaic(vollesRaster(6, 6), eingabe);
    const b = planMosaic(vollesRaster(6, 6), eingabe);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('hängt nicht an der Reihenfolge des Bestands', () => {
    const fotos = [foto('a', ROT), foto('b', BLAU), foto('c', GRUEN)];
    const vorwaerts = planMosaic(vollesRaster(5, 5), { photos: bestand(...fotos), ...FLAECHE });
    const rueckwaerts = planMosaic(vollesRaster(5, 5), {
      photos: bestand(...[...fotos].reverse()),
      ...FLAECHE,
    });
    expect(rueckwaerts.tiles).toEqual(vorwaerts.tiles);
  });

  it('ordnet mit einem anderen Seed anders an', () => {
    const eingabe = {
      photos: bestand(foto('a', ROT), foto('b', BLAU), foto('c', GRUEN)),
      ...FLAECHE,
    };
    const eins = planMosaic(vollesRaster(6, 6), { ...eingabe, seed: 1 });
    const zwei = planMosaic(vollesRaster(6, 6), { ...eingabe, seed: 2 });
    expect(zwei.tiles).not.toEqual(eins.tiles);
    // Gleich viele Kacheln bleiben es aber — der Seed streut, er wählt nicht aus.
    expect(zwei.tiles).toHaveLength(eins.tiles.length);
  });

  it('gibt die Kacheln zeilenweise aus, obwohl gestreut belegt wird', () => {
    const plan = planMosaic(vollesRaster(4, 3), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    const folge = plan.tiles.map((t) => t.row * 4 + t.col);
    expect(folge).toEqual([...folge].sort((x, y) => x - y));
  });

  it('bevorzugt keine Ecke', () => {
    // Der Grund für die gestreute Belegung: Zeilenweise bekäme die obere linke
    // Ecke die besten Treffer. Bei nur einer roten Zelle unter lauter freien
    // darf die Zuordnung dort nicht schon verbraucht sein.
    const cells: MosaicCell[] = Array.from({ length: 25 }, (_, i) =>
      i === 24 ? { alpha: 1, color: ROT } : { alpha: 1 },
    );
    const plan = planMosaic(
      { cols: 5, rows: 5, cells },
      { photos: bestand(foto('r', ROT), foto('b', BLAU), foto('g', GRUEN)), ...FLAECHE },
    );
    expect(plan.tiles.find((t) => t.col === 4 && t.row === 4)?.photoId).toBe('r');
  });
});

describe('Korrekturen und Befunde', () => {
  it('dreht das Farbraster mit einer korrigierten Ausrichtung mit', () => {
    // Ein auf dem Kopf stehender Scan: Der blaue Himmel liegt in der unteren
    // Zeile des Rasters. Nach der Korrektur muss die Kachel ihn oben suchen —
    // sonst zeigt sie den Waldboden und ist trotzdem als „blau" ausgewählt
    // worden.
    const grid: Rgb[] = [GRUEN, GRUEN, GRUEN, GRUEN, GRUEN, GRUEN, BLAU, BLAU, BLAU];
    const scan: Photo = { ...foto('s', [80, 140, 80]), tone: { mean: [80, 140, 80], grid } };
    const target: MosaicTarget = { cols: 1, rows: 1, cells: [{ alpha: 1, color: BLAU }] };
    // Eine halbe Drehung tauscht Breite und Höhe nicht — damit vergleicht der
    // Test die Lage des Ausschnitts und nicht nebenbei die Kachelform.
    const gemeinsam = { photos: bestand(scan), areaAspect: 1, crop: 'feld' as const };

    const roh = planMosaic(target, gemeinsam);
    const korrigiert = planMosaic(target, {
      ...gemeinsam,
      overrides: { s: { orientationTurns: 2 } },
    });

    expect(roh.tiles[0]!.crop.y).toBeGreaterThan(0.5);
    expect(korrigiert.tiles[0]!.crop.y).toBeCloseTo(0, 6);
  });

  it('lässt Fotos ohne Farbwerte außen vor und sagt es', () => {
    const ohne: Photo = foto('x', ROT);
    delete ohne.tone;
    const plan = planMosaic(vollesRaster(2, 2), {
      photos: bestand(foto('a', ROT), ohne),
      ...FLAECHE,
    });
    expect(plan.tiles.every((t) => t.photoId === 'a')).toBe(true);
    expect(plan.warnings).toContainEqual({ code: 'ohne-farbwerte', anzahl: 1 });
  });

  it('meldet einen Bestand ganz ohne Farbwerte, statt still leer zu bleiben', () => {
    const ohne: Photo = foto('x', ROT);
    delete ohne.tone;
    const plan = planMosaic(vollesRaster(2, 2), { photos: bestand(ohne), ...FLAECHE });
    expect(plan.tiles).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toContain('keine-fotos');
  });

  it('sagt, wenn mehr Kacheln als Fotos zu füllen sind', () => {
    const plan = planMosaic(vollesRaster(10, 10), {
      photos: bestand(foto('a', ROT), foto('b', BLAU)),
      ...FLAECHE,
    });
    expect(plan.warnings).toContainEqual({ code: 'wiederholung-noetig', fotos: 2, kacheln: 100 });
  });

  it('merkt ein Raster, dessen Zellenzahl nicht zu seinen Maßen passt', () => {
    const plan = planMosaic(
      { cols: 3, rows: 3, cells: [{ alpha: 1 }] },
      { photos: bestand(foto('a', ROT)), ...FLAECHE },
    );
    expect(plan.warnings).toContainEqual({ code: 'raster-unstimmig', erwartet: 9, vorhanden: 1 });
  });

  it('schreibt jeden Befund als deutschen Satz', () => {
    const alle = [
      { code: 'keine-fotos' },
      { code: 'wiederholung-noetig', fotos: 2, kacheln: 100 },
      { code: 'ohne-farbwerte', anzahl: 3 },
      { code: 'raster-unstimmig', erwartet: 9, vorhanden: 1 },
    ] as const;
    for (const w of alle) {
      expect(mosaicWarningText(w).length).toBeGreaterThan(10);
    }
  });
});

describe('Abdruck des Plans', () => {
  it('bleibt gleich, solange der Plan gleich ist', () => {
    const eingabe = { photos: bestand(foto('a', ROT), foto('b', BLAU)), ...FLAECHE };
    expect(mosaicFingerprint(planMosaic(vollesRaster(4, 4), eingabe))).toBe(
      mosaicFingerprint(planMosaic(vollesRaster(4, 4), eingabe)),
    );
  });

  it('ändert sich, sobald eine andere Zuordnung herauskäme', () => {
    const eingabe = { photos: bestand(foto('a', ROT), foto('b', BLAU)), ...FLAECHE };
    const eins = mosaicFingerprint(planMosaic(vollesRaster(4, 4), { ...eingabe, seed: 1 }));
    const zwei = mosaicFingerprint(planMosaic(vollesRaster(4, 4), { ...eingabe, seed: 2 }));
    expect(zwei).not.toBe(eins);
  });

  it('ändert sich, wenn nur die Einfärbung anders ist', () => {
    // Sie wirkt erst beim Backen — der Abdruck muss sie trotzdem kennen, sonst
    // liefert der Cache das alte Bild zurück.
    const eingabe = { photos: bestand(foto('r', ROT)), ...FLAECHE };
    const schwach = mosaicFingerprint(planMosaic(zeile(ROT), { ...eingabe, tint: 0.2 }));
    const stark = mosaicFingerprint(planMosaic(zeile(ROT), { ...eingabe, tint: 0.8 }));
    expect(stark).not.toBe(schwach);
  });

  it('ändert sich auch, wenn nur die Fugenbreite anders ist', () => {
    // Das gebackene Bild sähe anders aus — der Abdruck muss es merken.
    const eingabe = { photos: bestand(foto('a', ROT)), ...FLAECHE };
    const eng = mosaicFingerprint(planMosaic(vollesRaster(3, 3), { ...eingabe, gap: 0.02 }));
    const weit = mosaicFingerprint(planMosaic(vollesRaster(3, 3), { ...eingabe, gap: 0.2 }));
    expect(weit).not.toBe(eng);
  });
});

describe('Zugriff auf das Zielraster', () => {
  it('liefert die Zelle an ihrer Stelle', () => {
    const target = zeile(ROT, BLAU);
    expect(cellAt(target, 1, 0)?.color).toEqual(BLAU);
  });

  it('gibt außerhalb nichts zurück', () => {
    const target = zeile(ROT, BLAU);
    expect(cellAt(target, 2, 0)).toBeUndefined();
    expect(cellAt(target, -1, 0)).toBeUndefined();
    expect(cellAt(target, 0, 1)).toBeUndefined();
  });
});
