/**
 * Kennzahlen einer bestehenden Buchaufteilung.
 *
 * Beim Generieren fallen sie nebenbei an. Nach einer punktuellen Änderung –
 * ein Foto umgehängt, ein Ausschnitt von Hand gesetzt – müssen sie ohne
 * kompletten Neuaufbau nachgezogen werden, sonst zeigt die Oberfläche Zahlen
 * von vorgestern: „Fotos im Buch" wäre um eins zu hoch, sobald jemand ein Bild
 * in den Pool zieht.
 *
 * Gerechnet wird über den **gespeicherten** Ausschnitt, nicht über den, den die
 * Engine wählen würde. Nur so schlägt ein zu enger manueller Zuschnitt in der
 * Auflösungsstatistik durch – und genau das ist die Zahl, die der
 * Ausschnitt-Editor sichtbar machen soll. Für automatische Ausschnitte ist das
 * Ergebnis dasselbe wie über `slotCost`, weil beide Wege `coverCrop` und
 * `cropToPixels` benutzen.
 */
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop, cropToPixels } from '../model/crop.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import { templateById } from '../templates/index.js';
import { slotGeometry } from './scoring.js';

export interface BookStats {
  /** Fotos, die in einem Slot liegen. */
  placedCount: number;
  photosPerSpread: number;
  /** Schlechteste Auflösung im ganzen Buch. 0, wenn es kein Bild gibt. */
  worstDpi: number;
  belowTargetDpi: number;
  belowMinDpi: { photoId: PhotoId; spreadIndex: number; slotId: string; dpi: number }[];
}

export interface BookStatsOptions {
  spreads: readonly Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
}

export function bookStats(opts: BookStatsOptions): BookStats {
  const { spreads, photos, profile } = opts;

  const platziert = new Set<PhotoId>();
  let worstDpi = Number.POSITIVE_INFINITY;
  let belowTarget = 0;
  const belowMinDpi: BookStats['belowMinDpi'] = [];

  for (const spread of spreads) {
    const template = templateById(spread.templateId);
    if (!template) continue;

    for (const assignment of spread.slots) {
      if (!assignment.photoId) continue;
      const photo = photos.get(assignment.photoId);
      const slot = template.slots.find((s) => s.id === assignment.slotId);
      if (!photo || !slot) continue;

      platziert.add(photo.id);

      const geometry = slotGeometry(slot, profile);
      const crop =
        assignment.crop.mode === 'manual'
          ? assignment.crop
          : coverCrop(
              photo.width / photo.height,
              geometry.widthMm / geometry.heightMm,
              assignment.crop.focal,
            );
      const px = cropToPixels(crop, photo.width, photo.height);
      const dpi = effectiveDpi(px.width, geometry.widthMm);

      worstDpi = Math.min(worstDpi, dpi);
      if (dpi < profile.resolution.targetDpi) belowTarget++;
      if (dpi < profile.resolution.minDpi) {
        belowMinDpi.push({
          photoId: photo.id,
          spreadIndex: spread.index,
          slotId: slot.id,
          dpi,
        });
      }
    }
  }

  return {
    placedCount: platziert.size,
    photosPerSpread: spreads.length > 0 ? platziert.size / spreads.length : 0,
    worstDpi: Number.isFinite(worstDpi) ? worstDpi : 0,
    belowTargetDpi: belowTarget,
    belowMinDpi,
  };
}
