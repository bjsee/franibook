/**
 * Einzelne Buchseiten einfügen und die Blattgrenzen neu ziehen.
 *
 * Das Buch ist in Doppelseiten gedacht, und für die Gestaltung ist das richtig –
 * eine aufgeschlagene Doppelseite ist die Einheit, die man sieht. Eine einzelne
 * Seite einzuschieben kippt aber die Parität: Was rechts stand, steht danach
 * links, und jedes folgende Blatt besteht aus anderen zwei Buchseiten als vorher.
 *
 * Genau das ist hier verlangt, und es ist verlustfrei möglich – weil **kein
 * einziger Slot der Flussvorlagen über dem Falz liegt** (`templates/halves.ts`,
 * am Bestand geprüft). Jede Doppelseite zerfällt damit in zwei Buchseiten, die
 * Folge wird um die neue Seite ergänzt und neu gepaart. Kein Foto wechselt dabei
 * seinen Platz im Buch, nur seine Blattzugehörigkeit.
 *
 * Drei Sorten Blatt lassen sich nicht zerlegen: Auftakte (ihr Text hängt an
 * Textplätzen der Vorlage, und die randabfallenden gehen über den Falz),
 * justierte Zeilen (ihre Rechtecke sind über die ganze Satzbreite gerechnet) und
 * festgehaltene – Handarbeit wird nicht zerschnitten. Vor einem solchen Blatt
 * stellt eine leere Halbseite die Parität wieder her; dahinter ist das Buch
 * unverändert. Der Eingriff bleibt damit lokal, obwohl die Rechnung über alle
 * Blätter läuft: Am echten Buch sind 57 von 80 Doppelseiten unzerlegbar, und eine
 * eingefügte Seite setzt eine bis zwei neu zusammen.
 */
import { FULL_CROP } from '../model/crop.js';
import type { PhotoWeight } from '../model/date.js';
import type { Photo, PhotoId } from '../model/photo.js';
import {
  hiddenSlotsNachWechsel,
  type SlotAssignment,
  type Spread,
  type SpreadAnchor,
  type TextBlock,
} from '../model/spread.js';
import type { Template, TemplateSlot } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import {
  HALF_BLANK_ID,
  type HalfPage,
  halfPageById,
  halfPages,
  halvesOfTemplate,
  pairId,
  splitPairId,
} from '../templates/halves.js';
import {
  chapterHalfById,
  chapterHalfOfTemplate,
  chapterPairId,
  isChapterHalf,
} from '../templates/chapter-halves.js';
import { isJustified } from '../templates/justified.js';
import { templateById, templateMeta } from '../templates/index.js';
import { einwurfPlatzId } from './einwurf.js';
import { chooseHalf, layoutHalf } from './rebuild.js';

/**
 * Eine Buchseite als Baustein der Folge.
 *
 * `span: 2` heißt: Dieses Blatt lässt sich nicht zerlegen und belegt beide
 * Buchseiten. Die Zuweisungen tragen dann die Slotkennungen der Originalvorlage,
 * nicht die einer Halbseite.
 */
interface BookPage {
  span: 1 | 2;
  /** Halbseitenkennung, bei `span: 2` die ganze Doppelseite. */
  halfId?: string;
  /** Das unzerlegte Blatt, bei `span: 2`. */
  spread?: Spread;
  /** Zuweisungen in Slotkennungen der Halbseite. */
  slots?: SlotAssignment[];
  /** Textblöcke dieser Buchseite, in Linksform normiert. */
  blocks?: TextBlock[];
  background?: string;
  timeline?: boolean;
  /** Kennung der Doppelseite, aus der diese Buchseite stammt – für stabile Ids. */
  from?: string;
  /** Ob diese Buchseite von Hand gebaut ist und festgehalten werden soll. */
  own?: boolean;
  /**
   * Hintergrundbild dieser Buchseite, falls eines nur auf ihr liegt.
   *
   * Über beide Seiten gibt es das hier nicht: Ein solches Blatt zerfällt gar
   * nicht erst (`teilbar`).
   */
  backgroundPhotoId?: PhotoId;
  /**
   * Woran die festgehaltene Buchseite hängt, wenn das Buch neu erzeugt wird.
   *
   * Reist mit `own` mit: Ein ganzes Schloss geht als Objekt durch `insertKept`
   * und behält seinen Anker von selbst, eine Halbseite wird dagegen zerlegt und
   * neu zusammengesetzt. Ohne ihn hier verlöre sie ihn beim ersten Neuaufbau und
   * fiele fortan auf ihre alte Blattnummer zurück — eine Stelle im Buch von
   * gestern.
   */
  anchor?: SpreadAnchor;
}

/** Geometrischer Schlüssel, um Slots einer Hälfte ihren Halbseitenslots zuzuordnen. */
function key(s: { x: number; y: number; w: number; h: number }): string {
  return [s.x, s.y, s.w, s.h].map((v) => v.toFixed(4)).join(',');
}

/** Spiegelt eine normierte x-Koordinate an der Falzachse. */
function spiegel<T extends { x: number; w: number }>(r: T): T {
  return { ...r, x: 1 - r.x - r.w };
}

/**
 * Ob dieses Blatt in zwei Buchseiten zerfällt.
 *
 * Nicht zerlegbar sind Auftakte und justierte Zeilen – und jedes Blatt, dessen
 * Vorlage sich nicht sauber halbieren lässt. Im Zweifel bleibt das Blatt ganz:
 * Eine falsch zerlegte Doppelseite verlöre Bilder, ein nicht zerlegtes kostet nur
 * eine leere Halbseite davor.
 */
export function zerlegbar(spread: Spread): boolean {
  // Handarbeit wird beim Umpaaren nicht zerschnitten: Ein festgehaltenes Blatt
  // behält seine Form und seine Kennung. Auf ausdrückliches Verlangen – wenn
  // jemand eine seiner Seiten löscht – geht es trotzdem, siehe `teilbar`.
  if (spread.locked) return false;
  return teilbar(spread);
}

/**
 * Ob dieses Blatt sich überhaupt an der Falzachse trennen lässt.
 *
 * Ohne die Rücksicht auf das Schloss: Wer die eine Seite seiner selbst gebauten
 * Doppelseite löscht, verlangt genau diese Trennung, und sie ist geometrisch
 * ebenso sauber wie bei jedem anderen Blatt.
 */
export function teilbar(spread: Spread): boolean {
  if (isJustified(spread.templateId)) return false;
  if ((spread.texts ?? []).length > 0) return false;
  const template = templateById(spread.templateId);
  if (!template) return false;
  if (templateMeta(template.id).chapterOnly) return false;
  if (template.tags?.includes('gruppenauftakt')) return false;
  // Ein Hintergrundbild über **beide** Seiten hält das Blatt zusammen: Es
  // kreuzt den Falz, und eine halbe Fläche davon beschreibt kein Motiv. Liegt
  // es dagegen auf einer Buchseite, reist es mit ihr — `zerlege` gibt es ihrer
  // Hälfte mit, `paare` schreibt es samt neuer Seite zurück.
  if (spread.backgroundPhotoId && !spread.backgroundPhotoSide) return false;

  return halbseitenVon(template) !== undefined;
}

/**
 * Die beiden Halbseiten einer Vorlage, leere Hälften eingeschlossen.
 *
 * `halvesOfTemplate` schweigt zu einer Hälfte ohne Bildplatz – dort steht in
 * seinem Sinne keine Anordnung. Für die Zerlegung ist genau das eine: die leere
 * Buchseite. Ohne diese Unterscheidung gälte jede Vorlage mit einem einzigen
 * Bild als unzerlegbar, und das sind bei diesem Bestand die meisten.
 */
function halbseitenVon(template: Template): { left: string; right: string } | undefined {
  const links = template.slots.filter((s) => s.x + s.w <= 0.5001);
  const rechts = template.slots.filter((s) => s.x >= 0.4999);
  // Ein Slot über dem Falz ließe sich nicht zuordnen, ohne ein Bild zu
  // zerschneiden.
  if (links.length + rechts.length !== template.slots.length) return undefined;

  const halves = halvesOfTemplate(template);
  const left = links.length === 0 ? HALF_BLANK_ID : halves.left;
  const right = rechts.length === 0 ? HALF_BLANK_ID : halves.right;
  if (!left || !right) return undefined;
  return { left, right };
}

