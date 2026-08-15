/**
 * Die Jahresseite zerfällt auch — nur anders als eine Seite des Flusses.
 *
 * Eine Auftaktvorlage war bisher unteilbar: `halfChoices` meldete `auftakt`,
 * `setSpreadHalf` lehnte ab. Der Grund war handfest — die Halbseiten des Flusses
 * (`halves.ts`) tragen **keine Textplätze**, und `renderSpread` zeichnet nur
 * Texte, die auf einen `textSlot` der Vorlage zeigen. Aus zwei Flusshälften
 * zusammengesetzt verlor die Jahresseite Jahreszahl und Ereigniszeilen.
 *
 * Der Ausweg steckt in der Bibliothek selbst: **In jeder Jahresseite stehen alle
 * Textplätze auf einer Buchseite.** Damit ist die eine Seite die Textseite und
 * die andere eine gewöhnliche Bildseite, und beide lassen sich getrennt wählen,
 * sofern die Textplätze bei der Zusammensetzung mitkommen. Genau das tut dieses
 * Modul: Es führt die **Texthälften der Auftaktvorlagen** als eigene Familie
 * (`jahrseite:…`) und setzt sie mit einer beliebigen Halbseite des Flusses zu
 * `kapitel:<links>+<rechts>` zusammen.
 *
 * Drei Festlegungen tragen das:
 *
 * **Textseiten werden in Linksform geführt**, wie die Halbseiten auch. Die
 * Bibliothek spiegelt jede unsymmetrische Vorlage (`*.mirrored`), und dabei
 * wandern die Textplätze mit: Es gibt Jahresseiten mit dem Jahr rechts. In
 * Linksform fallen Vorlage und Spiegelung auf **eine** Textseite zusammen; auf
 * welcher Buchseite sie steht, sagt allein die Kennung der Doppelseite — der
 * Teil mit dem Präfix `jahrseite:` ist die Textseite.
 *
 * **Die Textplätze behalten ihre Kennung** (`t-year`, `t-events`). `TextElement`
 * verweist über `slotId` auf sie; ein Umbenennen wie bei den Bildplätzen
 * (`l-a`, `r-b`) nähme der Doppelseite genau den Text, um dessentwillen es
 * dieses Modul gibt — und zwar stillschweigend, denn ein Text ohne Platz wird
 * nicht gezeichnet, nicht gemeldet.
 *
 * **Eine zusammengesetzte Jahresseite bleibt eine Jahresseite.** `templateMeta`
 * gibt für `kapitel:` `chapterOnly` zurück. Sonst bekäme die Seite nach dem
 * ersten seitenweisen Griff Seitenzahlen (Auftakte bleiben ausgespart), fiele in
 * die Vorlagenwahl des Flusses und würde beim Bilderverschieben wie eine
 * gewöhnliche Doppelseite behandelt.
 */
import type { Template, TemplateId, TemplateSlot, TemplateTextSlot } from '../model/template.js';
import { halfPageById, mirror } from './halves.js';
import { allTemplates, templateMeta } from './index.js';

/** Kennungspräfix einer zusammengesetzten Jahresseite. */
export const CHAPTER_PAIR_PREFIX = 'kapitel:';

/** Kennungspräfix einer Texthälfte. */
export const CHAPTER_HALF_PREFIX = 'jahrseite:';

/**
 * Die Texthälfte einer Jahresseite: Textplätze und die Bilder daneben.
 *
 * Anders als `HalfPage` trägt sie `textSlots` — das ist der ganze Unterschied
 * und der Grund für einen eigenen Begriff. Wie jede Halbseite in Linksform.
 */
export interface ChapterHalf {
  id: string;
  /** Bildplätze der Hälfte, in Linksform und normiert auf die Doppelseite. */
  slots: TemplateSlot[];
  /** Jahreszahl und Ereigniszeilen, mit ihren Kennungen aus der Vorlage. */
  textSlots: TemplateTextSlot[];
  /** Aus welcher Auftaktvorlage sie stammt. */
  from: TemplateId;
  name: string;
}

/** Auf welcher Buchseite die Textplätze einer Vorlage stehen. */
export type Textseite = 'left' | 'right';

function kasten(r: { x: number; y: number; w: number; h: number }): string {
  return [r.x, r.y, r.w, r.h].map((v) => v.toFixed(4)).join(',');
}

