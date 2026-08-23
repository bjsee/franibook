/**
 * Baut Doppelseiten aus einer vorgegebenen Fotoverteilung.
 *
 * Gegenstück zur automatischen Generierung: Hier steht bereits fest, welche
 * Fotos auf welcher Doppelseite stehen – typischerweise, weil jemand das
 * Layout-Dokument von Hand bearbeitet hat. Zu bestimmen bleiben Vorlage,
 * Slotzuordnung und Ausschnitte.
 */
import { coverCrop } from '../model/crop.js';
import type { PhotoOverride, PhotoWeight } from '../model/date.js';
import { effectivePhotos } from '../model/effective-photo.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import type { Template, TemplateSlot } from '../model/template.js';
import type { TemplateId } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import { templateById, templatesWithSlotCount, templatesWithoutTitle } from '../templates/index.js';
import { HALF_BLANK_ID, halfPages, pairId } from '../templates/halves.js';
import {
  JUSTIFIED_MAX_PHOTOS,
  JUSTIFIED_MIN_PHOTOS,
  isJustified,
  justifiedTemplateId,
} from '../templates/justified.js';
import { justifiedRects } from './justify.js';
import { assign, prominenceScale, slotCost, slotGeometry } from './scoring.js';

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
  /**
   * Winziger Zufallsanteil je Kandidat, damit gleichwertige Vorlagen nicht
   * immer in Bibliotheksreihenfolge gewinnen.
   *
   * Dieselbe Rechnung wie in `chooseTemplate` (`layout/generate.ts`) und aus
   * demselben Grund: Der Jahresauftakt wählte sonst bei jedem Wurf dieselbe
   * Fassung, obwohl drei gleich gut passen — „Andere Anordnung" ließ die
   * Auftaktseiten unberührt. Die Passung behält dabei ihren Vorrang; 0,01
   * kippt nur, was ohnehin fast gleich steht.
   *
   * Ohne Angabe bleibt die Wahl rein nach Passung — der Vorlagenwechsel von
   * Hand soll auf denselben Bildern zweimal dasselbe ergeben.
   */
  jitter?: () => number;
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
    const cost = kostenmatrix(photos, template.slots, profile, weightOf);
    const assignment = assign(cost);
    const score =
      assignment.reduce((sum, slotIndex, photoIndex) => {
        // Ein Foto ohne Platz kostet nichts – es steht hinterher in `leftover`.
        if (slotIndex < 0 || slotIndex >= template.slots.length) return sum;
        return sum + cost[photoIndex]![slotIndex]!;
      }, 0) + (opts.jitter ? opts.jitter() * 0.01 : 0);

    if (score < bestScore) {
      bestScore = score;
      bestTemplateId = template.id;
      bestAssignment = assignment;
    }
  }

  // Passt keine Vorlage gut, rechnet die Seite ihre Plätze selbst. Nur im
  // Fluss: Bei gezielt angeforderten Vorlagen (Auftakte, Handauswahl) ist die
  // Gestaltung die Absicht und nicht die Formtreue.
  //
  // **Und nicht, wenn ein Bild dieser Seite ein Gewicht trägt.** Justierte
  // Zeilen haben lauter gleich gewichtete Plätze (`templates/justified.ts`) —
  // eine Auszeichnung bliebe dort ohne jede Wirkung, und zwar unsichtbar. Am
  // echten Buch sind 27 von 80 Doppelseiten justiert und tragen 358 der 997
  // Bilder: Ohne diese Zeile wäre das Hauptbild auf einem Drittel des Buchs ein
  // Knopf ohne Folge. Wer eine Hierarchie will, bekommt eine Vorlage — der Satz
  // stand schon in `justified.ts`, hier führt ihn die Automatik aus. Eine von
  // Hand gewählte justierte Vorlage bleibt davon unberührt (oben, `isJustified`).
  //
  // `filler` zählt mit und nicht nur `hero`: „Dieses Bild soll die Seite nicht
  // tragen" ist dieselbe Aussage von der anderen Seite, und die Oberfläche sagt
  // beiden dasselbe zu („rückt in einen kleinen Platz"). Nur `hero` zu prüfen
  // hieße, eine der beiden Zusagen unter der Hand zu brechen.
  const hatGewichtung = photos.some((p) => weightOf(p.id) !== 'normal');
  if (!opts.candidates && !festeVorlage && !opts.withText && !hatGewichtung) {
    const justiert = justifySpread({ photos, profile, weightOf, beatScore: bestScore });
    if (justiert) return { templateId: justiert.templateId, slots: justiert.slots, leftover: [] };
  }

  const template = templateById(bestTemplateId)!;
  const { slots, leftover } = zuweisungen(photos, template.slots, bestAssignment, profile);
  return { templateId: bestTemplateId, slots, leftover };
}

