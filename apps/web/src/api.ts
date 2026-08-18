/**
 * Der Zugang zum Server.
 *
 * Vorher stand `fetch(` in vierzehn Dateien: zehnmal in `App.tsx`, neunmal in
 * `useSpreadEditor.ts`, dazu drei Ansichten mit je einem eigenen kleinen
 * `schicke()`-Helfer. Jede Stelle wiederholte dieselben drei Zeilen — Methode,
 * `content-type`, `JSON.stringify` — und jede behandelte Fehler anders: mal
 * `res.ok`, mal `data.ok`, mal gar nicht. Ein vergessenes `res.ok` sah aus wie
 * Erfolg und hinterließ eine Oberfläche, die etwas anderes zeigte als das Buch.
 *
 * Hier steht beides genau einmal: die Form der Anfrage und die Form des
 * Fehlers. Was der Server kann, ist damit an einer Stelle ablesbar.
 *
 * Die Antworttypen stehen hier, weil sie den Server beschreiben und nicht die
 * Ansicht. Drei Ausnahmen bleiben, wo sie sind, weil sie zugleich UI-Formen
 * sind: `Report`, `TextBlockData` und `SpreadGroup` — als `import type` geholt,
 * der zur Laufzeit verschwindet.
 */
import type {
  Abnahmebericht,
  Befund,
  CoverDesign,
  CoverMosaic,
  CoverTextName,
  CoverTextStyle,
  Crop,
  Ebenenzug,
  FrameId,
  LayoutDocument,
  MoveSource,
  MoveTarget,
  PhotoGroup,
  PhotoMove,
  PhotoQuality,
  PhotoAdjust,
  PhotoWeight,
  RenderedCover,
  RenderedSpread,
  TextElement,
  TimelineFootVariant,
  TimelineSideVariant,
} from '@franibook/core';
import { imFlug } from './ausstehend.js';
import type { Report } from './Kennzahlen.js';
import type { TextBlockData } from './TextBlocks.js';
import type { SpreadGroup } from './spread/types.js';

/**
 * Ein Fehlschlag mit dem Satz, den der Server dazu geschrieben hat.
 *
 * Die Endpunkte antworten auf einen fachlichen Konflikt mit `409` und
 * `{ ok: false, error: '…' }`, auf einen unbrauchbaren Parameter mit `400`.
 * Der Text ist ein deutscher Satz für die Oberfläche — er wird angezeigt, nicht
 * übersetzt.
 */
export class ApiFehler extends Error {
  readonly status: number;

  constructor(text: string, status: number) {
    super(text);
    this.name = 'ApiFehler';
    this.status = status;
  }
}