/** Zerlegt ein Blatt in seine beiden Buchseiten. */
function zerlege(spread: Spread): [BookPage, BookPage] | undefined {
  const template = templateById(spread.templateId);
  if (!template) return undefined;
  const halves = halbseitenVon(template);
  if (!halves) return undefined;

  const paar = splitPairId(template.id);
  const bySlotId = new Map(spread.slots.map((s) => [s.slotId, s]));

  const seite = (which: 'left' | 'right'): BookPage | undefined => {
    const halfId = which === 'left' ? halves.left : halves.right;
    const half = halfPageById(halfId);
    if (!half) return undefined;

    // Welche Slots der Vorlage liegen auf dieser Seite, und wie heißen sie in
    // der Halbseite? Verglichen wird die Geometrie in Linksform – dieselbe
    // Rechnung, aus der die Halbseite entstanden ist.
    const eigene = template.slots.filter((s) =>
      which === 'left' ? s.x + s.w <= 0.5001 : s.x >= 0.4999,
    );
    const nachGeometrie = new Map<string, string>();
    for (const s of half.slots) nachGeometrie.set(key(s), s.id);

    const slots: SlotAssignment[] = [];
    for (const slot of eigene) {
      const linksform = which === 'left' ? slot : spiegel(slot);
      const halbSlotId = nachGeometrie.get(key(linksform));
      // Ohne Zuordnung wäre die Zuweisung nicht wiederherstellbar. Kann nur
      // eintreten, wenn `halvesOfTemplate` und diese Rechnung auseinanderlaufen.
      if (halbSlotId === undefined) return undefined;
      const bestand = paar
        ? bySlotId.get(`${which === 'left' ? 'l' : 'r'}-${slot.id.slice(2)}`)
        : bySlotId.get(slot.id);
      slots.push({
        slotId: halbSlotId,
        photoId: bestand?.photoId ?? null,
        crop: bestand?.crop ?? { ...FULL_CROP },
        ...(bestand?.rotateDeg !== undefined ? { rotateDeg: bestand.rotateDeg } : {}),
        ...(bestand?.rect ? { rect: which === 'left' ? bestand.rect : spiegel(bestand.rect) } : {}),
        // Rahmen, Bildunterschrift und Ebene gehören zum Bild und nicht zum
        // Platz – sie müssen die Zerlegung überleben. Vorher fielen sie hier
        // stumm heraus, und ein Polaroid verlor beim Umpaaren seinen Karton.
        ...(bestand?.frame !== undefined ? { frame: bestand.frame } : {}),
        ...(bestand?.caption !== undefined ? { caption: bestand.caption } : {}),
        // Mit der Unterschrift auch ihre Herkunft: Ohne sie gälte jede gefüllte
        // Zeile nach dem ersten Seiteneinschub als Handarbeit, und der
        // mengenwertige Zug ließe sie fortan stehen, ohne sagen zu können warum.
        ...(bestand?.captionAuto !== undefined ? { captionAuto: bestand.captionAuto } : {}),
        ...(bestand?.layer !== undefined ? { layer: bestand.layer } : {}),
      });
    }

    // Frei gesetzte Kästen kennt die Vorlage nicht, also findet die Schleife
    // darüber sie nicht – sie fielen bei der Zerlegung stumm heraus, und ein
    // eingeworfenes Bild war nach dem Einschieben einer Seite verschwunden.
    // Sie gehören der Buchseite, über der ihre Mitte liegt, und behalten ihre
    // Kennung: An ihr hängen Ausschnitt, Neigung und Ebene.
    const ausVorlage = new Set(template.slots.map((s) => s.id));
    for (const slot of spread.slots) {
      if (!slot.rect || ausVorlage.has(slot.slotId)) continue;
      const liegtLinks = slot.rect.x + slot.rect.w / 2 < 0.5;
      if (liegtLinks !== (which === 'left')) continue;
      slots.push({ ...slot, rect: which === 'left' ? slot.rect : spiegel(slot.rect) });
    }

    // Textblöcke gehören der Seite, auf der ihre Mitte liegt. Geteilt wird
    // keiner: Ein Block über dem Falz ist eine Gestaltungsabsicht, und eine
    // halbe Zeile auf jeder Seite wäre keine.
    const blocks = (spread.blocks ?? [])
      .filter((b) => {
        const mitte = b.rect.x + b.rect.w / 2;
        return which === 'left' ? mitte < 0.5 : mitte >= 0.5;
      })
      .map((b) => (which === 'left' ? b : { ...b, rect: spiegel(b.rect) }));

    return {
      span: 1,
      halfId,
      slots,
      blocks,
      ...(spread.background !== undefined ? { background: spread.background } : {}),
      ...(spread.timeline !== undefined ? { timeline: spread.timeline } : {}),
      // Das Hintergrundbild gehört der Buchseite, auf der es liegt – und nur
      // ihr. Auf der Gegenseite lag ohnehin keines, sonst wäre das Blatt nicht
      // zerlegbar.
      ...(spread.backgroundPhotoId !== undefined && spread.backgroundPhotoSide === which
        ? { backgroundPhotoId: spread.backgroundPhotoId }
        : {}),
      // Das halbseitige Schloss reist mit seiner Buchseite: Zerlegt und wieder
      // gepaart soll dieselbe Seite festgehalten sein, auch wenn sie dabei die
      // Blattseite wechselt. Der Anker gehört dazu — er sagt, wohin sie gehört.
      ...(spread.lockedSide === which
        ? { own: true as const, ...(spread.anchor ? { anchor: spread.anchor } : {}) }
        : {}),
      from: spread.id,
    };
  };

  const links = seite('left');
  const rechts = seite('right');
  if (!links || !rechts) return undefined;
  return [links, rechts];
}

