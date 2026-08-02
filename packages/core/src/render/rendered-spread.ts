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

export type RenderBox = ImageBox | TextBox | RectBox | EmptyBox;

export type RenderWarning =
  | { code: 'below-target-dpi'; dpi: number; targetDpi: number }
  | { code: 'below-min-dpi'; dpi: number; minDpi: number }
  | { code: 'crosses-gutter' }
  | { code: 'outside-safety' }
  | { code: 'photo-missing'; photoId: PhotoId };

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