/** Der Satz zu einem Fehlschlag, gleich ob vom Server oder aus dem Netz. */
export function fehlertext(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Wer dieses Fenster ist.
 *
 * Geht als Kopf an **jede** Anfrage, damit der Server die Meldung über einen
 * Griff nicht an den zurückschickt, der ihn getan hat (`ereignisse.ts` im
 * Server). Ohne das lüde jedes Fenster nach jedem eigenen Handgriff alles neu,
 * und bei einem gezogenen Regler wäre das eine Neuladung je Zwischenstellung.
 *
 * Eine Konstante je Seitenladung, bewusst **nicht** im `sessionStorage`: Der
 * wird beim Duplizieren eines Tabs mitkopiert, und zwei Fenster mit derselben
 * Kennung hielten einander für sich selbst — eines von beiden erführe nie
 * wieder etwas. Ein Neuladen ist dann eben ein neues Fenster; das kostet
 * nichts, denn die Kennung hat keine Bedeutung über die Sitzung hinaus.
 */
const FENSTER =
  globalThis.crypto?.randomUUID?.() ?? `f${Math.random().toString(36).slice(2)}${Date.now()}`;

/** Der Kopf, an dem der Server das Fenster erkennt (`FENSTER_KOPF` im Server). */
const FENSTER_KOPF = 'x-franibook-fenster';

/**
 * Ergänzt den Fensterkopf an einer Anfrage.
 *
 * Als Funktion und nicht als Zeile in `antwort`, weil es in dieser Datei eine
 * zweite Anfrage gibt, die `antwort` bewusst umgeht (`layoutAnwendenAnfrage` –
 * sie schickt rohen Text und deutet die Antwort selbst). Sie hatte den Kopf
 * vergessen, und ihr Fenster lud nach jedem eingespielten Layout sich selbst
 * neu, mit der Meldung, ein anderes hätte es getan.
 */
function mitFenster(headers?: HeadersInit): Record<string, string> {
  return { ...(headers as Record<string, string> | undefined), [FENSTER_KOPF]: FENSTER };
}

/**
 * Eine Anfrage und ihre Antwort.
 *
 * Geworfen wird auch bei `{ ok: false }` mit Status 200: Ein Endpunkt, der
 * seinen Misserfolg meldet, ist kein Erfolg — und der Aufrufer soll nicht
 * zwischen zwei Fehlerformen wählen müssen.
 */
function ruf<T>(pfad: string, init?: RequestInit): Promise<T> {
  // Jede Anfrage wird festgehalten, bis sie durch ist: Cmd+Z leert vorher, was
  // noch unterwegs ist, sonst überschreibt eine spät eintreffende Antwort den
  // zurückgenommenen Stand (`ausstehend.ts`).
  return imFlug(antwort<T>(pfad, init));
}

async function antwort<T>(pfad: string, init?: RequestInit): Promise<T> {
  // Der Fensterkopf an einer Stelle für alle: Ihn je Aufrufer zu setzen hieße,
  // ihn irgendwo zu vergessen – und dort käme dann das eigene Echo zurück.
  const res = await fetch(pfad, { ...init, headers: mitFenster(init?.headers) });
  const roh = await res.text();
  const daten: unknown = roh ? JSON.parse(roh) : {};
  const satz = (daten as { error?: string } | null)?.error;
  const misserfolg = (daten as { ok?: boolean } | null)?.ok === false;
  if (!res.ok || misserfolg) {
    throw new ApiFehler(satz ?? `HTTP ${res.status} ${res.statusText}`.trim(), res.status);
  }
  return daten as T;
}

/** Ein GET. */
function hole<T>(pfad: string): Promise<T> {
  return ruf<T>(pfad);
}

/** Ein schreibender Aufruf mit JSON-Rumpf. `body` weglassen heißt: ohne Rumpf. */
function sende<T>(methode: string, pfad: string, body?: unknown): Promise<T> {
  return ruf<T>(pfad, {
    method: methode,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

// ─── Projekt ────────────────────────────────────────────────────────────────

/** Die Einstellungen, die das ganze Buch betreffen. */
export interface Einstellungen {
  targetPages: number;
  chapterOpeners: boolean;
  /** Ob der Jahresauftakt auch auf der Jahresseite Bilder trägt. */
  chapterOpenersDense: boolean;
  groupOpeners: boolean | 'auto';
  timeline: boolean;
  timelineStyle: 'foot' | 'side';
  /** Fassung der Zeichnung, je Achse eine. */
  timelineFootVariant: TimelineFootVariant;
  timelineSideVariant: TimelineSideVariant;
  /** `auto` oder ein Hexwert aus `TIMELINE_ACCENTS`. */
  timelineAccent: string;
  background: string;
  chapterColors: boolean;
  /** Stärkste Neigung der Bilder in Grad; 0 stellt alles gerade. */
  tilt: number;
  /** Rahmen aller Bilder ohne eigenen; `keiner` ist die Vorgabe. */
  frame: FrameId;
  /** Seitenzahlen im Fuß jeder Buchseite. */
  pageNumbers: boolean;
  seed: number;
  /** Kennung des Druckprofils, also das Buchformat. */
  printProfileId: string;
  /**
   * Basisadresse der Videoverweise – fehlt, solange keine eingerichtet ist.
   *
   * Ohne sie druckt jeder QR-Code die Zieladresse unmittelbar, und ein Umzug des
   * Videos kostet einen Nachdruck.
   */
  videoBase?: string;
  birthDate?: string;
}

/** Ein wählbares Buchformat, so knapp wie die Auswahl es braucht. */
export interface Buchformat {
  id: string;
  /** Der Druckdienstleister. Gruppiert die Auswahl, sobald es mehr als einen gibt. */
  vendor: string;
  product: string;
  trimWidthMm: number;
  trimHeightMm: number;
  minPages: number;
  maxPages: number;
}

/** Was ein Neuanordnen verwerfen würde. */
export interface Handarbeit {
  crops: number;
  neigungen: number;
  rahmen: number;
  unterschriften: number;
  hintergruende: number;
  zeitstrahl: number;
  positionen: number;
  /** Bilder mit einer von Hand gesetzten Ebene im Stapel. */
  ebenen: number;
  texte: number;
  /** Vorlagentexte, die von Hand verschoben, aufgezogen oder gedreht wurden. */
  textplaetze: number;
  /** Weggenommene leere Plätze — der Neuaufbau holt sie aus der Vorlage zurück. */
  plaetze: number;
  festgehalten: number;
}

export interface Kapitel {
  year: number;
  photoCount: number;
  firstSpreadIndex: number;
}

export interface ProjectInfo {
  /** Die Ordner, aus denen das Buch gespeist wird. */
  sources: { id: string; label: string; root: string; erreichbar: boolean }[];
  /**
   * Das aktive Druckprofil, so weit die Oberfläche es braucht: die
   * Auflösungsschwellen, mit denen der Editor jede Änderung sofort bewertet,
   * und das Seitenmaß für die Vorschauen.
   */
  profile: {
    id: string;
    product: string;
    // `safetyMm` gehört dazu, seit die Oberfläche entscheidet, ob die Randachse
    // des Zeitstrahls in diesem Format überhaupt Platz hat (`sideAxisPasst`).
    page: { trimWidthMm: number; trimHeightMm: number; bleedMm: number; safetyMm: number };
    pageCount: { min: number; max: number; step: number };
    resolution: { minDpi: number; targetDpi: number };
  };
  /** Die wählbaren Formate, in der Reihenfolge der Bibliothek. */
  profiles: Buchformat[];
  settings: Einstellungen;
  photoCount: number;
  spreadCount: number;
  skippedVideos: string[];
  failed: { file: string; reason: string }[];
  report: Report | null;
  handwork: Handarbeit;
  chapters: Kapitel[];
  groupMarks: { spreadIndex: number; id: string; title: string }[];
  /**
   * Kennung → Vierteldrehungen, nur für die gedrehten Fotos.
   *
   * Gehört in jede Bildadresse (`bildadresse.tsx`): Die Bild-Endpunkte liefern
   * `immutable` aus, und die Fotokennung ist der Hash der *Datei* — eine
   * Ausrichtungskorrektur ändert die Pixel darunter.
   */
  bildFassungen: Record<string, 1 | 2 | 3>;
  /** Ob sich die Gruppen geändert haben, seit das Buch gebaut wurde. */
  groupsPending: boolean;
  /**
   * Ob die Kalendergliederung von der abweicht, aus der das Buch gebaut wurde.
   *
   * Datumskorrekturen, aussortierte Fotos, ein Nachimport. Nur wahr, wenn ein
   * Neuaufbau tatsächlich etwas ändern würde — eine Korrektur um Minuten, die
   * keine Reihenfolge kippt, meldet nichts.
   */
  structurePending: boolean;
  undatedCount: number;
  /** Was Cmd+Z und Cmd+Umschalt+Z gerade bedeuten. */
  undo: UndoAuskunft;
}

/** Woran der Verlauf gerade steht. */
export interface UndoAuskunft {
  /** Bezeichnung des Schritts, den Cmd+Z zurücknähme; `null` = nichts da. */
  zurueck: string | null;
  vor: string | null;
  tiefe: { zurueck: number; vor: number };
}

/** Was ein Zurücknehmen oder Wiederholen bewirkt hat. */
export interface UndoErgebnis {
  ok: true;
  label: string;
  /** Betroffene Doppelseite, wenn der Schritt eine hatte. */
  spreadIndex?: number;
  undo: UndoAuskunft;
}

/** Ein abgelegter Notanker. */
export interface Notanker {
  name: string;
  /** Wovor er gefallen ist, als deutscher Satz. */
  aktion: string;
  zeit: string;
  bytes: number;
}

/** Was ein Import bewirkt hat. */
export interface ImportDiff {
  neu: string[];
  verschwunden: string[];
  unveraendert: number;
  imBuchVerschwunden: string[];
  offline: { label: string; photoCount: number }[];
  /** Dateien, die als aussortiert übergangen wurden. */
  aussortiert: number;
  photoCount: number;
}

export const projektLaden = () => hole<ProjectInfo>('/api/project');

/**
 * Was sich an den Einstellungen ändern lässt.
 *
 * `videoBase` darf hier **`null`** sein, die Einstellung selbst nicht: `null` ist
 * die Anweisung „nimm die Basisadresse weg", nicht der Wert danach. Ohne diesen
 * Unterschied gäbe es keinen Weg zurück zu „ohne Basis" — ein leerer String wäre
 * eine Adresse, die nirgendwohin führt.
 */
export type Einstellungspatch = Partial<Omit<Einstellungen, 'videoBase'>> & {
  videoBase?: string | null;
};

export const einstellungenAendern = (patch: Einstellungspatch) =>
  sende<unknown>('PATCH', '/api/settings', patch);

/**
 * Wechselt das Buchformat.
 *
 * Eigener Aufruf und nicht `einstellungenAendern`: Der Server ordnet dabei
 * nichts neu, klemmt aber die Seitenzahl und sagt in `hinweise`, was das
 * bedeutet – die Oberfläche zeigt diese Sätze unverändert.
 */
export const formatWechseln = (printProfileId: string) =>
  sende<{ settings: Einstellungen; hinweise: string[] }>('PATCH', '/api/format', {
    printProfileId,
  });

/** Liest Bildquellen erneut ein — alle, oder nur eine. */
export const neuEinlesen = (body?: { limit?: number; sourceId?: string }) =>
  sende<ImportDiff>('POST', '/api/import', body ?? {});

export const buchErzeugen = (patch: Record<string, unknown>) =>
  sende<{ report: Report }>('POST', '/api/generate', patch);

// ─── Neu anordnen: erst ansehen ─────────────────────────────────────────────

/** Was aus einer Doppelseite wird, wenn das Buch neu angeordnet wird. */
export interface Probeseite {
  /**
   * Stelle im bisherigen Buch; `null` bei einer neu hinzukommenden Seite.
   *
   * Zugleich die Kennung, unter der eine Seite ansprechbar ist — `Spread.id`
   * taugt dafür nicht, sie ist nicht eindeutig (Begründung im Kern, bei
   * `Seitenvergleich.altIndex`).
   */
  altIndex: number | null;
  /** Stelle im neuen Buch; `null`, wenn die Seite wegfällt. */
  neuIndex: number | null;
  art: 'gleich' | 'vorlage' | 'fotos' | 'neu' | 'entfaellt';
  /** Gleicher Inhalt, andere Stelle im Buch. */
  verschoben: boolean;
  locked: boolean;
  templateVorher: string | null;
  templateNachher: string | null;
  fotosVorher: number;
  fotosNachher: number;
  zugegangen: string[];
  abgegangen: string[];
  /** Wie viele von Hand getroffene Entscheidungen diese eine Seite kostet. */
  handarbeit: number;
  /** Ob diese Doppelseite auf Verlangen bleibt, wie sie ist. */
  behalten: boolean;
}

/** Die gerechnete, noch nicht eingesetzte Anordnung. */
export interface Probe {
  id: string;
  /** Die Einstellungen, mit denen gerechnet wurde. */
  settings: Einstellungen;
  /** Wenn die gewünschte Seitenzahl in diesem Format nicht geht. */
  geklemmt?: { gewuenscht: number; wirksam: number };
  bilanz: {
    doppelVorher: number;
    doppelNachher: number;
    seitenVorher: number;
    seitenNachher: number;
    gleich: number;
    verschoben: number;
    geaendert: number;
    neu: number;
    entfallen: number;
    festgehalten: number;
    /** Bilder, die neu ins Buch kommen. */
    insBuch: number;
    /** Bilder, die herausfallen – sie liegen danach im Fotopool. */
    ausDemBuch: number;
    fotosVorher: number;
    fotosNachher: number;
  };
  /** Was diese Anordnung an Handarbeit kostet – auf sie gerechnet, nicht geschätzt. */
  handwork: Handarbeit;
  report: Report;
  /** Die Doppelseiten, die bleiben sollen, wie sie sind – als Stellen im bisherigen Buch. */
  behalten: number[];
  seiten: Probeseite[];
}

/**
 * Rechnet eine Probe: das neue Buch, ohne es einzusetzen.
 *
 * Nimmt denselben Rumpf wie `buchErzeugen` – regelmäßig ein neuer Seed –, dazu
 * die Doppelseiten, die bleiben sollen, wie sie sind. Beides in einem Aufruf,
 * weil das Buch um jede behaltene Seite herum anders fällt: Es gibt keine
 * Rechnung, die man nachträglich anpasst.
 */
export const probeRechnen = (patch: Record<string, unknown>, behalten: readonly number[] = []) =>
  sende<{ probe: Probe }>('POST', '/api/anordnung/probe', { ...patch, behalten });

/**
 * Die liegende Probe.
 *
 * `auskunft: null` heißt „keine da", `veraltet` heißt „eine da, aber der Stand
 * hat sich geändert" – dann rechnet die Ansicht neu, statt eine Vorschau zu
 * zeigen, die etwas anderes verspricht als das Übernehmen einsetzt.
 */
export const probeLaden = () =>
  hole<{ auskunft: Probe | null; veraltet?: boolean }>('/api/anordnung/probe');

/** Eine Doppelseite der Probe, gerendert – für die Miniaturen der Vorschau. */
export const probeDoppelseiteLaden = (index: number) =>
  hole<SpreadResponse>(`/api/anordnung/probe/spreads/${index}`);

/** Setzt die Probe in Kraft. Die Kennung ist die Zusage auf das Gezeigte. */
export const probeUebernehmen = (id: string) =>
  sende<{ ok: true; settings: Einstellungen; report: Report; handwork: Handarbeit }>(
    'POST',
    '/api/anordnung/uebernehmen',
    { id },
  );

export const probeVerwerfen = () => sende<{ ok: boolean }>('DELETE', '/api/anordnung/probe');

// ─── Zurücknehmen ───────────────────────────────────────────────────────────

/**
 * Nimmt den letzten Griff zurück.
 *
 * Vorher `ausstehendSenden()` rufen – sonst nimmt der Server einen Stand
 * zurück, der die verzögert gesendete Bewegung noch nicht enthält, und die
 * trifft danach ein. Der Aufrufer in `App.tsx` tut das.
 */
export const zurueckNehmen = () => sende<UndoErgebnis>('POST', '/api/undo');

export const wiederholen = () => sende<UndoErgebnis>('POST', '/api/redo');

/** Die Notanker, neuester zuerst. */
export const ankerListe = () => hole<{ anker: Notanker[] }>('/api/history');

/** Holt einen Notanker zurück. Verwirft alles seit ihm – aber rücknehmbar. */
export const ankerZurueckholen = (name: string) =>
  sende<{ ok: true; photoCount: number; spreadCount: number }>(
    'POST',
    `/api/history/${encodeURIComponent(name)}`,
  );

// ─── Doppelseiten ───────────────────────────────────────────────────────────

/**
 * Antwort auf `/api/spreads/:index`.
 *
 * `timelineOverride` und `groups` gehören nicht zum Rendered Spread Model – das
 * eine ist die Entscheidung des Benutzers zu dieser Doppelseite und stellt nur
 * den Schalter, das andere sagt, welche Gruppen hier liegen.
 */
export type SpreadResponse = RenderedSpread & {
  timelineOverride?: boolean | null;
  groups?: SpreadGroup[];
  /** Rohdaten der von Hand gesetzten Textblöcke – zum Bearbeiten, nicht zum Zeichnen. */
  blocks?: TextBlockData[];
  /**
   * Rohdaten der Vorlagentexte, aus demselben Grund: Jahreszahl, Gruppentitel und
   * Ereigniszeilen lassen sich verschieben, aufziehen und drehen.
   */
  texts?: TextElement[];
  /** Die Vorlage dieser Doppelseite – dort stehen die Textplätze. */
  templateId?: string | null;
  /** Ob diese Doppelseite ein Neuanordnen unverändert übersteht. */
  locked?: boolean;
  /** Ob sich einzelne Buchseiten daraus nehmen lassen. */
  splittable?: boolean;
  /**
   * Was die Abnahme über diese Doppelseite sagt — einschließlich der schon
   * abgenickten Funde, die die Bühne leise zeigt statt gar nicht.
   */
  befunde?: Befund[];
};

/** Was ein Umbau an Seiten hinterlassen hat. */
export interface Umpaarbericht {
  neuGepaart: number;
  leerseiten: number;
  leereBlaetter: number;
}

export const doppelseiteLaden = (index: number) => hole<SpreadResponse>(`/api/spreads/${index}`);

export const doppelseiteFesthalten = (index: number, locked: boolean) =>
  sende<{ spread?: SpreadResponse }>('PATCH', `/api/spreads/${index}/locked`, { locked });

export const doppelseiteLoeschen = (index: number) =>
  sende<{ ok: boolean; spreadCount: number; photoCount: number }>(
    'DELETE',
    `/api/spreads/${index}`,
  );

export const buchseiteLoeschen = (atPage: number) =>
  sende<{
    ok: boolean;
    spreadCount: number;
    photoCount: number;
    bericht?: Umpaarbericht;
  }>('DELETE', `/api/spreads/page/${atPage}`);

/** Zeitstrahl dieser einen Doppelseite, abweichend von der Vorgabe. */
export const zeitstrahlSetzen = (index: number, timeline: boolean | null) =>
  sende<unknown>('PATCH', `/api/spreads/${index}/timeline`, { timeline });

export const hintergrundSetzen = (
  index: number,
  patch: { color?: string | null; photoId?: string | null },
) => sende<{ hinweis?: string }>('PATCH', `/api/spreads/${index}/background`, patch);

/** Papiertöne und Bildkandidaten für den Hintergrund. */
export const hintergrundOptionenLaden = () =>
  hole<{
    colors: { id: string; name: string; hex: string }[];
    candidates: { photoId: string; fileName: string; dpi: number; taugt: boolean }[];
    minDpi: number;
  }>('/api/background');

// ─── Anordnung ──────────────────────────────────────────────────────────────

/** Eine Anordnung für eine ganze Doppelseite. */
export interface Vorlage {
  id: string;
  name: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  current: boolean;
}

/** Eine Anordnung für eine einzelne Buchseite, immer in Linksform. */
export interface Halbseite {
  id: string;
  /** Fehlt bei Hälften, die aus einer Vorlage entstanden und keinen eigenen Namen haben. */
  name?: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number }[];
  /**
   * Textplätze — nur die Fassungen der Jahresseite haben welche.
   *
   * Sie gehören in die Skizze: Eine Textseite ohne Bild sähe sonst aus wie eine
   * leere Seite, und genau die ist eine ganz andere Wahl.
   */
  textSlots?: { x: number; y: number; w: number; h: number }[];
}

export interface Anordnungen {
  templates: Vorlage[];
  halves: Halbseite[];
  /**
   * Die Fassungen der Jahresseite – nur bei einem Auftakt, und nur für die Seite,
   * auf der Jahreszahl und Ereigniszeilen stehen (`textseite`).
   */
  jahresseiten?: Halbseite[];
  /** Auf welcher Buchseite die Textplätze einer Jahresseite stehen. */
  textseite?: 'left' | 'right';
  current: { left?: string; right?: string };
  counts: { left: number; right: number };
  /** Jahresseite: Sie wählt je Buchseite in einer eigenen Familie. */
  auftakt: boolean;
}

/** Was eine geänderte Anordnung übrig lässt: Bilder ohne Platz. */
export interface AnordnungErgebnis {
  ok: boolean;
  spread: SpreadResponse;
  /** Bilder, die keinen Platz mehr fanden und jetzt im Pool liegen. */
  leftover: string[];
  report: Report | null;
}

export const anordnungenLaden = (index: number) =>
  hole<Anordnungen>(`/api/spreads/${index}/templates`);

export const vorlageSetzen = (index: number, templateId: string) =>
  sende<AnordnungErgebnis>('PATCH', `/api/spreads/${index}/template`, { templateId });

/**
 * Die Doppelseite neu anordnen – die Rechnung wählt die Vorlage.
 *
 * Für den Fall, dass sich die Bilder geändert haben und die Vorlage nicht: Ein
 * gekipptes Bild steht danach in einem Platz, der für seine alte Lage gewählt
 * wurde.
 */
export const seiteNeuAnordnen = (index: number) => vorlageSetzen(index, 'auto');

export const halbseiteSetzen = (index: number, side: 'left' | 'right', halfId: string) =>
  sende<AnordnungErgebnis>('PATCH', `/api/spreads/${index}/half`, { side, halfId });

// ─── Seiten einfügen ────────────────────────────────────────────────────────

/** Eine Ausgangsform für eine neu eingefügte Seite. */
export interface EinfuegeVorlage {
  id: string;
  name: string;
  /** Ob diese Form eine ganze Doppelseite belegt oder eine einzelne Buchseite. */
  scope: 'spread' | 'page';
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  /** Ob ein Titel gesetzt werden kann – nur dann lohnt das Textfeld. */
  hasTitle: boolean;
}

export const einfuegeVorlagenLaden = () =>
  hole<{ templates: EinfuegeVorlage[] }>('/api/templates/insert');

export const doppelseiteEinfuegen = (body: { at: number; templateId: string; title?: string }) =>
  sende<{ ok: boolean; index: number; spreadCount: number; spread: SpreadResponse }>(
    'POST',
    '/api/spreads',
    body,
  );

export const buchseiteEinfuegen = (body: { atPage: number; halfId: string; title?: string }) =>
  sende<{
    ok: boolean;
    index: number;
    spreadCount: number;
    spread: SpreadResponse;
    bericht?: Umpaarbericht;
  }>('POST', '/api/spreads/page', body);

// ─── Bilder auf der Doppelseite ─────────────────────────────────────────────

/** Ein normiertes Rechteck im Endformat – dieselbe Einheit wie in den Vorlagen. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Die Doppelseite, wie sie nach einer Änderung aussieht. */
type SpreadAntwort = { spread?: SpreadResponse };

export const ausschnittSetzen = (index: number, slotId: string, crop: Crop) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/crop`, {
    x: crop.x,
    y: crop.y,
    w: crop.w,
    h: crop.h,
  });

export const ausschnittZuruecksetzen = (index: number, slotId: string) =>
  sende<SpreadAntwort>('DELETE', `/api/spreads/${index}/slots/${slotId}/crop`);

/** `deg: null` heißt „wieder automatisch", `0` heißt „ausdrücklich gerade". */
export const neigungSetzen = (index: number, slotId: string, deg: number | null) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/rotate`, { deg });

export const rechteckSetzen = (index: number, slotId: string, rect: NormRect | null) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/rect`, { rect });

/** `frame: null` heißt „wie das Buch", `'keiner'` heißt „ausdrücklich ohne". */
export const rahmenSetzen = (index: number, slotId: string, frame: FrameId | null) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/frame`, { frame });

/** Bildunterschrift im Fuß des Rahmens. Ein leerer Text löscht sie. */
export const unterschriftSetzen = (index: number, slotId: string, caption: string) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/caption`, { caption });

/**
 * Nimmt einen leeren Platz von der Doppelseite oder holt ihn zurück.
 *
 * Nur für Plätze ohne Bild: Der Server antwortet mit `409` und einem Satz,
 * wenn dort noch eines liegt.
 */
export const platzWegnehmen = (index: number, slotId: string, hidden: boolean) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/hidden`, { hidden });

