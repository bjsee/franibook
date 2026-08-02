/**
 * Einheitenumrechnung.
 *
 * Millimeter sind die einzige Längeneinheit des Domänenmodells. Punkte werden
 * ausschließlich an der PDF-Grenze gebraucht, Pixel ausschließlich an der
 * Bildschirm- und Bildgrenze. Alle drei Umrechnungen leben hier, damit ein
 * Rundungs- oder Faktorfehler genau eine Fundstelle hat.
 */

/** Ein Zoll in Millimetern. */
export const MM_PER_INCH = 25.4;

/** PostScript-Punkte pro Zoll. In PDF per Definition exakt 72. */
export const PT_PER_INCH = 72;

/** Millimeter → PDF-Punkte. */
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

/** PDF-Punkte → Millimeter. */
export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

/**
 * Millimeter → Pixel bei gegebener Auflösung.
 *
 * Wird sowohl für die Bildschirmvorschau (dpi = Skalierungsfaktor der Ansicht)
 * als auch für die Zielgröße der Bilder im PDF-Export verwendet.
 */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

/** Pixel → Millimeter bei gegebener Auflösung. */
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}

/**
 * Effektive Auflösung, mit der ein Bildbereich gedruckt wird.
 *
 * `visiblePx` ist die Zahl der tatsächlich verwendeten Bildpixel in einer
 * Achse – also nach Abzug des Beschnitts, nicht die volle Bildbreite. Genau
 * diese Unterscheidung entscheidet über die Druckqualität: ein 24-Megapixel-Foto
 * kann nach einem starken Ausschnitt unter der Mindestauflösung liegen.
 */
export function effectiveDpi(visiblePx: number, targetMm: number): number {
  if (targetMm <= 0) return Infinity;
  return visiblePx / (targetMm / MM_PER_INCH);
}

/**
 * Zielgröße in Pixeln, auf die ein Bildausschnitt für den Druck skaliert wird.
 *
 * Aufgerundet, damit nie unterhalb der Zielauflösung gelandet wird.
 */
export function targetPx(targetMm: number, dpi: number): number {
  return Math.ceil(mmToPx(targetMm, dpi));
}
