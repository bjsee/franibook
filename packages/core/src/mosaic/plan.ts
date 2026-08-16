/**
 * Welches Foto kommt in welche Kachel.
 *
 * Das ist ein Zuordnungsproblem, aber ausdrücklich **nicht** das klassische:
 * Es gibt viel mehr Kacheln als Fotos, jedes Bild darf also mehrfach vorkommen.
 * Eine optimale Zuordnung (Ungarische Methode) wäre damit weder anwendbar noch
 * gewollt — gesucht ist nicht das rechnerische Minimum, sondern ein Bild, das
 * von weitem die Vorlage zeigt und von nahem nicht als Wiederholung auffällt.
 *
 * Also greedy, mit drei Kosten in **derselben Einheit** (Lab-Abstand):
 *
 *  1. Wie gut die Farbe passt.
 *  2. Ein Zuschlag je bereits gesetzter Kachel desselben Fotos — sonst füllt
 *     ein einziges blaues Bild den ganzen Himmel.
 *  3. Ein Zuschlag für eine Wiederholung in Sichtweite — dieselbe Kachel
 *     zweimal nebeneinander fällt auf, quer über die Fläche verteilt nicht.
 *
 * Eine gemeinsame Einheit statt gewichteter Faktoren, weil die Zahlen dann
 * etwas bedeuten: `reuseCost: 2` heißt „die zweite Verwendung muss um zwei
 * Lab-Einheiten besser passen", und das kann man am Ergebnis nachprüfen.
 *
 * **Die Reihenfolge der Zellen ist gestreut, nicht zeilenweise.** Greedy
 * bedient die früh drankommenden besser: Zeilenweise bekäme die obere linke
 * Ecke die schönsten Treffer und die untere rechte den Rest, und das sieht man
 * dem fertigen Mosaik an. Die Streuung ist eine reine Funktion aus Lage und
 * Seed — kein `Math.random()`, wie überall im Kern
 * (`.claude/rules/kern-rein.md`).
 */
import { type Crop, coverCrop } from '../model/crop.js';
import type { PhotoOverride } from '../model/date.js';
import { effectivePhotos } from '../model/effective-photo.js';
import { type Lab, type Rgb, farbAbstand, rgbNachLab } from '../model/farbe.js';
import { fnv1aZahl } from '../model/fingerprint.js';
import { focalForCrop } from '../model/focal.js';
import { TONE_GRID, type Photo, type PhotoId, aspectRatio } from '../model/photo.js';
import {
  DEFAULT_MOSAIC_SETTINGS,
  type MosaicPlan,
  type MosaicSettings,
  type MosaicTarget,
  type MosaicTile,
  type MosaicWarning,
} from './mosaic.js';

export interface MosaicPlanOptions extends Partial<MosaicSettings> {
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides?: Record<PhotoId, PhotoOverride>;
  /**
   * Seitenverhältnis der zu füllenden Fläche (Breite / Höhe).
   *
   * Daraus und aus dem Raster folgt die Form der Zelle — und die ist der
   * Ausschnitt, auf den jedes Foto geschnitten wird. Ohne diese Angabe wüsste
   * der Plan nicht, ob seine Kacheln quadratisch sind oder hochkant.
   */
  areaAspect: number;
}

