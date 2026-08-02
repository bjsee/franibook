/**
 * Bildausschnitt.
 *
 * Gespeichert wird das **sichtbare Rechteck** in normierten Bildkoordinaten
 * (0..1, bezogen auf das orientierungskorrigierte Bild) – nicht Zoom und
 * Versatz. Zwei Gründe:
 *
 *  - Der Ausschnitt ist unabhängig von den Slotmaßen definiert. Ändert sich
 *    der Slot, bleibt ein manuell gesetzter Ausschnitt gültig.
 *  - Der PDF-Renderer kann genau diesen Bereich extrahieren, ohne
 *    zurückzurechnen. Die Vorschau skaliert dasselbe Rechteck auf ihren
 *    Container. Beide interpretieren dieselbe Zahl, statt zwei Wege zum
 *    selben Ziel zu nehmen – das ist die Voraussetzung dafür, dass sie nicht
 *    auseinanderlaufen.
 */

export interface Crop {
  /** Linke Kante des sichtbaren Bereichs, 0..1. */
  x: number;
  /** Obere Kante, 0..1. */
  y: number;
  /** Breite des sichtbaren Bereichs, 0..1. */
  w: number;
  /** Höhe, 0..1. */
  h: number;
  /**
   * `auto-cover` wird neu berechnet, sobald sich der Slot ändert.
   * `manual` bleibt unangetastet.
   */
  mode: 'auto-cover' | 'manual';
  /**
   * Punkt, um den `auto-cover` zentriert. Ohne Angabe die Bildmitte.
   *
   * Dies ist die vorgesehene Andockstelle für spätere Bildanalyse: Eine
   * Gesichts- oder Saliency-Erkennung muss nur diesen Punkt liefern, am Rest
   * der Engine ändert sich nichts.
   */
  focal?: { x: number; y: number };
}

/** Der volle, unbeschnittene Bildbereich. */
export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Größtmöglicher Ausschnitt im Seitenverhältnis des Slots, zentriert um den
 * Fokuspunkt und an den Bildrand geklemmt.
 *
 * @param photoAspect Seitenverhältnis des Bildes (Breite / Höhe)
 * @param slotAspect  Seitenverhältnis des Slots
 */
export function coverCrop(
  photoAspect: number,
  slotAspect: number,
  focal: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Crop {
  if (!Number.isFinite(photoAspect) || photoAspect <= 0) return { ...FULL_CROP };
  if (!Number.isFinite(slotAspect) || slotAspect <= 0) return { ...FULL_CROP };

  let w: number;
  let h: number;

  if (photoAspect > slotAspect) {
    // Bild ist breiter als der Slot: volle Höhe nutzen, seitlich beschneiden
    h = 1;
    w = slotAspect / photoAspect;
  } else {
    // Bild ist höher: volle Breite nutzen, oben und unten beschneiden
    w = 1;
    h = photoAspect / slotAspect;
  }

  return {
    x: clamp(focal.x - w / 2, 0, 1 - w),
    y: clamp(focal.y - h / 2, 0, 1 - h),
    w,
    h,
    mode: 'auto-cover',
    ...(focal.x !== 0.5 || focal.y !== 0.5 ? { focal } : {}),
  };
}

/** Anteil der Bildfläche, der durch den Ausschnitt verlorengeht. 0 = nichts. */
export function cropLoss(crop: Crop): number {
  return 1 - crop.w * crop.h;
}

/**
 * Ausschnitt in Pixelkoordinaten des orientierungskorrigierten Bildes.
 *
 * Gerundet und an die Bildgrenzen geklemmt, damit `sharp.extract()` niemals
 * über den Rand hinausgreift – ein Fehler dort bricht den gesamten Export ab.
 */
export function cropToPixels(
  crop: Crop,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(crop.x * imageWidth), 0, Math.max(0, imageWidth - 1));
  const top = clamp(Math.round(crop.y * imageHeight), 0, Math.max(0, imageHeight - 1));
  const width = clamp(Math.round(crop.w * imageWidth), 1, imageWidth - left);
  const height = clamp(Math.round(crop.h * imageHeight), 1, imageHeight - top);
  return { left, top, width, height };
}

/**
 * Verschiebt den Ausschnitt innerhalb des Bildes, ohne seine Größe zu ändern.
 * Für den Crop-Editor: Ziehen bewegt den sichtbaren Bereich.
 */
export function panCrop(crop: Crop, dx: number, dy: number): Crop {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.w),
    y: clamp(crop.y + dy, 0, 1 - crop.h),
    mode: 'manual',
  };
}
