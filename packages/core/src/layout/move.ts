/**
 * Einzelne Fotos umhängen.
 *
 * Gegenstück zum Layout-Dokument: Dort wird die ganze Aufteilung neu
 * eingelesen und jede Doppelseite samt Vorlage, Slotzuordnung und Ausschnitten
 * neu gerechnet (`rebuild.ts`). Für einen einzelnen Griff – dieses Foto gehört
 * in jenen Slot – ist das zu viel: Die Rechnung verwirft auch die manuell
 * gesetzten Ausschnitte aller unbeteiligten Doppelseiten und kann bei
 * geänderter Bildzahl eine andere Vorlage wählen. Beides ist beim Verschieben
 * eines Bildes nicht gewollt und widerspricht der Erwartung, dass eine lokale
 * Korrektur nichts anderes umwirft.
 *
 * Deshalb rührt diese Funktion ausschließlich die beiden beteiligten Slots an.
 * Vorlage und Bildzahl je Doppelseite bleiben, wie sie sind; ein Slot darf
 * dabei leer stehen bleiben – das Modell sieht das ausdrücklich vor
 * (`SlotAssignment.photoId === null`).
 *
 * Der Fotopool ist keine eigene Liste, sondern die Rechnung „alle Fotos minus
 * die platzierten". Ein Bild aus dem Buch zu nehmen heißt deshalb nur, seinen
 * Slot zu leeren – es kann nicht verlorengehen.
 */
import { FULL_CROP } from '../model/crop.js';
import type { PhotoWeight } from '../model/date.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import { layoutSpread } from './rebuild.js';

export type MoveSource =
  { kind: 'slot'; spreadIndex: number; slotId: string } | { kind: 'pool'; photoId: PhotoId };

export type MoveTarget =
  | { kind: 'slot'; spreadIndex: number; slotId: string }
  /**
   * Die ganze Doppelseite, ohne bestimmten Platz.
   *
   * Der Unterschied zu `slot` ist nicht die Genauigkeit des Ziels, sondern die
   * Absicht: Auf einen Slot gezogen tauschen zwei Bilder ihre Plätze, die
   * Bilderzahl je Seite bleibt. Auf die Seite gezogen zieht das Bild um – die
   * Quellseite hat danach eines weniger, die Zielseite eines mehr, und beide
   * werden neu angeordnet.
   */
  | { kind: 'spread'; spreadIndex: number }
  | { kind: 'pool' };

/** Was das Neuanordnen braucht. Nur für Züge auf eine ganze Doppelseite. */
export interface ReflowContext {
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}

export interface MoveResult {
  ok: boolean;
  /** Grund, falls der Zug nicht ausführbar war. Deutsch, für die Oberfläche. */
  error?: string;
  /** Unveränderte Eingabe, wenn `ok` falsch ist. */
  spreads: Spread[];
  /** Betroffene Doppelseiten – die Vorschau muss nur diese nachladen. */
  touched: number[];
}

/**
 * Setzt einen Slot neu und stellt seinen Ausschnitt auf automatisch.
 *
 * Ein manuell gesetzter Ausschnitt war auf das Seitenverhältnis des alten
 * Slots zugeschnitten; im neuen wäre er schlicht falsch. Ihn zu behalten wäre
 * die schlechtere Überraschung als ein neu berechneter.
 */
function withSlot(spread: Spread, slotId: string, photoId: PhotoId | null): Spread {
  return {
    ...spread,
    slots: spread.slots.map((slot) =>
      slot.slotId === slotId ? { slotId: slot.slotId, photoId, crop: { ...FULL_CROP } } : slot,
    ),
  };
}

function slotOf(spreads: readonly Spread[], ref: { spreadIndex: number; slotId: string }) {
  const spread = spreads[ref.spreadIndex];
  if (!spread) return { error: `Doppelseite ${ref.spreadIndex + 1} gibt es nicht` } as const;
  const slot = spread.slots.find((s) => s.slotId === ref.slotId);
  if (!slot) {
    return { error: `Doppelseite ${ref.spreadIndex + 1} hat keinen Slot ${ref.slotId}` } as const;
  }
  return { slot } as const;
}

