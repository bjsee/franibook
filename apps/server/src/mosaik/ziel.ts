/**
 * Das Zielraster: was das Mosaik darstellen soll.
 *
 * Der Kern plant, welches Foto in welche Kachel kommt (`core/mosaic/`), kann
 * die Vorlage aber nicht selbst herstellen — dafür bräuchte er Pixel und eine
 * Schrift (`.claude/rules/kern-rein.md`). Hier entsteht sie, und zwar auf
 * genau zwei Wegen, die dasselbe `MosaicTarget` ergeben:
 *
 *  - **aus Text** („18"): Die Buchstabenform sagt, wo überhaupt eine Kachel
 *    liegt. Die Farbe bleibt offen.
 *  - **aus einem Foto**: Das verkleinerte Bild sagt, welche Farbe jede Kachel
 *    haben soll. Gedeckt ist überall.
 *
 * `verbinde` setzt beides zusammen — eine Ziffer, die zugleich das Motiv eines
 * Fotos trägt. Dass das ohne einen dritten Mechanismus geht, ist der Grund für
 * den Zuschnitt von `MosaicCell`.
 *
 * **Die Schrift kommt über ihre Glyphenkonturen ins Bild, nicht über eine
 * Schriftangabe im SVG.** Gemessen: librsvg (der Renderer hinter sharp)
 * ignoriert ein `@font-face` mit eingebetteter Schriftdatei stillschweigend
 * und setzt statt dessen seine Ausweichschrift — die Pixelzahl war mit und
 * ohne eingebettete Schrift identisch. Über eine im System registrierte
 * Schrift ginge es, aber dann hinge das Aussehen des Umschlags daran, was auf
 * dem Rechner installiert ist. `fontkit` liefert die Konturen direkt aus der
 * Datei, die auch ins PDF eingebettet wird.
 */
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import type { FontFamilyId, MosaicCell, MosaicTarget, Rgb } from '@franibook/core';
import { fontFilePath } from '@franibook/fonts';

/**
 * Wie fein die Vorlage gerastert wird, bevor sie auf das Zielraster
 * eingedampft wird.
 *
 * Acht Bildpunkte je Zelle und Kante, also 64 Messpunkte je Zelle: Damit hat
 * eine Zellendeckung 65 Stufen und die Ziffernkante einen brauchbaren Verlauf.
 * Höher zu gehen kostet quadratisch und bringt nichts — die Deckung steuert am
 * Ende die Kachelgröße, und die ist im Druck wenige Millimeter groß.
 */
const UEBERABTASTUNG = 8;

/**
 * Breite, in der die Buchstabenform gerastert wird.
 *
 * Großzügig, weil sie danach ohnehin verkleinert wird: Ein 44er-Raster mit
 * achtfacher Überabtastung ist 352 Punkte breit, 2000 lassen also reichlich
 * Luft für die Mittelung an den Bogenkanten. Größer zu rastern kostet Zeit für
 * Zwischenstufen, die niemand sieht.
 */
const SVG_RASTERBREITE_PX = 2000;

/**
 * Maße der Zwischenstufe, in der die Vorlage entsteht.
 *
 * **Sie hat die Proportionen der Fläche, nicht die des Rasters** — und das ist
 * der Punkt, an dem eine „18" sonst in die Breite läuft: Ein 40×30-Raster auf
 * einer quadratischen Fläche hat Zellen im Verhältnis 3:4, und wer die Form in
 * einem 40×30-Bild einpasst, hat sie schon verzerrt, bevor gemittelt wird.
 * Gerastert wird deshalb in Flächenform; das anschließende Stauchen auf
 * cols×rows nimmt genau die Verzerrung vor, die die nicht-quadratischen Zellen
 * wieder ausgleichen.
 */
function zwischenmasse(
  cols: number,
  rows: number,
  areaAspect: number,
): { breite: number; hoehe: number } {
  const breite = cols * UEBERABTASTUNG;
  const gueltig = Number.isFinite(areaAspect) && areaAspect > 0 ? areaAspect : cols / rows;
  return { breite, hoehe: Math.max(1, Math.round(breite / gueltig)) };
}

export interface TextZielOptionen {
  cols: number;
  rows: number;
  /** Seitenverhältnis der zu füllenden Fläche (Breite / Höhe). */
  areaAspect: number;
  /** Schriftfamilie aus `@franibook/fonts`. */
  family?: FontFamilyId;
  /**
   * Rand um die Form, als Anteil der kürzeren Flächenkante.
   *
   * Ohne Rand stößt die Ziffer an die Beschnittkante, und dort schneidet die
   * Druckerei sie an. 0,06 lässt bei 280 mm knapp 17 mm Luft.
   */
  padding?: number;
  /** Kacheln außerhalb der Form statt innerhalb. */
  invertiert?: boolean;
}