/** Ein Foto, für die Auswahl vorbereitet. */
interface Kandidat {
  photo: Photo;
  /** Mittlere Farbe des ganzen Bildes. */
  mittel: Lab;
  /** Die neun Felder, zeilenweise — leer, wenn das Raster nicht stimmt. */
  felder: Lab[];
  /** Wie oft schon gesetzt. */
  anzahl: number;
  /** Wo bisher gesetzt, für den Nachbarschaftszuschlag. */
  lagen: { col: number; row: number }[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Ausschnitt um eines der neun Felder, in der Form der Kachel.
 *
 * Das Feld ist ein Neuntel des Bildes und hat dessen Seitenverhältnis; die
 * Kachel hat ihres. Genommen wird deshalb das größte Rechteck in Kachelform,
 * das in das Feld passt, zentriert auf die Feldmitte und am Bildrand geklemmt.
 * Es bleibt damit im Feld — und nur deshalb hat der Ausschnitt am Ende auch
 * ungefähr die Farbe, nach der er ausgewählt wurde.
 */
function feldAusschnitt(feld: number, photoAspect: number, cellAspect: number): Crop {
  const n = TONE_GRID;
  const col = feld % n;
  const row = Math.floor(feld / n);

  // Verhältnis der Ausschnittkanten, bei dem der Bildbereich Kachelform hat.
  const ziel = cellAspect / photoAspect;
  const kante = 1 / n;
  const [w, h] = ziel > 1 ? [kante, kante / ziel] : [kante * ziel, kante];

  const cx = (col + 0.5) / n;
  const cy = (row + 0.5) / n;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
    // `manual`, weil der Ausschnitt eine getroffene Entscheidung ist: Er gehört
    // zur Farbwahl dieser Kachel und darf nicht als Cover-Ausschnitt neu
    // gerechnet werden.
    mode: 'manual',
  };
}

/**
 * Liegt schon ein Abzug dieses Fotos näher als der Mindestabstand?
 *
 * Euklidisch und nicht über die Schachbrettdistanz: Zwei Kacheln über Eck sind
 * weiter auseinander als zwei nebeneinander, und genau so sieht man sie auch.
 */
function zuNah(k: Kandidat, col: number, row: number, radius: number): boolean {
  if (radius <= 0) return false;
  for (const lage of k.lagen) {
    const dc = lage.col - col;
    const dr = lage.row - row;
    if (dc * dc + dr * dr < radius * radius) return true;
  }
  return false;
}

/** Ausschnitt, der das ganze Bild zeigt — mit Fokus auf Gesichtern. */
function ganzAusschnitt(photo: Photo, cellAspect: number): Crop {
  return coverCrop(aspectRatio(photo), cellAspect, focalForCrop(photo, cellAspect));
}

/**
 * Plant ein Mosaik.
 *
 * Deterministisch: gleiches Ziel, gleicher Bestand, gleiche Einstellungen
 * ergeben zeichengleich denselben Plan. Fotos ohne `tone` bleiben außen vor —
 * ihre Farbe ist unbekannt, und geraten wäre schlimmer als ausgelassen.
 */
export function planMosaic(target: MosaicTarget, options: MosaicPlanOptions): MosaicPlan {
  const s: MosaicSettings = { ...DEFAULT_MOSAIC_SETTINGS, ...ohneUndefined(options) };
  const warnings: MosaicWarning[] = [];

  const cols = Math.max(1, Math.floor(target.cols));
  const rows = Math.max(1, Math.floor(target.rows));
  const cellAspect = (options.areaAspect / cols) * rows;

  if (target.cells.length !== cols * rows) {
    warnings.push({
      code: 'raster-unstimmig',
      erwartet: cols * rows,
      vorhanden: target.cells.length,
    });
  }

  // Wie an jeder Eintrittsstelle des Kerns: erst die Korrekturen auflösen,
  // dann rechnen. Das Farbraster dreht dabei mit einer Ausrichtungskorrektur
  // mit — sonst suchte die Auswahl den Himmel an der falschen Bildkante.
  const photos = effectivePhotos(options.photos, options.overrides);

  // Nach Kennung sortiert und nicht in Map-Reihenfolge: Bei gleichen Kosten
  // gewinnt der erste Kandidat, und wer das ist, soll nicht davon abhängen, in
  // welcher Folge der Aufrufer seinen Bestand aufgebaut hat.
  const ids = [...photos.keys()].sort();
  const kandidaten: Kandidat[] = [];
  let ohneFarbe = 0;
  for (const id of ids) {
    const photo = photos.get(id)!;
    if (!photo.tone) {
      ohneFarbe++;
      continue;
    }
    const felder =
      photo.tone.grid.length === TONE_GRID * TONE_GRID
        ? photo.tone.grid.map((f) => rgbNachLab(f))
        : [];
    kandidaten.push({
      photo,
      mittel: rgbNachLab(photo.tone.mean),
      felder,
      anzahl: 0,
      lagen: [],
    });
  }
  if (ohneFarbe > 0) warnings.push({ code: 'ohne-farbwerte', anzahl: ohneFarbe });

  // Welche Zellen überhaupt eine Kachel bekommen — und in welcher Folge sie
  // drankommen. Der Streuwert hängt an Lage und Seed, damit keine Ecke
  // bevorzugt wird und derselbe Seed dieselbe Folge ergibt.
  const offen: {
    col: number;
    row: number;
    alpha: number;
    wunsch?: Lab;
    farbe?: Rgb;
    ordnung: number;
  }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = target.cells[row * cols + col];
      if (!cell) continue;
      const alpha = clamp(cell.alpha, 0, 1);
      if (alpha < s.minAlpha) continue;
      offen.push({
        col,
        row,
        alpha,
        ...(cell.color ? { wunsch: rgbNachLab(cell.color), farbe: cell.color } : {}),
        ordnung: fnv1aZahl(`${col}:${row}`, s.seed),
      });
    }
  }
  offen.sort((a, b) => a.ordnung - b.ordnung || a.row - b.row || a.col - b.col);

  if (kandidaten.length === 0) {
    if (offen.length > 0) warnings.push({ code: 'keine-fotos' });
    return { cols, rows, cellAspect, tiles: [], usage: [], candidates: 0, warnings };
  }
  if (kandidaten.length < offen.length) {
    warnings.push({
      code: 'wiederholung-noetig',
      fotos: kandidaten.length,
      kacheln: offen.length,
    });
  }

  const radius = Math.max(0, s.spreadRadius);
  const zellW = 1 / cols;
  const zellH = 1 / rows;
  const tiles: MosaicTile[] = [];

  for (const zelle of offen) {
    // Zwei Sieger nebeneinander: der beste unter denen, die den Mindestabstand
    // einhalten, und der beste überhaupt. Der zweite ist die Rückfalllinie für
    // den Fall, dass die Sperre alle Kandidaten ausschließt — bei mehr Kacheln
    // als Fotos ist das der Normalfall und kein Fehler.
    let bester: Kandidat | undefined;
    let besteKosten = Infinity;
    let bestesFeld = -1;
    let ersatz: Kandidat | undefined;
    let ersatzKosten = Infinity;
    let ersatzFeld = -1;

    for (const k of kandidaten) {
      let farbe = 0;
      let feld = -1;
      if (zelle.wunsch) {
        if (s.crop === 'feld' && k.felder.length > 0) {
          // Das Foto darf sich seine beste Stelle aussuchen: Ein Bild mit
          // hellem Himmel und dunklem Wald taugt für zwei ganz verschiedene
          // Wunschfarben, und ein Mittelwert verschenkte beide.
          farbe = Infinity;
          for (let i = 0; i < k.felder.length; i++) {
            const d = farbAbstand(k.felder[i]!, zelle.wunsch);
            if (d < farbe) {
              farbe = d;
              feld = i;
            }
          }
        } else {
          farbe = farbAbstand(k.mittel, zelle.wunsch);
        }
      }

      const kosten = farbe + s.reuseCost * k.anzahl;
      // Kann weder Sieger noch Ersatz werden — die häufigste Abkürzung, sie
      // spart bei 800 Kandidaten je Kachel die Abstandsprüfung unten.
      if (kosten >= ersatzKosten && kosten >= besteKosten) continue;

      if (kosten < ersatzKosten) {
        ersatzKosten = kosten;
        ersatz = k;
        ersatzFeld = feld;
      }

      if (kosten < besteKosten && !zuNah(k, zelle.col, zelle.row, radius)) {
        besteKosten = kosten;
        bester = k;
        bestesFeld = feld;
      }
    }

    if (!bester) {
      bester = ersatz;
      bestesFeld = ersatzFeld;
    }
    if (!bester) continue;
    bester.anzahl++;
    bester.lagen.push({ col: zelle.col, row: zelle.row });

    // Fuge und weiche Kante wirken gemeinsam auf die Kachelgröße. Die
    // Verkleinerung geht über die Wurzel, damit die **Fläche** proportional zur
    // Deckung schrumpft — das ist es, was das Auge an einer Kante als Verlauf
    // liest, nicht die Kantenlänge.
    const skala = (1 - clamp(s.gap, 0, 0.5)) * Math.sqrt(zelle.alpha);
    const w = zellW * skala;
    const h = zellH * skala;

    // Eingefärbt wird nur, wo es eine Wunschfarbe gibt: Bei der bloßen
    // Ziffernform wäre jede Tönung eine Behauptung über eine Farbe, die
    // niemand vorgegeben hat.
    const tintAnteil = clamp(s.tint, 0, 1);
    const tint =
      zelle.farbe && tintAnteil > 0 ? { color: zelle.farbe, amount: tintAnteil } : undefined;

    tiles.push({
      col: zelle.col,
      row: zelle.row,
      photoId: bester.photo.id,
      ...(tint ? { tint } : {}),
      crop:
        s.crop === 'feld' && bestesFeld >= 0
          ? feldAusschnitt(bestesFeld, aspectRatio(bester.photo), cellAspect)
          : ganzAusschnitt(bester.photo, cellAspect),
      x: zelle.col * zellW + (zellW - w) / 2,
      y: zelle.row * zellH + (zellH - h) / 2,
      w,
      h,
    });
  }

  // Zeilenweise ausgeben, obwohl gestreut belegt wurde: Wer den Plan liest oder
  // backt, arbeitet der Reihe nach — die Streuung war eine Frage der Auswahl,
  // nicht des Ergebnisses.
  tiles.sort((a, b) => a.row - b.row || a.col - b.col);

  const usage = kandidaten
    .filter((k) => k.anzahl > 0)
    .map((k) => ({ photoId: k.photo.id, count: k.anzahl }))
    .sort((a, b) => b.count - a.count || (a.photoId < b.photoId ? -1 : 1));

  return { cols, rows, cellAspect, tiles, usage, candidates: kandidaten.length, warnings };
}

