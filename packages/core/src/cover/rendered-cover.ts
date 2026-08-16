/**
 * Rendered Cover Model (RCM).
 *
 * Dasselbe Prinzip wie beim Innenteil: Die Engine erzeugt weder HTML noch PDF,
 * sondern eine Liste absolut in Millimetern positionierter Boxen. Vorschau und
 * PDF-Export sind zwei dünne Adapter darüber, und keiner von beiden trifft eine
 * Layoutentscheidung.
 *
 * Die Boxtypen sind absichtlich die des RSM (`render/rendered-spread.ts`) –
 * derselbe `ImageBox`, dasselbe `crop`-Feld, dieselbe Auflösungsangabe. Ein
 * zweites Boxmodell hätte bedeutet, die Ausschnitts- und dpi-Rechnung ein
 * zweites Mal zu schreiben, und genau das ist die Fehlerklasse, die der
 * Parity-Test beim Innenteil aufdeckt.
 *
 * Ergänzt ist nur, was der Umschlag mehr braucht als eine Doppelseite: eine
 * Drehung für den Rückentext und Befunde, die es im Innenteil nicht gibt
 * (Gelenkzone, zu schmaler Rücken, unverifiziertes Profil).
 */
import type { PhotoId } from '../model/photo.js';
import type { EmptyBox, ImageBox, Rect, RectBox, TextBox } from '../render/rendered-spread.js';
import type { CoverGeometry, CoverPanelKind } from './geometry.js';

/**
 * Textbox mit Drehung um ihren eigenen Mittelpunkt.
 *
 * Nur der Rückentext braucht sie. Drehpunkt ist die Mitte und nicht die obere
 * linke Ecke, weil beide Renderer denselben Punkt treffen müssen: Bei der Mitte
 * genügt dafür in DOM und PDF je eine Transformation, bei der Ecke wären es
 * Verschiebung plus Drehung – zwei Gelegenheiten für einen Vorzeichenfehler.
 */
export interface CoverTextBox extends TextBox {
  /** Grad im Uhrzeigersinn. Ohne Angabe: waagerecht. */
  rotateDeg?: number;
}

export type CoverBox = ImageBox | CoverTextBox | RectBox | EmptyBox;

/** Hilfslinien der Coveransicht. Nie Teil des PDFs. */
export interface CoverGuide extends Rect {
  kind: 'bleed' | 'wrap' | 'safety' | 'hinge' | 'spine' | 'fold';
  /** Feld, auf das sich die Linie bezieht, sofern eindeutig. */
  panel?: CoverPanelKind;
}

export type CoverWarning =
  | { code: 'below-target-dpi'; slotId: string; dpi: number; targetDpi: number }
  | { code: 'below-min-dpi'; slotId: string; dpi: number; minDpi: number }
  | { code: 'photo-missing'; slotId: string; photoId: PhotoId }
  | { code: 'in-hinge'; slotId: string }
  | { code: 'outside-safety'; slotId: string; panel: CoverPanelKind }
  | { code: 'spine-too-narrow-for-text'; spineMm: number; requiredMm: number }
  | { code: 'spine-text-clipped'; requestedMm: number; availableMm: number }
  | { code: 'profile-unverified'; source: string };

export interface RenderedCover {
  /** Feste Kennung; es gibt genau ein Cover je Buch. */
  coverId: 'cover';
  /** Gesamtbreite des Bogens, identisch mit `geometry.widthMm`. */
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  geometry: CoverGeometry;
  background: string;
  boxes: CoverBox[];
  guides: CoverGuide[];
  warnings: CoverWarning[];
}

/** Alle Bildboxen des Covers. */
export function coverImageBoxes(cover: RenderedCover): ImageBox[] {
  return cover.boxes.filter((b): b is ImageBox => b.kind === 'image');
}

/** Ob ein Befund den Druck verhindern sollte. */
export function isBlocking(warning: CoverWarning): boolean {
  return warning.code === 'below-min-dpi' || warning.code === 'photo-missing';
}

/**
 * Befund als deutscher Satz.
 *
 * Steht hier und nicht in der Oberfläche, damit Weboberfläche und
 * Exportbericht denselben Wortlaut zeigen – sonst beschreiben zwei Texte
 * dieselbe Ursache verschieden, und der Benutzer sucht zwei Fehler.
 */
export function coverWarningText(w: CoverWarning): string {
  switch (w.code) {
    case 'below-target-dpi':
      return `${w.slotId}: ${Math.round(w.dpi)} dpi, Zielauflösung ${w.targetDpi} dpi`;
    case 'below-min-dpi':
      return `${w.slotId}: nur ${Math.round(w.dpi)} dpi – unter der Mindestauflösung von ${w.minDpi} dpi`;
    case 'photo-missing':
      return `${w.slotId}: Bild ${w.photoId} nicht im Bestand`;
    case 'in-hinge':
      return `${w.slotId} ragt in die Gelenkzone – dort verschwindet bei der Bindung Fläche`;
    case 'outside-safety':
      return `${w.slotId} liegt außerhalb des Sicherheitsbereichs von ${w.panel}`;
    case 'spine-too-narrow-for-text':
      return (
        `Der Rücken ist mit ${w.spineMm.toFixed(1)} mm zu schmal für Text ` +
        `(nötig wären ${w.requiredMm.toFixed(1)} mm) – der Rückentext bleibt weg`
      );
    case 'spine-text-clipped':
      return (
        `Die gesetzte Schriftgröße des Rückentitels bräuchte ${w.requestedMm.toFixed(1)} mm ` +
        `Rückenbreite – gesetzt wird auf ${w.availableMm.toFixed(1)} mm`
      );
    case 'profile-unverified':
      return (
        'Die Covermaße stammen aus einem unverifizierten Druckprofil ' +
        `(${w.source}). Vor dem Druckauftrag gegen die Vorlage des Anbieters prüfen.`
      );
  }
}