/** Ein SVG, das den Text als reine Konturen enthält. */
export function textAlsSvg(text: string, family: FontFamilyId = 'display'): string {
  const datei = fontFilePath(family, 'regular');

  // `create` liefert je nach Datei auch eine Sammlung; `layout` gibt es nur an
  // einer einzelnen Schrift. Alle Dateien des Projekts sind einzelne TTFs.
  const font = fontkit.create(readFileSync(datei));
  if (!('layout' in font)) throw new Error(`${datei} ist eine Schriftsammlung, keine Schrift`);

  const lauf = font.layout(text);
  if (lauf.glyphs.length === 0) throw new Error('Der Text enthält kein darstellbares Zeichen');

  let x = 0;
  const pfade: string[] = [];
  for (let i = 0; i < lauf.glyphs.length; i++) {
    const d = lauf.glyphs[i]!.path.toSVG();
    // Leerzeichen haben keine Kontur — sie schieben nur weiter.
    if (d) pfade.push(`<path transform="translate(${x} 0)" d="${d}"/>`);
    x += lauf.positions[i]?.xAdvance ?? 0;
  }

  // Die Tintenfläche, nicht die Zeilenhöhe: Eine „18" soll die Fläche füllen
  // und nicht die Oberlängen einer Zeile mittragen, in der sie allein steht.
  const { minX, minY, maxX, maxY } = lauf.bbox;
  const breite = Math.max(1, maxX - minX);
  const hoehe = Math.max(1, maxY - minY);

  // **`width` und `height` müssen dranstehen.** Ohne sie nimmt librsvg eine
  // eigene Vorgabegröße an und bildet die viewBox darauf ab — gemessen kam
  // dabei von einer „18" nur der untere Rand im Bild an. Die Zahlen sind die
  // Rasterbreite unten und daraus das unverzerrte Gegenstück.
  const rasterBreite = SVG_RASTERBREITE_PX;
  const rasterHoehe = Math.max(1, Math.round((rasterBreite * hoehe) / breite));

  // Glyphenkoordinaten laufen nach oben, SVG-Koordinaten nach unten — daher
  // die Spiegelung an der x-Achse.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterBreite}" height="${rasterHoehe}" ` +
    `viewBox="${minX} ${-maxY} ${breite} ${hoehe}">` +
    `<g transform="scale(1 -1)" fill="#000000">${pfade.join('')}</g></svg>`
  );
}

/**
 * Zielraster aus einem Text.
 *
 * Die Form wird in die Fläche eingepasst (nicht gefüllt): Eine „18" ist breiter
 * als hoch, und sie zu verzerren, damit sie ein quadratisches Cover ausfüllt,
 * wäre keine Gestaltung, sondern ein Fehler.
 */
