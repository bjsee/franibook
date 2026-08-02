/**
 * Baut Doppelseiten aus einer vorgegebenen Fotoverteilung.
 *
 * Gegenstück zur automatischen Generierung: Hier steht bereits fest, welche
 * Fotos auf welcher Doppelseite stehen – typischerweise, weil jemand das
 * Layout-Dokument von Hand bearbeitet hat. Zu bestimmen bleiben Vorlage,
 * Slotzuordnung und Ausschnitte.
 */
import { coverCrop } from '../model/crop.js';
import type { PhotoWeight } from '../model/date.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import { templateById, templatesWithSlotCount } from '../templates/index.js';
import { assign, slotCost, slotGeometry } from './scoring.js';

export interface RebuildInput {
  photoIds: PhotoId[];
  /** Bereits festgelegte Vorlage. Ohne Angabe wird die beste gewählt. */
  templateId?: string;
  text?: string;
  /** Abweichende Entscheidung zum Zeitstrahl, die den Neuaufbau übersteht. */
  timeline?: boolean;
}

export interface RebuildOptions {
  spreads: readonly RebuildInput[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}

export interface RebuildResult {
  spreads: Spread[];
  /** Doppelseiten, für die es keine passende Vorlage gibt. */
  problems: { index: number; photoCount: number; message: string }[];
}

/**
 * Setzt die Doppelseiten neu zusammen.
 *
 * Gibt es für eine Fotozahl keine Vorlage – etwa sieben oder elf Bilder –,
 * wird die Doppelseite übersprungen und gemeldet. Sie stillschweigend
 * aufzuteilen wäre schlimmer: Der Benutzer hat sie bewusst so angelegt und
 * soll erfahren, warum es nicht geht.
 */
export function rebuildSpreads(opts: RebuildOptions): RebuildResult {
  const { photos, profile } = opts;
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);

  const spreads: Spread[] = [];
  const problems: RebuildResult['problems'] = [];

  opts.spreads.forEach((input, i) => {
    const groupPhotos = input.photoIds
      .map((id) => photos.get(id))
      .filter((p): p is Photo => p !== undefined);

    if (groupPhotos.length === 0) return;

    const candidates = input.templateId
      ? [templateById(input.templateId)].filter((t) => t !== undefined)
      : templatesWithSlotCount(groupPhotos.length);

    if (candidates.length === 0) {
      problems.push({
        index: i + 1,
        photoCount: groupPhotos.length,
        message:
          `Für ${groupPhotos.length} Bilder gibt es keine Vorlage. ` +
          `Verfügbar sind Doppelseiten mit ${verfuegbareGroessen().join(', ')} Bildern.`,
      });
      return;
    }

    // Beste Vorlage samt Zuordnung
    let bestTemplateId = candidates[0]!.id;
    let bestAssignment: number[] = [];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const template of candidates) {
      const geometries = template.slots.map((s) => slotGeometry(s, profile));
      const cost = groupPhotos.map((photo) =>
        template.slots.map(
          (slot, j) => slotCost(photo, slot, geometries[j]!, { profile, weightOf }).total,
        ),
      );
      const assignment = assign(cost);
      const score = assignment.reduce((sum, slotIndex, photoIndex) => {
        const slot = template.slots[slotIndex];
        if (!slot) return sum;
        return (
          sum +
          slotCost(groupPhotos[photoIndex]!, slot, geometries[slotIndex]!, { profile, weightOf })
            .total
        );
      }, 0);

      if (score < bestScore) {
        bestScore = score;
        bestTemplateId = template.id;
        bestAssignment = assignment;
      }
    }

    const template = templateById(bestTemplateId)!;
    const slots = template.slots.map((slot, slotIndex) => {
      const photoIndex = bestAssignment.indexOf(slotIndex);
      const photo = photoIndex >= 0 ? groupPhotos[photoIndex] : undefined;
      if (!photo) {
        return {
          slotId: slot.id,
          photoId: null,
          crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
        };
      }
      const geometry = slotGeometry(slot, profile);
      return {
        slotId: slot.id,
        photoId: photo.id,
        crop: coverCrop(photo.width / photo.height, geometry.widthMm / geometry.heightMm),
      };
    });

    const textSlot = template.textSlots?.[0];
    spreads.push({
      id: `spread-${spreads.length}`,
      index: spreads.length,
      templateId: bestTemplateId,
      slots,
      ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
      ...(input.text && textSlot
        ? {
            texts: [
              {
                id: `spread-${spreads.length}-text`,
                role: textSlot.role,
                content: input.text,
                slotId: textSlot.id,
              },
            ],
          }
        : {}),
    });
  });

  return { spreads, problems };
}

function verfuegbareGroessen(): number[] {
  const counts = new Set<number>();
  for (let n = 1; n <= 16; n++) {
    if (templatesWithSlotCount(n).length > 0) counts.add(n);
  }
  return [...counts].sort((a, b) => a - b);
}
