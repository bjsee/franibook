/**
 * Das Mosaik: viele kleine Fotos, die zusammen ein Bild ergeben.
 *
 * Zwei Wünsche stehen dahinter, und dieses Modul behandelt sie als **einen**:
 * eine aus Bildern geformte „18", und ein vorgegebenes Foto, das aus
 * Miniaturen nachgebaut wird. Der gemeinsame Nenner ist das `MosaicTarget` —
 * ein grobes Raster, in dem jede Zelle zwei Dinge sagt: ob dort überhaupt eine
 * Kachel liegt (`alpha`) und welche Farbe sie haben sollte (`color`). Die
 * Ziffer setzt die Deckung und lässt die Farbe offen, das Zielfoto setzt die
 * Farbe und lässt die Deckung bei 1. Alles dazwischen ist damit ebenfalls
 * möglich, ohne dass es einen zweiten Mechanismus bräuchte — etwa eine Ziffer,
 * die zugleich das Motiv eines Fotos trägt.
 *
 * **Das Zielraster kommt von außen.** Der Kern hat keine Pixel und keine
 * Schrift zum Rastern (`.claude/rules/kern-rein.md`); ob eine Zelle in der
 * Ziffer liegt, entscheidet der Server (`apps/server/src/mosaik/`). Hier wird
 * daraus geplant, welches Foto wohin kommt — deterministisch, ohne I/O und
 * damit ohne eine einzige Bilddatei prüfbar.
 *
 * **Der Plan ist nicht das Bild.** `planMosaic` liefert Kachellagen in
 * normierten Koordinaten; das Zusammensetzen zu einer Bilddatei ist Adapterarbeit
 * (`apps/server/src/mosaik/backen.ts`). Das ist dieselbe Aufgabenteilung wie
 * zwischen RSM und den beiden Renderern, nur mit einem dritten Adapter — und
 * sie ist der Grund, warum die Kachelwahl hier mit Tests festgenagelt werden
 * kann, statt in einer sharp-Pipeline zu stecken.
 */
import type { Crop } from '../model/crop.js';
import type { Rgb } from '../model/farbe.js';
import type { PhotoId } from '../model/photo.js';

/**
 * Eine Zelle des Zielrasters.
 *
 * `alpha` ist absichtlich keine Ja-Nein-Frage: Eine gerasterte Ziffernkante
 * trifft Zellen halb, und eine harte Schwelle machte daraus eine Treppe. Statt
 * dessen schrumpft die Kachel — die Kante bekommt einen Saum aus kleineren
 * Bildern, was man an gebauten Mosaiken als gewollt liest. Wer eine harte Kante
 * will, liefert ein Raster ohne Zwischenwerte; dann fällt der Mechanismus von
 * selbst weg.
 */
export interface MosaicCell {
  /** Deckung, 0..1. Unter `minAlpha` bleibt die Zelle leer. */
  alpha: number;
  /**
   * Wunschfarbe der Zelle.
   *
   * Ohne Angabe ist die Farbe frei — dann entscheiden allein Streuung und
   * Wiederverwendung, welches Foto hier landet. Genau das ist der Fall der
   * bloßen Ziffernform.
   */
  color?: Rgb;
}

/**
 * Das Zielraster.
 *
 * `cells` steht zeilenweise von oben links, Länge `cols * rows`. Ein flaches
 * Feld und keine Zeilen von Zellen: Die Zuordnung läuft ohnehin einmal
 * hindurch, und ein zweistufiges Feld hätte bei jedem Zugriff die Frage
 * gestellt, ob Zeile oder Spalte zuerst kommt.
 */
export interface MosaicTarget {
  cols: number;
  rows: number;
  cells: readonly MosaicCell[];
}

/**
 * Was eine Kachel vom Foto zeigt.
 *
 * `ganz` schneidet das Foto auf Zellform, mit dem Fokuspunkt aus
 * `focalForCrop` — die Kachel bleibt ein erkennbares kleines Bild, Gesichter
 * werden nicht angeschnitten. Das ist der Reiz der Sache: Wer nah herantritt,
 * soll die einzelnen Aufnahmen wiedererkennen.
 *
 * `feld` schneidet statt dessen um dasjenige der neun Felder von `PhotoTone`,
 * das der Wunschfarbe am nächsten kommt. Das trifft die Vorlage deutlich
 * genauer — ein Bild mit hellem Himmel und dunklem Wald taugt damit für zwei
 * verschiedene Zellen —, zeigt aber Ausschnitte statt Bilder. Für ein
 * Fotomosaik, das aus zwei Metern Abstand gelesen werden soll, ist das die
 * bessere Wahl.
 */
export type MosaicCropMode = 'ganz' | 'feld';