function signature(half: Pick<ChapterHalf, 'slots' | 'textSlots'>): string {
  return [
    half.slots.map(kasten).sort().join('|'),
    half.textSlots
      .map((t) => `${t.id}:${t.role}:${kasten(t)}`)
      .sort()
      .join('|'),
  ].join('#');
}

/** Spiegelt Textplätze an der Falzachse. Die Kennung bleibt — an ihr hängt der Text. */
function mirrorTexts(texts: readonly TemplateTextSlot[]): TemplateTextSlot[] {
  return texts.map((t) => ({ ...t, x: 1 - t.x - t.w }));
}

/** Wie die Wahl sie nennt: die Jahreszahl steht immer darauf, die Bilder zählen. */
function nameFuer(bilder: number): string {
  if (bilder === 0) return 'Jahreszahl allein';
  return bilder === 1 ? 'Jahreszahl und ein Bild' : `Jahreszahl und ${bilder} Bilder`;
}

/**
 * Zerlegt eine Auftaktvorlage in Texthälfte und Bildhälfte.
 *
 * `undefined`, wenn die Textplätze auf beide Seiten verteilt sind oder ein Platz
 * über dem Falz liegt — dann bleibt die Vorlage unteilbar, statt falsch zerlegt
 * zu werden. Am Bestand gibt es diesen Fall nicht.
 */
function zerlege(
  template: Template,
): { seite: Textseite; text: Pick<ChapterHalf, 'slots' | 'textSlots'> } | undefined {
  const texte = template.textSlots ?? [];
  if (texte.length === 0) return undefined;
  if (template.slots.some((s) => s.x < 0.4999 && s.x + s.w > 0.5001)) return undefined;

  const linksText = texte.filter((t) => t.x + t.w <= 0.5001);
  const rechtsText = texte.filter((t) => t.x >= 0.4999);
  if (linksText.length + rechtsText.length !== texte.length) return undefined;
  if (linksText.length > 0 && rechtsText.length > 0) return undefined;

  const seite: Textseite = linksText.length > 0 ? 'left' : 'right';
  const bilder = template.slots.filter((s) =>
    seite === 'left' ? s.x + s.w <= 0.5001 : s.x >= 0.4999,
  );

  return {
    seite,
    text:
      seite === 'left'
        ? { slots: bilder, textSlots: texte }
        : { slots: mirror(bilder), textSlots: mirrorTexts(texte) },
  };
}

function buildChapterHalves(): ChapterHalf[] {
  const gesehen = new Map<string, ChapterHalf>();

  for (const t of allTemplates()) {
    if (!templateMeta(t.id).chapterOnly || t.tags?.includes('veraltet')) continue;
    const teile = zerlege(t);
    if (!teile) continue;

    const sig = signature(teile.text);
    if (gesehen.has(sig)) continue;
    gesehen.set(sig, {
      // Die Kennung hängt an der Quellvorlage und damit an etwas, das in
      // gespeicherten Projekten steht. Eine gespiegelte Fassung liefert dieselbe
      // Texthälfte und tritt der ersten ihre Kennung nicht weg.
      id: `${CHAPTER_HALF_PREFIX}${t.id}`,
      ...teile.text,
      from: t.id,
      name: nameFuer(teile.text.slots.length),
    });
  }

  return [...gesehen.values()].sort(
    (a, b) => a.slots.length - b.slots.length || a.id.localeCompare(b.id),
  );
}

/**
 * Erst beim ersten Zugriff gebaut — derselbe Zyklus wie bei den Halbseiten:
 * Dieses Modul liest die Bibliothek, die Bibliothek löst Kapitelkennungen über
 * dieses Modul auf. Beim Laden wäre `allTemplates()` noch leer.
 */
let CHAPTER_HALVES: ChapterHalf[] | undefined;
let BY_ID: Map<string, ChapterHalf> | undefined;

function ensure(): ChapterHalf[] {
  if (!CHAPTER_HALVES) {
    CHAPTER_HALVES = buildChapterHalves();
    BY_ID = new Map(CHAPTER_HALVES.map((h) => [h.id, h]));
  }
  return CHAPTER_HALVES;
}