const FULL_AUTO_CROP = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Kosten jedes Fotos in jedem Platz – die Matrix, die `assign` löst. */
function kostenmatrix(
  photos: readonly Photo[],
  slots: readonly TemplateSlot[],
  profile: PrintProfile,
  weightOf: (photoId: PhotoId) => PhotoWeight,
): number[][] {
  const geometries = slots.map((s) => slotGeometry(s, profile));
  const prominenceOf = prominenceScale(slots);
  return photos.map((photo) =>
    slots.map(
      (slot, j) => slotCost(photo, slot, geometries[j]!, { profile, weightOf, prominenceOf }).total,
    ),
  );
}

/**
 * Aus einer Zuordnung die Slotzuweisungen samt Ausschnitten.
 *
 * Geteilt zwischen ganzer Doppelseite und einzelner Buchseite (`layoutHalf`):
 * Welches Bild in welchen Platz und mit welchem Ausschnitt, ist dieselbe Frage –
 * verschieden ist nur, woher die Plätze kommen.
 */
function zuweisungen(
  photos: readonly Photo[],
  slots: readonly TemplateSlot[],
  assignment: readonly number[],
  profile: PrintProfile,
): { slots: SlotAssignment[]; leftover: PhotoId[] } {
  const belegt: SlotAssignment[] = slots.map((slot, slotIndex) => {
    const photoIndex = assignment.indexOf(slotIndex);
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

  // Bei zu wenig Plätzen bleiben Fotos übrig. `assign` lässt sie unzugeordnet;
  // erkennbar sind sie daran, dass kein Slot auf ihren Index zeigt.
  const leftover = photos
    .filter((_, photoIndex) => {
      const slotIndex = assignment[photoIndex];
      return slotIndex === undefined || slotIndex < 0 || slotIndex >= slots.length;
    })
    .map((p) => p.id);

  return { slots: belegt, leftover };
}

/**
 * Ordnet die Fotos **einer Buchseite** auf den Plätzen einer Halbseite an.
 *
 * Die halbe Schwester von `layoutSpread`: dieselbe Zuordnungsrechnung, aber
 * ohne Vorlagenwahl – die Halbseite ist gewählt, und was auf der Gegenseite
 * derselben Doppelseite liegt, geht die Rechnung nichts an. Genau das braucht
 * der seitenweise Anordnungswechsel (`setHalfPage`): Wer die rechte Seite
 * umstellt, will die linke unverändert wiederfinden.
 *
 * Die Plätze stehen in Linksform und auf die ganze Doppelseite normiert, wie
 * jede Halbseite (`templates/halves.ts`). Für die Kosten ist das gleichgültig:
 * `slotCost` liest Breite, Höhe, Vorliebe und Prominenz, nicht die Lage auf dem
 * Papier.
 */
export function layoutHalf(opts: {
  photos: readonly Photo[];
  slots: readonly TemplateSlot[];
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}): { slots: SlotAssignment[]; leftover: PhotoId[] } {
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);
  const assignment = assign(kostenmatrix(opts.photos, opts.slots, opts.profile, weightOf));
  return zuweisungen(opts.photos, opts.slots, assignment, opts.profile);
}

/**
 * Wählt unter mehreren Halbseiten die, die diese Bilder am besten trägt.
 *
 * Dieselbe Rechnung wie die Vorlagenwahl in `layoutSpread` – Kostenmatrix,
 * Zuordnung, Summe –, nur über Halbseiten und ohne die Sonderwege für justierte
 * Zeilen: Eine halbe Seite hat keine justierte Fassung, ihre Rechtecke sind über
 * die ganze Satzbreite gerechnet.
 *
 * Gebraucht, wo eine Buchseite eine **andere Bilderzahl** bekommt, ohne dass
 * jemand eine Anordnung gewählt hat: beim Zusammenpacken zweier Buchseiten
 * (`mergeSinglePages`). `layoutHalf` ordnet nur zu, es wählt nicht – und die
 * Wahl von Hand zu verlangen hieße, für einen Griff zwei zu brauchen.
 *
 * @returns Kennung, Zuweisungen und was keinen Platz fand – oder `undefined`,
 *   wenn keine Halbseite angeboten wurde.
 */
export function chooseHalf(opts: {
  photos: readonly Photo[];
  halves: readonly { id: string; slots: readonly TemplateSlot[] }[];
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}): { halfId: string; slots: SlotAssignment[]; leftover: PhotoId[] } | undefined {
  const weightOf = opts.weightOf ?? (() => 'normal' as PhotoWeight);
  if (opts.halves.length === 0) return undefined;

  let besteId = opts.halves[0]!.id;
  let besteZuordnung: number[] = [];
  let besteSlots: readonly TemplateSlot[] = opts.halves[0]!.slots;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const halbseite of opts.halves) {
    const cost = kostenmatrix(opts.photos, halbseite.slots, opts.profile, weightOf);
    const assignment = assign(cost);
    const score = assignment.reduce((summe, slotIndex, photoIndex) => {
      if (slotIndex < 0 || slotIndex >= halbseite.slots.length) return summe;
      return summe + cost[photoIndex]![slotIndex]!;
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      besteId = halbseite.id;
      besteSlots = halbseite.slots;
      besteZuordnung = assignment;
    }
  }

  const { slots, leftover } = zuweisungen(opts.photos, besteSlots, besteZuordnung, opts.profile);
  return { halfId: besteId, slots, leftover };
}

/**
 * Die Doppelseite, die eine gewählte Halbseite mit der besten Gegenseite paart.
 *
 * Gebraucht, wenn jemand die Anordnung *einer* Buchseite wählt und die
 * gegenüberliegende keine bekannte Halbseite ist – bei justierten Zeilen etwa,
 * deren Rechtecke über die ganze Satzbreite gerechnet sind. Für die Gegenseite
 * muss dann eine Anordnung gefunden werden, und das ist dieselbe Frage wie bei
 * jeder Vorlagenwahl: welche trägt diese Bilder am besten.
 *
 * Gerechnet wird über `layoutSpread` mit den zusammengesetzten Doppelseiten als
 * Kandidaten. Nicht mit den Halbseiten selbst: Ihre Kennung löst `templateById`
 * nicht auf, und die Passung gilt ohnehin für die ganze Doppelseite – ein Bild
 * neben dem Falz hat andere Nachbarn als eines am Außenrand.
 *
 * @param restCount Wie viele Bilder auf der Gegenseite liegen.
 * @returns Paarkennung, oder `undefined`, wenn keine Halbseite so viele Bilder trägt.
 */
export function choosePairFor(opts: {
  side: 'left' | 'right';
  halfId: string;
  /** Alle Bilder der Doppelseite – die Zuordnung entscheidet die Passung. */
  photos: readonly Photo[];
  restCount: number;
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}): string | undefined {
  const gegen = halfPages().filter((h) => h.slots.length === opts.restCount);
  const kandidatenIds = [
    ...(opts.restCount === 0 ? [HALF_BLANK_ID] : []),
    ...gegen.map((h) => h.id),
  ].map((id) => (opts.side === 'left' ? pairId(opts.halfId, id) : pairId(id, opts.halfId)));

  const kandidaten = kandidatenIds
    .map((id) => templateById(id))
    .filter((t): t is Template => t !== undefined);
  if (kandidaten.length === 0) return undefined;

  const ergebnis = layoutSpread({
    photos: opts.photos,
    profile: opts.profile,
    ...(opts.weightOf ? { weightOf: opts.weightOf } : {}),
    candidates: kandidaten,
  });
  return ergebnis?.templateId;
}

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

  // Die Plätze tragen ihre Lage erst aus den gerechneten Rechtecken; die
  // Prominenz muss also an ihnen hängen und nicht an den Platzhaltern der
  // Trägervorlage, deren Koordinaten mit dieser Seite nichts zu tun haben.
  const plaetze = template.slots.map((slot, i) => ({ ...slot, ...rects[i]! }));
  const prominenceOf = prominenceScale(plaetze);

  let score = 0;
  const slots: SlotAssignment[] = template.slots.map((slot, i) => {
    const photo = photos[i]!;
    const rect = rects[i]!;
    const platz = plaetze[i]!;
    const geometry = slotGeometry(platz, profile);
    score += slotCost(photo, platz, geometry, { profile, weightOf, prominenceOf }).total;
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
  /**
   * Benutzerkorrekturen. Werden beim Eintritt über `effectivePhotos` aufgelöst –
   * ohne sie rechnet die Engine mit dem rohen Importergebnis, und eine
   * korrigierte Ausrichtung bliebe wirkungslos.
   */
  overrides?: Record<PhotoId, PhotoOverride>;
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
  const { profile } = opts;
  const photos = effectivePhotos(opts.photos, opts.overrides);
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
