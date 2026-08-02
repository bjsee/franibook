/**
 * Halbseiten: die Anordnung einer einzelnen Buchseite.
 *
 * Die Bibliothek ist auf Doppelseiten gebaut, und für die Automatik ist das
 * richtig – eine aufgeschlagene Doppelseite ist die Einheit, die man sieht. Von
 * Hand will man aber die eine Seite ändern, auf der das Bild falsch steht, und
 * nicht beide.
 *
 * Erzeugt wird nichts Neues: Jede vorhandene Vorlage zerfällt an der Falzachse
 * in zwei Hälften. Am Bestand geprüft liegt **kein einziger Slot** über dem
 * Falz – die Templates lassen die Falzzone ohnehin frei –, sodass alle 105
 * Vorlagen des Flusses sauber zerlegbar sind. Das ergibt 126 verschiedene
 * Halbseiten, die sich frei zu Doppelseiten kombinieren lassen.
 *
 * Geführt werden alle Halbseiten in **Linksform**. Für die rechte Seite wird
 * gespiegelt und nicht verschoben: Eine Seite hat außen mehr Rand als am Falz,
 * und eine nur verschobene linke Hälfte legte ihren Außenrand an den Falz.
 */
import type { Template, TemplateId, TemplateSlot } from '../model/template.js';
import { allTemplates, templateMeta } from './index.js';

/** Kennungspräfix einer zusammengesetzten Doppelseite. */
export const PAIR_PREFIX = 'paar:';

export interface HalfPage {
  id: string;
  /** Slots in Linksform, normiert auf die ganze Doppelseite. */
  slots: TemplateSlot[];
  /** Aus welcher Vorlage die Hälfte stammt – für die Herkunft in der Oberfläche. */
  from: TemplateId;
}

/** Geometrische Signatur, um gleiche Hälften nur einmal anzubieten. */
function signature(slots: readonly TemplateSlot[]): string {
  return slots
    .map((s) => [s.x, s.y, s.w, s.h].map((v) => v.toFixed(4)).join(','))
    .sort()
    .join('|');
}

/** Spiegelt Slots an der Falzachse – aus einer linken Hälfte wird eine rechte. */
function mirror(slots: readonly TemplateSlot[]): TemplateSlot[] {
  return slots.map((s) => ({ ...s, x: 1 - s.x - s.w }));
}

function buildHalves(): HalfPage[] {
  const gesehen = new Map<string, HalfPage>();

  for (const t of allTemplates()) {
    const meta = templateMeta(t.id);
    // Auftakte bleiben außen vor: Ihre Vorlagen tragen Text und werden gezielt
    // vergeben, nicht über die Slotzahl gefunden. Veraltete ebenso.
    if (meta.chapterOnly || t.tags?.includes('veraltet') || t.tags?.includes('gruppenauftakt')) {
      continue;
    }

    const links = t.slots.filter((s) => s.x + s.w <= 0.5001);
    const rechts = t.slots.filter((s) => s.x >= 0.4999);
    // Eine Vorlage mit einem Slot über dem Falz ließe sich nicht halbieren,
    // ohne ein Bild zu zerschneiden. Am Bestand gibt es sie nicht; käme eine
    // hinzu, fiele sie hier heraus statt falsch zerlegt zu werden.
    if (links.length + rechts.length !== t.slots.length) continue;

    for (const [teil, seite] of [
      [links, 'L'],
      [mirror(rechts), 'R'],
    ] as const) {
      if (teil.length === 0) continue;
      const sig = signature(teil);
      if (gesehen.has(sig)) continue;
      gesehen.set(sig, { id: `halb:${t.id}:${seite}`, slots: teil, from: t.id });
    }
  }

  return [...gesehen.values()].sort(
    (a, b) => a.slots.length - b.slots.length || a.id.localeCompare(b.id),
  );
}

/**
 * Erst beim ersten Zugriff gebaut, nicht beim Laden des Moduls.
 *
 * Die Bibliothek importiert dieses Modul (um Paarkennungen aufzulösen) und
 * dieses Modul die Bibliothek (um die Vorlagen zu zerlegen). Bei einem solchen
 * Zyklus ist die Reihenfolge der Ausführung entscheidend: Liefe `buildHalves`
 * beim Laden, wäre `allTemplates()` noch leer und die Halbseiten still
 * verschwunden.
 */