/** Ein Bild im Stapel der Doppelseite bewegen – vier Züge, keine Ebenennummer. */
export const ebeneSetzen = (index: number, slotId: string, zug: Ebenenzug) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/slots/${slotId}/layer`, { zug });

/** Was ein Zug im Buch bewegt hat: die betroffenen Doppelseiten, fertig gerendert. */
export interface Zugergebnis {
  ok: boolean;
  touched: number[];
  spreads: SpreadResponse[];
  report: Report | null;
  /**
   * Der Platz, der dabei entstanden ist – nur beim Zug auf eine Stelle des
   * Papiers (`{ kind: 'frei' }`). Die Bühne wählt ihn danach aus.
   */
  slotId?: string;
}

export const fotoVerschieben = (source: MoveSource, target: MoveTarget) =>
  sende<Zugergebnis>('POST', '/api/book/move', { source, target });

/** Was ein Stapel bewegt hat – wie `Zugergebnis`, plus die leer gebliebenen Seiten. */
export interface Stapelergebnis extends Zugergebnis {
  leer: number[];
}

/**
 * Mehrere Fotos in einem Zug umhängen.
 *
 * Ein Aufruf und nicht n: Jede berührte Doppelseite wird genau einmal
 * angeordnet, und im Verlauf steht eine Handlung statt n. Slots sind hier kein
 * Ziel – der Platztausch bleibt `fotoVerschieben`.
 */
export const fotosVerschieben = (moves: readonly PhotoMove[]) =>
  sende<Stapelergebnis>('POST', '/api/book/move', { moves });

// ─── Textblöcke ─────────────────────────────────────────────────────────────

export const textErstellen = (index: number, patch: Partial<TextBlockData>) =>
  sende<SpreadAntwort & { block?: TextBlockData }>('POST', `/api/spreads/${index}/texts`, patch);

export const textAendern = (index: number, id: string, patch: Partial<TextBlockData>) =>
  sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/texts/${id}`, patch);