export interface MosaicSettings {
  /**
   * Seed, dieselbe Rolle wie `settings.seed` im Buch: Variation ohne
   * Zufallszahlen. Er steuert die Reihenfolge, in der die Zellen belegt werden.
   */
  seed: number;
  crop: MosaicCropMode;
  /**
   * Fugenbreite als Anteil der Zellkante, 0..0,5.
   *
   * Ohne Fuge stoßen die Kacheln aneinander und das Mosaik liest sich aus der
   * Nähe wie ein einziges wirres Bild; eine schmale Fuge lässt jede Aufnahme
   * für sich stehen. Aus der Ferne verschwindet sie ohnehin.
   */
  gap: number;
  /** Kacheln unter dieser Deckung bleiben leer. */
  minAlpha: number;
  /**
   * Zuschlag je bereits gesetzter Kachel desselben Fotos, in Lab-Einheiten.
   *
   * Ohne ihn gewinnt für jede Zelle einer Farbfläche dasselbe Foto, und eine
   * blaue Himmelspartie besteht aus vierzig Abzügen desselben Bildes. Mit ihm
   * weicht die Auswahl nach und nach auf die nächstbesten aus. Der Wert ist in
   * derselben Einheit wie der Farbabstand — 2 heißt also: die zweite
   * Verwendung muss um zwei Lab-Einheiten besser passen als ein noch
   * ungenutztes Foto.
   */
  reuseCost: number;
  /**
   * Mindestabstand zwischen zwei Abzügen desselben Fotos, in Zellen.
   *
   * Der Zuschlag oben zählt nur, wie oft ein Foto vorkommt — nicht, ob die
   * Wiederholungen nebeneinander liegen. Zwei gleiche Kacheln als direkte
   * Nachbarn fallen aber sofort auf, während dieselben zwei quer über die
   * Fläche verteilt niemand bemerkt.
   *
   * **Eine Sperre und kein weiterer Zuschlag**, und das ist der zweite Anlauf:
   * Als Zuschlag musste er gegen den Farbabstand aufgewogen werden, und beide
   * Skalen ließen sich nicht gleichzeitig richtig einstellen — hoch genug für
   * die Streuung überstimmte er die Farbwahl und machte aus einem Porträt ein
   * Rauschen, niedrig genug für die Farbe ließ er gleiche Kacheln
   * aneinanderstoßen. Als Sperre schränkt er nur die Auswahl ein: Unter den
   * verbleibenden Kandidaten entscheidet weiterhin allein die Farbe.
   *
   * Bleibt kein Kandidat übrig — zu wenige Fotos für zu viele Kacheln —, wird
   * die Sperre für diese Zelle aufgehoben. Eine Lücke wäre die schlechtere
   * Antwort als eine sichtbare Wiederholung.
   */
  spreadRadius: number;
  /**
   * Wie weit die Kachel zur Wunschfarbe hin eingefärbt wird, 0..1.
   *
   * **Ohne das trägt kein Fotomosaik.** Ein Familienbestand hat kein sattes
   * Rot und kein tiefes Blau; wo die Vorlage eines verlangt, findet die
   * Auswahl bestenfalls Backstein — und zwar an jeder roten Stelle denselben
   * ungefähren Ton. Das Motiv bleibt dann unlesbar, gleich wie fein das Raster
   * ist. Eine leichte Einfärbung schließt genau diese Lücke: Sie verschiebt
   * jede Kachel um den Rest, den der Bestand nicht hergibt.
   *
   * Am echten Bestand gemessen, 48×48-Raster über ein Kinderporträt: ohne
   * Einfärbung war das Gesicht nicht zu erkennen, bei 0,35 erschien es,
   * bei 0,55 war es klar lesbar und die einzelnen Aufnahmen blieben als Fotos
   * kenntlich. Darüber wird es ein eingefärbtes Raster. Wirkt nur, wo eine
   * Zelle überhaupt eine Wunschfarbe hat — bei der bloßen Ziffernform also gar
   * nicht.
   */
  tint: number;
}

/**
 * Vorgaben, am echten Bestand (971 Fotos) eingestellt.
 *
 * `reuseCost: 1` klingt klein, ist es aber nicht: Innerhalb einer Farbfläche
 * liegen die Kandidaten oft nur Bruchteile einer Lab-Einheit auseinander, der
 * Zuschlag schiebt die Auswahl also schon beim zweiten Mal weiter. Höher
 * angesetzt verteilt er zwar gleichmäßiger, trifft aber die Vorlage schlechter
 * — und das sieht man dem Mosaik eher an als eine ungleiche Nutzung.
 *
 * `spreadRadius: 3` heißt: Zwischen zwei Abzügen desselben Fotos liegen
 * mindestens drei Zellen. Bei einem 48er-Raster ist das ein Sechzehntel der
 * Bildbreite — nah genug beieinander fällt eine Wiederholung auf, darüber
 * hinaus sucht sie niemand.
 */
export const DEFAULT_MOSAIC_SETTINGS: MosaicSettings = {
  seed: 1,
  crop: 'ganz',
  gap: 0.06,
  minAlpha: 0.15,
  reuseCost: 1,
  spreadRadius: 3,
  tint: 0.5,
};

