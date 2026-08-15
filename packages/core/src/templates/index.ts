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
import { PAIR_PREFIX, pairTemplate } from './halves.js';
import { CHAPTER_PAIR_PREFIX, chapterPairTemplate } from './chapter-halves.js';
import { JUSTIFIED_PREFIX, justifiedTemplate } from './justified.js';

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

/**
 * Was jede Vorlage der Bibliothek nach außen freilässt, in Referenzeinheiten.
 *
 * Kein Entwurfswert, sondern eine Eigenschaft der Bibliothek: Kein Bildplatz
 * und kein Textplatz beginnt weiter außen als hier — bis auf den einen bewusst
 * randabfallenden Auftakt (`spread.group.opener-full`). `library.test.ts` hält
 * das fest, denn zwei Stellen rechnen damit: die justierten Zeilen setzen
 * denselben Satzspiegel (`layout/justify.ts`), und die Randachse des
 * Zeitstrahls prüft daran, ob sie überhaupt Platz hat.
 */
export const LIBRARY_OUTER_MARGIN_REF = 22;

/**
 * Derselbe Rand in Millimetern des gewählten Formats.
 *
 * Die Referenzseite der Bibliothek ist 600 mm breit für die ganze Doppelseite —
 * der Rand ist also ein Anteil der Doppelseitenbreite und wächst mit dem Format
 * mit.
 */
export function libraryOuterMarginMm(profile: { page: { trimWidthMm: number } }): number {
  return (LIBRARY_OUTER_MARGIN_REF / REF.widthMm) * 2 * profile.page.trimWidthMm;
}

/** Ein Bildplatz aus der Bibliothek: Millimeter hinein, 0..1 heraus. */
function slot(s: RawSlot): TemplateSlot {
  return {
    id: s.id,
    x: s.x / REF.widthMm,
    y: s.y / REF.heightMm,
    w: s.w / REF.widthMm,
    h: s.h / REF.heightMm,
    prominence: s.prominence as 1 | 2 | 3,
    ...(s.prefers ? { prefers: s.prefers as 'landscape' | 'portrait' | 'any' } : {}),
    ...(s.bleed ? { bleed: true } : {}),
  };
}