export const textLoeschen = (index: number, id: string) =>
  sende<SpreadAntwort>('DELETE', `/api/spreads/${index}/texts/${id}`);

// ─── Vorlagentexte ──────────────────────────────────────────────────────────

/**
 * Wortlaut, Platz oder Winkel eines Vorlagentexts.
 *
 * Angesprochen über die Kennung des Textplatzes (`t-year`) – dieselbe, unter der
 * er im RSM steht. `rect: null` bzw. `rotateDeg: null` stellt die Vorlage wieder
 * her. Eine Schriftgröße gibt es hier nicht: Sie folgt der Kastenhöhe.
 */
export const vorlagentextAendern = (
  index: number,
  slotId: string,
  patch: {
    content?: string;
    rect?: { x: number; y: number; w: number; h: number } | null;
    rotateDeg?: number | null;
  },
) => sende<SpreadAntwort>('PATCH', `/api/spreads/${index}/textslots/${slotId}`, patch);

// ─── Fotos ──────────────────────────────────────────────────────────────────

/** Ein Bild, das derzeit in keiner Doppelseite steht. */
export interface PoolFoto {
  id: string;
  fileName: string;
  date: string | null;
  width: number;
  height: number;
}

/**
 * Was der Server über ein Foto weiß – `PhotoView` aus `project.ts`.
 *
 * `effectiveDate` ist das Ergebnis der Datumskaskade, `dateSource` sagt, woher
 * es stammt (`exif`, `filename`, `interpolated` …). Beides zusammen anzuzeigen
 * ist der Punkt: Ein interpoliertes Datum sieht sonst so verbindlich aus wie
 * ein ausgelesenes.
 */
export interface FotoInfo {
  id: string;
  fileName: string;
  relPath: string;
  width: number;
  height: number;
  bytes: number;
  effectiveDate: string | null;
  dateSource: string;
  dateConfidence: string;
  takenAt?: string;
  gps?: { lat: number; lon: number };
  place?: { key: string; label: string };
  camera?: string;
  issues: { code: string; detail?: string }[];
  /** Ob `place` von Hand gesetzt ist statt über GPS aufgelöst. */
  placeManual?: boolean;
  /**
   * Vierteldrehungen aus einer Ausrichtungskorrektur.
   *
   * Sie gehört in die Bild-URL: Ohne sie zeigte der Browser das Bild weiter in
   * der alten Ausrichtung, weil die Vorschauen `immutable` ausgeliefert werden.
   */
  quarterTurns?: 1 | 2 | 3;
  /**
   * Gemessene Bildqualität, sofern der Hintergrundlauf schon dort war.
   *
   * Die Ansicht zeigt daraus nur die Schärfe, und nur im Vergleich: Ein
   * absoluter Wert sagt niemandem etwas, „von diesen zweien das schärfere"
   * dagegen sofort.
   */
  quality?: PhotoQuality;
  /**
   * Von Hand gesetztes Gewicht, sofern eines gesetzt ist.
   *
   * Fehlt bei der Vorgabe und ist dann nicht `'normal'`: Die Ansicht soll eine
   * getroffene Auszeichnung zeigen, nicht die Vorgabe als Zustand.
   */
  weight?: PhotoWeight;
  /**
   * Eingestellte Bildanpassung, sofern eine gesetzt ist.
   *
   * Fehlt wie `weight`, wenn nichts eingestellt ist – die Regler stehen dann
   * auf ihrer Mitte, und das ist kein Zustand, den der Server mitteilen müsste.
   */
  adjust?: PhotoAdjust;
  /**
   * Das Video, für das dieses Foto das Standbild ist.
   *
   * Fehlt bei jedem gewöhnlichen Foto. `url` fehlt, solange niemand eine Adresse
   * hinterlegt hat – dann steht auch kein Code im Buch.
   */
  video?: { kennung: string; url?: string };
}

// ─── Doppel ─────────────────────────────────────────────────────────────────

/**
 * Mehrere Aufnahmen desselben Augenblicks.
 *
 * Wird bei jedem Aufruf frisch gerechnet und nirgends gespeichert — der
 * Vorschlag hängt an den Datumskorrekturen (`apps/server/src/project/doppel.ts`).
 */
export interface DoppelVorschlag {
  photoIds: string[];
  from: string;
  to: string;
  /** Welches Foto die Automatik behielte — das schärfste. */
  behalten: string;
  /** Die Kennung, unter der ein „beide behalten" gemerkt wird. */
  schluessel: string;
  /**
   * Der größte gemessene Bildabstand innerhalb des Doppels — die Begründung
   * des Vorschlags. Fehlt, wenn kein Bildvergleich stattgefunden hat.
   */
  aehnlichkeit?: number;
  /** Wann „beide behalten" gedrückt wurde, sofern es das wurde. */
  behaltenSeit?: string;
}

export interface DoppelBericht {
  doppel: DoppelVorschlag[];
  fotos: number;
  /**
   * Ob ein Bildvergleich stattgefunden hat.
   *
   * `false` heißt, dass die Vorschläge allein aus der Zeit stammen — dann
   * stehen auch zwei Kameras auf demselben Fest als Doppel darin, und die
   * Ansicht sagt es dazu.
   */
  bestaetigt: boolean;
  /** Die Schwellen, mit denen gerechnet wurde — die Ansicht begründet damit. */
  fensterSekunden: number;
  hoechstabstand: number;
  millisekunden: number;
}

export const doppelLaden = () => hole<DoppelBericht>('/api/photos/doppel');