/** Eine gesetzte Kachel. */
export interface MosaicTile {
  /** Lage im Raster, 0-basiert von oben links. */
  col: number;
  row: number;
  photoId: PhotoId;
  /** Ausschnitt des Fotos, schon in der Form der Kachel. */
  crop: Crop;
  /**
   * Lage im Bildbereich, normiert auf 0..1, Ursprung oben links.
   *
   * Fugen und die Verkleinerung an weichen Kanten sind darin schon verrechnet —
   * wer das Mosaik zusammensetzt, skaliert diese vier Zahlen auf seine
   * Pixelmaße und zeichnet, ohne eine Entscheidung zu treffen. Dieselbe
   * Arbeitsteilung wie zwischen RSM und Renderer.
   */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Einfärbung zur Wunschfarbe hin, sofern die Zelle eine hatte.
   *
   * Steht hier und wird nicht vom Backvorgang aus `settings.tint` abgeleitet:
   * Der Kern entscheidet, der Adapter zeichnet — dieselbe Aufgabenteilung wie
   * bei `ImageBox.colorMatrix`, wo aus „Kontrast +30" ebenfalls vorher eine
   * fertige Abbildung wird. Und sie geht damit in `mosaicFingerprint` ein, so
   * dass eine geänderte Einfärbung ein neues Bild backen lässt.
   */
  tint?: { color: Rgb; amount: number };
}

export type MosaicWarning =
  /** Kein einziges Foto hat Farbwerte — der Bestand ist noch nicht nachgezogen. */
  | { code: 'keine-fotos' }
  /** Weniger Fotos als Kacheln: Wiederholungen sind unvermeidlich. */
  | { code: 'wiederholung-noetig'; fotos: number; kacheln: number }
  /** So viele Fotos des Bestands blieben ohne Farbwerte und damit außen vor. */
  | { code: 'ohne-farbwerte'; anzahl: number }
  /** Das Zielraster passt nicht zu seinen Maßangaben. */
  | { code: 'raster-unstimmig'; erwartet: number; vorhanden: number };

export interface MosaicPlan {
  cols: number;
  rows: number;
  /** Seitenverhältnis einer Zelle (Breite/Höhe). Alle Zellen sind gleich groß. */
  cellAspect: number;
  tiles: MosaicTile[];
  /** Wie oft welches Foto vorkommt, absteigend — Auskunft für die Oberfläche. */
  usage: { photoId: PhotoId; count: number }[];
  /**
   * Wie viele Fotos überhaupt zur Wahl standen, also Farbwerte haben.
   *
   * Erst im Verhältnis dazu bedeutet `usage.length` etwas: „674 von 971" ist
   * eine Aussage über die Vielfalt, „674" allein ist eine Zahl. Die Oberfläche
   * beschriftet damit den Regler, der die Vielfalt stellt — er hätte sonst nur
   * seinen eigenen, bedeutungslosen Zahlenwert anzuzeigen.
   */
  candidates: number;
  warnings: MosaicWarning[];
}

/** Befund als deutscher Satz, wie bei `coverWarningText` für die Oberfläche. */
export function mosaicWarningText(w: MosaicWarning): string {
  switch (w.code) {
    case 'keine-fotos':
      return 'Kein Foto des Bestands hat Farbwerte – das Mosaik bleibt leer. Die Werte entstehen beim Import und werden im Hintergrund nachgezogen.';
    case 'wiederholung-noetig':
      return `${w.kacheln} Kacheln auf ${w.fotos} Fotos – jedes Bild kommt im Schnitt ${(w.kacheln / Math.max(1, w.fotos)).toFixed(1)}-mal vor.`;
    case 'ohne-farbwerte':
      return `${w.anzahl} Fotos haben noch keine Farbwerte und bleiben außen vor.`;
    case 'raster-unstimmig':
      return `Das Zielraster nennt ${w.erwartet} Zellen, mitgeliefert wurden ${w.vorhanden}.`;
  }
}

/** Zelle an einer Rasterstelle, oder `undefined` außerhalb. */
export function cellAt(target: MosaicTarget, col: number, row: number): MosaicCell | undefined {
  if (col < 0 || row < 0 || col >= target.cols || row >= target.rows) return undefined;
  return target.cells[row * target.cols + col];
}

/**
 * Ein Zielraster ohne Vorlage: überall Kachel, Farbe frei.
 *
 * Die einfachste sinnvolle Eingabe und damit der Ausgangspunkt zum Ausprobieren —
 * ein gleichmäßiges Feld aus Bildern, ohne Ziffer und ohne Vorlage.
 */
export function vollesRaster(cols: number, rows: number): MosaicTarget {
  return {
    cols,
    rows,
    cells: Array.from({ length: cols * rows }, () => ({ alpha: 1 })),
  };
}
