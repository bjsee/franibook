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
import type { SlotAssignment, Spread } from '../model/spread.js';
import type { Template } from '../model/template.js';
import type { TemplateId } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import { templateById, templatesWithSlotCount, templatesWithoutTitle } from '../templates/index.js';
import { assign, slotCost, slotGeometry } from './scoring.js';

export interface LayoutSpreadOptions {
  /** Die Fotos dieser Doppelseite. Die Reihenfolge entscheidet nur bei Gleichstand. */
  photos: readonly Photo[];
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
  /**
   * Feste Vorlage. Ohne Angabe wird die beste für diese Bilderzahl gesucht.
   *
   * Mit Angabe darf sie mehr oder weniger Plätze haben als Bilder da sind:
   * Überzählige Plätze bleiben leer, überzählige Bilder stehen in `leftover`.
   * Genau das braucht der Vorlagenwechsel von Hand – sonst könnte man eine
   * Anordnung nur gegen eine mit derselben Bilderzahl tauschen.
   */
  templateId?: TemplateId;
  /** Erlaubt Vorlagen mit Überschriftenstreifen. Nur für Seiten mit Text. */
  withText?: boolean;
  /**
   * Eigene Auswahlliste statt der Vorlagen des Flusses.
   *
   * Für die Jahresauftakte: Sie werden gezielt vergeben und stehen nicht in
   * `templatesWithoutTitle`. Die Frage – welche dieser Vorlagen trägt diese
   * Bilder am besten? – ist aber dieselbe, und sie soll nur einmal beantwortet
   * sein.
   */
  candidates?: readonly Template[];
}

export interface LayoutSpreadResult {
  templateId: TemplateId;
  slots: SlotAssignment[];
  /** Fotos, für die kein Platz übrig war. Der Aufrufer entscheidet, wohin sie gehen. */
  leftover: PhotoId[];
}

/**
 * Ordnet die Fotos einer Doppelseite an: Vorlage, Slotzuordnung, Ausschnitte.
 *
 * Der Kern, den `rebuildSpreads` je Doppelseite braucht – und ebenso jeder
 * Griff, der die Bilderzahl einer Seite ändert: ein Foto, das von einer Seite
 * auf die nächste wandert, oder ein von Hand gewählter Vorlagenwechsel. Alle
 * drei stellen dieselbe Frage, und sie soll nur einmal beantwortet sein.
 *
 * Die Ausschnitte entstehen dabei neu. Ein von Hand gesetzter Ausschnitt war
 * auf das Seitenverhältnis seines alten Slots zugeschnitten; in einem anders
 * geformten Platz wäre er schlicht falsch.
 *
 * @returns `undefined`, wenn es für diese Bilderzahl keine Vorlage gibt oder
 * die angeforderte Vorlage unbekannt ist.
 */
export function layoutSpread(opts: LayoutSpreadOptions): LayoutSpreadResult | undefined {
  const { photos, profile } = opts;
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);

  const candidates = opts.candidates
    ? opts.candidates
    : opts.templateId
      ? [templateById(opts.templateId)].filter((t) => t !== undefined)
      : opts.withText
        ? templatesWithSlotCount(photos.length)
        : templatesWithoutTitle(photos.length);

  if (candidates.length === 0) return undefined;

  let bestTemplateId = candidates[0]!.id;
  let bestAssignment: number[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const template of candidates) {
    const geometries = template.slots.map((s) => slotGeometry(s, profile));
    const cost = photos.map((photo) =>
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
        slotCost(photos[photoIndex]!, slot, geometries[slotIndex]!, { profile, weightOf }).total
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
    const photo = photoIndex >= 0 ? photos[photoIndex] : undefined;
    if (!photo) {
      return { slotId: slot.id, photoId: null, crop: { ...FULL_AUTO_CROP } };
    }
    const geometry = slotGeometry(slot, profile);
    return {
      slotId: slot.id,
      photoId: photo.id,
      crop: coverCrop(photo.width / photo.height, geometry.widthMm / geometry.heightMm),
    };
  });

  // Bei einer festen Vorlage mit zu wenig Plätzen bleiben Fotos übrig. `assign`
  // lässt sie unzugeordnet; erkennbar sind sie daran, dass kein Slot auf ihren
  // Index zeigt.
  const leftover = photos
    .filter((_, photoIndex) => {
      const slotIndex = bestAssignment[photoIndex];
      return slotIndex === undefined || slotIndex < 0 || slotIndex >= template.slots.length;
    })
    .map((p) => p.id);

  return { templateId: bestTemplateId, slots, leftover };
}

const FULL_AUTO_CROP = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

export interface RebuildInput {
  photoIds: PhotoId[];
  /** Bereits festgelegte Vorlage. Ohne Angabe wird die beste gewählt. */
  templateId?: string;
  text?: string;
  /** Abweichende Entscheidung zum Zeitstrahl, die den Neuaufbau übersteht. */
  timeline?: boolean;
  /** Hintergrundfarbe, die den Neuaufbau übersteht. */
  background?: string;
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

    // Ohne Text keine `mit-titel`-Fassung: Sie würde 16 mm für eine Überschrift
    // freihalten, die es nicht gibt, und die Bilder dafür kleiner setzen.
    const angeordnet = layoutSpread({
      photos: groupPhotos,
      profile,
      weightOf,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.text ? { withText: true } : {}),
    });

    if (!angeordnet) {
      problems.push({
        index: i + 1,
        photoCount: groupPhotos.length,
        message:
          `Für ${groupPhotos.length} Bilder gibt es keine Vorlage. ` +
          `Verfügbar sind Doppelseiten mit ${verfuegbareGroessen().join(', ')} Bildern.`,
      });
      return;
    }

    const template = templateById(angeordnet.templateId)!;
    const textSlot = template.textSlots?.[0];
    spreads.push({
      id: `spread-${spreads.length}`,
      index: spreads.length,
      templateId: angeordnet.templateId,
      slots: angeordnet.slots,
      ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
      ...(input.background !== undefined ? { background: input.background } : {}),
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
