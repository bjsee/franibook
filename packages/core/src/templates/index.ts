/**
 * Templatebibliothek.
 *
 * Die Templates sind in Millimetern auf einer Referenz-Doppelseite definiert
 * und werden hier einmalig auf 0..1 normiert. Millimeter sind beim Entwerfen
 * und Nachrechnen lesbar, normierte Koordinaten sind es nicht – und die
 * Engine braucht ohnehin nur die normierte Form, weil dasselbe Template für
 * 21×21 cm und 30×30 cm gelten soll.
 */
import type { Template, TemplateId, TemplateSlot } from '../model/template.js';
import { mirrorTemplate } from '../model/template.js';
import library from './library.json' with { type: 'json' };

interface RawSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  prominence: number;
  prefers?: string;
  bleed?: boolean;
}

interface RawTextSlot {
  id: string;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  optional: boolean;
  align?: string;
  lines?: number;
}

interface RawTemplate {
  id: string;
  name: string;
  tags?: string[];
  slots: RawSlot[];
  textSlots?: RawTextSlot[];
  chapterOnly?: boolean;
  highResOnly?: boolean;
}

const REF = library.reference;

function normalize(raw: RawTemplate): Template {
  const slot = (s: RawSlot): TemplateSlot => ({
    id: s.id,
    x: s.x / REF.widthMm,
    y: s.y / REF.heightMm,
    w: s.w / REF.widthMm,
    h: s.h / REF.heightMm,
    prominence: s.prominence as 1 | 2 | 3,
    ...(s.prefers ? { prefers: s.prefers as 'landscape' | 'portrait' | 'any' } : {}),
    ...(s.bleed ? { bleed: true } : {}),
  });

  return {
    id: raw.id,
    name: raw.name,
    pageSpan: 2,
    slots: raw.slots.map(slot),
    ...(raw.tags ? { tags: raw.tags } : {}),
    ...(raw.textSlots
      ? {
          textSlots: raw.textSlots.map((t) => ({
            id: t.id,
            role: t.role as 'year' | 'eventTitle' | 'caption' | 'place' | 'freeText',
            x: t.x / REF.widthMm,
            y: t.y / REF.heightMm,
            w: t.w / REF.widthMm,
            h: t.h / REF.heightMm,
            style: t.style,
            optional: t.optional,
            ...(t.align ? { align: t.align as 'left' | 'center' | 'right' } : {}),
            ...(t.lines !== undefined ? { lines: t.lines } : {}),
          })),
        }
      : {}),
  };
}

/** Merkmale, die die Engine bei der Auswahl braucht. */
export interface TemplateMeta {
  /** Nur für Kapitelauftakte, nie im normalen Fluss. */
  chapterOnly: boolean;
  /** Braucht ein Foto oberhalb der üblichen Auflösung. */
  highResOnly: boolean;
}

const RAW = library.templates as RawTemplate[];

const META = new Map<TemplateId, TemplateMeta>();
const ALL: Template[] = [];

for (const raw of RAW) {
  const base = normalize(raw);
  const meta: TemplateMeta = {
    chapterOnly: raw.chapterOnly ?? false,
    highResOnly: raw.highResOnly ?? false,
  };
  ALL.push(base);
  META.set(base.id, meta);

  // Gespiegelte Varianten verdoppeln die Bibliothek ohne Mehraufwand und
  // brechen den Rhythmus auf, wenn dasselbe Template zweimal in Folge fällt.
  // Symmetrische Templates brauchen keine Spiegelung.
  if (!isSymmetric(base)) {
    const mirrored = mirrorTemplate(base);
    ALL.push(mirrored);
    META.set(mirrored.id, meta);
  }
}

/**
 * Ob das Template durch Spiegelung an der Falzachse auf sich selbst fällt.
 *
 * Betrachtet werden nur die Bildplätze. Der Titelplatz sitzt in jedem Template
 * links oben und würde jedes symmetrische Layout formal unsymmetrisch machen –
 * eine zweite Variante, die sich nur in der Position der Überschrift
 * unterscheidet, brächte aber nichts.
 */