export async function zielAusText(text: string, optionen: TextZielOptionen): Promise<MosaicTarget> {
  const { cols, rows } = optionen;
  const { breite, hoehe } = zwischenmasse(cols, rows, optionen.areaAspect);
  const rand = Math.round(Math.min(breite, hoehe) * (optionen.padding ?? 0.06));

  // Der Umweg über eine große Zwischenstufe ist nötig, weil das SVG in
  // Flächenform gerendert werden muss, bevor gemittelt wird: Direkt auf
  // cols×rows gerastert hätte jede Zelle nur einen Bildpunkt und die Kante
  // wäre eine Treppe.
  //
  // **Zwei Durchläufe und nicht eine Kette:** sharp lässt je Pipeline nur ein
  // `resize()` zu — ein zweites ersetzt das erste stillschweigend. Gemessen
  // war das Ergebnis eine „18", von der 31 von 1600 Zellen übrig blieben.
  //
  // Die Zwischenstufe bleibt ein Rohpuffer und wird nicht als PNG geschrieben:
  // Sie sieht niemand, und ein geschriebenes Bild wäre eine Ausgabekette mehr,
  // die den Farbraum ansagen müsste (`tests/architektur`).
  const flaeche = await sharp(Buffer.from(textAlsSvg(text, optionen.family ?? 'display')))
    .resize({
      width: Math.max(1, breite - 2 * rand),
      height: Math.max(1, hoehe - 2 * rand),
      fit: 'contain',
      background: '#ffffff',
    })
    .flatten({ background: '#ffffff' })
    .extend({ top: rand, bottom: rand, left: rand, right: rand, background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gerastert = await sharp(flaeche.data, {
    raw: {
      width: flaeche.info.width,
      height: flaeche.info.height,
      channels: flaeche.info.channels,
    },
  })
    .resize({ width: cols, height: rows, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // **Die Schrittweite kommt aus der Ausgabe und wird nicht angenommen.**
  // `raw()` liefert nach einem einkanaligen Rohpuffer wieder drei Kanäle, und
  // wer hier fest mit einem rechnet, liest jede dritte Zelle und schreibt sie
  // an die falsche Stelle. Gemessen: Von einer „18" blieben 421 statt 577
  // belegter Zellen übrig — wenig genug, um wie eine feine Rasterung
  // auszusehen, und damit die unangenehmste Art von Fehler.
  const schritt = gerastert.info.channels;
  const cells: MosaicCell[] = [];
  for (let i = 0; i < cols * rows; i++) {
    // Schwarz auf Weiß gerastert: Je dunkler die Zelle, desto mehr Form liegt
    // darin.
    const deckung = 1 - (gerastert.data[i * schritt] ?? 255) / 255;
    cells.push({ alpha: optionen.invertiert ? 1 - deckung : deckung });
  }
  return { cols, rows, cells };
}

export interface FotoZielOptionen {
  cols: number;
  rows: number;
  /** Seitenverhältnis der zu füllenden Fläche (Breite / Höhe). */
  areaAspect: number;
  /**
   * Wie stark die Farben zur Mitte gezogen werden, 0..1.
   *
   * Der Gedanke war: Ein Fotobuch hat kaum satte Farben, das Zielbild aber
   * schon — die Zuordnung sucht dann Rot, findet Backstein und trifft die
   * Vorlage überall gleich schlecht; die Farben des Ziels in den Bereich zu
   * holen, den der Bestand hergibt, sollte das Motiv lesbarer machen.
   *
   * **Am Bestand gemessen stimmt das nicht**, seit die Kacheln zur
   * Wunschfarbe hin eingefärbt werden (`MosaicSettings.tint`): Die Einfärbung
   * schließt die Lücke ohnehin, und die Entsättigung nimmt dann nur noch
   * Kontrast aus der Vorlage. Deshalb steht sie auf 0 und bleibt als Regler
   * für den Fall, dass ein sehr buntes Zielbild das Mosaik überzeichnet.
   */
  entsaettigung?: number;
}

/**
 * Zielraster aus einem Foto.
 *
 * `fit: 'cover'` und nicht `'contain'`: Das Motiv soll die Fläche füllen. Was
 * seitlich wegfällt, entscheidet die Bildmitte — wer das nicht will, gibt ein
 * anders beschnittenes Bild vor.
 */
export async function zielAusFoto(pfad: string, optionen: FotoZielOptionen): Promise<MosaicTarget> {
  const { cols, rows } = optionen;
  const anteil = Math.min(1, Math.max(0, optionen.entsaettigung ?? 0));
  const { breite, hoehe } = zwischenmasse(cols, rows, optionen.areaAspect);

  // Erst in Flächenform beschneiden, dann auf das Raster stauchen — aus
  // demselben Grund wie bei der Textvorlage, und aus demselben Grund in zwei
  // Durchläufen: sharp lässt je Pipeline nur ein `resize()` zu.
  const flaeche = await sharp(pfad)
    .flatten({ background: '#ffffff' })
    .resize({ width: breite, height: hoehe, fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const daten = await sharp(flaeche.data, {
    raw: {
      width: flaeche.info.width,
      height: flaeche.info.height,
      channels: flaeche.info.channels,
    },
  })
    .resize({ width: cols, height: rows, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Schrittweite aus der Ausgabe, wie oben bei der Textvorlage: Sie muss nicht
  // die des Eingangs sein.
  const schritt = daten.info.channels;
  const cells: MosaicCell[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const roh: Rgb = [
      daten.data[i * schritt] ?? 0,
      daten.data[i * schritt + 1] ?? 0,
      daten.data[i * schritt + 2] ?? 0,
    ];
    cells.push({ alpha: 1, color: entsaettige(roh, anteil) });
  }
  return { cols, rows, cells };
}

/** Zieht eine Farbe anteilig zu ihrem eigenen Grauwert. */
function entsaettige(rgb: Rgb, anteil: number): Rgb {
  if (anteil <= 0) return rgb;
  // Dieselben Leuchtdichtegewichte wie in `farbmatrix` (`core/model/adjust.ts`),
  // damit „Grau" im ganzen Projekt dasselbe heißt.
  const grau = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [
    Math.round(rgb[0] + (grau - rgb[0]) * anteil),
    Math.round(rgb[1] + (grau - rgb[1]) * anteil),
    Math.round(rgb[2] + (grau - rgb[2]) * anteil),
  ];
}

/**
 * Legt eine Form über eine Farbvorlage.
 *
 * Die Deckung kommt aus der ersten, die Farbe aus der zweiten — eine Ziffer,
 * die das Motiv eines Fotos trägt. Beide müssen dasselbe Raster haben;
 * andernfalls gewinnt die Form, denn sie entscheidet, wo überhaupt etwas steht.
 */
export function verbinde(form: MosaicTarget, farben: MosaicTarget): MosaicTarget {
  const cells = form.cells.map((zelle, i) => {
    const farbe =
      form.cols === farben.cols && form.rows === farben.rows ? farben.cells[i]?.color : undefined;
    return { alpha: zelle.alpha, ...(farbe ? { color: farbe } : {}) };
  });
  return { cols: form.cols, rows: form.rows, cells };
}