/** Auf welcher Doppelseite liegt dieses Foto? `-1`, wenn es im Pool ist. */
function findSpreadIndex(spreads: readonly Spread[], photoId: PhotoId): number {
  return spreads.findIndex((s) => s.slots.some((slot) => slot.photoId === photoId));
}

/**
 * Verschiebt ein Foto von Slot zu Slot, aus dem Buch heraus oder hinein.
 *
 * Trifft ein Foto auf einen belegten Slot, tauschen die beiden ihre Plätze –
 * ein Bild überschreiben und stillschweigend verlieren darf nicht passieren.
 * Kommt das Foto aus dem Pool, wandert das verdrängte dorthin zurück.
 */
export function movePhoto(
  spreads: readonly Spread[],
  source: MoveSource,
  target: MoveTarget,
  /** Nur nötig, wenn das Ziel eine ganze Doppelseite ist. */
  reflow?: ReflowContext,
): MoveResult {
  const unveraendert = (error: string): MoveResult => ({
    ok: false,
    error,
    spreads: [...spreads],
    touched: [],
  });

  if (source.kind === 'pool' && target.kind === 'pool') {
    return unveraendert('Quelle und Ziel sind beide der Fotopool');
  }

  if (target.kind === 'spread') {
    if (!reflow) return unveraendert('Zum Umhängen auf eine Doppelseite fehlt der Bildbestand');
    return moveToSpread(spreads, source, target.spreadIndex, reflow, unveraendert);
  }

  // --- Quelle auflösen ---------------------------------------------------
  let photoId: PhotoId;
  if (source.kind === 'slot') {
    const gefunden = slotOf(spreads, source);
    if ('error' in gefunden) return unveraendert(gefunden.error);
    if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
    photoId = gefunden.slot.photoId;
  } else {
    const liegtAuf = findSpreadIndex(spreads, source.photoId);
    if (liegtAuf >= 0) {
      // Sonst stünde dasselbe Foto zweimal im Buch. Der Aufrufer hat einen
      // veralteten Pool vor sich – die Meldung sagt ihm, wo es steckt.
      return unveraendert(`Das Foto liegt schon auf Doppelseite ${liegtAuf + 1}`);
    }
    photoId = source.photoId;
  }

  // --- Ziel auflösen -----------------------------------------------------
  if (target.kind === 'pool') {
    if (source.kind !== 'slot') return unveraendert('Quelle und Ziel sind beide der Fotopool');
    const kopie = [...spreads];
    kopie[source.spreadIndex] = withSlot(kopie[source.spreadIndex]!, source.slotId, null);
    return { ok: true, spreads: kopie, touched: [source.spreadIndex] };
  }

  const zielSlot = slotOf(spreads, target);
  if ('error' in zielSlot) return unveraendert(zielSlot.error);

  if (
    source.kind === 'slot' &&
    source.spreadIndex === target.spreadIndex &&
    source.slotId === target.slotId
  ) {
    // Auf sich selbst gezogen: nichts zu tun, aber auch kein Fehler.
    return { ok: true, spreads: [...spreads], touched: [] };
  }

  const verdraengt = zielSlot.slot.photoId;
  const kopie = [...spreads];
  kopie[target.spreadIndex] = withSlot(kopie[target.spreadIndex]!, target.slotId, photoId);

  if (source.kind === 'slot') {
    // Tausch: Das verdrängte Foto nimmt den Platz des verschobenen ein. Ist
    // das Ziel leer, bleibt der Ausgangsslot leer stehen.
    kopie[source.spreadIndex] = withSlot(
      kopie[source.spreadIndex]!,
      source.slotId,
      verdraengt ?? null,
    );
  }

  const touched =
    source.kind === 'slot' && source.spreadIndex !== target.spreadIndex
      ? [source.spreadIndex, target.spreadIndex]
      : [target.spreadIndex];

  return { ok: true, spreads: kopie, touched };
}