let HALVES: HalfPage[] | undefined;
let HALVES_BY_ID: Map<string, HalfPage> | undefined;

function ensureHalves(): HalfPage[] {
  if (!HALVES) {
    HALVES = buildHalves();
    HALVES_BY_ID = new Map(HALVES.map((h) => [h.id, h]));
  }
  return HALVES;
}

/** Alle Halbseiten, nach Bilderzahl sortiert. */
export function halfPages(): readonly HalfPage[] {
  return ensureHalves();
}

export function halfPageById(id: string): HalfPage | undefined {
  ensureHalves();
  return HALVES_BY_ID?.get(id);
}

/**
 * Welche Halbseiten stecken in dieser Vorlage?
 *
 * Damit die Oberfläche auch bei einer gewöhnlichen Doppelseite zeigen kann,
 * welche Anordnung links und rechts gerade steht – und nicht erst, nachdem
 * einmal von Hand gewählt wurde. Verglichen wird die Geometrie, nicht die
 * Herkunft: Dieselbe Hälfte kommt in mehreren Vorlagen vor.
 *
 * @returns `undefined` je Seite, wenn dort nichts steht oder die Vorlage sich
 * nicht zerlegen lässt.
 */
export function halvesOfTemplate(template: Template): {
  left?: string;
  right?: string;
} {
  const paar = splitPairId(template.id);
  if (paar) return { left: paar.left, right: paar.right };

  ensureHalves();
  const links = template.slots.filter((s) => s.x + s.w <= 0.5001);
  const rechts = template.slots.filter((s) => s.x >= 0.4999);
  if (links.length + rechts.length !== template.slots.length) return {};

  const finde = (slots: TemplateSlot[]) => {
    if (slots.length === 0) return undefined;
    const sig = signature(slots);
    return ensureHalves().find((h) => signature(h.slots) === sig)?.id;
  };

  return {
    ...(finde(links) ? { left: finde(links)! } : {}),
    ...(finde(mirror(rechts)) ? { right: finde(mirror(rechts))! } : {}),
  };
}

/** Kennung der Doppelseite aus zwei Halbseiten. */
export function pairId(left: string, right: string): TemplateId {
  return `${PAIR_PREFIX}${left}+${right}`;
}

/** Zerlegt eine Paarkennung wieder in ihre beiden Halbseiten. */
export function splitPairId(id: TemplateId): { left: string; right: string } | undefined {
  if (!id.startsWith(PAIR_PREFIX)) return undefined;
  const [left, right] = id.slice(PAIR_PREFIX.length).split('+');
  if (!left || !right) return undefined;
  return { left, right };
}

/**
 * Setzt zwei Halbseiten zu einer Doppelseite zusammen.
 *
 * Die Slots bekommen neue Kennungen (`l-a`, `r-b`), damit sie sich nicht
 * überschneiden – ein Ausschnitt gehört zu genau einem Slot, und zwei Slots
 * namens `a` auf derselben Doppelseite wären nicht auseinanderzuhalten.
 *
 * @returns `undefined`, wenn eine der beiden Hälften unbekannt ist. Dann ist
 * die Doppelseite nicht auflösbar, und der Aufrufer muss das melden statt eine
 * halbe Seite zu zeichnen.
 */
export function pairTemplate(id: TemplateId): Template | undefined {
  const teile = splitPairId(id);
  if (!teile) return undefined;

  const links = halfPageById(teile.left);
  const rechts = halfPageById(teile.right);
  if (!links || !rechts) return undefined;

  return {
    id,
    name: `${links.slots.length} links, ${rechts.slots.length} rechts`,
    pageSpan: 2,
    slots: [
      ...links.slots.map((s) => ({ ...s, id: `l-${s.id}` })),
      ...mirror(rechts.slots).map((s) => ({ ...s, id: `r-${s.id}` })),
    ],
  };
}