/** „Beide behalten": merkt ein Doppel als erledigt, ohne etwas zu löschen. */
export const doppelBehalten = (schluessel: string) =>
  sende<{ ok: true; schluessel: string }>('POST', '/api/photos/doppel/behalten', { schluessel });

/** Nimmt ein „beide behalten" zurück; ohne Schlüssel alle auf einmal. */
export const doppelBehaltenZurueck = (schluessel?: string) =>
  sende<{ ok: true; anzahl: number }>(
    'DELETE',
    '/api/photos/doppel/behalten',
    schluessel === undefined ? {} : { schluessel },
  );

// ─── Einwurf ────────────────────────────────────────────────────────────────

/**
 * Was ein Einwurf hinterlassen hat.
 *
 * `dupliziert` heißt: Dasselbe Bild lag schon im Bestand, es ist keine zweite
 * Datei entstanden – die Kennung eines Fotos ist sein Inhalt. `zurueckgeholt`
 * heißt: Es war aussortiert und ist von der Merkliste genommen worden.
 * `spread` fehlt bei einem Einwurf in den Fotopool.
 */
export interface Einwurfergebnis {
  ok: boolean;
  photo?: FotoInfo;
  /** Wohin die Datei geschrieben wurde, relativ zur Bildquelle. */
  relPath?: string;
  dupliziert?: boolean;
  zurueckgeholt?: boolean;
  /** Der Platz, an dem das Bild liegt – nur mit Fallstelle. */
  slotId?: string;
  touched?: number[];
  spread?: SpreadResponse;
  report?: Report | null;
  photoCount?: number;
}

/**
 * Wirft eine Datei ins Buch.
 *
 * Der Rumpf ist die Datei selbst und nicht ein `FormData`: Ein Einwurf ist genau
 * ein Bild, und der Server braucht dafür keinen Multipart-Leser (Begründung am
 * Parser in `app.ts`). Der Name geht als Query mit, weil ein
 * `Content-Disposition` mit Umlauten nur mit Sonderregeln zu schreiben ist – und
 * der Bestand ist voller Umlaute.
 *
 * `ziel`:
 * - `{ kind: 'pool' }` – nur in den Bestand, das Bild liegt danach im Fotopool.
 * - `{ kind: 'spread', index, punkt }` – auf die Doppelseite, an die Fallstelle.
 *   Der Punkt ist normiert auf den Endformatbereich der Doppelseite.
 * - `{ kind: 'spread', index }` – auf die Doppelseite, die danach neu angeordnet
 *   wird (aus dem Baum, wo eine Zeile keine Stelle im Millimeterraster hat).
 */
export function bildEinwerfen(
  datei: File,
  ziel: { kind: 'pool' } | { kind: 'spread'; index: number; punkt?: { x: number; y: number } },
): Promise<Einwurfergebnis> {
  const frage = new URLSearchParams({ name: datei.name });
  if (ziel.kind === 'spread' && ziel.punkt) {
    frage.set('x', String(ziel.punkt.x));
    frage.set('y', String(ziel.punkt.y));
  }
  const pfad =
    ziel.kind === 'pool'
      ? `/api/photos/einwurf?${frage}`
      : `/api/spreads/${ziel.index}/einwurf?${frage}`;

  return ruf<Einwurfergebnis>(pfad, {
    method: 'POST',
    // **Immer** `octet-stream` und nicht `datei.type`: Der Medientyp entscheidet,
    // ob Fastify die Anfrage überhaupt annimmt. Der Browser schickt für eine
    // `.webp` oder `.gif` einen Typ, für den kein Parser angemeldet ist – die
    // Antwort wäre ein englischer `415` aus dem Rahmenwerk statt des deutschen
    // Satzes, der sagt, welche Endungen ins Buch kommen. Was die Datei ist,
    // entscheidet ohnehin ihre Endung und ihr Inhalt, nicht ihr Kopf.
    headers: { 'content-type': 'application/octet-stream' },
    body: datei,
  });
}

// ─── Videos ─────────────────────────────────────────────────────────────────

/**
 * Die Medientypen der Videoendungen – aus dem Namen abgeleitet, nicht aus
 * `File.type`.
 *
 * Anders als beim Bildeinwurf, der **immer** `octet-stream` schickt, muss hier
 * der echte Typ mit: Am Medientyp hängt, welcher Parser die Anfrage annimmt, und
 * nur der Videoparser reicht den Strom durch, statt ein Gigabyte in den Speicher
 * zu lesen (`app.ts` im Server). Auf `File.type` ist dabei kein Verlass – für
 * eine `.m4v` liefern Browser mitunter einen leeren String.
 */
const VIDEO_TYPEN: Record<string, string> = {
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
};

function endungVon(name: string): string {
  const punkt = name.lastIndexOf('.');
  return punkt < 0 ? '' : name.slice(punkt).toLowerCase();
}

/**
 * Ob diese Datei als Video eingeworfen wird.
 *
 * Über die Endung und nicht über den Medientyp: Dieselbe Entscheidung trifft der
 * Server über dieselbe Liste (`VIDEO_EXT` in `import.ts`), und ein Browser, der
 * keinen Typ mitschickt, würde sonst ein Video als Bild einwerfen – die Antwort
 * wäre ein Fehler über eine unerlaubte Endung.
 */
export function istVideodatei(name: string): boolean {
  return endungVon(name) in VIDEO_TYPEN;
}

/** Was der Server nach dem Aufnehmen über das Video weiß. */
export interface Videoaufnahme {
  kennung: string;
  dauerSek: number;
  /** Eine Adresse, die für dieses Video schon einmal hinterlegt wurde. */
  adresse?: string;
}

/**
 * Nimmt ein Video auf. Es entsteht dabei **kein Foto** – nur eine Kennung.
 *
 * Der zweite Schritt (`videoStandbildEinwerfen`) wählt die Sekunde und legt das
 * Standbild ins Buch. Zweistufig, weil die Fotokennung der Bildinhalt ist: Ein
 * anderes Standbild wäre ein anderes Foto, und der Wechsel müsste jedes Vorkommen
 * umhängen (Begründung in `project/video.ts` im Server).
 */
export function videoAufnehmen(datei: File): Promise<Videoaufnahme> {
  const typ = VIDEO_TYPEN[endungVon(datei.name)];
  if (!typ) throw new Error(`„${datei.name}" ist kein Video`);

  return ruf<Videoaufnahme>(`/api/videos?${new URLSearchParams({ name: datei.name })}`, {
    method: 'POST',
    headers: { 'content-type': typ },
    body: datei,
  });
}

/**
 * Die Adresse eines Standbildes zu einer Sekunde – für den Schieber.
 *
 * Eine Adresse und kein Aufruf: Das Bild hängt in einem `<img>`, und der Browser
 * lädt es selbst. Es wird nicht zwischengespeichert (`no-store` am Endpunkt).
 */
export function videoStandbildAdresse(kennung: string, sekunde: number): string {
  return `/api/videos/${kennung}/standbild?t=${sekunde.toFixed(2)}`;
}

/** Zieht das Standbild an dieser Sekunde und setzt es ein. */
export function videoStandbildEinwerfen(
  kennung: string,
  sekunde: number,
  ziel: { kind: 'pool' } | { kind: 'spread'; index: number; punkt?: { x: number; y: number } },
  /** Name des Films – das Standbild heißt danach `<name>-<sekunde>s.jpg`. */
  name?: string,
): Promise<Einwurfergebnis & { kennung?: string; uebernommeneAdresse?: string }> {
  return sende('POST', `/api/videos/${kennung}/standbild`, {
    sekunde,
    ...(name ? { name } : {}),
    ...(ziel.kind === 'spread'
      ? { spread: ziel.index, ...(ziel.punkt ? { x: ziel.punkt.x, y: ziel.punkt.y } : {}) }
      : {}),
  });
}

/**
 * Hinterlegt die Adresse, unter der das Video zu sehen ist – oder nimmt sie weg.
 *
 * Wirkt an **allen** Standbildern desselben Films; wie viele es waren, sagt
 * `geaendert`.
 */
export const videoAdresseSetzen = (photoId: string, url: string | null) =>
  sende<{
    ok: true;
    geaendert: number;
    kennung?: string;
    photo?: FotoInfo;
    spread?: SpreadResponse;
  }>('PUT', `/api/photos/${photoId}/video`, { url });

/** Kennung → Zieladresse, für die Umleitung hinter der Kurzadresse. */
export const videoUmleitungen = () =>
  hole<{
    basis: string | null;
    umleitungen: { kennung: string; ziel: string; photoId: string }[];
  }>('/api/videos/umleitungen');

/**
 * Eine Datumskorrektur, wie der Server sie annimmt.
 *
 * `shift` verschiebt um einen Betrag und erhält damit die Abstände — der
 * Kamera-Reset-Fall. `spread` verteilt über einen Zeitraum und liefert deshalb
 * geschätzte Werte. `clear` gibt das Datum an die Datei zurück.
 */