/** Setzt zwei Buchseiten zu einem Blatt zusammen. */
function paare(links: BookPage, rechts: BookPage, index: number): Spread | undefined {
  const id = pairId(links.halfId ?? HALF_BLANK_ID, rechts.halfId ?? HALF_BLANK_ID);
  const template = templateById(id);
  if (!template) return undefined;

  const bekannt = new Set(template.slots.map((s) => s.id));
  const slots: SlotAssignment[] = [];
  const zuweisen = (seite: BookPage, prefix: 'l' | 'r'): void => {
    const half = halfPageById(seite.halfId ?? HALF_BLANK_ID);
    const ausHalbseite = new Set((half?.slots ?? []).map((s) => s.id));
    for (const s of seite.slots ?? []) {
      // Ein Platz aus der Halbseite bekommt das Präfix der Buchseite; ein frei
      // gesetzter Kasten behält seine Kennung, denn er steht in keiner Vorlage
      // und `l-frei.1` wäre nur ein längerer Name für dasselbe. Kollidieren
      // zwei – beide Buchseiten brachten ein `frei.1` von verschiedenen
      // Blättern mit –, bekommt der zweite die nächste freie Zahl.
      const frei = !ausHalbseite.has(s.slotId);
      const kennung = frei
        ? slots.some((v) => v.slotId === s.slotId)
          ? einwurfPlatzId({ slots })
          : s.slotId
        : `${prefix}-${s.slotId}`;
      slots.push({
        ...s,
        slotId: kennung,
        // Eine frei gesetzte Position trägt eigene Koordinaten und wird
        // zurückgespiegelt, während die Slotgeometrie aus der Paarvorlage
        // kommt. Der Ausschnitt bleibt: Er beschreibt den Bildinhalt, nicht
        // den Platz.
        ...(s.rect ? { rect: prefix === 'r' ? spiegel(s.rect) : s.rect } : {}),
      });
    }
  };
  zuweisen(links, 'l');
  zuweisen(rechts, 'r');

  // Zuweisungen, die es in der Paarvorlage nicht gibt, fielen beim Rendern
  // stumm heraus. Es sind dieselben Slots, nur anders benannt – trifft der Fall
  // trotzdem ein, gehört er gemeldet und nicht verschwiegen. Freie Kästen sind
  // davon ausgenommen: Sie tragen ihre Geometrie selbst (`wirksamePlaetze`).
  if (slots.some((s) => !bekannt.has(s.slotId) && !s.rect)) return undefined;

  const blocks = [
    ...(links.blocks ?? []),
    ...(rechts.blocks ?? []).map((b) => ({ ...b, rect: spiegel(b.rect) })),
  ];

  // Hintergrund und Zeitstrahl gehören dem Blatt, nicht der Seite. Bei
  // ungleichen Werten gewinnt die linke: Sie ist die Seite, die man beim
  // Umblättern zuerst sieht.
  const background = links.background ?? rechts.background;
  const timeline = links.timeline ?? rechts.timeline;

  /*
   * Das Hintergrundbild dagegen gehört seiner Buchseite und wandert mit ihr auf
   * die Seite, auf der sie landet.
   *
   * Bringen beide Hälften eines mit, gewinnt aus demselben Grund die linke: Das
   * Modell kennt **ein** Bild je Blatt, und zwei nebeneinander wären zwei
   * randabfallende Motive auf einer aufgeschlagenen Doppelseite — eher ein
   * Versehen als eine Gestaltung. Der Fall entsteht nur durch Umpaaren, nie
   * durch eine Wahl.
   */
  const hintergrundBild = links.backgroundPhotoId
    ? { photoId: links.backgroundPhotoId, side: 'left' as const }
    : rechts.backgroundPhotoId
      ? { photoId: rechts.backgroundPhotoId, side: 'right' as const }
      : undefined;

  // Die eigene Seite gibt dem Blatt ihre Kennung, damit `keep` und `anchor`
  // weiter auf dasselbe Blatt zeigen. Sonst zählt das Blatt durch.
  const eigen = links.own ? links : rechts.own ? rechts : undefined;

  return {
    id: eigen?.from ?? `blatt-${index}`,
    index,
    templateId: id,
    slots,
    ...(blocks.length > 0 ? { blocks } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(timeline !== undefined ? { timeline } : {}),
    ...(hintergrundBild
      ? {
          backgroundPhotoId: hintergrundBild.photoId,
          backgroundPhotoSide: hintergrundBild.side,
        }
      : {}),
    /*
     * Das Schloss so eng wie die Handarbeit, die es schützt.
     *
     * Vorher stand hier `locked: true`, sobald **eine** der beiden Seiten von
     * Hand gebaut war — und damit fror eine eingefügte Buchseite auch ihre
     * Nachbarin ein, die die Automatik gestellt hatte. Sind beide eigen, ist es
     * ein ganzes Blatt Handarbeit und `locked` weiter das Richtige.
     */
    ...(links.own && rechts.own
      ? { locked: true as const }
      : links.own
        ? { lockedSide: 'left' as const }
        : rechts.own
          ? { lockedSide: 'right' as const }
          : {}),
    // Und der Anker der eigenen Seite: Ohne ihn stünde die bewahrte Buchseite
    // beim nächsten Neuaufbau auf ihrer alten Blattnummer statt bei ihren
    // Nachbarbildern.
    ...(eigen?.anchor ? { anchor: eigen.anchor } : {}),
  };
}

export interface SetHalfPageOptions {
  side: 'left' | 'right';
  /** Die gewählte Anordnung dieser Buchseite. */
  halfId: string;
  /**
   * Die Fotos dieser Doppelseite, aufgelöst.
   *
   * Verteilt werden nur die der gewählten Seite; die übrigen stehen hier, weil
   * die Zuweisungen Kennungen tragen und die Zuordnung Maße braucht.
   */
  photos: readonly Photo[];
  profile: PrintProfile;
  weightOf?: (photoId: PhotoId) => PhotoWeight;
}

/**
 * Ordnet eine Buchseite neu an, wo das Blatt in keine zwei Halbseiten zerfällt.
 *
 * Der übliche Weg (`zerlege` + `paare`) braucht für beide Seiten eine
 * Halbseitenkennung. Justierte Zeilen haben keine – ihre Rechtecke sind aus den
 * Bildern gerechnet und stehen in keiner Vorlage –, und ein frei gezogener
 * Kasten ebenso wenig. Trotzdem liegt jedes dieser Rechtecke auf genau einer
 * Buchseite, und damit ist die Frage „lass die Gegenseite stehen" sehr wohl
 * beantwortbar: **Ihre Kästen werden wörtlich übernommen**, mit derselben
 * Geometrie, demselben Ausschnitt, Rahmen, Winkel und Ebene. Was keine Vorlage
 * kennt, trägt seine Lage selbst (`SlotAssignment.rect`, aufgelöst über
 * `wirksamePlaetze`) – derselbe Mechanismus wie beim eingeworfenen Bild.
 *
 * Die Doppelseite heißt danach `paar:<gewählt>+halb:leer`: Nur die gewählte
 * Seite steht in der Vorlage, die Gegenseite besteht aus freien Kästen. Der
 * Preis dafür steht in `handwork().positionen` – ein Neuaufbau stellt gerechnete
 * Zeilen wieder her, frei gesetzte Kästen nicht. Das ist der ehrlichere Handel
 * als die Alternative, die es vorher gab: die ganze Doppelseite neu anordnen und
 * dabei die Gegenseite verlieren, um die es gar nicht ging.
 *
 * Nicht getrennt wird, was als Doppelseite gedacht ist: ein Auftakt (sein Text
 * hängt an Textplätzen der Vorlage), ein Hintergrundbild über beide Seiten, ein
 * Kasten über dem Falz.
 */
function alsFreieKaesten(
  spread: Spread,
  half: HalfPage,
  opts: SetHalfPageOptions,
): { ok: boolean; error?: string; spread?: Spread; leftover: PhotoId[] } {
  const nein = (error: string) => ({ ok: false, error, leftover: [] as PhotoId[] });

  const template = templateById(spread.templateId);
  if (!template) return nein(`Die Vorlage ${spread.templateId} gibt es nicht`);
  if (
    templateMeta(template.id).chapterOnly ||
    template.tags?.includes('gruppenauftakt') ||
    (spread.texts ?? []).length > 0
  ) {
    return nein(
      'Eine Seite mit Vorlagentext lässt sich nur als ganze Doppelseite anordnen – ' +
        'seitenweise verlöre sie ihre Textplätze',
    );
  }
  // Nur ein Bild über **beide** Seiten macht das Blatt zur Einheit; eines auf
  // einer Buchseite bleibt liegen, wo es liegt — der Spread wird unten aus dem
  // alten zusammengesetzt und trägt es mit. Dieselbe Grenze wie in `teilbar`.
  if (spread.backgroundPhotoId && !spread.backgroundPhotoSide) {
    return nein(
      'Auf dieser Doppelseite liegt ein Bild über beide Seiten – sie lässt sich nur als Ganzes anordnen',
    );
  }

  const geo = new Map(template.slots.map((s) => [s.id, s]));
  const eigene: SlotAssignment[] = [];
  const gegen: SlotAssignment[] = [];
  for (const slot of spread.slots) {
    const platz = slot.rect ?? geo.get(slot.slotId);
    if (!platz) return nein(`Der Platz ${slot.slotId} hat keine Geometrie`);
    // Ein Kasten über der Falzachse gehört keiner der beiden Buchseiten ganz.
    // Ihn der näheren zuzuschlagen hieße, die Gegenseite doch anzufassen – und
    // genau das soll der Griff nicht.
    if (platz.x < 0.4999 && platz.x + platz.w > 0.5001) {
      return nein(
        'Auf dieser Doppelseite liegt ein Bild über dem Falz – sie lässt sich nur als Ganzes anordnen',
      );
    }
    const liegtRechts = platz.x + platz.w / 2 >= 0.5;
    if (liegtRechts === (opts.side === 'right')) eigene.push(slot);
    else {
      // Die Gegenseite bekommt ihre Lage als eigenes Rechteck – auch die Slots,
      // die sie bisher aus der Vorlage bezogen: Die neue Vorlage kennt dort
      // keinen Platz mehr, an dem sie hängen könnten.
      gegen.push(
        slot.rect ? slot : { ...slot, rect: { x: platz.x, y: platz.y, w: platz.w, h: platz.h } },
      );
    }
  }

  const nachKennung = new Map(opts.photos.map((p) => [p.id, p]));
  const angeordnet = layoutHalf({
    photos: eigene
      .map((s) => (s.photoId ? nachKennung.get(s.photoId) : undefined))
      .filter((p): p is Photo => p !== undefined),
    slots: half.slots,
    profile: opts.profile,
    ...(opts.weightOf ? { weightOf: opts.weightOf } : {}),
  });

  const templateId =
    opts.side === 'left' ? pairId(opts.halfId, HALF_BLANK_ID) : pairId(HALF_BLANK_ID, opts.halfId);
  if (!templateById(templateId)) {
    return nein(`Die Anordnung ${opts.halfId} lässt sich hier nicht einsetzen`);
  }

  const prefix = opts.side === 'left' ? 'l' : 'r';
  const slots: SlotAssignment[] = angeordnet.slots.map((s) => ({
    ...s,
    slotId: `${prefix}-${s.slotId}`,
  }));
  for (const s of gegen) {
    // Die Kennung bleibt, woran Ausschnitt und Neigung hängen – sie ist nur
    // innerhalb des Blattes eindeutig, und die neue Vorlage benennt ihre Plätze
    // mit Präfix. Trifft sie doch zusammen, bekommt der Kasten die nächste freie.
    slots.push(
      slots.some((v) => v.slotId === s.slotId) ? { ...s, slotId: einwurfPlatzId({ slots }) } : s,
    );
  }

  return {
    ok: true,
    spread: mitPlaetzen({ ...spread, templateId, slots }, template, templateById(templateId)),
    leftover: angeordnet.leftover,
  };
}

/**
 * Ordnet **eine** Seite einer Jahresseite neu an.
 *
 * Bis hierher war eine Jahresseite unteilbar, und der Grund war gut: Die
 * Halbseiten des Flusses tragen keine Textplätze, also verlöre sie Jahreszahl
 * und Ereigniszeilen. `chapter-halves.ts` hebt das auf — es führt die
 * **Texthälften** als eigene Familie und setzt sie mit einer beliebigen
 * Halbseite zu `kapitel:<links>+<rechts>` zusammen. Was hier bleibt, ist die
 * Buchhaltung: welche Seite gewählt wurde, was auf der anderen stehenbleibt.
 *
 * **Jede Seite wählt in ihrer eigenen Familie.** Auf der Textseite stehen die
 * Jahresseiten-Fassungen (Jahreszahl, dazu 0 bis n Bilder), gegenüber die
 * gewöhnlichen Halbseiten. Eine Flusshälfte auf der Textseite wäre genau der
 * Griff, der die Jahreszahl nimmt — er wird abgelehnt und nicht angeboten.
 *
 * **Die Gegenseite behält jedes Bild in seinem Platz.** Ihre Zuweisungen werden
 * über die Geometrie auf die Plätze der neuen Vorlage umgehängt, samt Ausschnitt,
 * Rahmen, Neigung, Ebene und Bildunterschrift. Wo die neue Vorlage keinen
 * gleichen Platz kennt — die Bildseite mancher Auftaktvorlage ist keine bekannte
 * Halbseite —, trägt der Kasten seine Lage selbst (`SlotAssignment.rect`), wie
 * bei `alsFreieKaesten`. Der Preis steht in `handwork().positionen`.
 */
export function setChapterHalf(
  spread: Spread,
  opts: SetHalfPageOptions,
): { ok: boolean; error?: string; spread?: Spread; leftover: PhotoId[] } {
  const nein = (error: string) => ({ ok: false, error, leftover: [] as PhotoId[] });

  const template = templateById(spread.templateId);
  if (!template) return nein(`Die Vorlage ${spread.templateId} gibt es nicht`);
  const jetzt = chapterHalfOfTemplate(template);
  if (!jetzt) {
    return nein('Diese Jahresseite lässt sich nicht in zwei Buchseiten zerlegen');
  }
  // Nur ein Bild über **beide** Seiten macht das Blatt zur Einheit; eines auf
  // einer Buchseite bleibt liegen, wo es liegt — der Spread wird unten aus dem
  // alten zusammengesetzt und trägt es mit. Dieselbe Grenze wie in `teilbar`.
  if (spread.backgroundPhotoId && !spread.backgroundPhotoSide) {
    return nein(
      'Auf dieser Doppelseite liegt ein Bild über beide Seiten – sie lässt sich nur als Ganzes anordnen',
    );
  }

  const textseite = jetzt.seite === opts.side;
  if (textseite && !isChapterHalf(opts.halfId)) {
    return nein(
      'Auf dieser Seite stehen Jahreszahl und Ereigniszeilen – wählbar sind hier nur die Fassungen der Jahresseite',
    );
  }
  if (!textseite && isChapterHalf(opts.halfId)) {
    return nein('Die Jahreszahl steht auf der anderen Seite dieser Doppelseite');
  }
  const gewaehlt = textseite ? chapterHalfById(opts.halfId) : halfPageById(opts.halfId);
  if (!gewaehlt) return nein(`Anordnung ${opts.halfId} gibt es nicht`);

  // Was auf der Gegenseite steht, behält seine Kennung — beim ersten Griff auf
  // einer Vorlage aus der Bibliothek gibt es dafür aber keine: Deren Bildhälfte
  // ist in `halves.ts` bewusst nicht enthalten. Dann tritt die leere Halbseite
  // an ihre Stelle, und die Bilder behalten ihre Lage als freie Kästen.
  const gegenId = textseite
    ? (halvesOfTemplate(template)[opts.side === 'left' ? 'right' : 'left'] ?? HALF_BLANK_ID)
    : jetzt.id;

  const neueId =
    opts.side === 'left'
      ? chapterPairId(opts.halfId, gegenId)
      : chapterPairId(gegenId, opts.halfId);
  const neu = templateById(neueId);
  if (!neu) return nein(`Die Anordnung ${opts.halfId} lässt sich hier nicht einsetzen`);

  // Alte Zuweisungen nach Buchseite trennen — über die Geometrie, denn bei einer
  // Vorlage aus der Bibliothek sagt allein das Rechteck, wo ein Bild steht.
  const geo = new Map(template.slots.map((s) => [s.id, s]));
  const eigene: SlotAssignment[] = [];
  const gegen: { slot: SlotAssignment; platz: { x: number; y: number; w: number; h: number } }[] =
    [];
  for (const slot of spread.slots) {
    const platz = slot.rect ?? geo.get(slot.slotId);
    if (!platz) return nein(`Der Platz ${slot.slotId} hat keine Geometrie`);
    if (platz.x < 0.4999 && platz.x + platz.w > 0.5001) {
      return nein(
        'Auf dieser Doppelseite liegt ein Bild über dem Falz – sie lässt sich nur als Ganzes anordnen',
      );
    }
    const liegtRechts = platz.x + platz.w / 2 >= 0.5;
    if (liegtRechts === (opts.side === 'right')) eigene.push(slot);
    else gegen.push({ slot, platz: { x: platz.x, y: platz.y, w: platz.w, h: platz.h } });
  }

  const prefix = opts.side === 'left' ? 'l-' : 'r-';
  const nachKennung = new Map(opts.photos.map((p) => [p.id, p]));
  const angeordnet = layoutHalf({
    photos: eigene
      .map((s) => (s.photoId ? nachKennung.get(s.photoId) : undefined))
      .filter((p): p is Photo => p !== undefined),
    slots: neu.slots.filter((s) => s.id.startsWith(prefix)),
    profile: opts.profile,
    ...(opts.weightOf ? { weightOf: opts.weightOf } : {}),
  });

  // Die Gegenseite auf die Plätze der neuen Vorlage umhängen: gleiche Geometrie,
  // gleicher Platz. Die Kennungen wechseln dabei (`a` → `r-a`), der Inhalt nicht.
  const gegenPlaetze = new Map(
    neu.slots.filter((s) => !s.id.startsWith(prefix)).map((s) => [key(s), s.id]),
  );
  const slots: SlotAssignment[] = [...angeordnet.slots];
  for (const { slot, platz } of gegen) {
    const treffer = gegenPlaetze.get(key(platz));
    if (treffer && !slots.some((v) => v.slotId === treffer)) {
      slots.push({ ...slot, slotId: treffer });
      continue;
    }
    // Kein gleicher Platz in der neuen Vorlage: Der Kasten trägt seine Lage
    // selbst. Die Kennung muss frei sein — sonst hinge ein zweiter Ausschnitt am
    // selben Platz.
    const frei = slots.some((v) => v.slotId === slot.slotId)
      ? einwurfPlatzId({ slots })
      : slot.slotId;
    slots.push({ ...slot, slotId: frei, rect: platz });
  }

  return {
    ok: true,
    spread: mitPlaetzen({ ...spread, templateId: neueId, slots }, template, neu),
    leftover: angeordnet.leftover,
  };
}

/**
 * Trägt die weggenommenen Plätze in die neue Anordnung um.
 *
 * Eine Zeile Buchhaltung, aber sie gehört an jede Stelle, die `templateId`
 * wechselt: Ein Vermerk, der die alte Kennung behielte, versteckte gegenüber
 * irgendeinen anderen Platz – unbemerkt und ohne Weg zurück. Warum die Stelle
 * auf dem Blatt entscheidet und nicht die Kennung, steht bei
 * `hiddenSlotsNachWechsel`.
 */
function mitPlaetzen(spread: Spread, alt: Template | undefined, neu: Template | undefined): Spread {
  const uebrig = hiddenSlotsNachWechsel(spread.hiddenSlots, alt, neu);
  if (uebrig.length > 0) return { ...spread, hiddenSlots: uebrig };
  const { hiddenSlots: _fort, ...ohne } = spread;
  return ohne;
}

/**
 * Ordnet **eine** Buchseite neu an; die gegenüberliegende bleibt, wie sie ist.
 *
 * Der Weg dahin ist derselbe wie beim Einschieben einer Seite: Das Blatt
 * zerfällt an der Falzachse in zwei Buchseiten, eine davon wird ersetzt, und
 * beide werden wieder gepaart. Die Gegenseite behält damit jedes Bild in seinem
 * Platz – samt Ausschnitt, Rahmen, Neigung, Ebene und Bildunterschrift.
 *
 * Vorher lief der Griff über `layoutSpread` mit der zusammengesetzten
 * Paarkennung, und der ordnet die **ganze** Doppelseite neu an: Wer die rechte
 * Seite umstellte, fand links andere Bilder in anderen Plätzen und jeden
 * Ausschnitt verworfen. Die Rechnung war nicht falsch, nur zu weit gefasst –
 * eine Zuordnung über beide Seiten hinweg ist gültig und trifft trotzdem nicht,
 * was verlangt war.
 *
 * **Was in keine Halbseite zerfällt, wird trotzdem getrennt** – über
 * `alsFreieKaesten` (siehe dort). Justierte Zeilen etwa haben keine
 * Halbseitenkennung, aber sehr wohl eine Buchseite, auf der jedes ihrer
 * Rechtecke liegt.
 *
 * @returns `ok: false`, wenn die Doppelseite als Ganzes gedacht ist – ein
 * Auftakt, ein Bild über dem Falz, ein Hintergrundbild über beide Seiten. Der
 * Aufrufer muss dann die ganze Doppelseite anordnen; hier wird nichts geraten.
 */
export function setHalfPage(
  spread: Spread,
  opts: SetHalfPageOptions,
): { ok: boolean; error?: string; spread?: Spread; leftover: PhotoId[] } {
  const half = halfPageById(opts.halfId);
  if (!half) return { ok: false, error: `Halbseite ${opts.halfId} gibt es nicht`, leftover: [] };

  // Ohne Rücksicht auf das Schloss, wie beim Löschen einer einzelnen Seite: Wer
  // eine Seite seiner selbst gebauten Doppelseite umstellt, verlangt genau
  // diese Trennung. Das Schloss schützt die Handarbeit vor der Umpaarung, nicht
  // vor dem Benutzer.
  const teile = teilbar(spread) ? zerlege(spread) : undefined;
  if (!teile) return alsFreieKaesten(spread, half, opts);

  const [links, rechts] = teile;
  const alt = opts.side === 'left' ? links : rechts;

  const nachKennung = new Map(opts.photos.map((p) => [p.id, p]));
  const eigene = (alt.slots ?? [])
    .map((s) => (s.photoId ? nachKennung.get(s.photoId) : undefined))
    .filter((p): p is Photo => p !== undefined);

  const angeordnet = layoutHalf({
    photos: eigene,
    slots: half.slots,
    profile: opts.profile,
    ...(opts.weightOf ? { weightOf: opts.weightOf } : {}),
  });

  const neue: BookPage = {
    span: 1,
    halfId: opts.halfId,
    slots: angeordnet.slots,
    // Textblöcke stehen frei und gehören nicht zur Anordnung – sie bleiben, wo
    // sie stehen. Übernommen werden sie hier trotzdem, damit `paare` dieselbe
    // Seite zusammensetzt, die es zerlegt hat.
    ...(alt.blocks ? { blocks: alt.blocks } : {}),
    ...(alt.background !== undefined ? { background: alt.background } : {}),
    ...(alt.timeline !== undefined ? { timeline: alt.timeline } : {}),
    ...(alt.from !== undefined ? { from: alt.from } : {}),
  };

  const blatt = paare(
    opts.side === 'left' ? neue : links,
    opts.side === 'left' ? rechts : neue,
    spread.index,
  );
  if (!blatt) {
    return {
      ok: false,
      error: `Die Anordnung ${opts.halfId} lässt sich hier nicht einsetzen`,
      leftover: [],
    };
  }

  // Nur Vorlage und Plätze wechseln. Kennung, Schloss, Anker, Jahr und
  // Textblöcke gehören der Doppelseite und nicht ihrer Anordnung: `paare` baut
  // ein neues Blatt, hier wird ein bestehendes umgestellt.
  return {
    ok: true,
    spread: mitPlaetzen(
      { ...spread, templateId: blatt.templateId, slots: blatt.slots },
      templateById(spread.templateId),
      templateById(blatt.templateId),
    ),
    leftover: angeordnet.leftover,
  };
}

export interface InsertSinglePageOptions {
  /**
   * Stelle in der Buchseitenfolge, nullbasiert: `0` ist die erste Buchseite,
   * `2 × Blätter` das Ende. Eine ungerade Zahl trifft eine rechte Seite.
   */
  atPage: number;
  /** Halbseite der neuen Seite – leer oder mit einem Bildplatz. */
  halfId: string;
  /** Kennung der neuen Doppelseite; die eigene Seite behält sie über Neuaufbauten. */
  id: string;
  blocks?: TextBlock[];
  background?: string;
}

export interface SinglePageResult {
  ok: boolean;
  error?: string;
  spreads: Spread[];
  /**
   * Was die Umpaarung gekostet hat.
   *
   * `neuGepaart` zählt Blätter, deren beide Hälften vorher nicht zusammenstanden –
   * ein Blatt, das nur seine Nummer wechselt, ist keine Änderung. `leerseiten`
   * sind die Halbseiten, die für die Parität neu eingeschoben werden mussten:
   * `0` heißt, dass eine bereits leere verbraucht wurde und das Buch nicht
   * länger geworden ist. `leereBlaetter` sind Blätter ganz ohne Bild.
   */
  bericht?: {
    neuGepaart: number;
    leerseiten: number;
    leereBlaetter: number;
    /** Ob eine schon vorhandene leere Halbseite den Platz gestellt hat. */
    leerseiteVerbraucht: boolean;
  };
}

/**
 * Ob zwei Bücher dasselbe zeigen.
 *
 * Verglichen wird, wo jedes Bild liegt – nicht die Vorlagenkennung. Ein Blatt
 * mit einem Bild links heißt einmal `spread.1up.hero-left` und nach dem
 * Umpaaren `paar:halb:spread.1up.hero-left:L+halb:leer`; gedruckt ist es
 * dasselbe Blatt. Für die Frage „hat der Griff etwas bewirkt" zählt allein die
 * Wirkung.
 */
function unveraendert(vorher: readonly Spread[], nachher: readonly Spread[]): boolean {
  const form = (spreads: readonly Spread[]) =>
    spreads
      .map((spread) => {
        const template = templateById(spread.templateId);
        const geo = new Map((template?.slots ?? []).map((s) => [s.id, s]));
        return spread.slots
          .filter((s) => s.photoId)
          .map((s) => {
            const platz = s.rect ?? geo.get(s.slotId);
            const ort = platz
              ? [platz.x, platz.y, platz.w, platz.h].map((v) => v.toFixed(4)).join(',')
              : '?';
            return `${s.photoId}@${ort}`;
          })
          .sort()
          .join(';');
      })
      .join('|');

  return form(vorher) === form(nachher);
}

/**
 * Das Buch als Folge von Buchseiten; unzerlegbare Blätter bleiben ein Eintrag.
 *
 * `auchTrennen` nennt Kennungen von Blättern, die trotz ihres Schlosses zerlegt
 * werden – das ist der Fall, wenn jemand ausdrücklich eine ihrer Seiten löscht.
 */
function buchseitenfolge(
  spreads: readonly Spread[],
  auchTrennen?: ReadonlySet<string>,
): BookPage[] {
  const folge: BookPage[] = [];
  for (const spread of spreads) {
    const darf = zerlegbar(spread) || (auchTrennen?.has(spread.id) === true && teilbar(spread));
    const teile = darf ? zerlege(spread) : undefined;
    if (teile) folge.push(teile[0], teile[1]);
    else folge.push({ span: 2, spread });
  }
  return folge;
}

/**
 * Welcher Folgeeintrag steht an dieser Buchseitenposition?
 *
 * Ein unzerlegtes Blatt lässt sich nicht in der Mitte treffen – eine Position
 * innerhalb eines solchen Blattes trifft seinen Anfang.
 */
function folgeIndexVon(folge: readonly BookPage[], stelle: number): number {
  let gezaehlt = 0;
  for (const [i, eintrag] of folge.entries()) {
    if (gezaehlt >= stelle) return i;
    gezaehlt += eintrag.span;
  }
  return folge.length;
}

/**
 * Welcher Eintrag **enthält** diese Buchseite?
 *
 * Der Unterschied zu `folgeIndexVon` ist die zweite Seite eines unzerlegten
 * Blattes: Als Einfügestelle gehört sie zur Grenze dahinter, als zu löschende
 * Seite gehört sie zu diesem Blatt. Beim Löschen die Grenze zu nehmen träfe die
 * Nachbarseite – gemessen an einer eingefügten Seite hinter einem festgehaltenen
 * Blatt: Statt ihrer verschwand das Bild danach.
 */
function eintragAn(folge: readonly BookPage[], stelle: number): number {
  let gezaehlt = 0;
  for (const [i, eintrag] of folge.entries()) {
    if (stelle < gezaehlt + eintrag.span) return i;
    gezaehlt += eintrag.span;
  }
  return -1;
}

/**
 * Fügt eine einzelne Buchseite ein und zieht die Blattgrenzen neu.
 *
 * Die neue Seite ist festgehalten (`locked`), wie jede selbst gebaute: Sie
 * besteht aus Handarbeit, und ein Neuaufbau hätte nichts, woraus er sie
 * wiederherstellen könnte.
 */
export function insertSinglePage(
  spreads: readonly Spread[],
  opts: InsertSinglePageOptions,
): SinglePageResult {
  const half = halfPageById(opts.halfId);
  if (!half) {
    return { ok: false, error: `Halbseite ${opts.halfId} gibt es nicht`, spreads: [...spreads] };
  }

  const folge = buchseitenfolge(spreads);
  const seitenzahl = folge.reduce((n, e) => n + e.span, 0);
  const stelle = Math.min(Math.max(0, Math.trunc(opts.atPage)), seitenzahl);
  const einfuegeIndex = folgeIndexVon(folge, stelle);

  const neue: BookPage = {
    span: 1,
    halfId: opts.halfId,
    slots: half.slots.map((s: TemplateSlot) => ({
      slotId: s.id,
      photoId: null,
      crop: { ...FULL_CROP },
    })),
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
    ...(opts.background !== undefined ? { background: opts.background } : {}),
    from: opts.id,
    own: true,
  };

  folge.splice(einfuegeIndex, 0, neue);

  // --- Platz für die neue Seite beschaffen -------------------------------
  //
  // Ein Buch besteht aus Blättern: Eine Seite mehr heißt, dass irgendwo eine
  // Halbseite frei werden muss. Meist steht schon eine leere herum – jede
  // Vorlage mit einem einzigen Bild hat eine –, und die wird verbraucht statt
  // eine neue zu erzeugen. Sonst hätte das Einfügen einer Seite eine ganze leere
  // Doppelseite zur Folge, und das Buch wüchse um zwei Seiten statt um eine.
  //
  // Gesucht wird nur bis zum nächsten unzerlegbaren Blatt: Dahinter stellt der
  // Paritätsausgleich die Ordnung ohnehin wieder her, und eine dort entnommene
  // Leerseite würde nichts sparen, sondern nur eine gewollte Ruhefläche nehmen.
  let verbraucht = false;
  for (let i = einfuegeIndex + 1; i < folge.length; i++) {
    const eintrag = folge[i]!;
    if (eintrag.span === 2) break;
    // Leer heißt: trägt nichts – nicht „hat keinen Platz aus der Vorlage".
    // Eine Buchseite mit der Kennung `halb:leer` kann sehr wohl ein Bild
    // tragen: ein eingeworfenes, oder die Gegenseite eines seitenweisen
    // Anordnungswechsels (`alsFreieKaesten`). Über die Kennung gesucht, fiel
    // sie samt Bild aus dem Buch.
    const traegt = (eintrag.slots ?? []).length > 0 || (eintrag.blocks ?? []).length > 0;
    if (eintrag.halfId === HALF_BLANK_ID && !traegt) {
      folge.splice(i, 1);
      verbraucht = true;
      break;
    }
  }

  return paareNeu(folge, spreads, verbraucht);
}

/**
 * Setzt halbseitig festgehaltene Buchseiten in den neu erzeugten Fluss zurück.
 *
 * Das Gegenstück zu `insertKept` für Blätter — mit demselben Anker und
 * derselben Absicht, nur eine Buchseite statt zwei: Die bewahrte Seite kommt
 * dorthin, wo ihr Ankerfoto gelandet ist, und bekommt die Nachbarin, die der
 * Fluss dort ohnehin baut. Genau darin liegt der Unterschied zum ganzen Schloss:
 * Die Gegenseite ist neu, nicht eingefroren.
 *
 * Die Seite darf dabei die Blattseite wechseln — `paare` normiert jede Buchseite
 * in Linksform und spiegelt sie zurück, wo sie landet. Das ist die Entscheidung
 * gegen einen Paritätszwang: Eine bewahrte linke Seite, die nur links stehen
 * dürfte, verlangte vor sich eine leere Halbseite, und das Buch bekäme je
 * festgehaltener Seite eine weiße dazu.
 *
 * Wie beim Einfügen wird eine leere Halbseite dahinter verbraucht, statt das
 * Buch wachsen zu lassen: Das Budget hat für diese Seite schon bezahlt
 * (`generateBook`, `budgetSeiten`).
 */
export function insertKeptHalves(
  flow: readonly Spread[],
  gehalten: readonly Spread[],
): SinglePageResult & { uebersprungen?: string[] } {
  if (gehalten.length === 0) {
    return { ok: true, spreads: flow.map((spread, i) => ({ ...spread, index: i })) };
  }

  const folge = buchseitenfolge(flow);

  /**
   * Buchseitenposition je Foto — **jedes Mal neu gerechnet**.
   *
   * Gezählt wird über die Folge und nicht über die Blätter: Der Anker nennt ein
   * Foto, eingefügt wird aber zwischen Buchseiten, und ein unzerlegtes Blatt
   * belegt deren zwei.
   *
   * Einmal vorab gerechnet wäre die Karte ab der zweiten eingesetzten Seite
   * falsch: Jede Einfügung verschiebt alles dahinter um eine Buchseite, und die
   * zweite Seite landete dann eine Position zu früh — bei drei Seiten zwei.
   * Die Folge ist kurz, das Neurechnen kostet nichts gegen einen Fehler, den
   * man erst im gedruckten Buch sieht.
   */
  const positionen = (): { seiteVonFoto: Map<PhotoId, number>; seitenzahl: number } => {
    const seiteVonFoto = new Map<PhotoId, number>();
    let gezaehlt = 0;
    for (const eintrag of folge) {
      const slots = eintrag.span === 2 ? (eintrag.spread?.slots ?? []) : (eintrag.slots ?? []);
      for (const slot of slots) {
        if (slot.photoId !== null && !seiteVonFoto.has(slot.photoId)) {
          seiteVonFoto.set(slot.photoId, gezaehlt);
        }
      }
      gezaehlt += eintrag.span;
    }
    return { seiteVonFoto, seitenzahl: gezaehlt };
  };

  // In der bisherigen Reihenfolge einsetzen: Treffen zwei auf dieselbe Stelle,
  // entscheidet sie – dieselbe Regel wie in `insertKept`.
  const sortiert = [...gehalten].sort((a, b) => a.index - b.index);

  const uebersprungen: Spread[] = [];

  for (const spread of sortiert) {
    const seite = spread.lockedSide;
    if (!seite) continue;
    /*
     * Erst `teilbar`, dann `zerlege`.
     *
     * `zerlege` fragt nur die Geometrie der Vorlage und trennt deshalb auch, was
     * nicht getrennt werden darf: Ein Auftakt verlöre dabei seine Textplätze,
     * ein Blatt mit Hintergrundbild das Bild — beides kennt eine Buchseite
     * nicht. `teilbar` ist die Bedingung, unter der das halbe Schloss überhaupt
     * gesetzt werden darf (`setSpreadLocked`); hat sich das Blatt seither
     * geändert, fällt es hier heraus statt beschädigt zu werden.
     */
    const teile = teilbar(spread) ? zerlege(spread) : undefined;
    if (!teile) {
      uebersprungen.push(spread);
      continue;
    }

    const { seiteVonFoto, seitenzahl } = positionen();
    const halbseite = seite === 'left' ? teile[0] : teile[1];
    const anchor = spread.anchor;
    const treffer = anchor ? seiteVonFoto.get(anchor.photoId) : undefined;
    const stelle =
      treffer !== undefined
        ? anchor!.where === 'after'
          ? treffer + 1
          : treffer
        : Math.min(Math.max(0, spread.index * 2), seitenzahl);

    const einfuegeIndex = folgeIndexVon(folge, stelle);
    folge.splice(einfuegeIndex, 0, halbseite);

    // Dieselbe Suche wie beim Einfügen von Hand: Eine leere Halbseite dahinter
    // stellt den Platz, sonst wächst das Buch um eine Seite.
    for (let i = einfuegeIndex + 1; i < folge.length; i++) {
      const eintrag = folge[i]!;
      if (eintrag.span === 2) break;
      const traegt =
        (eintrag.slots ?? []).some((sl) => sl.photoId) || (eintrag.blocks ?? []).length > 0;
      if (eintrag.halfId === HALF_BLANK_ID && !traegt && !eintrag.own) {
        folge.splice(i, 1);
        break;
      }
    }
  }

  const ergebnis = paareNeu(folge, flow, false);
  return uebersprungen.length > 0
    ? { ...ergebnis, uebersprungen: uebersprungen.map((sp) => sp.id) }
    : ergebnis;
}

/**
 * Nimmt eine einzelne Buchseite aus dem Buch und zieht die Blattgrenzen neu.
 *
 * Das Gegenstück zum Einfügen, mit derselben Rechnung: Die Seite fällt aus der
 * Folge, alles danach rückt eine Halbseite auf, und vor dem nächsten
 * unzerlegbaren Blatt füllt eine leere Halbseite auf. Geht die Rechnung auf,
 * verschwindet ein Blatt.
 *
 * Bilder auf dieser Seite gehen nicht verloren: Der Fotopool ist die Differenz
 * zwischen Bestand und platzierten Bildern, sie liegen unmittelbar danach dort.
 */
export function removeSinglePage(
  spreads: readonly Spread[],
  atPage: number,
): SinglePageResult & { photoCount: number } {
  let folge = buchseitenfolge(spreads);
  const seitenzahl = folge.reduce((n, e) => n + e.span, 0);
  const stelle = Math.trunc(atPage);

  if (stelle < 0 || stelle >= seitenzahl) {
    return {
      ok: false,
      error: `Buchseite ${stelle + 1} gibt es nicht`,
      spreads: [...spreads],
      photoCount: 0,
    };
  }

  let index = eintragAn(folge, stelle);

  // Trifft es ein festgehaltenes Blatt, wird es für diesen einen Griff getrennt:
  // Wer eine Seite seiner selbst gebauten Doppelseite löscht, verlangt genau
  // das. Das Schloss schützt die Handarbeit vor der Umpaarung, nicht vor dem
  // Benutzer.
  const getroffen = folge[index];
  if (getroffen?.span === 2 && getroffen.spread?.locked && teilbar(getroffen.spread)) {
    folge = buchseitenfolge(spreads, new Set([getroffen.spread.id]));
    index = eintragAn(folge, stelle);
  }

  const eintrag = folge[index];
  if (!eintrag) {
    return { ok: false, error: 'Buchseite nicht gefunden', spreads: [...spreads], photoCount: 0 };
  }

  // Ein unzerlegbares Blatt hat keine einzelne Seite, die man herausnehmen
  // könnte – ein Auftakt trägt seinen Text über beide Hälften, justierte Zeilen
  // ihre Rechtecke. Das gehört gesagt, statt heimlich das ganze Blatt zu nehmen.
  if (eintrag.span === 2) {
    return {
      ok: false,
      error:
        'Diese Doppelseite lässt sich nicht in einzelne Seiten trennen – ' +
        'nimm sie ganz aus dem Buch.',
      spreads: [...spreads],
      photoCount: 0,
    };
  }

  const photoCount = (eintrag.slots ?? []).filter((s) => s.photoId).length;
  folge.splice(index, 1);

  const ergebnis = paareNeu(folge, spreads, false);
  if (!ergebnis.ok) return { ...ergebnis, photoCount: 0 };

  // Bleibt das Buch dabei unverändert, war der Griff wirkungslos – und das
  // gehört gesagt statt stillschweigend Erfolg zu melden. Der Fall ist echt und
  // nicht selten: Eine leere Seite unmittelbar vor einem Blatt, das sich nicht
  // trennen lässt, wird von der Blattaufteilung sofort wieder erzwungen. Weg
  // ist sie nur mit dem ganzen Blatt.
  if (unveraendert(spreads, ergebnis.spreads)) {
    return {
      ok: false,
      error:
        'Diese Seite lässt sich nicht einzeln entfernen: Sie liegt vor einer Doppelseite, ' +
        'die sich nicht trennen lässt, und die Blattaufteilung erzwingt sie dort wieder. ' +
        'Nimm die ganze Doppelseite heraus.',
      spreads: [...spreads],
      photoCount: 0,
    };
  }

  return { ...ergebnis, photoCount };
}

/**
 * Setzt eine Buchseitenfolge zu Blättern zusammen.
 *
 * Ein unzerlegtes Blatt muss auf einer Blattgrenze beginnen. Steht davor noch
 * eine Seite offen, füllt eine leere Halbseite auf – das ist der Punkt, an dem
 * die Parität wieder gerade wird und alles Weitere unverändert bleibt.
 */
function paareNeu(
  folge: readonly BookPage[],
  original: readonly Spread[],
  leerseiteVerbraucht: boolean,
): SinglePageResult {
  const ergebnis: Spread[] = [];
  let leerseiten = 0;
  let neuGepaart = 0;
  let offen: BookPage | undefined;

  /** Ob eine Buchseite nichts trägt – kein Bild, keinen Text. */
  const nichts = (seite: BookPage): boolean =>
    !seite.own && (seite.slots ?? []).every((s) => !s.photoId) && (seite.blocks ?? []).length === 0;

  const schliessen = (rechts: BookPage): boolean => {
    const links = offen!;
    offen = undefined;

    // Ein Blatt, das durch das Umpaaren entsteht und nichts trägt, wird gar
    // nicht gebaut: Es wäre reines Artefakt der verschobenen Blattgrenzen –
    // zwei leere Hälften, die vorher zu verschiedenen Blättern gehörten. Ein
    // Blatt, das schon vorher beidseitig leer war, bleibt dagegen: Dort war es
    // eine Entscheidung.
    if (links.from !== rechts.from && nichts(links) && nichts(rechts)) return true;

    const blatt = paare(links, rechts, ergebnis.length);
    if (!blatt) return false;
    // Neu zusammengesetzt ist ein Blatt, dessen beide Hälften vorher nicht
    // zusammen auf einem Blatt standen. Das ist die Zahl, die den Eingriff
    // beschreibt – ein Blatt, das nur seine Nummer wechselt, ist keine Änderung.
    if (links.from !== rechts.from) neuGepaart++;
    ergebnis.push(blatt);
    return true;
  };

  const leer = (): BookPage => ({ span: 1, halfId: HALF_BLANK_ID, slots: [], blocks: [] });
  const gescheitert = (): SinglePageResult => ({
    ok: false,
    error: 'Blatt nicht zusammensetzbar',
    spreads: [...original],
  });

  for (const eintrag of folge) {
    if (eintrag.span === 2) {
      if (offen) {
        if (!schliessen(leer())) return gescheitert();
        leerseiten++;
      }
      ergebnis.push({ ...eintrag.spread!, index: ergebnis.length });
      continue;
    }

    if (!offen) offen = eintrag;
    else if (!schliessen(eintrag)) return gescheitert();
  }

  if (offen) {
    if (!schliessen(leer())) return gescheitert();
    leerseiten++;
  }

  const leereBlaetter = ergebnis.filter(
    (blatt) => blatt.slots.every((s) => !s.photoId) && !blatt.locked && !blatt.texts?.length,
  ).length;

  return {
    ok: true,
    spreads: ergebnis,
    bericht: { neuGepaart, leerseiten, leereBlaetter, leerseiteVerbraucht },
  };
}

/**
 * Packt zwei benachbarte Buchseiten zu einer zusammen.
 *
 * Der kleine Bruder von `verschmelzeDoppelseiten` (`layout/verschmelzen.ts`):
 * Dort werden zwei Blätter eines, hier zwei Buchseiten eine, und das Buch wird
 * **eine** Seite kürzer statt zweier. Gebraucht für den häufigen Fall, dass nur
 * eine Seite zu luftig steht — ihre Nachbarin dazu, und beide zusammen füllen
 * eine.
 *
 * Gerechnet wird mit denselben Bausteinen wie das Einfügen und Herausnehmen
 * einer Seite: Die Blätter zerfallen in Buchseiten, die beiden Einträge werden
 * durch einen ersetzt, und die Folge wird neu gepaart. Die Anordnung wählt
 * `chooseHalf` — dieselbe Kostenrechnung, mit der die Automatik eine Vorlage
 * wählt, denn eine neue Bilderzahl braucht eine neue Halbseite und die von Hand
 * zu verlangen hieße, für einen Griff zwei zu brauchen.
 *
 * Drei Absagen, und jede nennt ihren Grund: ein unzerlegbares Blatt (Auftakt,
 * justierte Zeilen, Hintergrund über beide Seiten), eine festgehaltene eigene
 * Seite, und eine Bilderzahl, für die es keine Halbseite gibt — die Bibliothek
 * trägt bis vierzehn.
 */
export function mergeSinglePages(
  spreads: readonly Spread[],
  atPage: number,
  reflow: { profile: PrintProfile; weightOf?: (photoId: PhotoId) => PhotoWeight },
  /**
   * Die Fotos **aufgelöst** (`effectivePhotos`), wie `layoutSpread` sie erwartet:
   * Eine korrigierte Ausrichtung tauscht Breite und Höhe, und danach wird die
   * Anordnung gewählt.
   */
  bestand: ReadonlyMap<PhotoId, Photo>,
): SinglePageResult & { bilder: number; leftover: PhotoId[] } {
  const nein = (error: string): SinglePageResult & { bilder: number; leftover: PhotoId[] } => ({
    ok: false,
    error,
    spreads: [...spreads],
    bilder: 0,
    leftover: [],
  });

  const folge = buchseitenfolge(spreads);
  const seitenzahl = folge.reduce((n, e) => n + e.span, 0);
  const stelle = Math.trunc(atPage);
  if (stelle < 0 || stelle >= seitenzahl) return nein(`Buchseite ${stelle + 1} gibt es nicht`);

  const index = eintragAn(folge, stelle);
  const erste = folge[index];
  const zweite = folge[index + 1];
  if (!erste) return nein('Buchseite nicht gefunden');
  if (!zweite) return nein(`Hinter Buchseite ${stelle + 1} kommt keine zweite`);

  // Ein unzerlegbares Blatt hat keine einzelne Seite, die man packen könnte –
  // derselbe Satz wie beim Herausnehmen, und aus demselben Grund.
  if (erste.span === 2 || zweite.span === 2) {
    return nein(
      'Eine der beiden Seiten gehört zu einer Doppelseite, die sich nicht in einzelne ' +
        'Seiten trennen lässt – pack die ganzen Doppelseiten zusammen.',
    );
  }
  if (erste.own || zweite.own) {
    return nein('Eine der beiden Buchseiten ist festgehalten – erst lösen, dann packen');
  }

  const ids = [...(erste.slots ?? []), ...(zweite.slots ?? [])]
    .map((s) => s.photoId)
    .filter((id): id is PhotoId => id !== null);
  if (ids.length === 0) return nein('Auf diesen beiden Buchseiten liegt kein Bild');

  const photos = ids.map((id) => bestand.get(id)).filter((p): p is Photo => p !== undefined);
  if (photos.length < ids.length) {
    return nein(`${ids.length - photos.length} Bild(er) gehören nicht mehr zum Bestand`);
  }

  const kandidaten = halfPages().filter((h) => h.slots.length === photos.length);
  if (kandidaten.length === 0) {
    return nein(`Für ${photos.length} Bilder auf einer Buchseite gibt es keine Anordnung`);
  }

  const gewaehlt = chooseHalf({
    photos,
    halves: kandidaten,
    profile: reflow.profile,
    ...(reflow.weightOf ? { weightOf: reflow.weightOf } : {}),
  });
  if (!gewaehlt) return nein(`Für ${photos.length} Bilder gibt es keine Anordnung`);

  // Die erste Seite bleibt und nimmt auf: ihre Kennung, ihre Farbe, ihr
  // Zeitstrahl. Dieselbe Regel wie beim Paaren („bei ungleichen Werten gewinnt
  // die linke") und beim Packen zweier Doppelseiten.
  const gepackt: BookPage = {
    span: 1,
    halfId: gewaehlt.halfId,
    slots: gewaehlt.slots,
    ...(erste.from ? { from: erste.from } : {}),
    ...(erste.background !== undefined ? { background: erste.background } : {}),
    ...(erste.timeline !== undefined ? { timeline: erste.timeline } : {}),
    // Die Textblöcke beider Seiten wandern mit; ihre Lage ist in Linksform
    // normiert und gilt auf der gepackten Seite unverändert.
    ...((erste.blocks ?? []).length + (zweite.blocks ?? []).length > 0
      ? { blocks: [...(erste.blocks ?? []), ...(zweite.blocks ?? [])] }
      : {}),
    // Ein Hintergrundbild kann nur eine Seite haben. Die erste gewinnt; das
    // andere Foto liegt danach im Fotopool und wird als `leftover` gemeldet.
    ...(erste.backgroundPhotoId
      ? { backgroundPhotoId: erste.backgroundPhotoId }
      : zweite.backgroundPhotoId
        ? { backgroundPhotoId: zweite.backgroundPhotoId }
        : {}),
  };

  const neueFolge = [...folge];
  neueFolge.splice(index, 2, gepackt);

  const ergebnis = paareNeu(neueFolge, spreads, false);
  if (!ergebnis.ok) return { ...ergebnis, bilder: 0, leftover: [] };

  const verworfen = [
    ...gewaehlt.leftover,
    ...(erste.backgroundPhotoId && zweite.backgroundPhotoId ? [zweite.backgroundPhotoId] : []),
  ];
  return { ...ergebnis, bilder: photos.length, leftover: verworfen };
}
