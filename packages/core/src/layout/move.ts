/**
 * Fotos umhängen – einzeln (`movePhoto`) oder als Stapel (`movePhotos`).
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
 *
 * Der Stapel ist keine Schleife über den Einzelzug, sondern eine eigene
 * Rechnung mit eigener Arbeitshöhe: Er bewegt Bilder zwischen Seiten und ordnet
 * jede berührte Seite genau einmal an. Was ihn vom Einzelzug unterscheidet und
 * warum, steht an `movePhotos`.
 */
import { FULL_CROP } from '../model/crop.js';
import type { PhotoOverride, PhotoWeight } from '../model/date.js';
import { effectivePhoto, effectivePhotos } from '../model/effective-photo.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import { hiddenSlotsNachWechsel } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import type { Template } from '../model/template.js';
import {
  BLANK_TEMPLATE_ID,
  chapterChoices,
  groupOpenerTemplates,
  templateById,
} from '../templates/index.js';
import { istEinwurfPlatz, mitEinwurf } from './einwurf.js';
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
  /**
   * Eine Stelle auf dem Papier, ohne Platz aus der Vorlage.
   *
   * Die dritte Absicht neben Tausch und Umzug: „Das Bild gehört **hierhin**."
   * Es bekommt einen freien Platz an der Fallstelle (`layout/einwurf.ts`), und
   * die übrigen Bilder rühren sich nicht — anders als beim Zug auf die ganze
   * Seite, der beide Seiten neu anordnet und dabei jeden Ausschnitt verwirft.
   *
   * Damit lässt sich eine Seite auch dann füllen, wenn ihre Vorlage keinen
   * Platz mehr frei hat: Das Bild zählt danach zu ihr, also stehen die
   * Anordnungen für eine Bilderzahl mehr zur Wahl (`templateChoices`) und ein
   * `auto` ordnet sie mit ihm neu an.
   *
   * `punkt` ist normiert auf den Endformatbereich der Doppelseite, wie ein
   * Templateslot — dieselbe Einheit wie beim Dateieinwurf.
   */
  | { kind: 'frei'; spreadIndex: number; punkt: { x: number; y: number } }
  | { kind: 'pool' };