export type Datumskorrektur =
  | { kind: 'set'; value: string }
  | {
      kind: 'shift';
      years?: number;
      months?: number;
      days?: number;
      hours?: number;
      minutes?: number;
    }
  | { kind: 'spread'; from: string; to: string }
  | { kind: 'clear' };

export interface Korrekturergebnis {
  geaendert: number;
  uebersprungen: { id: string; grund: string }[];
  unbekannt: string[];
  /** Die betroffenen Fotos mit neu aufgelöstem Datum. */
  photos: FotoInfo[];
  structurePending: boolean;
  undatedCount: number;
}

/**
 * Korrigiert das Datum mehrerer Fotos.
 *
 * **Die Reihenfolge der Liste ist die Reihenfolge der Verteilung** — beim
 * Verteilen über einen Zeitraum bekommt das erste Foto den frühesten Zeitpunkt.
 * Die Ansicht schickt also die Liste, die sie zeigt.
 */
export const datumKorrigieren = (ids: string[], date: Datumskorrektur) =>
  sende<Korrekturergebnis>('PATCH', '/api/photos', { ids, date });

/** Ein Ort, wie er im Bestand vorkommt – Grundlage der Vervollständigung. */
export interface Ort {
  key: string;
  label: string;
  count: number;
}

export const ortsListeLaden = () => hole<{ places: Ort[] }>('/api/photos/places');

/**
 * Setzt den Ort mehrerer Fotos; `null` gibt ihn an die Automatik zurück.
 *
 * Mit `key` aus der Vorschlagsliste fällt das Foto mit den über GPS aufgelösten
 * desselben Ortes in *einen* Gruppenvorschlag. Ohne Kennung entsteht eine eigene
 * (`manual:<Name>`) – richtig für einen Ort, den es im Bestand noch nicht gibt.
 */
export const ortSetzen = (ids: string[], place: { label: string; key?: string } | null) =>
  sende<Korrekturergebnis>('PATCH', '/api/photos', { ids, place });

/**
 * Kippt die Ausrichtung mehrerer Fotos; `null` gibt sie an die Datei zurück.
 *
 * Die Vierteldrehungen **addieren sich** auf das schon Gesetzte: Am Knopf dreht
 * man, bis es stimmt, statt mitzuzählen.
 */
export const ausrichtungKippen = (ids: string[], orientation: 1 | 2 | 3 | null) =>
  sende<Korrekturergebnis>('PATCH', '/api/photos', { ids, orientation });

/**
 * Zeichnet Fotos als Hauptbild aus; `'normal'` nimmt es zurück.
 *
 * Anders als bei Ort und Ausrichtung kein `null` für die Vorgabe: `'normal'`
 * ist die Vorgabe und hat einen Namen, mit dem sich ein Knopf beschriften lässt.
 *
 * **Das Buch folgt nicht von selbst** — das Gewicht wiegt in der Slotzuordnung
 * und wirkt erst beim nächsten Anordnen dieser Doppelseite.
 */
export const gewichtSetzen = (ids: string[], weight: PhotoWeight) =>
  sende<Korrekturergebnis>('PATCH', '/api/photos', { ids, weight });

/**
 * Stellt Helligkeit, Kontrast, Sättigung, Wärme und Tonung ein; `null` nimmt
 * alles zurück.
 *
 * Der Befehl trägt die **ganze** Einstellung und nicht einen einzelnen Regler:
 * „Kontrast unverändert" und „Kontrast auf 0" kämen sonst als dieselbe fehlende
 * Zahl an.
 *
 * Anders als beim Gewicht folgt das Buch **sofort** — die Anpassung wird beim
 * Rendern angewandt und steht in der Antwort schon drin.
 */
export const anpassungSetzen = (ids: string[], adjust: PhotoAdjust | null) =>
  sende<Korrekturergebnis>('PATCH', '/api/photos', { ids, adjust });

/** Was das Aussortieren eines Fotos bewirkt hat. */
export interface AussortierErgebnis {
  fileName: string;
  /** Slots im Buch, die dadurch leer stehen. */
  imBuch: number;
  spreads: number[];
  photoCount: number;
  /** Die betroffenen Doppelseiten, fertig gerendert. */
  rendered: { index: number; spread: RenderedSpread }[];
}

/**
 * Ein aussortiertes Foto – `Aussortiert` aus `project/bestand.ts`.
 *
 * Die Datei liegt weiter in ihrer Bildquelle; was das Foto draußen hält, ist
 * dieser Vermerk. Deshalb muss er sichtbar sein und sich aufheben lassen.
 */
export interface AussortiertesFoto {
  /**
   * Das rohe Importergebnis, nicht die aufgelöste `FotoInfo`: Es ist genau das,
   * was beim Aussortieren aus dem Bestand genommen wurde.
   */
  photo: {
    id: string;
    fileName: string;
    relPath: string;
    width: number;
    height: number;
    bytes: number;
    takenAt?: string;
  };
  /** Wann aussortiert, als ISO-Zeitstempel. */
  at: string;
}

export const aussortierteLaden = () =>
  hole<{ aussortiert: AussortiertesFoto[] }>('/api/photos/aussortiert');

/** Hebt den Vermerk auf: Das Foto steht danach wieder im Fotopool. */
export const fotoWiederAufnehmen = (photoId: string) =>
  sende<{ photo: FotoInfo; photoCount: number }>(
    'DELETE',
    `/api/photos/aussortiert/${encodeURIComponent(photoId)}`,
  );

export const fotopoolLaden = () => hole<{ photos: PoolFoto[] }>('/api/book/unplaced');

/**
 * Eine Doppelseite im Baum – `BaumSeite` aus `project/baum.ts`.
 *
 * Ohne die Bilddaten selbst: Die kommen über `fotosLaden()`. Hier steht die
 * Gliederung und was an der Seite auffällt.
 */
export interface BaumSeite {
  index: number;
  /** Die belegten Plätze in Slotreihenfolge – mit dem Slotnamen, den ein Zug braucht. */
  bilder: { slotId: string; photoId: string }[];
  templateId: string;
  year?: number;
  groupTitle?: string;
  locked: boolean;
  auftakt: boolean;
  leer: boolean;
  handarbeit: boolean;
  zuKlein: number;
  /** Bilder, die quer zu ihrem Platz stehen – meist nach einer Ausrichtungskorrektur. */
  falscheLage: number;
}

export const baumLaden = () => hole<{ spreads: BaumSeite[] }>('/api/book/tree');

/**
 * Der Abnahmebericht — was dem Druck im Weg steht, über das ganze Buch.
 *
 * Der Antworttyp kommt aus dem Kern und wird hier nicht nachgeschrieben: Er ist
 * das Ergebnis von `pruefeBuch`, und eine zweite Fassung davon in dieser Datei
 * wäre eine zweite Wahrheit über die Arten von Befunden — mit der die Ansicht
 * eine Art zeigen könnte, die es nicht mehr gibt.
 */
export const abnahmeLaden = () => hole<Abnahmebericht>('/api/book/pruefung');

/**
 * „Weiß ich, ist ok" — nickt einen Befund ab.
 *
 * Der Schlüssel hängt am Gegenstand des Funds, nicht an seiner Stelle: Ein
 * abgenicktes Foto darf quer stehen, wo immer es landet. Zurück kommt der
 * ganze Bericht, weil sich mit einer Abnahme auch die Bilanz und — bei einem
 * gebündelten Textplatz — mehrere Zeilen auf einmal ändern.
 */
export const befundAbnicken = (schluessel: string) =>
  sende<{ ok: true; bericht: Abnahmebericht }>('POST', '/api/book/pruefung/abnahmen', {
    schluessel,
  });

/** Nimmt eine Abnahme zurück — mit Schlüssel eine, ohne alle. */
export const abnahmeZuruecknehmen = (schluessel?: string) =>
  sende<{ ok: true; anzahl: number; bericht: Abnahmebericht }>(
    'DELETE',
    '/api/book/pruefung/abnahmen',
    schluessel === undefined ? {} : { schluessel },
  );

/** Worauf der Unterschriftenzug wirkt. */
export type Unterschriftenbereich =
  { kind: 'spread'; index: number } | { kind: 'group'; id: string } | { kind: 'book' };

/** Woraus die Zeile besteht – dieselben Namen wie im Kern (`model/caption.ts`). */
export type CaptionForm = 'ort' | 'tag' | 'monat' | 'ort-tag' | 'ort-monat';

export interface UnterschriftenErgebnis {
  geaendert: number;
  uebersprungen: { handarbeit: number; ohneAngabe: number; ohneFuss: number };
  /** Die berührten Doppelseiten, fertig gerendert – wie bei `POST /api/book/move`. */
  seiten: number[];
  spreads: SpreadResponse[];
}

/** Füllt Bildunterschriften aus Ort und Datum. */
export const unterschriftenSetzen = (
  bereich: Unterschriftenbereich,
  form: CaptionForm,
  ueberschreiben = false,
) => sende<UnterschriftenErgebnis>('POST', '/api/book/captions', { bereich, form, ueberschreiben });

