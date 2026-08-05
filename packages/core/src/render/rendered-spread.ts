/**
 * Rendered Spread Model (RSM).
 *
 * Das Bindeglied zwischen Layout-Engine und den beiden Renderern. Die Engine
 * erzeugt weder HTML noch PDF, sondern diese Liste absolut in Millimetern
 * positionierter Boxen. Vorschau und PDF-Export sind zwei dünne Adapter
 * darüber.
 *
 * Dadurch ist die Übereinstimmung von Bildschirm und Druck strukturell
 * erzwungen: Was in der Vorschau anders aussieht als im PDF, ist per
 * Konstruktion ein Fehler in einem der beiden Adapter – nicht das Ergebnis
 * zweier unabhängiger Layoutrechnungen, die auseinanderdriften.
 *
 * Ursprung ist die obere linke Ecke der **Beschnittfläche**, nicht des
 * Endformats. Alle Boxen liegen damit im positiven Bereich, auch wenn sie
 * randabfallend sind.
 */
import type { Crop } from '../model/crop.js';
import type { PhotoId } from '../model/photo.js';
import type { FrameId } from './frame.js';
import type { FontFamilyId, FontWeight } from './typography.js';

export interface Rect {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface ImageBox extends Rect {
  kind: 'image';
  slotId: string;
  photoId: PhotoId;
  crop: Crop;
  /** Auflösung, mit der dieser Bildbereich tatsächlich gedruckt wird. */
  effectiveDpi: number;
  /**
   * Neigung in Grad im Uhrzeigersinn, um den Mittelpunkt der Box. Ohne Angabe:
   * waagerecht.
   *
   * Gedreht wird der Kasten samt Inhalt, nicht das Foto im Kasten – der
   * Ausschnitt bleibt davon unberührt. Drehpunkt ist die Mitte und nicht die
   * obere linke Ecke, weil beide Renderer denselben Punkt treffen müssen: Bei
   * der Mitte genügt dafür in DOM und PDF je eine Transformation, bei der Ecke
   * wären es Verschiebung plus Drehung – zwei Gelegenheiten für einen
   * Vorzeichenfehler. Dieselbe Festlegung gilt für den Rückentext des
   * Umschlags (`cover/rendered-cover.ts`).
   */
  rotateDeg?: number;
  /**
   * Drehpunkt, falls nicht die Mitte dieser Box.
   *
   * Gebraucht, sobald das Bild in einem Rahmen steht: Der Polaroidkarton hat
   * unten einen breiteren Rand, seine Mitte ist also nicht die des Bildes.
   * Drehte jede Box um ihre eigene, rutschte das Bild im Karton, je stärker es
   * geneigt ist. Alle Boxen eines Rahmens tragen deshalb denselben Punkt – die
   * Mitte des Außenkastens. Dieselbe Festlegung wie bei mehrzeiligem Text.
   */
  rotateAboutMm?: { xMm: number; yMm: number };
  /**
   * Ob Position und Größe von Hand gesetzt sind statt aus der Vorlage zu
   * kommen.
   *
   * Keine Geometrie, sondern Herkunft – wie `warnings`. Der Editor zeigt daran,
   * ob „Ins Raster" etwas zurückzunehmen hat; die Renderer sehen es nie an.
   */
  manualRect?: true;
  /**
   * Der Rahmen, in dem dieses Bild steht. Ohne Angabe: keiner.
   *
   * Wie `manualRect` keine Geometrie, sondern Herkunft: Die Boxen des Rahmens
   * stehen längst als eigene Einträge in der Liste, und kein Renderer sieht
   * dieses Feld an. Der Editor braucht es, weil dem RSM sonst nicht anzusehen
   * wäre, welcher der vier Rahmen gerade wirkt – die Kartonfläche allein sagt
   * es nicht.
   */
  frame?: FrameId;
  /**
   * Ob der Rahmen an diesem Bild gesetzt ist statt aus der Buchvorgabe zu
   * kommen. Dieselbe Unterscheidung wie `undefined` gegen `0` bei der Neigung.
   */
  manualFrame?: true;
  /**
   * Die gespeicherte Bildunterschrift – auch wenn sie gerade nicht zu sehen ist.
   *
   * Gezeichnet wird sie als eigene `TextBox` im Fuß des Rahmens; dass der Text
   * hier ein zweites Mal steht, ist bewusst und keine zweite Wahrheit: Die
   * TextBox gibt es nur, solange ein Rahmen mit Fuß gewählt ist, das Feld hier
   * dagegen immer. Sonst stünde im Editor ein leeres Eingabefeld, obwohl ein
   * Satz gespeichert ist – und wer den Rahmen wechselt, hielte seine Notiz für
   * gelöscht. Wie `frame` und `manualRect` sehen die Renderer es nie an.
   */
  caption?: string;
  warnings: RenderWarning[];
}

export interface TextBox extends Rect {
  kind: 'text';
  slotId: string;
  content: string;
  fontSizePt: number;
  /** Schnitt. Kein Renderer wählt ihn selbst. */
  weight: FontWeight;
  /**
   * Schriftfamilie. Ohne Angabe die Buchschrift.
   *
   * Alles, was die Engine selbst setzt, steht in `sans`; die übrigen Familien
   * kommen nur aus von Hand gesetzten Textblöcken. Der PDF-Renderer bettet
   * ausschließlich ein, was auf den ausgegebenen Seiten wirklich vorkommt.
   */
  family?: FontFamilyId;
  align: 'left' | 'center' | 'right';
  color: string;
  /**
   * Sperrung: zusätzlicher Abstand nach jedem Zeichen, in Millimetern.
   *
   * In Millimetern und nicht in Em, weil das ganze Modell in Millimetern rechnet
   * und beide Adapter dieselbe Zahl treffen müssen – pdfkit erwartet Punkt, das
   * SVG Benutzereinheiten, und die Umrechnung gehört in den Adapter.
   *
   * Beide fügen den Abstand **nach jedem** Zeichen ein, auch nach dem letzten.
   * Bei zentriertem Text steht der Satz dadurch um eine halbe Sperrung zu weit
   * links. Ausgeglichen wird das dort, wo die Sperrung gesetzt wird – in der
   * Box selbst –, nicht in den Adaptern: Beide zeichnen weiterhin nur nach, was
   * im Modell steht, und können deshalb gar nicht auseinanderlaufen.
   */
  letterSpacingMm?: number;
  /** Drehung in Grad im Uhrzeigersinn. Ohne Angabe waagerecht. */
  rotateDeg?: number;
  /**
   * Drehpunkt, falls nicht die Mitte dieser Box.
   *
   * Ein mehrzeiliger Text steht als eine Box je Zeile im Modell – der
   * Zeilenabstand ist Geometrie und darf keinem Renderer überlassen bleiben.
   * Gedreht werden muss er trotzdem als ein Block: Um die je eigene Mitte
   * gedreht, fächerten die Zeilen auseinander. Deshalb tragen alle Zeilen
   * denselben Punkt.
   */
  rotateAboutMm?: { xMm: number; yMm: number };
}

export interface RectBox extends Rect {
  kind: 'rect';
  /** Füllfarbe. `'none'` lässt die Fläche frei – nur die Kontur wird gezeichnet. */
  fill: string;
  /**
   * Konturfarbe. Ohne Angabe wird keine gezeichnet.
   *
   * Der Strich liegt **mittig auf der Kante**, je zur Hälfte innen und außen –
   * so zeichnet pdfkit einen Pfad, und die Vorschau muss sich danach richten.
   * Das ist keine Beliebigkeit, sondern die einzige Festlegung, die beide
   * Adapter ohne Umrechnung treffen können: CSS-`border` läge innen,
   * `outline` außen, und schon wäre die Bildkontur im PDF um eine halbe
   * Strichstärke enger als in der Vorschau.
   */
  stroke?: string;
  /** Strichstärke in Millimetern. Ohne Kontur bedeutungslos. */
  strokeWidthMm?: number;
  /**
   * Deckkraft von 0 bis 1. Ohne Angabe deckend.
   *
   * Eingeführt für den Versatzschatten des Polaroids und den Klebestreifen:
   * Beide liegen über Fotos, und eine deckende Fläche wäre dort ein Fleck. Als
   * eigenes Feld und nicht als `rgba()` in `fill`, weil pdfkit Farben nur als
   * Hex oder Kanalarray nimmt und die Deckkraft getrennt im Grafikzustand führt
   * (`fillOpacity`). Ein Adapter müsste den Farbstring sonst zerlegen.
   */
  opacity?: number;
  /** Drehung in Grad im Uhrzeigersinn. Ohne Angabe waagerecht. */
  rotateDeg?: number;
  /**
   * Drehpunkt, falls nicht die Mitte dieser Box. Siehe `ImageBox.rotateAboutMm`:
   * Karton, Schatten und Bild eines Rahmens fahren um denselben Punkt.
   */
  rotateAboutMm?: { xMm: number; yMm: number };
  /**
   * Eckenradius in Millimetern. Ohne Angabe scharfe Ecken.
   *
   * Eingeführt für den Spannbalken des Zeitstrahls: Ein Balken mit runden Enden
   * und einer Perle am Median liest sich als eine Form, ein Rechteck mit
   * aufgesetztem Dreieck als zwei. Ein Radius von der halben Höhe ergibt die
   * Kapsel, einer von der halben Kantenlänge bei quadratischer Box den Kreis –
   * eine eigene Boxart für Kreise wäre eine zweite Wahrheit über dieselbe
   * Geometrie.
   */
  rxMm?: number;
}

/** Ein leerer Slot. Wird nur in der Vorschau dargestellt, nie im PDF. */
export interface EmptyBox extends Rect {
  kind: 'empty';
  slotId: string;
}

/**
 * Fläche aus Eckpunkten, absolut in Millimetern.
 *
 * Eingeführt für die Markerspitze des Zeitstrahls – die einzige Form im Buch,
 * die kein Rechteck ist. Bewusst ohne umschließendes Rechteck: Zwei Wahrheiten
 * über dieselbe Geometrie laufen auseinander, und keine Stelle im System
 * braucht die Hülle. Die Renderer zeichnen die Punkte unmittelbar.
 *
 * Verworfen wurde eine semantische `TimelineBox`, aus der jeder Renderer den
 * Zeitstrahl selbst zeichnet: Das wären genau die zwei unabhängigen
 * Zeichenroutinen, die der Parity-Test verhindern soll.
 */
export interface PolygonBox {
  kind: 'polygon';
  pointsMm: readonly { xMm: number; yMm: number }[];
  fill: string;
  /** Deckkraft von 0 bis 1. Ohne Angabe deckend – siehe `RectBox.opacity`. */
  opacity?: number;
}

export type RenderBox = ImageBox | TextBox | RectBox | EmptyBox | PolygonBox;

export type RenderWarning =
  | { code: 'below-target-dpi'; dpi: number; targetDpi: number }
  | { code: 'below-min-dpi'; dpi: number; minDpi: number }
  | { code: 'crosses-gutter' }
  | { code: 'outside-safety' }
  | { code: 'photo-missing'; photoId: PhotoId }
  /**
   * Hintergrundbild mit zu geringer Auflösung.
   *
   * Eigener Code und eigene Schwelle: Ein Hintergrund darf weicher sein als ein
   * Motiv (siehe `render/background.ts`), aber irgendwann ist auch er sichtbar
   * unscharf.
   */
  | { code: 'background-low-dpi'; dpi: number; recommendedDpi: number }
  /**
   * Bild und Platz stehen quer zueinander – ein Hochformat in einem
   * Querformatplatz oder umgekehrt.
   *
   * Keine Aussage über die Auflösung, sondern über die Form: Der Ausschnitt hat
   * immer die Form des Platzes, also bleibt von einem quer stehenden Bild nur
   * ein Streifen übrig (`sichtbar`, Anteil der Bildfläche). Am häufigsten nach
   * einer Ausrichtungskorrektur – das Bild kippt, sein Platz nicht, und der
   * Zoom sitzt danach am Anschlag, ohne zu sagen warum.
   *
   * Die Engine bewertet dasselbe beim Anordnen als `orientationClash`
   * (`layout/scoring.ts`); dort ist es ein Kostenzuschlag, hier eine Auskunft.
   */
  | { code: 'orientation-mismatch'; sichtbar: number };

/** Hilfslinien. Ausschließlich für die Vorschau – nie Teil des PDFs. */
export interface Guide {
  kind: 'trim' | 'safety' | 'gutter' | 'gutter-zone' | 'bleed';
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface RenderedSpread {
  spreadId: string;
  /** 2 × Endformatbreite + 2 × Beschnitt. */
  widthMm: number;
  /** Endformathöhe + 2 × Beschnitt. */
  heightMm: number;
  bleedMm: number;
  /** Lage der Falzachse, von der linken Beschnittkante aus gemessen. */
  gutterXMm: number;
  background: string;
  boxes: RenderBox[];
  guides: Guide[];
}

/** Alle Bildboxen eines Spreads. */
export function imageBoxes(spread: RenderedSpread): ImageBox[] {
  return spread.boxes.filter((b): b is ImageBox => b.kind === 'image');
}

/** Sammelt alle Warnungen eines Spreads mit ihrer Box. */
export function collectWarnings(
  spread: RenderedSpread,
): { box: ImageBox; warning: RenderWarning }[] {
  return imageBoxes(spread).flatMap((box) => box.warnings.map((warning) => ({ box, warning })));
}
