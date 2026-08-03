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
import {
  JUSTIFIED_MAX_PHOTOS,
  JUSTIFIED_MIN_PHOTOS,
  isJustified,
  justifiedTemplateId,
} from '../templates/justified.js';
import { justifiedRects } from './justify.js';
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

  // Ausdrücklich justiert: Die Kennung nennt eine Bilderzahl, maßgeblich ist
  // aber die tatsächliche. Wandert ein Foto von der Seite, wird die Seite mit
  // einem Bild weniger justiert und nicht mit einem leeren Platz.
  if (isJustified(opts.templateId)) {
    const justiert = justifySpread({ photos, profile, weightOf });
    if (justiert) return { templateId: justiert.templateId, slots: justiert.slots, leftover: [] };
  }

  // Eine justierte Kennung, die sich nicht rechnen ließ (zu viele Bilder für
  // den Satzspiegel), fällt hier auf die Bibliothek zurück statt auf ihre
  // Trägervorlage: Das Rückfallgitter ist für leere Plätze gedacht, nicht als
  // Anordnung.
  const festeVorlage = isJustified(opts.templateId) ? undefined : opts.templateId;

  const candidates = opts.candidates
    ? opts.candidates
    : festeVorlage
      ? [templateById(festeVorlage)].filter((t) => t !== undefined)
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

  // Passt keine Vorlage gut, rechnet die Seite ihre Plätze selbst. Nur im
  // Fluss: Bei gezielt angeforderten Vorlagen (Auftakte, Handauswahl) ist die
  // Gestaltung die Absicht und nicht die Formtreue.
  if (!opts.candidates && !festeVorlage && !opts.withText) {
    const justiert = justifySpread({ photos, profile, weightOf, beatScore: bestScore });
    if (justiert) return { templateId: justiert.templateId, slots: justiert.slots, leftover: [] };
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

/**
 * Vorsprung, den die Bibliothek behält.
 *
 * Justierte Zeilen beschneiden kein Bild, ihr Kostenanteil aus `cropLoss` und
 * `orientationClash` ist also null – ohne Zuschlag gewännen sie fast immer, und
 * das Buch bestünde aus Gitterseiten. Der Wert entspricht einem Zehntel
 * Flächenverlust je Bild: Soviel darf eine Vorlage verschenken, bevor die
 * Rechnung übernimmt. Eine Fehlpaarung kostet allein 0,6 – die Fälle, um die es
 * geht, kippen also, gut sitzende Vorlagen nicht.
 */
const JUSTIFY_MALUS = 0.1;

export interface JustifySpreadOptions {
  photos: readonly Photo[];
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
  /**
   * Kosten der besten Vorlage. Angegeben, übernimmt die Rechnung nur, wenn sie
   * sie um ihren Zuschlag unterbietet.
   *
   * Ohne Angabe wird justiert, weil jemand es verlangt hat – dann entscheidet
   * nur, ob es überhaupt aufgeht.
   */
  beatScore?: number;
}

/**
 * Legt die Bilder einer Doppelseite in justierten Zeilen.
 *
 * Die Zuordnung ist hier keine Wahl: Jedes Bild bekommt sein eigenes Rechteck
 * in chronologischer Reihenfolge. Gerechnet werden die Kosten trotzdem – wegen
 * der Auflösung. Sechs Bilder auf einer Doppelseite werden 176 mm breit, und bei
 * 2048 px Vorlage ist das die Grenze.
 *
 * @returns `undefined`, wenn die Bilder nicht in den Satzspiegel passen oder
 * eine Vorlage sie besser trägt.
 */
export function justifySpread(
  opts: JustifySpreadOptions,
): { templateId: TemplateId; slots: SlotAssignment[]; score: number } | undefined {
  const { photos, profile } = opts;
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);

  if (photos.length < JUSTIFIED_MIN_PHOTOS || photos.length > JUSTIFIED_MAX_PHOTOS) {
    return undefined;
  }

  const rects = justifiedRects({ photos, profile });
  if (rects.length !== photos.length) return undefined;

  const templateId = justifiedTemplateId(photos.length);
  const template = templateById(templateId);
  if (!template) return undefined;

  let score = 0;
  const slots: SlotAssignment[] = template.slots.map((slot, i) => {
    const photo = photos[i]!;
    const rect = rects[i]!;
    const platz = { ...slot, ...rect };
    const geometry = slotGeometry(platz, profile);
    score += slotCost(photo, platz, geometry, { profile, weightOf }).total;
    return {
      slotId: slot.id,
      photoId: photo.id,
      // Das Rechteck hat die Form des Bildes; der Ausschnitt bleibt trotzdem
      // gerechnet und nicht pauschal ganzflächig – ein Rundungsrest von einem
      // Zehntelmillimeter würde sonst als Verzerrung durchschlagen.
      crop: coverCrop(photo.width / photo.height, geometry.widthMm / geometry.heightMm),
      rect,
    };
  });

  if (opts.beatScore !== undefined && score + JUSTIFY_MALUS * photos.length >= opts.beatScore) {
    return undefined;
  }

  return { templateId, slots, score };
}

export interface RebuildInput {
  photoIds: PhotoId[];
  /** Bereits festgelegte Vorlage. Ohne Angabe wird die beste gewählt. */
  templateId?: string;
  text?: string;
  /** Abweichende Entscheidung zum Zeitstrahl, die den Neuaufbau übersteht. */
  timeline?: boolean;
  /** Hintergrundfarbe, die den Neuaufbau übersteht. */
  background?: string;
  /**
   * Fertige Doppelseite, die unverändert übernommen wird – eine selbst gebaute.
   *
   * An ihr ist nichts zu rechnen: Sie besteht aus Handarbeit, und ein Neuaufbau
   * hätte nichts, woraus er sie wiederherstellen könnte. Sie steht hier
   * trotzdem und nicht daneben, damit ihr Platz in der Reihenfolge aus derselben
   * Liste kommt wie der aller anderen – die Alternative wäre ein zweites
   * Einsortieren beim Aufrufer, mit eigener Zählung.
   */
  keep?: Spread;
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
    // Übernommen statt gebaut. Zeitstrahl und Hintergrund folgen dabei dem
    // Dokument wie bei jeder anderen Doppelseite – wer die Zeile dort löscht,
    // will zurück zur Vorgabe.
    if (input.keep) {
      const { timeline: _alt, background: _alteFarbe, ...ohne } = input.keep;
      spreads.push({
        ...ohne,
        index: spreads.length,
        ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
        ...(input.background !== undefined ? { background: input.background } : {}),
      });
      return;
    }

    const groupPhotos = input.photoIds
      .map((id) => photos.get(id))
      .filter((p): p is Photo => p !== undefined);

    if (groupPhotos.length === 0) {
      // Eine bildlose Vorlage ist kein Versehen, sondern eine Aussage: Der
      // Jahresauftakt zeigt nur die Jahreszahl. Jede andere Doppelseite ohne
      // auflösbares Bild fällt weiterhin weg – dort wäre nichts zu zeigen.
      const genannt = input.templateId ? templateById(input.templateId) : undefined;
      if (!genannt || genannt.slots.length > 0) return;
    }

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