/** Nimmt die erzeugten Unterschriften wieder heraus; getippte bleiben. */
export const unterschriftenEntfernen = (bereich: Unterschriftenbereich) =>
  sende<UnterschriftenErgebnis>('DELETE', '/api/book/captions', { bereich });

export const fotosDerSeiteLaden = (index: number) =>
  hole<{ photos: FotoInfo[] }>(`/api/spreads/${index}/photos`);

/**
 * Was sich am Bestand filtern lässt. Die Bedingungen verunden sich.
 *
 * Dieselben Namen wie die Query-Parameter des Servers, damit die Adresse
 * lesbar bleibt und `bestandsAdresse` nichts übersetzen muss.
 */
export interface Bestandsfilter {
  /** `true`: im Buch. `false`: der Fotopool. */
  platziert?: boolean;
  von?: string;
  bis?: string;
  ohneDatum?: boolean;
  /** Ortskennung, Name oder Wortteil; `''` sucht die Fotos ohne Ort. */
  ort?: string;
  quelle?: string;
  datumsquelle?: string;
  konfidenz?: 'high' | 'medium' | 'low';
  /** Gruppenkennung; `''` sucht die Fotos in keiner Gruppe. */
  gruppe?: string;
  problems?: boolean;
}

/** Die Query eines Bestandsfilters – leere Angaben fallen weg, nicht der leere Text. */
function bestandsQuery(filter: Bestandsfilter): string {
  const p = new URLSearchParams();
  if (filter.platziert !== undefined) p.set('platziert', filter.platziert ? 'ja' : 'nein');
  if (filter.von) p.set('von', filter.von);
  if (filter.bis) p.set('bis', filter.bis);
  if (filter.ohneDatum) p.set('ohneDatum', '1');
  // `!== undefined` und nicht `if (filter.ort)`: Der leere Text ist hier eine
  // Frage („ohne Ort", „in keiner Gruppe") und kein fehlender Wert.
  if (filter.ort !== undefined) p.set('ort', filter.ort);
  if (filter.quelle) p.set('quelle', filter.quelle);
  if (filter.datumsquelle) p.set('datumsquelle', filter.datumsquelle);
  if (filter.konfidenz) p.set('konfidenz', filter.konfidenz);
  if (filter.gruppe !== undefined) p.set('gruppe', filter.gruppe);
  if (filter.problems) p.set('problems', '1');
  const query = p.toString();
  return query ? `?${query}` : '';
}

/**
 * Der Bestand, wahlweise gefiltert.
 *
 * Gefiltert wird auf dem Server und nicht im Browser: Dieselben Bedingungen
 * beantworten dort auch andere Fragen (der Kontaktbogen der nicht platzierten
 * Fotos), und zwei Fassungen derselben Rechnung liefen auseinander. Der Server
 * bindet an `127.0.0.1`, ein Rundgang kostet nichts.
 *
 * `gesamt` steht in der Antwort, sobald gefiltert wurde – „42 von 830" ist oft
 * schon die Antwort.
 */
export const fotosLaden = (filter: Bestandsfilter = {}) =>
  hole<{ photos: FotoInfo[]; count: number; gesamt?: number }>(
    `/api/photos${bestandsQuery(filter)}`,
  );

export const fotoAussortieren = (photoId: string) =>
  sende<AussortierErgebnis>('DELETE', `/api/photos/${photoId}`);

// ─── Gruppen ────────────────────────────────────────────────────────────────

/**
 * Eine Fotogruppe, wie der Server sie liefert.
 *
 * `firstSpreadIndex` fehlt, wenn keines der Fotos im Buch steht – etwa weil sie
 * noch im Pool liegen.
 */
export type Gruppe = PhotoGroup & { firstSpreadIndex?: number };

type GruppenAntwort = { groups: Gruppe[] };

export const gruppenLaden = () => hole<GruppenAntwort>('/api/groups');

export const gruppenVorschlagen = (reset = false) =>
  sende<GruppenAntwort & { added: number }>('POST', '/api/groups/suggest', { reset });

export const gruppeErstellen = (title: string, photoIds: string[]) =>
  sende<GruppenAntwort>('POST', '/api/groups', { title, photoIds });

export const gruppeAendern = (
  id: string,
  patch: {
    title?: string;
    coverPhotoId?: string;
    active?: boolean;
    photoIds?: string[];
    /** Auftaktseite für diese Gruppe; `null` setzt sie auf die Vorgabe zurück. */
    opener?: boolean | null;
  },
) => sende<GruppenAntwort>('PATCH', `/api/groups/${id}`, patch);

export const gruppeLoeschen = (id: string) => sende<GruppenAntwort>('DELETE', `/api/groups/${id}`);

export const gruppenVerschmelzen = (id: string, targetId: string) =>
  sende<GruppenAntwort>('POST', `/api/groups/${id}/merge`, { targetId });

export const gruppeErweitern = (id: string, photoIds: string[]) =>
  sende<GruppenAntwort>('POST', `/api/groups/${id}/add`, { photoIds });

export const gruppierungAufheben = (photoIds: string[]) =>
  sende<GruppenAntwort>('POST', '/api/groups/ungroup', { photoIds });

// ─── Bildquellen ────────────────────────────────────────────────────────────

export interface Bildquelle {
  id: string;
  label: string;
  root: string;
  addedAt: string;
  erreichbar: boolean;
  photoCount: number;
  /** Fotos dieser Quelle, die derzeit in einer Doppelseite stehen. */
  inBookCount: number;
}

export const quellenLaden = () => hole<{ sources: Bildquelle[] }>('/api/sources');

export const quelleHinzufuegen = (root: string, label?: string) =>
  sende<{ source: Bildquelle } & ImportDiff>('POST', '/api/sources', {
    root,
    ...(label ? { label } : {}),
  });

export const quelleEntfernen = (id: string) =>
  sende<{ source: Bildquelle; entfernt: number; imBuch: number }>('DELETE', `/api/sources/${id}`);

export const quelleUmbenennen = (id: string, label: string) =>
  sende<{ source: Bildquelle }>('PATCH', `/api/sources/${id}`, { label });

/**
 * Zeigt eine Quelle auf einen anderen Ordner — der Weg zurück, wenn er umgezogen
 * ist und mit ihm jede Bilddatei.
 *
 * Nicht dasselbe wie Entfernen und Neuanlegen: Die Quelle behält ihre Kennung,
 * und damit bleibt jedes Foto bei ihr, samt Korrekturen und Platz im Buch.
 */
export const quelleUmziehen = (id: string, root: string) =>
  sende<{ source: Bildquelle }>('PATCH', `/api/sources/${id}`, { root });

/** Fotos, deren Bilddatei nicht mehr auffindbar ist. */
export const fehlendeDateienLaden = () =>
  hole<{
    count: number;
    geprueft: number;
    offline: { id: string; label: string; photoCount: number }[];
    photos: FotoInfo[];
  }>('/api/photos/fehlend');

// ─── Jahresereignisse ───────────────────────────────────────────────────────

export const jahresereignisseLaden = () =>
  hole<{ yearEvents: Record<string, string[]> }>('/api/chapters/events');

/**
 * `angewendet: false` heißt: gespeichert, aber im Buch noch nicht zu sehen —
 * das Jahr hat keine Auftaktseite, auf der die Zeilen stehen könnten.
 */
export const jahresereignisseSpeichern = (year: number, events: string[]) =>
  sende<{ angewendet: boolean }>('PUT', `/api/chapters/${year}/events`, { events });

// ─── Umschlag ───────────────────────────────────────────────────────────────

export interface Umschlag {
  design: CoverDesign;
  cover: RenderedCover;
  candidates: { photoId: string; label: string }[];
  hints: string[];
  profileVerified: boolean;
  /**
   * Was aus der Anweisung für die Vorderseite geworden ist. Fehlt, solange
   * keine gesetzt ist — oder wenn das Backen scheiterte; dann steht der Grund
   * in `hints`.
   */
  mosaik?: Mosaikstand;
  /** Dasselbe für die Rückseite. */
  rueckmosaik?: Mosaikstand;
}

export interface Mosaikstand {
  photoId: string;
  datei: string;
  kacheln: number;
  /** Wie viele verschiedene Fotos vorkommen. */
  fotos: number;
  /** Wie viele überhaupt zur Wahl standen — `fotos` ist nur davor eine Aussage. */
  verfuegbar: number;
  druckBreitePx: number;
  druckHoehePx: number;
}

export const umschlagLaden = () => hole<Umschlag>('/api/cover');

/**
 * Was `PATCH /api/cover` annimmt.
 *
 * `frontMosaic`/`backMosaic` auf `null` entfernen das Mosaik — ein weggelassenes
 * Feld hieße „nicht angefasst", und über JSON kommt kein `undefined` an.
 * Dieselbe Regel gilt in `texts` je Feld: `null` nimmt eine Gestaltung zurück,
 * statt sie auf einen leeren Wert zu setzen. Und `texts` wird serverseitig **je
 * Text verschmolzen**, die Oberfläche schickt also nur, was sie angefasst hat.
 */