function isSymmetric(t: Template): boolean {
  const key = (s: { x: number; y: number; w: number; h: number }) =>
    `${s.x.toFixed(5)},${s.y.toFixed(5)},${s.w.toFixed(5)},${s.h.toFixed(5)}`;
  const original = new Set(t.slots.map(key));
  return t.slots.every((s) => original.has(key({ ...s, x: 1 - s.x - s.w })));
}

const BY_ID = new Map<TemplateId, Template>(ALL.map((t) => [t.id, t]));

export function allTemplates(): readonly Template[] {
  return ALL;
}

export function templateById(id: TemplateId): Template | undefined {
  return BY_ID.get(id);
}

export function requireTemplate(id: TemplateId): Template {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Template nicht gefunden: ${id}`);
  return t;
}

export function templateMeta(id: TemplateId): TemplateMeta {
  return META.get(id) ?? { chapterOnly: false, highResOnly: false };
}

/**
 * Templates, die für eine Gruppe dieser Größe in Frage kommen.
 *
 * Kapitel- und Reserve-Templates sind ausgenommen; sie werden gezielt
 * angefordert, nicht über die Slotzahl gefunden.
 */
export function templatesWithSlotCount(n: number): Template[] {
  return ALL.filter((t) => {
    const meta = templateMeta(t.id);
    return t.slots.length === n && !meta.chapterOnly && !meta.highResOnly;
  });
}

/**
 * Templates, die einen Gruppentitel aufnehmen können.
 *
 * Nur Vorlagen mit Freiraum am oberen Rand – bei einer dichten Collage, deren
 * Bilder am Satzspiegel beginnen, wäre kein Platz dafür.
 */
export function templatesWithTitle(slotCount: number): Template[] {
  return templatesWithSlotCount(slotCount).filter((t) =>
    t.textSlots?.some((ts) => ts.role === 'eventTitle'),
  );
}

/**
 * Templates für eine Gruppe dieser Größe, die keinen Titel erwartet.
 *
 * Die `mit-titel`-Fassungen räumen 16 mm am oberen Rand für die Überschrift
 * frei und setzen die Bilder entsprechend kleiner. Steht dort kein Titel, ist
 * der Streifen leer und der Verlust umsonst: Im Buch aus dem echten Bestand
 * traf das 9 von 45 Doppelseiten, deren Bilder dadurch 6 % kleiner standen als
 * nötig. Bleibt nach dem Filtern nichts übrig, gilt wieder die vollständige
 * Liste – ein leerer Streifen ist besser als keine Vorlage.
 */
export function templatesWithoutTitle(slotCount: number): Template[] {
  const alle = templatesWithSlotCount(slotCount);
  const ohne = alle.filter((t) => !t.tags?.includes('mit-titel'));
  return ohne.length > 0 ? ohne : alle;
}

/** Auftaktseiten für Fotogruppen. */
export function groupOpenerTemplates(): Template[] {
  return ALL.filter((t) => t.tags?.includes('gruppenauftakt'));
}

/**
 * Kapitelauftakte, die zur Wahl stehen.
 *
 * Als `veraltet` markierte bleiben in der Bibliothek, damit gespeicherte
 * Projekte weiter auflösbar sind – gewählt werden sie nicht mehr. Betroffen
 * sind die beiden Auftakte mit einem großen Bild, seit die Jahresseite links
 * das Jahr und rechts mehrere Bilder zeigt.
 */
export function chapterTemplates(): Template[] {
  return ALL.filter((t) => templateMeta(t.id).chapterOnly && !t.tags?.includes('veraltet'));
}

/** Welche Gruppengrößen die Bibliothek überhaupt abdeckt. */
export function supportedSlotCounts(): number[] {
  const counts = new Set<number>();
  for (const t of ALL) {
    const meta = templateMeta(t.id);
    if (!meta.chapterOnly && !meta.highResOnly && t.slots.length > 0) counts.add(t.slots.length);
  }
  return [...counts].sort((a, b) => a - b);
}

/** Referenzmaße, gegen die die Templates entworfen wurden. */
export const TEMPLATE_REFERENCE = REF;
