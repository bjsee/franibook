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
 * Falz – die Templates lassen die Falzzone ohnehin frei –, sodass alle Vorlagen
 * des Flusses sauber zerlegbar sind. Das ergibt 74 verschiedene Halbseiten, die
 * sich frei zu Doppelseiten kombinieren lassen.
 *
 * Fast nichts Neues: Die Zerlegung deckt nicht jede Bilderzahl ab. Für sieben
 * und acht Bilder gab sie je genau **eine** Anordnung her, für dreizehn keine
 * einzige – wer eine solche Seite von Hand anordnen wollte, bekam keine Wahl,
 * sondern eine Bestätigung. Die Bibliothek führt deshalb unter `halves` eigens
 * entworfene Halbseiten, die die Lücken auf mindestens drei Anordnungen je
 * Bilderzahl auffüllen. Sie kommen **nach** den abgeleiteten in die Liste: Eine
 * Halbseitenkennung steht in gespeicherten Projekten, und die abgeleitete darf
 * ihre nicht an eine gleich geformte neue verlieren.
 *
 * Geführt werden alle Halbseiten in **Linksform**. Für die rechte Seite wird
 * gespiegelt und nicht verschoben: Eine Seite hat außen mehr Rand als am Falz,
 * und eine nur verschobene linke Hälfte legte ihren Außenrand an den Falz.
 */
import type { Template, TemplateId, TemplateSlot } from '../model/template.js';
import { allTemplates, libraryHalves, templateMeta } from './index.js';

/** Kennungspräfix einer zusammengesetzten Doppelseite. */
export const PAIR_PREFIX = 'paar:';

export interface HalfPage {
  id: string;
  /** Slots in Linksform, normiert auf die ganze Doppelseite. */
  slots: TemplateSlot[];
  /** Aus welcher Vorlage die Hälfte stammt – für die Herkunft in der Oberfläche. */
  from: TemplateId;
  /** Wie sie heißt, sofern sie eigens entworfen wurde – sonst die der Vorlage. */
  name?: string;
}

/** Geometrische Signatur, um gleiche Hälften nur einmal anzubieten. */
function signature(slots: readonly TemplateSlot[]): string {
  return slots
    .map((s) => [s.x, s.y, s.w, s.h].map((v) => v.toFixed(4)).join(','))
    .sort()
    .join('|');
}

/** Spiegelt Slots an der Falzachse – aus einer linken Hälfte wird eine rechte. */
export function mirror(slots: readonly TemplateSlot[]): TemplateSlot[] {
  return slots.map((s) => ({ ...s, x: 1 - s.x - s.w }));
}

/**
 * Halbseite ohne Bildplatz – die leere Buchseite.
 *
 * Nicht aus einer Vorlage abgeleitet, denn keine hat null Plätze. Gebraucht wird
 * sie an zwei Stellen: als eigene Seite, auf der nur Textblöcke stehen, und als
 * Paritätsausgleich vor einem Blatt, das sich nicht zerlegen lässt.
 */
export const HALF_BLANK_ID = 'halb:leer';

/**
 * Halbseite mit einem Bildplatz, quadratisch und mittig.
 *
 * 180 mm im Quadrat, nicht die volle Nutzfläche von 262 mm: Bei 2048 px langer
 * Kante – dem Maß dieses Bestands – ergeben 262 mm nur 198 dpi und lägen unter
 * der Mindestauflösung, 180 mm ergeben 289 dpi. Wer ein größeres Bild hat, zieht
 * den Platz von Hand auf.
 */
export const HALF_ONE_ID = 'halb:eins';

/** Die Halbseiten, die es in keiner Vorlage gibt und die von Hand vergeben werden. */
function ownHalfPages(): HalfPage[] {
  return [
    { id: HALF_BLANK_ID, slots: [], from: HALF_BLANK_ID },
    {
      id: HALF_ONE_ID,
      // Linksform und normiert auf die ganze Doppelseite, wie jede Halbseite:
      // 180 mm im Quadrat, mittig in der linken Seite des 600×300-Rasters.
      slots: [
        {
          id: 'a',
          x: 63 / 600,
          y: 60 / 300,
          w: 180 / 600,
          h: 180 / 300,
          prominence: 3,
          prefers: 'any',
        },
      ],
      from: HALF_ONE_ID,
    },
  ];
}

/** Ob diese Halbseite von Hand vergeben wird und in keiner Vorlage steckt. */
export function isOwnHalf(id: string): boolean {
  return id === HALF_BLANK_ID || id === HALF_ONE_ID;
}

function buildHalves(): HalfPage[] {
  const gesehen = new Map<string, HalfPage>();
  // Zuerst die eigenen: Ihre Kennung soll stabil sein und nicht davon abhängen,
  // ob eine Vorlage zufällig dieselbe Geometrie trägt.
  for (const eigen of ownHalfPages()) gesehen.set(signature(eigen.slots), eigen);

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
      gesehen.set(sig, { id: `halb:${t.id}:${seite}`, slots: teil, from: t.id, name: t.name });
    }
  }

  // Zuletzt die eigens entworfenen: Sie füllen die Bilderzahlen auf, für die
  // die Zerlegung zu wenig hergibt, und treten dabei keiner abgeleiteten
  // Halbseite ihre Kennung weg.
  for (const eigen of libraryHalves()) {
    const sig = signature(eigen.slots);
    if (gesehen.has(sig)) continue;
    gesehen.set(sig, {
      id: eigen.id,
      slots: eigen.slots,
      from: eigen.id,
      name: eigen.name,
    });
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

/**
 * Die Halbseiten des Flusses, nach Bilderzahl sortiert.
 *
 * Ohne die von Hand vergebenen: Die leere Halbseite in der Anordnungswahl einer
 * gewöhnlichen Seite wäre eine Falle – sie schickt jedes Bild dieser Seite in
 * den Pool, und ihre Skizze, ein leeres Rechteck, sagt das niemandem vorher.
 */
export function halfPages(): readonly HalfPage[] {
  return ensureHalves().filter((h) => !isOwnHalf(h.id));
}

/** Die Halbseiten, unter denen eine selbst eingefügte Buchseite wählen kann. */
export function ownHalves(): readonly HalfPage[] {
  return ensureHalves().filter((h) => isOwnHalf(h.id));
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
    // Eine Hälfte ohne Bildplatz ist die leere Buchseite und keine Unbekannte.
    // Vorher stand hier `undefined`, und die Oberfläche schloss daraus, die
    // Doppelseite reiche über den Falz – womit sich bei jeder Vorlage mit einem
    // einzigen Bild die freie Seite nicht mehr ändern ließ.
    if (slots.length === 0) return HALF_BLANK_ID;
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
