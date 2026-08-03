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
import type { SlotAssignment, Spread, TextBlock } from '../model/spread.js';
import type { Template, TemplateSlot } from '../model/template.js';
import {
  HALF_BLANK_ID,
  halfPageById,
  halvesOfTemplate,
  pairId,
  splitPairId,
} from '../templates/halves.js';
import { isJustified } from '../templates/justified.js';
import { templateById, templateMeta } from '../templates/index.js';

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
  if (isJustified(spread.templateId)) return false;
  if ((spread.texts ?? []).length > 0) return false;
  // Handarbeit wird nicht zerschnitten: Ein festgehaltenes Blatt behält seine
  // Form und seine Kennung – auch die selbst gebauten Seiten sind welche.
  if (spread.locked) return false;
  const template = templateById(spread.templateId);
  if (!template) return false;
  if (templateMeta(template.id).chapterOnly) return false;
  if (template.tags?.includes('gruppenauftakt')) return false;
  if (spread.backgroundPhotoId) return false; // ein randabfallendes Bild über beide Seiten

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
      });
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

  const slots: SlotAssignment[] = [];
  const zuweisen = (seite: BookPage, prefix: 'l' | 'r'): void => {
    for (const s of seite.slots ?? []) {
      slots.push({
        ...s,
        slotId: `${prefix}-${s.slotId}`,
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
  // trotzdem ein, gehört er gemeldet und nicht verschwiegen.
  const bekannt = new Set(template.slots.map((s) => s.id));
  if (slots.some((s) => !bekannt.has(s.slotId))) return undefined;

  const blocks = [
    ...(links.blocks ?? []),
    ...(rechts.blocks ?? []).map((b) => ({ ...b, rect: spiegel(b.rect) })),
  ];

  // Hintergrund und Zeitstrahl gehören dem Blatt, nicht der Seite. Bei
  // ungleichen Werten gewinnt die linke: Sie ist die Seite, die man beim
  // Umblättern zuerst sieht.
  const background = links.background ?? rechts.background;
  const timeline = links.timeline ?? rechts.timeline;

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
    ...(links.own || rechts.own ? { locked: true as const } : {}),
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
   * sind die Halbseiten, die für die Parität eingeschoben wurden, `leereBlaetter`
   * die Blätter, die dadurch ganz ohne Bild dastehen: Trifft eine leere Halbseite
   * aus einer Ein-Bild-Vorlage auf den Paritätsausgleich, bleibt eine leere
   * Doppelseite. Sie zu vermeiden hieße, Bilder aufrücken zu lassen – und damit
   * genau die Fotoverteilung anzufassen, die hier unangetastet bleiben soll.
   */
  bericht?: { neuGepaart: number; leerseiten: number; leereBlaetter: number };
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

  // --- Buchseitenfolge bilden -------------------------------------------
  const folge: BookPage[] = [];
  let seitenzahl = 0;
  for (const spread of spreads) {
    if (zerlegbar(spread)) {
      const teile = zerlege(spread);
      if (teile) {
        folge.push(teile[0], teile[1]);
        seitenzahl += 2;
        continue;
      }
    }
    folge.push({ span: 2, spread });
    seitenzahl += 2;
  }

  const stelle = Math.min(Math.max(0, Math.trunc(opts.atPage)), seitenzahl);

  // Wo in der Folge liegt diese Buchseitenposition? Ein unzerlegtes Blatt lässt
  // sich nicht in der Mitte treffen – dort wird davor eingefügt.
  let einfuegeIndex = folge.length;
  let gezaehlt = 0;
  for (const [i, eintrag] of folge.entries()) {
    if (gezaehlt >= stelle) {
      einfuegeIndex = i;
      break;
    }
    gezaehlt += eintrag.span;
  }

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

  // --- Neu paaren --------------------------------------------------------
  const ergebnis: Spread[] = [];
  let leerseiten = 0;
  let offen: BookPage | undefined;

  let neuGepaart = 0;

  const schliessen = (rechts: BookPage): boolean => {
    const links = offen!;
    const blatt = paare(links, rechts, ergebnis.length);
    if (!blatt) return false;
    // Neu zusammengesetzt ist ein Blatt, dessen beide Hälften vorher nicht
    // zusammen auf einem Blatt standen. Das ist die Zahl, die den Eingriff
    // beschreibt – ein Blatt, das nur seine Nummer wechselt, ist keine
    // Änderung.
    if (links.from !== rechts.from) neuGepaart++;
    ergebnis.push(blatt);
    offen = undefined;
    return true;
  };

  const leer = (): BookPage => ({ span: 1, halfId: HALF_BLANK_ID, slots: [], blocks: [] });

  for (const eintrag of folge) {
    if (eintrag.span === 2) {
      // Ein unzerlegtes Blatt muss auf einer Blattgrenze beginnen. Steht noch
      // eine Seite offen, füllt eine leere Halbseite auf – das ist der Punkt,
      // an dem die Parität wieder gerade wird und alles Weitere unverändert
      // bleibt.
      if (offen) {
        if (!schliessen(leer())) {
          return { ok: false, error: 'Blatt nicht zusammensetzbar', spreads: [...spreads] };
        }
        leerseiten++;
      }
      ergebnis.push({ ...eintrag.spread!, index: ergebnis.length });
      continue;
    }

    if (!offen) offen = eintrag;
    else if (!schliessen(eintrag)) {
      return { ok: false, error: 'Blatt nicht zusammensetzbar', spreads: [...spreads] };
    }
  }

  if (offen) {
    if (!schliessen(leer())) {
      return { ok: false, error: 'Blatt nicht zusammensetzbar', spreads: [...spreads] };
    }
    leerseiten++;
  }

  const leereBlaetter = ergebnis.filter(
    (blatt) => blatt.slots.every((s) => !s.photoId) && !blatt.locked && !blatt.texts?.length,
  ).length;

  return { ok: true, spreads: ergebnis, bericht: { neuGepaart, leerseiten, leereBlaetter } };
}
