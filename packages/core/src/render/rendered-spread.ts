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
import type { FontWeight } from './typography.js';

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
  warnings: RenderWarning[];
}

export interface TextBox extends Rect {
  kind: 'text';
  slotId: string;
  content: string;
  fontSizePt: number;
  /** Schnitt der Buchschrift. Kein Renderer wählt ihn selbst. */
  weight: FontWeight;
  align: 'left' | 'center' | 'right';
  color: string;
}

export interface RectBox extends Rect {
  kind: 'rect';
  fill: string;
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
  | { code: 'background-low-dpi'; dpi: number; recommendedDpi: number };

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