/** Was das Neuanordnen braucht. Nur für Züge auf eine ganze Doppelseite. */
export interface ReflowContext {
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

export interface MoveResult {
  ok: boolean;
  /** Grund, falls der Zug nicht ausführbar war. Deutsch, für die Oberfläche. */
  error?: string;
  /** Unveränderte Eingabe, wenn `ok` falsch ist. */
  spreads: Spread[];
  /** Betroffene Doppelseiten – die Vorschau muss nur diese nachladen. */
  touched: number[];
  /**
   * Der Platz, der dabei entstanden ist – nur beim Zug auf eine Stelle des
   * Papiers (`kind: 'frei'`).
   *
   * Die Oberfläche wählt ihn danach aus, ohne nachzufragen: Man hat das Bild
   * eben hingelegt, es ist das gemeinte. Dieselbe Auskunft wie beim
   * Dateieinwurf.
   */
  slotId?: string;
}

/**
 * Was die **Gestalt eines Platzes** ausmacht und einen Bildwechsel übersteht:
 * seine Lage und seine Neigung.
 *
 * Ein Zug tauscht Bilder, nicht Kästen – „beide Bilder in der jeweils anderen
 * Größe" ist genau das. Ohne diese Übernahme war der Tausch auf einer
 * **justierten** Doppelseite ein Bruch: Dort trägt jeder Platz sein Rechteck
 * selbst (`layout/justify.ts`), und ein Platz ohne `rect` fällt auf das
 * Rückfallgitter der Trägervorlage (`templates/justified.ts`). Die zwei
 * getauschten Bilder landeten damit in zwei gleich großen Gitterzellen mitten in
 * einer Seite, deren übrige Kästen ihre gerechneten Rechtecke behielten – sie
 * überdeckten ihre Nachbarn, und die Seite sah aus wie zerschossen. Am freien
 * Platz eines eingeworfenen Bildes wäre es noch stiller ausgegangen: Seine
 * Kennung steht in keiner Vorlage, also gibt `wirksamePlaetze` ihn ohne `rect`
 * überhaupt nicht mehr aus.
 *
 * **Die Neigung bleibt hier und wandert nicht mit dem Bild**, anders als bei der
 * Zerlegung eines Blattes (`layout/single-page.ts`), wo dasselbe Bild in
 * denselben Kasten unter neuer Kennung zieht. Eine von Hand gesetzte Neigung ist
 * fast immer die Antwort auf die Stelle – ein Bild am Falz, ein Bild neben einem
 * schiefen Nachbarn –, und die Automatik gibt einem getauschten Bild ohnehin
 * einen neuen Winkel: Ihr Schlüssel ist `slotId:photoId` (`render/tilt.ts`),
 * ausdrücklich damit zwei getauschte Bilder nicht identisch schief stehen.
 */
function platzgestalt(slot: SlotAssignment): Partial<SlotAssignment> {
  return {
    ...(slot.rect ? { rect: slot.rect } : {}),
    ...(slot.rotateDeg !== undefined ? { rotateDeg: slot.rotateDeg } : {}),
  };
}

/**
 * Was mit dem **Bild** wandert: Rahmen, Unterschrift und Ebene.
 *
 * „Rahmen, Bildunterschrift und Ebene gehören zum Bild und nicht zum Platz" ist
 * schon die Regel der Blattzerlegung (`layout/single-page.ts`), und beim Tausch
 * wird daraus eine Rechnung. Bei der Unterschrift ist sie am deutlichsten: Der
 * Text nennt Ort oder Anlass dieses einen Fotos und stünde am Platz gelassen
 * unter dem falschen. Verworfen wurde beides – am Platz gelassen lügt er, ganz
 * fallen gelassen verliert ein Tausch eine getippte Zeile.
 *
 * Der Rahmen muss deshalb mitgehen: Nur das Polaroid hat einen Fuß, in dem eine
 * Unterschrift erscheint. Blieben Rahmen und Text getrennt, wäre nach dem Tausch
 * eines Polaroids gegen ein rahmenloses Bild die Zeile geschrieben und
 * unsichtbar – und im leeren Fuß daneben stünde nichts.
 */
function bildeigenes(slot: SlotAssignment, mitEbene = true): Partial<SlotAssignment> {
  return {
    ...(slot.frame !== undefined ? { frame: slot.frame } : {}),
    ...(slot.caption !== undefined ? { caption: slot.caption } : {}),
    ...(slot.captionAuto ? { captionAuto: true } : {}),
    ...(mitEbene && slot.layer !== undefined ? { layer: slot.layer } : {}),
  };
}

/**
 * Setzt einen Slot neu und stellt seinen Ausschnitt auf automatisch.
 *
 * Ein manuell gesetzter Ausschnitt war auf das Seitenverhältnis des alten
 * Slots zugeschnitten; im neuen wäre er schlicht falsch. Ihn zu behalten wäre
 * die schlechtere Überraschung als ein neu berechneter.
 *
 * Die Gestalt des Platzes bleibt stehen (`platzgestalt`); `mitgebracht` ist, was
 * das Bild von seinem alten Platz mitnimmt (`bildeigenes`).
 */
function withSlot(
  spread: Spread,
  slotId: string,
  photoId: PhotoId | null,
  mitgebracht: Partial<SlotAssignment> = {},
): Spread {
  return {
    ...spread,
    slots: spread.slots.map((slot) =>
      slot.slotId === slotId
        ? {
            slotId: slot.slotId,
            photoId,
            crop: { ...FULL_CROP },
            ...platzgestalt(slot),
            ...(photoId ? mitgebracht : {}),
          }
        : slot,
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

/** Die Bilder einer Doppelseite in Slotreihenfolge, ohne die leeren Plätze. */
function fotosVon(spread: Spread): PhotoId[] {
  return spread.slots.map((s) => s.photoId).filter((id): id is PhotoId => id !== null);
}

/**
 * Die Vorlagen, unter denen eine Auftaktseite wählen darf – oder `undefined`
 * für eine gewöhnliche Doppelseite.
 *
 * Ein Auftakt bleibt ein Auftakt: Wächst er von sechs auf neun Bilder, wird er
 * die dichte Fassung und nicht irgendeine Flussvorlage, sonst verlöre er seine
 * Textplätze und damit Jahreszahl und Ereigniszeilen. Gewählt wird unter
 * `chapterChoices` und nicht unter dem, was die Automatik nimmt: Bilder von
 * Hand auf die Seite zu ziehen ist die Ansage, nicht ihr Gegenteil.
 */
function auftaktKandidaten(spread: Spread, anzahl: number): Template[] | undefined {
  const tags = templateById(spread.templateId)?.tags;
  const familie = tags?.includes('kapitel')
    ? chapterChoices()
    : tags?.includes('gruppenauftakt')
      ? groupOpenerTemplates()
      : undefined;
  return familie?.filter((t) => t.slots.length === anzahl);
}

/**
 * Ordnet eine Doppelseite mit einer neuen Bildmenge an.
 *
 * Auftaktseiten wählen aus ihrer eigenen Familie (siehe `auftaktKandidaten`).
 * Die trägt aber nicht jede Bilderzahl – Jahresauftakte gibt es für bis zu
 * zwölf Bilder, Gruppenauftakte nur für eines. Passt die neue Zahl in keine,
 * wird der Zug abgelehnt und die Meldung nennt die Grenze: Eine Seite, die nach
 * dem Zug ihre Beschriftung verloren hätte, wäre die schlechtere Antwort.
 *
 * Bei einer Seite mit Textplätzen ohne Auftaktfamilie genügt `withText` – sonst
 * wählte die Rechnung eine Vorlage ganz ohne Textplatz.
 *
 * Öffentlich, weil das Verschmelzen zweier Doppelseiten
 * (`layout/verschmelzen.ts`) dieselbe Frage stellt: Diese Bilder, diese Seite,
 * welche Vorlage? Die Auftaktregel darf dafür nicht ein zweites Mal geschrieben
 * werden.
 *
 * @returns die neue Doppelseite oder eine deutsche Fehlermeldung.
 */
export function ordneSpreadAn(
  spread: Spread,
  ids: readonly PhotoId[],
  reflow: ReflowContext,
  bestand: ReadonlyMap<PhotoId, Photo>,
): Spread | string {
  const photos = ids.map((id) => bestand.get(id)).filter((p): p is Photo => p !== undefined);
  const kandidaten = auftaktKandidaten(spread, photos.length);

  if (kandidaten?.length === 0) {
    const familie = templateById(spread.templateId)?.tags?.includes('kapitel')
      ? chapterChoices()
      : groupOpenerTemplates();
    const zahlen = [...new Set(familie.map((t) => t.slots.length))].sort((a, b) => a - b);
    // Seit es Jahresauftakte für jede Bilderzahl bis zwölf gibt, wäre die
    // Aufzählung eine Zahlenreihe. Eine Obergrenze sagt dasselbe kürzer.
    const luecken = zahlen.some((n, i) => i > 0 && n !== zahlen[i - 1]! + 1);
    const traegt = luecken
      ? `${zahlen.join(', ')} Bilder`
      : `höchstens ${zahlen[zahlen.length - 1]} Bilder`;
    return `Eine Auftaktseite trägt ${traegt} – für ${photos.length} gibt es keine Fassung`;
  }

  const ergebnis = layoutSpread({
    photos,
    profile: reflow.profile,
    ...(reflow.weightOf ? { weightOf: reflow.weightOf } : {}),
    ...(kandidaten ? { candidates: kandidaten } : {}),
    ...(!kandidaten && spread.texts?.length ? { withText: true } : {}),
  });
  if (!ergebnis) return `Für ${photos.length} Bilder gibt es keine Vorlage`;

  // Die weggenommenen Plätze mit umtragen, statt sie mitzuschleppen: Eine
  // Kennung meint in der neuen Vorlage einen anderen Kasten, und der wäre danach
  // unsichtbar, ohne dass etwas davon berichtet — `a` steht in 65 der 117
  // Vorlagen. Dieselbe Rechnung wie beim Vorlagenwechsel im Server
  // (`project/anordnung.ts`); nach einer Neuanordnung bleibt in aller Regel
  // nichts übrig, und das ist richtig so.
  const uebrig = hiddenSlotsNachWechsel(
    spread.hiddenSlots,
    templateById(spread.templateId),
    templateById(ergebnis.templateId),
  );

  const neu: Spread = { ...spread, templateId: ergebnis.templateId, slots: ergebnis.slots };
  if (uebrig.length > 0) neu.hiddenSlots = uebrig;
  else delete neu.hiddenSlots;
  return neu;
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

  if (target.kind === 'frei') {
    if (!reflow) return unveraendert('Zum Platzieren auf dem Papier fehlt der Bildbestand');
    return moveToFrei(spreads, source, target, reflow, unveraendert);
  }

  // --- Quelle auflösen ---------------------------------------------------
  let photoId: PhotoId;
  /** Der Ausgangsplatz, für das, was das Bild von dort mitnimmt. */
  let quellplatz: SlotAssignment | undefined;
  if (source.kind === 'slot') {
    const gefunden = slotOf(spreads, source);
    if ('error' in gefunden) return unveraendert(gefunden.error);
    if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
    quellplatz = gefunden.slot;
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
    kopie[source.spreadIndex] = ohneQuelle(kopie[source.spreadIndex]!, source.slotId);
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
  kopie[target.spreadIndex] = withSlot(
    kopie[target.spreadIndex]!,
    target.slotId,
    photoId,
    quellplatz ? bildeigenes(quellplatz) : {},
  );

  if (source.kind === 'slot') {
    // Tausch: Das verdrängte Foto nimmt den Platz des verschobenen ein, samt
    // seiner Unterschrift. Ist das Ziel leer, wird der Ausgangsplatz geräumt –
    // ein Vorlagenplatz bleibt leer stehen, ein frei gesetzter fällt weg
    // (`ohneQuelle`), wie beim Zug auf eine Stelle des Papiers.
    kopie[source.spreadIndex] = verdraengt
      ? withSlot(kopie[source.spreadIndex]!, source.slotId, verdraengt, bildeigenes(zielSlot.slot))
      : ohneQuelle(kopie[source.spreadIndex]!, source.slotId);
  }

  const touched =
    source.kind === 'slot' && source.spreadIndex !== target.spreadIndex
      ? [source.spreadIndex, target.spreadIndex]
      : [target.spreadIndex];

  return { ok: true, spreads: kopie, touched };
}

/**
 * Räumt den Ausgangsplatz eines Zuges.
 *
 * Ein Platz der Vorlage bleibt stehen und leer – dort ist der Kasten die
 * Anordnung. Ein **frei gesetzter** fällt ganz weg: Er ist nur da, weil ein
 * Bild dort lag, und bliebe sonst als leerer Rahmen genau an der Stelle
 * stehen, von der man das Bild eben weggezogen hat.
 *
 * Der Unterschied zu `withSlot(…, null)` ist allein dieser eine Fall. Die Lage
 * behält beides – justierte Zeilen (`justiert.n`) und die wörtlich übernommene
 * Gegenseite einer einzeln umgestellten Buchseite (`paar:<x>+halb:leer`) tragen
 * ihr Rechteck selbst, und ohne es gäbe `wirksamePlaetze` den Kasten nicht mehr
 * aus: Der leere Platz, den dieser Zug zusagt, verschwände einfach.
 */
function ohneQuelle(spread: Spread, slotId: string): Spread {
  if (istEinwurfPlatz(slotId)) {
    return { ...spread, slots: spread.slots.filter((s) => s.slotId !== slotId) };
  }
  return withSlot(spread, slotId, null);
}

/**
 * Legt ein Foto frei auf eine Doppelseite – dorthin, wo die Hand losgelassen
 * hat.
 *
 * Der dritte Zug neben Tausch und Umzug, und der einzige, der **keine**
 * Anordnung anfasst: Das Bild bekommt einen eigenen Kasten an der Fallstelle
 * (`layout/einwurf.ts`), alle übrigen bleiben in ihren Plätzen samt Ausschnitt,
 * Rahmen und Neigung. Damit nimmt eine Seite auch dann ein Bild an, wenn ihre
 * Vorlage voll ist – die Frage „und jetzt eine Anordnung für sechs?" stellt
 * sich danach, mit dem Bild schon auf der Seite.
 *
 * **Auch eine festgehaltene Seite nimmt es an.** `locked` heißt, dass die
 * Automatik die Finger davon lässt; hier legt niemand automatisch etwas um. Der
 * Zug auf die ganze Seite (`moveToSpread`) bleibt dort verwehrt – der ordnet
 * neu an und verwürfe genau das, wofür die Seite festgehalten wurde.
 */
function moveToFrei(
  spreads: readonly Spread[],
  source: MoveSource,
  target: { spreadIndex: number; punkt: { x: number; y: number } },
  reflow: ReflowContext,
  unveraendert: (error: string) => MoveResult,
): MoveResult {
  if (!spreads[target.spreadIndex]) {
    return unveraendert(`Doppelseite ${target.spreadIndex + 1} gibt es nicht`);
  }

  let photoId: PhotoId;
  /**
   * Was das Bild von seinem alten Platz mitnimmt – Rahmen und Unterschrift,
   * aber **nicht** die Ebene: Der freie Platz kommt hinten dazu und liegt damit
   * obenauf, und das ist die Zusage dieses Zuges. Eine mitgenommene Ebene legte
   * ein eben hingelegtes Bild unter seine Nachbarn.
   */
  let mitgenommen: Partial<SlotAssignment> = {};
  if (source.kind === 'slot') {
    const gefunden = slotOf(spreads, source);
    if ('error' in gefunden) return unveraendert(gefunden.error);
    if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
    photoId = gefunden.slot.photoId;
    mitgenommen = bildeigenes(gefunden.slot, false);
  } else {
    const liegtAuf = findSpreadIndex(spreads, source.photoId);
    if (liegtAuf >= 0) return unveraendert(`Das Foto liegt schon auf Doppelseite ${liegtAuf + 1}`);
    photoId = source.photoId;
  }

  // Ohne Maße hat der Kasten keine Form – das Bild stünde als Quadrat da, und
  // zwar unbemerkt. Trifft ein aussortiertes Bild, dessen Slot noch auf es zeigt.
  const photo = reflow.photos.get(photoId);
  if (!photo) return unveraendert('Dieses Foto gehört nicht mehr zum Bestand');

  const kopie = [...spreads];

  // Erst räumen, dann legen: Kommt das Bild von derselben Seite, müssen beide
  // Schritte auf demselben Stand geschehen – sonst trüge die neue Fassung den
  // alten Platz wieder ein.
  if (source.kind === 'slot') {
    kopie[source.spreadIndex] = ohneQuelle(kopie[source.spreadIndex]!, source.slotId);
  }

  // Aufgelöst übergeben: Eine korrigierte Ausrichtung tauscht Breite und Höhe,
  // und der Kasten soll die Form haben, die das Bild wirklich hat.
  const { spread: neu, slotId } = mitEinwurf(
    kopie[target.spreadIndex]!,
    effectivePhoto(photo, reflow.overrides?.[photoId]),
    target.punkt,
    reflow.profile,
    mitgenommen,
  );
  kopie[target.spreadIndex] = neu;

  return {
    ok: true,
    spreads: kopie,
    touched:
      source.kind === 'slot' && source.spreadIndex !== target.spreadIndex
        ? [source.spreadIndex, target.spreadIndex].sort((a, b) => a - b)
        : [target.spreadIndex],
    slotId,
  };
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
 *
 * **Festgehaltene Seiten sind weder Ziel noch Quelle**, genau wie im Stapel
 * (`unantastbar` in `movePhotos`). Hier fehlte die Prüfung: Ein Bild aus dem
 * Nachbarstreifen auf eine festgehaltene Seite gezogen ordnete sie neu an und
 * verwarf jeden Ausschnitt, jeden Rahmen und jede Neigung, für die sie
 * festgehalten wurde. Wer ein Bild dorthin legen will, ohne die Seite
 * umzuwerfen, zieht es auf eine **Stelle** (`moveToFrei`) – dort ordnet
 * niemand um, und deshalb ist es dort auch erlaubt.
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
  if (ziel.locked) {
    return unveraendert(
      `Doppelseite ${zielIndex + 1} ist festgehalten – erst lösen, dann umhängen. ` +
        `Auf eine Stelle des Papiers gezogen geht es auch so.`,
    );
  }

  // --- Quelle auflösen ---
  let photoId: PhotoId;
  if (source.kind === 'slot') {
    const gefunden = slotOf(spreads, source);
    if ('error' in gefunden) return unveraendert(gefunden.error);
    if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
    photoId = gefunden.slot.photoId;

    const quelle = spreads[source.spreadIndex];
    if (quelle?.locked) {
      return unveraendert(
        `Doppelseite ${source.spreadIndex + 1} ist festgehalten – erst lösen, dann umhängen.`,
      );
    }

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

  // Einmal für den Zug aufgelöst, nicht je Doppelseite: `anordnen` läuft für
  // Quelle und Ziel.
  const bestand = effectivePhotos(reflow.photos, reflow.overrides);

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
    const neu = ordneSpreadAn(quelle, uebrig, reflow, bestand);
    if (typeof neu === 'string')
      return unveraendert(`Doppelseite ${source.spreadIndex + 1}: ${neu}`);
    kopie[source.spreadIndex] = neu;
  }

  const neuesZiel = ordneSpreadAn(ziel, [...fotosVon(ziel), photoId], reflow, bestand);
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

/**
 * Ein Zug im Stapel.
 *
 * Kein Slot als Ziel: Der Platztausch ist eine andere Geste – „diese zwei
 * Bilder tauschen ihre Plätze" – und gehört ans Bild in der aufgeschlagenen
 * Doppelseite. Ein Stapel bewegt Bilder zwischen Seiten, und dafür ist der
 * Platz auf der Zielseite gerade nicht die Aussage.
 */
export interface PhotoMove {
  source: MoveSource;
  target: { kind: 'spread'; spreadIndex: number } | { kind: 'pool' };
}

export interface MoveManyResult extends MoveResult {
  /**
   * Doppelseiten, die der Stapel leer zurücklässt. Sie stehen weiter im Buch –
   * herausnehmen ist eine eigene Entscheidung, siehe `movePhotos`.
   */
  leer: number[];
}

/**
 * Hängt mehrere Fotos in einem Zug um.
 *
 * Nicht dasselbe wie `movePhoto` n-mal hintereinander, und der Unterschied ist
 * der Grund für diese Funktion: Zwei Bilder von einer Achterseite auf eine
 * Viererseite gezogen sollen **einmal** in 6 und 6 münden. Nacheinander
 * gerechnet bekäme die Zielseite erst eine Fünfer-, dann eine Sechservorlage,
 * die Ausschnitte würden zweimal verworfen, und im Verlauf stünden zwei
 * Schritte, wo der Benutzer eine Handlung gemacht hat – dieselbe Überlegung wie
 * bei der mengenwertigen Datumskorrektur.
 *
 * Deshalb zwei Phasen: Erst wandert die Zugehörigkeit (welche Bilder liegen
 * danach auf welcher Seite), dann wird jede berührte Seite genau einmal
 * angeordnet.
 *
 * **Eine leer gezogene Seite bleibt stehen** – mit der leeren Vorlage und ohne
 * Plätze – statt den Stapel abzulehnen, wie es der Einzelzug tut. Der
 * Unterschied ist die Arbeitshöhe: Am Nachbarstreifen arbeitet man in einer
 * Doppelseite, dort ist eine leere Seite ein Unfall. Im Baum arbeitet man am
 * Buch, dort ist das Leerräumen einer Seite eine Bewegung, die man macht. Sie
 * dann auch gleich zu entfernen wäre trotzdem falsch: Das verschiebt alle
 * folgenden Seitenzahlen und gehört als eigene Entscheidung an
 * `DELETE /api/spreads/:index`. Gemeldet wird sie über `leer`.
 *
 * Ein Zug in den Pool ordnet die Quellseite hier ebenfalls neu an – anders als
 * beim Einzelzug, der nur den Slot leert. Drei Bilder aus einer Achterseite
 * herauszunehmen und drei Löcher zu hinterlassen wäre keine Aufteilung.
 *
 * **Festgehaltene Seiten sind weder Ziel noch Quelle** – sie verlören genau
 * das, wofür sie festgehalten wurden. Ein Bild dort auszutauschen bleibt
 * möglich, als Platztausch über `movePhoto`, der die Bilderzahl nicht anrührt.
 *
 * **Auftaktseiten dagegen nehmen Bilder an und geben welche ab**, solange die
 * neue Zahl eine Auftaktfassung hat (`anordnen`). Sie wechseln dann innerhalb
 * ihrer Familie – ein Sechser-Auftakt wird zum dichten Neuner – und behalten
 * ihre Textplätze.
 *
 * Alles oder nichts: Scheitert ein Zug, bleibt `spreads` unverändert.
 */
export function movePhotos(
  spreads: readonly Spread[],
  moves: readonly PhotoMove[],
  reflow: ReflowContext,
): MoveManyResult {
  const unveraendert = (error: string): MoveManyResult => ({
    ok: false,
    error,
    spreads: [...spreads],
    touched: [],
    leer: [],
  });

  if (moves.length === 0) return { ok: true, spreads: [...spreads], touched: [], leer: [] };

  const bestand = effectivePhotos(reflow.photos, reflow.overrides);

  /**
   * Was eine Seite dem Umhängen entzieht, oder `null`.
   *
   * Nur das Festhalten, und das aus seiner eigenen Bedeutung heraus: Eine
   * festgehaltene Seite ist die, die ein Neuanordnen unverändert übersteht –
   * sie umzuhängen hieße, genau das zu tun, wogegen sie festgehalten wurde.
   *
   * **Auftaktseiten stehen hier bewusst nicht.** Sie nehmen Bilder an und geben
   * welche ab, solange die neue Zahl eine Fassung hat; darüber entscheidet
   * `anordnen`, wo die Vorlagen bekannt sind. Sie pauschal zu sperren war eine
   * Vorsicht zu viel – ein Auftakt von sechs auf neun Bilder ist ein völlig
   * gewöhnlicher Wunsch.
   */
  const unantastbar = (i: number): string | null => {
    const seite = spreads[i];
    if (!seite) return null;
    if (seite.locked) {
      return `Doppelseite ${i + 1} ist festgehalten – erst lösen, dann umhängen.`;
    }
    return null;
  };

  // Phase 1: nur die Zugehörigkeit. Kein Slot wird angefasst – erst wenn alle
  // Züge eingerechnet sind, steht die Bilderzahl je Seite fest, und erst dann
  // lohnt die Vorlagenwahl.
  const belegung = spreads.map(fotosVon);
  const beruehrt = new Set<number>();
  const bewegt = new Set<PhotoId>();

  for (const { source, target } of moves) {
    let photoId: PhotoId;
    /** Seite, von der das Bild kommt – `null` heißt aus dem Pool. */
    let herkunft: number | null;

    if (source.kind === 'slot') {
      const gefunden = slotOf(spreads, source);
      if ('error' in gefunden) return unveraendert(gefunden.error);
      if (!gefunden.slot.photoId) return unveraendert('Der Ausgangsslot ist leer');
      photoId = gefunden.slot.photoId;
      herkunft = source.spreadIndex;
      const schutz = unantastbar(herkunft);
      if (schutz) return unveraendert(schutz);
    } else {
      photoId = source.photoId;
      // Gegen die laufende Belegung geprüft, nicht gegen die Eingabe: Ein Bild,
      // das ein früherer Zug des Stapels ins Freie gelegt hat, darf wieder ins
      // Buch.
      const liegtAuf = belegung.findIndex((ids) => ids.includes(photoId));
      if (liegtAuf >= 0)
        return unveraendert(`Das Foto liegt schon auf Doppelseite ${liegtAuf + 1}`);
      herkunft = null;
    }

    // Sonst stünde dasselbe Foto am Ende zweimal im Buch: Die Slots der Quelle
    // liest Phase 1 aus der unveränderten Eingabe, ein zweiter Zug auf denselben
    // Slot fände es also noch dort.
    if (bewegt.has(photoId)) return unveraendert('Dasselbe Foto steht zweimal im Stapel');

    if (!bestand.has(photoId)) return unveraendert('Dieses Foto gehört nicht mehr zum Bestand');

    if (target.kind === 'spread') {
      if (!spreads[target.spreadIndex]) {
        return unveraendert(`Doppelseite ${target.spreadIndex + 1} gibt es nicht`);
      }
      // Auf die eigene Seite gezogen: kein Fehler, nur nichts zu tun.
      if (herkunft === target.spreadIndex) continue;
      const schutz = unantastbar(target.spreadIndex);
      if (schutz) return unveraendert(schutz);
    } else if (herkunft === null) {
      return unveraendert('Quelle und Ziel sind beide der Fotopool');
    }

    if (herkunft !== null) {
      belegung[herkunft] = belegung[herkunft]!.filter((id) => id !== photoId);
      beruehrt.add(herkunft);
    }
    if (target.kind === 'spread') {
      // Hinten angehängt wie beim Einzelzug: Welchen Platz das Bild bekommt,
      // entscheidet ohnehin die Kostenzuordnung in `layoutSpread`.
      belegung[target.spreadIndex]!.push(photoId);
      beruehrt.add(target.spreadIndex);
    }
    bewegt.add(photoId);
  }

  // Phase 2: je berührter Seite eine Anordnung.
  const kopie = [...spreads];
  const leer: number[] = [];
  const touched = [...beruehrt].sort((a, b) => a - b);

  for (const i of touched) {
    const seite = spreads[i]!;
    const ids = belegung[i]!;

    if (ids.length === 0) {
      kopie[i] = { ...seite, templateId: BLANK_TEMPLATE_ID, slots: [] };
      leer.push(i);
      continue;
    }

    const neu = ordneSpreadAn(seite, ids, reflow, bestand);
    if (typeof neu === 'string') return unveraendert(`Doppelseite ${i + 1}: ${neu}`);
    kopie[i] = neu;
  }

  return { ok: true, spreads: kopie, touched, leer };
}