export type UmschlagPatch = Omit<Partial<CoverDesign>, 'frontMosaic' | 'backMosaic' | 'texts'> & {
  frontMosaic?: CoverMosaic | null;
  backMosaic?: CoverMosaic | null;
  texts?: Partial<Record<CoverTextName, Partial<Record<keyof CoverTextStyle, unknown>>>>;
};

export const umschlagAendern = (patch: UmschlagPatch) =>
  sende<Umschlag>('PATCH', '/api/cover', patch);

/**
 * Woran der Server gerade backt, oder `null`.
 *
 * Wird im Sekundentakt gefragt, solange ein Mosaik entsteht — die Antwort auf
 * das `PATCH` kommt erst, wenn alles fertig ist, und nützt für eine Anzeige
 * während der Arbeit deshalb nichts.
 */
export interface Mosaikfortschritt {
  phase: string;
  fertig: number;
  /** 0 heißt „keine zählbaren Schritte" — dann steht der Satz ohne Balken. */
  gesamt: number;
}

export const mosaikFortschrittLaden = () =>
  hole<{ fortschritt: Mosaikfortschritt | null }>('/api/cover/mosaik-fortschritt');

export const umschlagExportieren = () =>
  sende<{
    outputPath: string;
    fileName: string;
    widthMm: number;
    heightMm: number;
    spineMm: number;
    pageCount: number;
  }>('POST', '/api/export/cover', {});

// ─── Layout-Dokument und Export ─────────────────────────────────────────────

export interface LayoutProblem {
  severity: 'error' | 'warning';
  spread?: number;
  message: string;
}

export interface LayoutErgebnis {
  ok: boolean;
  issues: LayoutProblem[];
  problems: { index: number; photoCount: number; message: string }[];
  spreadCount: number;
}

export const layoutLaden = () => hole<LayoutDocument>('/api/book/layout');

/**
 * Das bearbeitete Layout-Dokument, als Rohtext aus dem Editor.
 *
 * Hier geht ausnahmsweise kein Objekt hinaus, sondern der Text, den der Benutzer
 * getippt hat: Er soll genau das prüfen lassen, was im Feld steht. Und die
 * Antwort ist auch bei `ok: false` eine Auskunft — die Mängelliste ist das
 * Ergebnis, kein Fehlschlag.
 */
export function layoutAnwenden(rohtext: string): Promise<LayoutErgebnis> {
  // Über `imFlug` wie jeder andere schreibende Aufruf hier: Sonst wartet
  // `ausstehendSenden()` vor einem Cmd+Z nicht auf ihn, und eine spät
  // eintreffende Antwort überschriebe den gerade zurückgenommenen Stand.
  return imFlug(layoutAnwendenAnfrage(rohtext));
}

async function layoutAnwendenAnfrage(rohtext: string): Promise<LayoutErgebnis> {
  const res = await fetch('/api/book/layout', {
    method: 'POST',
    headers: mitFenster({ 'content-type': 'application/json' }),
    body: rohtext,
  });
  const roh = await res.text();
  const daten: unknown = roh ? JSON.parse(roh) : {};
  // Ausdrücklich der HTTP-Status, nicht `daten.ok`: Ein `ok: false` im Rumpf
  // ist hier eine gültige Auskunft – die Mängelliste des Editors –, kein
  // Fehlschlag. Nur ein schlechter Status oder eine kaputte Antwort ist einer.
  if (!res.ok) {
    const satz = (daten as { error?: string } | null)?.error;
    throw new ApiFehler(satz ?? `HTTP ${res.status} ${res.statusText}`.trim(), res.status);
  }
  return daten as LayoutErgebnis;
}

/**
 * Was ein Export zurückgibt.
 *
 * `outputPath` ist die Auskunft für den Menschen, `fileName` die Adresse für
 * `GET /api/export/:fileName` — daran hängt der Öffnen-Link an der Meldung.
 */
export interface ExportErgebnis {
  outputPath: string;
  fileName: string;
  pages: number;
  images: number;
}

export const pdfExportieren = (spreadIndex?: number) =>
  sende<ExportErgebnis>(
    'POST',
    '/api/export/pdf',
    spreadIndex === undefined ? {} : { spreadIndex },
  );

/**
 * Der Korrekturabzug — immer das ganze Buch.
 *
 * Ohne Doppelseitenwahl, anders als beim Druck-PDF: Eine einzelne Seite sieht
 * man in der Vorschau, und zum Blättern gibt es nichts, wenn es ein Blatt ist.
 */
export const abzugExportieren = () => sende<ExportErgebnis>('POST', '/api/export/abzug', {});

// ─── Wer sonst noch am Buch sitzt ───────────────────────────────────────────

/** Eine Änderung, die ein anderes Fenster ausgelöst hat. */
export interface FremdeAenderung {
  /**
   * Fortlaufend ab 1, je Server. **Keine Lückenerkennung** – dem eigenen
   * Fenster fehlen die Nummern seiner eigenen Griffe (Begründung am Feld im
   * Server). Dass die Leitung weg war, sagt `onWiederVerbunden`.
   */
  nr: number;
  /** Deutscher Satzanfang, wie am Zurück-Knopf: „Ausschnitt gesetzt". */
  label: string;
  /** Welche Doppelseite es betrifft, wenn es eine gibt. */
  spreadIndex?: number;
}

/** Was am Ereignisstrom eintreffen kann. */
export interface Strommelder {
  /** Ein anderes Fenster hat etwas geändert. */
  onAenderung(a: FremdeAenderung): void;
  /** Wie viele Fenster gerade offen sind – dieses mitgezählt. */
  onFenster(anzahl: number): void;
  /**
   * Die Leitung stand, war weg und steht wieder.
   *
   * Nicht dasselbe wie eine Änderung, aber die gleiche Folge: In der Lücke kann
   * etwas geschehen sein, das dieses Fenster nicht erfahren hat. Wer den Melder
   * baut, lädt danach einmal nach – der `nr`-Sprung allein hilft nicht, denn die
   * verpasste Meldung kam ja nie an.
   */
  onWiederVerbunden(): void;
}

/**
 * Hört, was die anderen Fenster tun.
 *
 * `EventSource` und kein eigener Verbindungsaufbau: Der Browser verbindet nach
 * einem Abbruch von selbst neu, mit wachsendem Abstand, und genau das will man
 * hier — ein Server, der gerade neu startet, soll nicht von einer Schleife
 * bestürmt werden.
 *
 * Hier in `api.ts` und nicht im Haken, aus demselben Grund wie jedes `fetch`:
 * Was der Server kann, steht an einer Stelle. Der Haken (`useEreignisse.ts`)
 * entscheidet, *wann* nachgeladen wird.
 *
 * @returns den Griff zum Schließen. Ohne ihn bliebe die Leitung offen, und der
 * Server zählte ein Fenster, das es nicht mehr gibt.
 */
export function ereignisseHoeren(melder: Strommelder): () => void {
  // Die Kennung steht in der **Adresse** und nicht im Kopf, und das ist keine
  // Geschmacksfrage: `EventSource` kann keine eigenen Kopfzeilen setzen – die
  // API kennt außer `withCredentials` keine Option dafür. Mit dem Kopf war die
  // Leitung für den Server namenlos, jedes Fenster bekam sein eigenes Echo und
  // lud nach jedem eigenen Griff neu – samt der Meldung, ein anderes Fenster
  // hätte es getan. Die mutierenden Anfragen tragen ihn weiter im Kopf; nur
  // diese eine kann es nicht.
  const quelle = new EventSource(`/api/ereignisse?fenster=${encodeURIComponent(FENSTER)}`);
  // Erst beim zweiten `open` ist es eine Wiederverbindung. Das erste ist der
  // Anfang, und da hat das Fenster seine Daten gerade frisch geladen.
  let stand = false;

  quelle.addEventListener('open', () => {
    if (stand) melder.onWiederVerbunden();
    stand = true;
  });
  quelle.addEventListener('aenderung', (e) => {
    melder.onAenderung(JSON.parse((e as MessageEvent<string>).data) as FremdeAenderung);
  });
  quelle.addEventListener('fenster', (e) => {
    const { anzahl } = JSON.parse((e as MessageEvent<string>).data) as { anzahl: number };
    melder.onFenster(anzahl);
  });
  // `herzschlag` braucht keinen Hörer: Die Zeile hält die Leitung offen, mehr
  // soll sie nicht. Ein Fehler ebenso wenig — `EventSource` verbindet selbst
  // neu, und eine Meldung „Verbindung verloren" wäre bei einem Server auf
  // demselben Rechner meistens schon wieder falsch, bevor jemand sie liest.

  return () => quelle.close();
}
