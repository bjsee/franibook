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

/**
 * Passt einen Ausschnitt an ein neues Seitenverhältnis des Kastens an.
 *
 * Gebraucht, weil beide Renderer den Ausschnitt auf den Kasten **abbilden**:
 * Stimmen die Seitenverhältnisse nicht überein, wird das Bild gestaucht. Bei
 * `auto-cover` fällt das nicht auf, weil der Ausschnitt für die aktuellen
 * Kastenmaße ohnehin neu gerechnet wird; ein von Hand gesetzter blieb dagegen
 * unangetastet – und sah nach einem Vorlagenwechsel verzerrt aus. Seit man den
 * Kasten am Griff frei aufziehen kann, wäre das der Normalfall statt der
 * Ausnahme.
 *
 * **Die Fläche bleibt gleich.** Das ist die Wahl, die diese Funktion trifft:
 * Fläche halten heißt Auflösung halten – der Ausschnitt behält seine
 * Vergrößerung und dreht sich nur in die neue Form. Die Alternative, jeweils die
 * kürzere Kante zu behalten, hätte über mehrere Änderungen hinweg immer weiter
 * hineingezoomt.
 *
 * Der Mittelpunkt bleibt, soweit das Bild es zulässt – am Rand wird geklemmt.
 * Der gespeicherte Ausschnitt selbst wird davon nicht angefasst: Er ist die
 * Entscheidung des Benutzers, diese Anpassung nur ihre Darstellung im aktuellen
 * Kasten.
 *
 * @param photoAspect Seitenverhältnis des Bildes (Breite / Höhe)
 * @param slotAspect  Seitenverhältnis des Kastens
 */
export function fitCropToAspect(crop: Crop, photoAspect: number, slotAspect: number): Crop {
  if (!Number.isFinite(photoAspect) || photoAspect <= 0) return crop;
  if (!Number.isFinite(slotAspect) || slotAspect <= 0) return crop;
  if (crop.w <= 0 || crop.h <= 0) return crop;

  // Gesucht ist das Verhältnis der Ausschnittskanten, bei dem der ausgeschnittene
  // Bildbereich dieselbe Form hat wie der Kasten.
  const ziel = slotAspect / photoAspect;
  // Passt es schon, bleibt der Ausschnitt unverändert – Zeichen für Zeichen.
  // Sonst liefe jede Rundung durch die Wurzel unten in die Parity-Messung.
  if (Math.abs(crop.w / crop.h - ziel) < 1e-6) return crop;

  let w = Math.sqrt(crop.w * crop.h * ziel);
  let h = w / ziel;
  // Über den Bildrand hinaus geht nicht. Nur einer der beiden Fälle kann
  // eintreten: `w > 1` verlangt `ziel > 1`, `h > 1` verlangt `ziel < 1`.
  if (w > 1) {
    w = 1;
    h = 1 / ziel;
  } else if (h > 1) {
    h = 1;
    w = ziel;
  }

  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;

  return {
    ...crop,
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
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

/**
 * Kleinste zulässige Kantenlänge eines Ausschnitts.
 *
 * Bei 5 % bleiben von den 2048 px dieses Bestands rund 100 px übrig – schon
 * der kleinste Slot der Bibliothek (55 mm) verlangt bei 240 dpi über 500 px.
 * Weiter hineinzuzoomen liefert also garantiert Ausschuss; der Zoom stoppt
 * hier, statt eine unbrauchbare Vergrößerung zuzulassen.
 */
export const MIN_CROP_EDGE = 0.05;

/**
 * Vergrößert oder verkleinert den sichtbaren Bereich um seine Mitte.
 *
 * `factor < 1` zoomt hinein (kleinerer sichtbarer Bereich, mehr Vergrößerung),
 * `factor > 1` heraus. Breite und Höhe werden mit demselben Faktor skaliert –
 * nur so behält der Ausschnitt sein Seitenverhältnis und füllt den Slot weiter
 * ohne Verzerrung. Der Faktor wird zurückgenommen, sobald der Bildrand oder
 * `MIN_CROP_EDGE` erreicht ist; ein Fehlerfall ist das nicht, sondern das
 * erwartete Anschlagen am Ende des Bildes.
 */
export function zoomCrop(crop: Crop, factor: number): Crop {
  if (!Number.isFinite(factor) || factor <= 0) return crop;

  const groesserAls1 = Math.min(1 / crop.w, 1 / crop.h);
  const kleinerAlsMin = MIN_CROP_EDGE / Math.min(crop.w, crop.h);
  const f = clamp(factor, kleinerAlsMin, groesserAls1);

  const w = crop.w * f;
  const h = crop.h * f;
  // Mitte festhalten: Ohne das wandert das Bild beim Zoomen zur linken oberen
  // Ecke, weil x/y die Kante beschreiben und nicht den Mittelpunkt.
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;

  return {
    ...crop,
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
    mode: 'manual',
  };
}