/** Die Textseiten, unter denen die Textseite einer Jahresseite wählen kann. */
export function chapterHalves(): readonly ChapterHalf[] {
  return ensure();
}

export function chapterHalfById(id: string): ChapterHalf | undefined {
  ensure();
  return BY_ID?.get(id);
}

export function isChapterHalf(id: string): boolean {
  return id.startsWith(CHAPTER_HALF_PREFIX);
}

/** Kennung der Jahresseite aus ihren beiden Hälften, in Buchreihenfolge. */
export function chapterPairId(left: string, right: string): TemplateId {
  return `${CHAPTER_PAIR_PREFIX}${left}+${right}`;
}

export function splitChapterPairId(id: TemplateId): { left: string; right: string } | undefined {
  if (!id.startsWith(CHAPTER_PAIR_PREFIX)) return undefined;
  const [left, right] = id.slice(CHAPTER_PAIR_PREFIX.length).split('+');
  if (!left || !right) return undefined;
  return { left, right };
}

/**
 * Welche Texthälfte in dieser Vorlage steckt und auf welcher Seite sie steht.
 *
 * Für eine noch ungeteilte Auftaktvorlage die aus ihr abgeleitete, für eine
 * zusammengesetzte die gewählte. Damit kann die Oberfläche zeigen, was gerade
 * steht, bevor überhaupt einmal von Hand gewählt wurde — und der Server die
 * Gegenseite bewahren, wenn nur eine Seite wechselt.
 */
export function chapterHalfOfTemplate(
  template: Template,
): { id: string; seite: Textseite } | undefined {
  const paar = splitChapterPairId(template.id);
  if (paar) {
    if (isChapterHalf(paar.left)) return { id: paar.left, seite: 'left' };
    if (isChapterHalf(paar.right)) return { id: paar.right, seite: 'right' };
    return undefined;
  }
  if (!templateMeta(template.id).chapterOnly) return undefined;

  const teile = zerlege(template);
  if (!teile) return undefined;
  const sig = signature(teile.text);
  const treffer = ensure().find((h) => signature(h) === sig);
  return treffer ? { id: treffer.id, seite: teile.seite } : undefined;
}

/**
 * Setzt eine Jahresseite aus ihren beiden Hälften zusammen.
 *
 * Welche der beiden die Texthälfte ist, sagt ihr Präfix — sie darf links oder
 * rechts stehen. Die Bildplätze bekommen neue Kennungen (`l-a`, `r-b`) wie bei
 * `pairTemplate`, die **Textplätze nicht**: An ihnen hängen die Texte der
 * Doppelseite.
 *
 * @returns `undefined`, wenn eine der beiden Hälften unbekannt ist oder keine
 * von beiden Text trägt — dann meldet der Aufrufer das, statt eine halbe
 * Jahresseite zu zeichnen.
 */
export function chapterPairTemplate(id: TemplateId): Template | undefined {
  const teile = splitChapterPairId(id);
  if (!teile) return undefined;

  const textLinks = isChapterHalf(teile.left);
  const textRechts = isChapterHalf(teile.right);
  if (textLinks === textRechts) return undefined;

  const text = chapterHalfById(textLinks ? teile.left : teile.right);
  const bilder = halfPageById(textLinks ? teile.right : teile.left);
  if (!text || !bilder) return undefined;

  const links = textLinks
    ? { slots: text.slots, textSlots: text.textSlots }
    : { slots: bilder.slots, textSlots: [] as TemplateTextSlot[] };
  const rechts = textLinks
    ? { slots: mirror(bilder.slots), textSlots: [] as TemplateTextSlot[] }
    : { slots: mirror(text.slots), textSlots: mirrorTexts(text.textSlots) };

  return {
    id,
    name: `Jahresauftakt, ${text.name.toLowerCase()}, gegenüber ${bilder.slots.length} ${
      bilder.slots.length === 1 ? 'Bild' : 'Bilder'
    }`,
    pageSpan: 2,
    slots: [
      ...links.slots.map((s) => ({ ...s, id: `l-${s.id}` })),
      ...rechts.slots.map((s) => ({ ...s, id: `r-${s.id}` })),
    ],
    textSlots: [...links.textSlots, ...rechts.textSlots],
    tags: ['kapitel', 'auftakt'],
  };
}