/**
 * Streicht die nicht gesetzten Felder aus den Optionen.
 *
 * Nötig wegen `exactOptionalPropertyTypes`: Ein `{ seed: undefined }` aus einem
 * teilweise gefüllten Optionsobjekt überschriebe im Spread die Vorgabe mit
 * `undefined`, und die Rechnung liefe auf `NaN`.
 */
function ohneUndefined(options: Partial<MosaicSettings>): Partial<MosaicSettings> {
  const rein: Record<string, unknown> = {};
  for (const [schluessel, wert] of Object.entries(options)) {
    if (wert !== undefined) rein[schluessel] = wert;
  }
  return rein as Partial<MosaicSettings>;
}

/**
 * Abdruck eines Plans — ändert sich, sobald das gebackene Bild veralten würde.
 *
 * Dieselbe Rolle wie die Abdrücke von Gruppen und Gliederung: Der Server hängt
 * ihn an den Dateinamen des gebackenen Mosaiks und weiß damit ohne
 * Zustandshaltung, ob die Datei im Cache noch die richtige ist. Erfasst sind
 * die Kachellagen und die Zuordnung, **nicht** die Warnungen — ein nachgezogener
 * Farbwert soll das Bild neu backen lassen, ein geänderter Hinweistext nicht.
 */
export function mosaicFingerprint(plan: MosaicPlan): string {
  const teile = plan.tiles.map(
    (t) =>
      `${t.col},${t.row},${t.photoId},${t.crop.x.toFixed(4)},${t.crop.y.toFixed(4)},` +
      `${t.crop.w.toFixed(4)},${t.crop.h.toFixed(4)},${t.x.toFixed(4)},${t.y.toFixed(4)},` +
      `${t.w.toFixed(4)},${t.h.toFixed(4)},` +
      (t.tint ? `${t.tint.color.join('-')}@${t.tint.amount.toFixed(3)}` : '-'),
  );
  return fnv1aZahl(`${plan.cols}x${plan.rows}@${plan.cellAspect.toFixed(4)}|${teile.join('|')}`)
    .toString(36)
    .padStart(7, '0');
}
