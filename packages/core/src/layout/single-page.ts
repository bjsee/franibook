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
    if (eintrag.halfId === HALF_BLANK_ID && (eintrag.blocks ?? []).length === 0) {
      folge.splice(i, 1);
      verbraucht = true;
      break;
    }
  }

  return paareNeu(folge, spreads, verbraucht);
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