/**
 * Hängt ein Foto auf eine andere Doppelseite um und ordnet beide neu an.
 *
 * Anders als der Platztausch ändert das die Bilderzahl beider Seiten. Deshalb
 * bekommen sie eine neue Vorlage – auf der Quellseite bliebe sonst ein Loch, wo
 * das Bild stand, und auf der Zielseite hätte es gar keinen Platz. Die
 * Ausschnitte beider Seiten entstehen dabei neu; das ist der Preis dieses Zuges
 * und der Grund, warum er ein anderer ist als der Tausch.
 *
 * Leer werden darf eine Doppelseite nicht: Für null Bilder gibt es keine
 * Vorlage, und eine Seite aus dem Buch zu nehmen würde alle folgenden
 * Seitenzahlen verschieben – im Zweifel mitten unter den Händen des Benutzers.
 * Der Zug wird dann abgelehnt statt geraten.
 */
function moveToSpread(
  spreads: readonly Spread[],
  source: MoveSource,
  zielIndex: number,
  reflow: ReflowContext,
  unveraendert: (error: string) => MoveResult,
): MoveResult {
  const ziel = spreads[zielIndex];
  if (!ziel) return unveraendert(`Doppelseite ${zielIndex + 1} gibt es nicht`);

  // --- Quelle auflösen ---
  let photoId: PhotoId;
  if (source.kind === 'slot') {
    const gefunden = slotOf(spreads, source);
    if ('error' in gefunden) return unveraendert(gefunden.error);
    if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
    photoId = gefunden.slot.photoId;

    if (source.spreadIndex === zielIndex) {
      // Innerhalb derselben Seite gibt es nichts umzuhängen. Kein Fehler: Wer
      // ein Bild auf die eigene Seite zieht, hat sich vergriffen, nicht geirrt.
      return { ok: true, spreads: [...spreads], touched: [] };
    }
  } else {
    const liegtAuf = findSpreadIndex(spreads, source.photoId);
    if (liegtAuf >= 0) return unveraendert(`Das Foto liegt schon auf Doppelseite ${liegtAuf + 1}`);
    photoId = source.photoId;
  }

  // Ohne Maße lässt sich das Bild keinem Platz zuordnen – es fiele beim
  // Anordnen stillschweigend heraus, und das wäre ein verlorenes Foto statt
  // eines abgelehnten Zuges. Trifft ein aussortiertes Bild, dessen Slot noch
  // auf es zeigt.
  if (!reflow.photos.has(photoId)) {
    return unveraendert('Dieses Foto gehört nicht mehr zum Bestand');
  }

  const fotosVon = (spread: Spread): PhotoId[] =>
    spread.slots.map((s) => s.photoId).filter((id): id is PhotoId => id !== null);

  const anordnen = (spread: Spread, ids: readonly PhotoId[]): Spread | string => {
    const photos = ids
      .map((id) => reflow.photos.get(id))
      .filter((p): p is Photo => p !== undefined);

    const ergebnis = layoutSpread({
      photos,
      profile: reflow.profile,
      ...(reflow.weightOf ? { weightOf: reflow.weightOf } : {}),
    });
    if (!ergebnis) return `Für ${photos.length} Bilder gibt es keine Vorlage`;

    return { ...spread, templateId: ergebnis.templateId, slots: ergebnis.slots };
  };

  const kopie = [...spreads];

  // Erst die Quellseite: Scheitert sie, ist noch nichts geschehen.
  if (source.kind === 'slot') {
    const quelle = spreads[source.spreadIndex]!;
    const uebrig = fotosVon(quelle).filter((id) => id !== photoId);
    if (uebrig.length === 0) {
      return unveraendert(
        `Doppelseite ${source.spreadIndex + 1} bliebe dann leer. ` +
          `Zieh zuerst ein anderes Bild dorthin.`,
      );
    }
    const neu = anordnen(quelle, uebrig);
    if (typeof neu === 'string')
      return unveraendert(`Doppelseite ${source.spreadIndex + 1}: ${neu}`);
    kopie[source.spreadIndex] = neu;
  }

  const neuesZiel = anordnen(ziel, [...fotosVon(ziel), photoId]);
  if (typeof neuesZiel === 'string')
    return unveraendert(`Doppelseite ${zielIndex + 1}: ${neuesZiel}`);
  kopie[zielIndex] = neuesZiel;

  return {
    ok: true,
    spreads: kopie,
    touched:
      source.kind === 'slot' ? [source.spreadIndex, zielIndex].sort((a, b) => a - b) : [zielIndex],
  };
}