function normalize(raw: RawTemplate): Template {
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

/**
 * Eine eigens entworfene Halbseite, wie sie in der Bibliothek steht.
 *
 * Normiert wie ein Template und in Linksform – die Slots liegen in der
 * Nutzfläche der linken Buchseite. `halves.ts` setzt sie neben die Hälften, die
 * aus der Zerlegung der Vorlagen entstehen; warum es sie überhaupt gibt, steht
 * im Kommentar der `halves`-Liste in `library.json`.
 */
export interface LibraryHalf {
  id: string;
  name: string;
  slots: TemplateSlot[];
}

const HALVES: LibraryHalf[] = (library.halves as { id: string; name: string; slots: RawSlot[] }[])
  .filter((h) => h.slots.length > 0)
  .map((h) => ({ id: h.id, name: h.name, slots: h.slots.map(slot) }));

export function libraryHalves(): readonly LibraryHalf[] {
  return HALVES;
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

/**
 * Vorlage zu einer Kennung.
 *
 * Neben den Vorlagen der Bibliothek löst sie auch **zusammengesetzte**
 * Doppelseiten auf: `paar:<links>+<rechts>` entsteht, wenn jemand die Anordnung
 * je Seite von Hand wählt. Sie steht nicht in der Bibliothek, weil es davon
 * 126 × 126 gäbe – sie wird aus ihrer Kennung gebaut, und weil das
 * deterministisch geschieht, überlebt sie Speichern und Laden wie jede andere.
 *
 * Dasselbe gilt für `justiert.<n>`: Die Trägervorlage einer Doppelseite mit
 * justierten Zeilen, deren Plätze aus den Bildern gerechnet werden.
 *
 * Der Zwischenspeicher hält, was einmal zusammengesetzt wurde: Ein Buch mit
 * achtzig Doppelseiten fragt beim Rendern jede Vorlage mehrfach ab.
 */
export function templateById(id: TemplateId): Template | undefined {
  const bekannt = BY_ID.get(id);
  if (bekannt) return bekannt;

  if (
    !id.startsWith(PAIR_PREFIX) &&
    !id.startsWith(JUSTIFIED_PREFIX) &&
    !id.startsWith(CHAPTER_PAIR_PREFIX)
  ) {
    return undefined;
  }
  const zusammengesetzt =
    PAIRS.get(id) ??
    (id.startsWith(PAIR_PREFIX)
      ? pairTemplate(id)
      : id.startsWith(CHAPTER_PAIR_PREFIX)
        ? chapterPairTemplate(id)
        : justifiedTemplate(id));
  if (zusammengesetzt) PAIRS.set(id, zusammengesetzt);
  return zusammengesetzt;
}

/** Abgeleitete Doppelseiten, einmal gebaut und dann behalten. */
const PAIRS = new Map<TemplateId, Template>();

export function requireTemplate(id: TemplateId): Template {
  const t = templateById(id);
  if (!t) throw new Error(`Template nicht gefunden: ${id}`);
  return t;
}

export function templateMeta(id: TemplateId): TemplateMeta {
  const bekannt = META.get(id);
  if (bekannt) return bekannt;
  // Eine seitenweise angeordnete Jahresseite bleibt eine Jahresseite: Sonst
  // bekäme sie nach dem ersten Griff Seitenzahlen (Auftakte bleiben ausgespart),
  // stünde in der Vorlagenwahl des Flusses und nähme beim Verschieben Bilder an
  // wie eine gewöhnliche Doppelseite (`chapter-halves.ts`).
  if (id.startsWith(CHAPTER_PAIR_PREFIX)) return { chapterOnly: true, highResOnly: false };
  return { chapterOnly: false, highResOnly: false };
}

/**
 * Templates, die für eine Gruppe dieser Größe in Frage kommen.
 *
 * Kapitel- und Reserve-Templates sind ausgenommen; sie werden gezielt
 * angefordert, nicht über die Slotzahl gefunden. Dasselbe gilt für die von Hand
 * vergebenen (`eigen`): Die leere Doppelseite hat null Bildplätze und würde
 * sonst als Vorlage für null Bilder gelten – ein Zustand, den die Engine nie
 * meint, aber rechnerisch treffen kann.
 */
export function templatesWithSlotCount(n: number): Template[] {
  return ALL.filter((t) => {
    const meta = templateMeta(t.id);
    return t.slots.length === n && !meta.chapterOnly && !meta.highResOnly && !isHandPicked(t);
  });
}

/**
 * Kennung der leeren Doppelseite: kein Bildplatz, kein Textplatz, nur Fläche.
 *
 * Die Grundlage jeder selbst gebauten Seite. Sie steht in der Bibliothek und
 * nicht als zusammengesetzte Kennung wie `paar:` oder `justiert.`, weil an ihr
 * nichts zu rechnen ist – sie ist die einzige Vorlage, die keine Aussage über
 * Bilder macht.
 */
export const BLANK_TEMPLATE_ID = 'spread.leer';

export function isBlank(id: TemplateId | undefined): boolean {
  return id === BLANK_TEMPLATE_ID;
}

/**
 * Ob diese Vorlage ausschließlich von Hand vergeben wird.
 *
 * Sie taucht in keiner automatischen Auswahl auf – nicht, weil sie schlechter
 * wäre, sondern weil ihre Wahl eine Absicht ist und keine Passung. Heute
 * betrifft das allein die leere Doppelseite.
 */
export function isHandPicked(t: Template): boolean {
  return t.tags?.includes('eigen') ?? false;
}

/**
 * Vorlagen, unter denen eine selbst eingefügte Doppelseite wählen kann.
 *
 * Die leere zuerst, dann die Gruppenauftakte: Wer eine Seite einfügt, will sie
 * entweder ganz selbst gestalten oder den vorhandenen Auftakt – Titel groß, ein
 * Bild daneben – für ein Ereignis nutzen, das die Automatik nicht als Gruppe
 * erkannt hat.
 */
export function insertTemplates(): Template[] {
  const leer = templateById(BLANK_TEMPLATE_ID);
  return [...(leer ? [leer] : []), ...groupOpenerTemplates()];
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
 *
 * Seit die Titel im Zeitstrahl stehen, ist das der einzige Weg zu einer Vorlage
 * für den Fluss: Eine Doppelseite im Innenteil bekommt keine Überschrift mehr.
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
 * Kapitelauftakte, die **die Automatik** wählen darf.
 *
 * Als `veraltet` markierte bleiben in der Bibliothek, damit gespeicherte
 * Projekte weiter auflösbar sind – gewählt werden sie nicht mehr. Betroffen
 * sind die beiden Auftakte mit einem großen Bild, seit die Jahresseite links
 * das Jahr und rechts mehrere Bilder zeigt.
 *
 * `dicht` nimmt die Fassungen dazu, die auch auf der Jahresseite Bilder tragen.
 * Sie sind eine Wahl und keine Verbesserung: Ohne sie steht die Jahreszahl
 * allein auf ihrer Seite und das Buch atmet an jeder Kapitelgrenze; mit ihnen
 * trägt der Auftakt neun statt sechs Bilder und kostet damit fast nichts. Weil
 * sie neun Plätze haben und die bildlosen höchstens sechs, bleiben die kleinen
 * Fassungen auch dann die Wahl, wenn ein Jahrgang zu wenige Bilder hat.
 *
 * `nur-wahl` bleibt draußen: Die Bibliothek hat Auftakte für jede Bilderzahl
 * von 1 bis 12, aber `auftaktGroessen` (layout/generate.ts) nimmt die größte
 * Fassung, für die ein Jahrgang genug Bilder hat – mit allen zusammen füllte
 * ein Jahresauftakt acht statt sechs Bilder, und das ändert Seitenzahl und
 * Bildverteilung des ganzen Buchs. Wer sie sehen will, wählt sie
 * (`chapterChoices`).
 */
export function chapterTemplates(dicht = false): Template[] {
  return chapterChoices().filter(
    (t) => !t.tags?.includes('nur-wahl') && (dicht || !t.tags?.includes('dicht')),
  );
}

/**
 * Alle Jahresauftakte, unter denen **von Hand** gewählt werden kann.
 *
 * Schlank und dicht, für jede Bilderzahl von 1 bis 12 je drei Fassungen –
 * hochkant, quer und gemischt. Eine Wahl von Hand ist eine Absicht für diese
 * eine Doppelseite und keine Vorgabe für das Buch; deshalb gilt hier weder
 * `settings.chapterOpenersDense` noch die Zurückhaltung der Automatik.
 *
 * Gebraucht an drei Stellen, und überall aus demselben Grund: Eine Auftaktseite
 * bleibt eine Auftaktseite. Beim Anordnen von Hand, beim Ziehen von Bildern in
 * den Baum und beim Neuanordnen einer einzelnen Seite darf sie nur unter ihrer
 * eigenen Familie wählen, sonst verliert sie Jahreszahl und Ereigniszeilen.
 */
export function chapterChoices(): Template[] {
  return ALL.filter((t) => templateMeta(t.id).chapterOnly && !t.tags?.includes('veraltet'));
}

/** Welche Gruppengrößen die Bibliothek überhaupt abdeckt. */
export function supportedSlotCounts(): number[] {
  const counts = new Set<number>();
  for (const t of ALL) {
    const meta = templateMeta(t.id);
    if (!meta.chapterOnly && !meta.highResOnly && !isHandPicked(t) && t.slots.length > 0) {
      counts.add(t.slots.length);
    }
  }
  return [...counts].sort((a, b) => a - b);
}

/** Referenzmaße, gegen die die Templates entworfen wurden. */
export const TEMPLATE_REFERENCE = REF;
