/**
 * Projektzustand.
 *
 * Hält Fotos, Struktur und Buch im Speicher und schreibt sie atomar auf
 * Platte. Bestehende Bilddateien werden ausschließlich gelesen; die einzige
 * Ausnahme ist `einwerfen`, das eine **neue** Datei in der ersten Bildquelle
 * anlegt (`project/einwurf.ts`).
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type Chapter,
  type CoverDesign,
  type Crop,
  type DateContext,
  type DateEdit,
  type Ebenenzug,
  type FrameId,
  imageBoxes,
  type GenerateResult,
  type LayoutDocument,
  type LayoutIssue,
  type MoveManyResult,
  type MoveResult,
  type MoveSource,
  type MoveTarget,
  type NaiveDateTime,
  type PhotoMove,
  type Photo,
  type PhotoId,
  type Abnahmebericht,
  type Befund,
  type PhotoGroup,
  type PhotoOverride,
  type PhotoAdjust,
  type PhotoWeight,
  type PrintProfile,
  type RenderedCover,
  type RenderedSpread,
  type SinglePageResult,
  type Spread,
  type Structure,
  type DoppelKandidat,
  type DoppelOptions,
  type TextBlock,
  type TimelineFootVariant,
  type TimelineSideVariant,
  splitKept,
  aufsBlatt,
  bookStats,
  buildStructure,
  DEFAULT_BACKGROUND,
  FONT_FAMILIES,
  DEFAULT_FRAME,
  DEFAULT_TILT_DEG,
  normalizeRotation,
  backgroundFit,
  defaultProfile,
  DEFAULT_PROFILE_ID,
  profileById,
  pruefeBuch,
  markiere,
  seitenbefunde,
  befundzeile,
  BEFUNDARTEN,
  effectivePhoto,
  findBulkSeconds,
  FULL_CROP,
  generateBook,
  isBackgroundColor,
  isFrameId,
  isJustified,
  moveSlotLayer,
  movePhoto,
  movePhotos,
  addToGroup,
  createGroup,
  mergeGroups,
  needsAttention,
  renderSpread,
  requireTemplate,
  resolveEffectiveDate,
  sortKey,
  removeGroup,
  structureFingerprint,
  templateById,
  ungroupPhotos,
  updateGroup,
} from '@franibook/core';
import type { DecodeCache } from './decode.js';
import type { PreviewCache } from './previews.js';
import * as anordnung from './project/anordnung.js';
import { type BaumSeite, baum } from './project/baum.js';
import * as bestand from './project/bestand.js';
import type { Aussortiert, ImportDiff, QuellenBericht } from './project/bestand.js';
import * as einwurf from './project/einwurf.js';
import * as fotodaten from './project/fotodaten.js';
import * as gruppen from './project/gruppen.js';
import { type Bestandsfilter, filtereFotos, platzierteFotos } from './project/filter.js';
import {
  type Unterschriftenbereich,
  type UnterschriftenErgebnis,
  type UnterschriftenOptionen,
  type Unterschriftenstand,
  loescheUnterschriften,
  setzeUnterschriften,
} from './project/unterschriften.js';
import * as merkmale from './project/merkmale.js';
import type { MerkmaleBericht } from './project/merkmale.js';
import * as qualitaet from './project/qualitaet.js';
import type { QualitaetBericht } from './project/qualitaet.js';
import * as doppel from './project/doppel.js';
import type { DoppelBericht } from './project/doppel.js';
import type { AbstandsErkennung, VisionErkennung } from './vision.js';
import * as layoutDokument from './project/layout-dokument.js';
import {
  type Anker,
  ANKER_ORDNER,
  ankerLegen,
  ankerLesen,
  ankerListe,
} from './project/notanker.js';
import * as seiten from './project/seiten.js';
import * as umschlag from './project/umschlag.js';
import { type Schritt, Verlauf } from './project/verlauf.js';
import { type PhotoSource, quellenId, Sources } from './sources.js';

/**
 * 2: Bildquellen sind eine Liste, Fotos tragen eine `sourceId`.
 * 3: Titel stehen im Zeitstrahl, nicht als Überschrift auf der Doppelseite.
 *
 * Jeder Sprung wird migriert statt verworfen – ein Projekt enthält
 * Datumskorrekturen, bestätigte Gruppen und ein von Hand nachgearbeitetes
 * Buch, und nichts davon stellt ein Neuimport wieder her.
 */
const SCHEMA_VERSION = 3;

/** Alle drei beschreiben den Bestand und stehen deshalb bei ihm. */
export type { Aussortiert, ImportDiff, QuellenBericht };

export interface ProjectSettings {
  targetPages: number;
  chapterOpeners: boolean;
  /**
   * Ob der Jahresauftakt auch auf der Jahresseite Bilder trägt.
   *
   * Aus: sechs Bilder rechts, links nur die Jahreszahl. An: neun über beide
   * Seiten, die Zahl größer und in einem Band, das kein Bild berührt. Am echten
   * Bestand spart das rund vier Doppelseiten und kostet die Ruhe an der
   * Kapitelgrenze – deshalb eine Wahl und keine Umstellung.
   */
  chapterOpenersDense: boolean;
  /**
   * Eigene Auftaktseite je Fotogruppe, mit Hauptbild und Titel.
   *
   * `'auto'` heißt: das Gegenteil von `timeline`. Trägt der Zeitstrahl den
   * Gruppentitel auf jeder Doppelseite, ist der Auftakt entbehrlich; ohne ihn
   * ist er die einzige Stelle, an der die Gruppe benannt wird.
   */
  groupOpeners: boolean | 'auto';
  /** Ab wie vielen Fotos eine Gruppe ohne Hauptbild einen Auftakt bekommt. */
  groupOpenerMinPhotos: number;
  /** Zeitstrahl am Fuß jeder Doppelseite. */
  timeline: boolean;
  /**
   * Welche Achse gezeichnet wird, solange `timeline` an ist.
   *
   * `foot` ist der Zeitstrahl im Fußraum mit Gruppentitel, `side` die stumme
   * Lebensachse am äußeren Rand über alle Jahrgänge. Sie beantworten
   * verschiedene Fragen, deshalb ist es eine Wahl und keine Verbesserung.
   */
  timelineStyle: 'foot' | 'side';
  /**
   * Fassung der Zeichnung, je Achse eine.
   *
   * Zwei Felder, weil die Fassungen nichts miteinander zu tun haben: Wer
   * zwischen Fuß und Rand hin und her schaltet, findet auf jeder Seite seine
   * Wahl wieder. `'classic'` ist der Bestand und die Vorgabe – ein geladenes
   * Projekt ohne diese Felder verhält sich damit wie vorher.
   */
  timelineFootVariant: TimelineFootVariant;
  timelineSideVariant: TimelineSideVariant;
  /**
   * Akzentfarbe des Markers: `'auto'` oder einer der Hexwerte aus
   * `TIMELINE_ACCENTS`.
   *
   * `'auto'` ist die Vorgabe und heißt „aus der Jahresfarbe der Doppelseite"
   * (`accentOn`) – der Marker gehört dann zur Seite, statt auf ihr zu liegen.
   * Ein fester Ton gilt dagegen durch alle Jahrgänge.
   */
  timelineAccent: string;
  /** Hintergrundfarbe aller Doppelseiten, sofern keine eigene gesetzt ist. */
  background: string;
  /** Ob jeder Jahrgang beim Erzeugen eine eigene Hintergrundfarbe bekommt. */
  chapterColors: boolean;
  /**
   * Stärkste Neigung der Bilder in Grad. `0` stellt alles gerade.
   *
   * Wirkt allein beim Rendern (`render/tilt.ts`) und ändert die
   * Fotoverteilung nicht – ein Umstellen erfordert deshalb kein Neugenerieren.
   */
  tilt: number;
  /**
   * Rahmen aller Bilder, die keinen eigenen tragen.
   *
   * Wie die Neigung eine reine Rendereinstellung (`render/frame.ts`): Der
   * Rahmen verkleinert das Bild in seinem Kasten, verschiebt aber kein Foto.
   * Umstellen erfordert deshalb kein Neugenerieren.
   */
  frame: FrameId;
  /**
   * Seitenzahlen im Fuß jeder Buchseite.
   *
   * Wie Neigung und Rahmen eine reine Rendereinstellung: Die Zahl wird beim
   * Zeichnen aus dem Platz der Doppelseite gerechnet, nichts am Buch ändert
   * sich. Ein Projekt ohne dieses Feld bekommt sie – ein Buch mit Seitenzahlen
   * ist der Normalfall, und wer sie nicht will, schaltet sie ab.
   */
  pageNumbers: boolean;
  seed: number;
  /**
   * Das Buchformat, als Kennung eines Druckprofils.
   *
   * Die Kennung und nicht das Profil selbst: Sonst läge eine Kopie der Maße im
   * gespeicherten Projekt und eine korrigierte Zahl im Profil erreichte sie
   * nie. Fehlt das Feld – jedes vor der Formatwahl gespeicherte Projekt –,
   * gilt `DEFAULT_PROFILE_ID`.
   *
   * Ein Wechsel ändert Seitenmaß, Seitenverhältnis und die zulässige
   * Seitenzahl. Die Doppelseiten überstehen ihn, weil jede Vorlage normiert
   * ist; was sich ändert, ist die Auflösung je Bild und – bei einem anderen
   * Seitenverhältnis – der Zuschnitt.
   */
  printProfileId: string;
  /** Für die Geburtstagserkennung und die Plausibilitätsprüfung. */
  birthDate?: string;
  subjectName?: string;
}

interface PersistedProject {
  schemaVersion: number;
  /** Ab Schema 2. Vorher: das eine `sourceRoot`. */
  sources?: PhotoSource[];
  /** Nur noch für die Migration von Schema 1 gelesen. */
  sourceRoot?: string;
  settings: ProjectSettings;
  photos: Photo[];
  /**
   * Aussortierte Fotos. Fehlt in Projekten aus der Zeit des Papierkorbs – die
   * hatten ihre Merkliste im Dateisystem, und die hat nicht gehalten.
   */
  aussortiert?: Aussortiert[];
  overrides: Record<PhotoId, PhotoOverride>;
  book: { spreads: Spread[] };
  groups: PhotoGroup[];
  /** Stand der Gruppen beim letzten Erzeugen; fehlt in älteren Projekten. */
  groupStamp?: string;
  /** Stand der Kalendergliederung beim letzten Erzeugen; fehlt in älteren Projekten. */
  structureStamp?: string;
  yearEvents?: Record<string, string[]>;
  /** Erst ab Umschlagunterstützung vorhanden; ältere Projekte haben es nicht. */
  cover?: CoverDesign;
  /**
   * Abgenickte Befunde der Abnahme, Schlüssel → Zeitpunkt. Fehlt in Projekten
   * von vor dem Abnahmebericht — ein leeres Objekt ist die richtige Antwort
   * darauf und kostet keine Schemaerhöhung.
   */
  abnahmen?: Record<string, string>;
  /**
   * Doppel, die ausdrücklich stehen bleiben. Fehlt in Projekten von vor der
   * Doppel-Ansicht — wie bei `abnahmen` ist ein leeres Objekt die richtige
   * Antwort darauf und kostet keine Schemaerhöhung.
   */
  doppelBehalten?: Record<string, string>;
  importedAt: string;
}

/**
 * Eine Merkkarte „Schlüssel → Zeitpunkt" aus einem gespeicherten Projekt.
 *
 * Zwei Felder haben diese Form und dieselbe Bedeutung — „das habe ich gesehen
 * und für gut befunden": die abgenickten Befunde der Abnahme und die Doppel,
 * die stehen bleiben sollen.
 *
 * `istBrauchbareStruktur` prüft die Felder nicht mit — sie sind optional und
 * fehlen in jedem älteren Stand. Ein von Hand verändertes `project.json` könnte
 * dort aber auch eine Liste oder eine Zeichenkette stehen haben, und
 * `Object.keys` darauf ergäbe Schlüssel wie `0`, `1`, `2`. Derselbe Grundsatz
 * wie beim Schema: lieber leer als falsch gedeutet.
 */
function merkkarteAus(roh: unknown): Record<string, string> {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return {};
  return Object.fromEntries(
    Object.entries(roh as Record<string, unknown>).filter(
      (eintrag): eintrag is [string, string] => typeof eintrag[1] === 'string',
    ),
  );
}

/**
 * Grobe Formprüfung, bevor `migriere()` die Struktur für bekannt hält.
 *
 * `JSON.parse` liefert `unknown` und kein `PersistedProject` – ein von Hand
 * verändertes oder durch einen Sync-Konflikt beschädigtes `project.json`
 * bekäme sonst erst tief im Rendering eine Ausnahme, statt hier kontrolliert
 * abgelehnt zu werden. Derselbe Grundsatz wie bei einer unbekannten
 * `schemaVersion`: lieber neu importieren als eine kaputte Struktur deuten.
 */
function istBrauchbareStruktur(data: unknown): data is PersistedProject {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  const book = d.book as Record<string, unknown> | undefined;
  return (
    typeof d.schemaVersion === 'number' &&
    Array.isArray(d.photos) &&
    Array.isArray(d.groups) &&
    typeof d.overrides === 'object' &&
    d.overrides !== null &&
    typeof book === 'object' &&
    book !== null &&
    Array.isArray(book.spreads) &&
    typeof d.importedAt === 'string'
  );
}

/**
 * Hebt ein gespeichertes Projekt auf das aktuelle Schema.
 *
 * @returns `null`, wenn das Format unbekannt ist – dann importiert der Server
 * lieber neu, als eine fremde Struktur falsch zu deuten.
 */
export function migriere(data: PersistedProject): PersistedProject | null {
  if (data.schemaVersion === SCHEMA_VERSION) return data;

  let stand = data;
  if (stand.schemaVersion === 1) {
    const zwei = zuSchema2(stand);
    if (!zwei) return null;
    stand = zwei;
  }
  if (stand.schemaVersion === 2) stand = zuSchema3(stand);

  return stand.schemaVersion === SCHEMA_VERSION ? stand : null;
}

/**
 * 1 → 2: Aus dem einen Quellordner wird eine Liste mit einem Eintrag, und jedes
 * Foto bekommt dessen Kennung.
 *
 * Ohne diese Zuordnung wäre nach dem ersten zusätzlichen Ordner nicht mehr
 * entscheidbar, in welchem Ordner eine Datei zu suchen ist.
 */
function zuSchema2(data: PersistedProject): PersistedProject | null {
  if (!data.sourceRoot) return null;

  const root = data.sourceRoot;
  const source: PhotoSource = {
    id: quellenId(root),
    label: basename(root) || root,
    root,
    addedAt: data.importedAt,
  };
  return {
    ...data,
    schemaVersion: 2,
    sources: [source],
    photos: data.photos.map((p) => ({ ...p, sourceId: p.sourceId ?? source.id })),
  };
}

/**
 * 2 → 3: Überschriften aus dem Innenteil nehmen.
 *
 * Sie standen dort als `eventTitle` auf der ersten Doppelseite einer Gruppe
 * oder – geraten – auf der eines Monats. Beides benennt heute der Zeitstrahl,
 * und zwar auf jeder Doppelseite der Gruppe und aus den Gruppen selbst, statt
 * aus einem Text, der beim Erzeugen einmal festgeschrieben wurde. Bliebe der
 * alte Text stehen, zeigte ein gespeichertes Buch nach dem Auflösen einer
 * Gruppe weiter deren Namen.
 *
 * Die Auftaktseiten behalten ihren Titel: Sie bestehen aus nichts anderem.
 */
function zuSchema3(data: PersistedProject): PersistedProject {
  const spreads = (data.book?.spreads ?? []).map((spread) => {
    if (!spread.texts?.some((t) => t.role === 'eventTitle')) return spread;
    if (templateById(spread.templateId)?.tags?.includes('gruppenauftakt')) return spread;

    const uebrige = spread.texts.filter((t) => t.role !== 'eventTitle');
    const { texts: _alt, ...ohne } = spread;
    return uebrige.length > 0 ? { ...ohne, texts: uebrige } : ohne;
  });

  return { ...data, schemaVersion: 3, book: { spreads } };
}

/**
 * Der veränderbare Stand des Projekts, wie ihn ein Undo-Schritt festhält.
 *
 * Fast dasselbe wie `PersistedProject` — und trotzdem ein eigener Typ, weil die
 * Unterschiede Aussagen sind. Dabei sind die beiden Abdrücke und `lastReport`:
 * Ohne sie stünden `groupsPending()` und `structurePending()` nach einem
 * Zurücknehmen falsch, ohne den
 * Bericht die Kennzahlen. Nicht dabei ist die Kalendergliederung
 * (`structure`) — sie ist abgeleitet und wird nach jedem Setzen neu gebildet —
 * und nicht dabei ist der Importbefund (`importedAt`, `skippedVideos`,
 * `failed`): Der gehört zum Import, und der ist eine Barriere im Verlauf.
 */
export interface Stand {
  quellen: PhotoSource[];
  photos: Map<PhotoId, Photo>;
  /**
   * Mit im Stand, und damit nimmt ein Cmd+Z das Aussortieren zurück.
   *
   * Vorher hing daran ein `Dateizug` am Schritt, der das `rename` umkehrte –
   * die einzige Wirkung außerhalb des Projektzustands und die einzige, die
   * scheitern konnte. Jetzt ist das Aussortieren ein Eintrag in einem Objekt
   * wie jede andere Änderung auch.
   */
  aussortiert: Record<PhotoId, Aussortiert>;
  overrides: Record<PhotoId, PhotoOverride>;
  groups: PhotoGroup[];
  groupStamp: string | undefined;
  structureStamp: string | undefined;
  spreads: Spread[];
  settings: ProjectSettings;
  yearEvents: Record<string, string[]>;
  cover: CoverDesign;
  /**
   * Mit im Stand, und damit nimmt ein Cmd+Z auch ein „Weiß ich, ist ok"
   * zurück — es ist eine Entscheidung über das Buch wie jede andere.
   */
  abnahmen: Record<string, string>;
  /**
   * Doppel, die ausdrücklich stehen bleiben — Schlüssel → Zeitpunkt.
   *
   * Wie die Abnahmen mit im Stand: „Beide behalten" ist eine Entscheidung über
   * das Buch und damit ein Cmd+Z wert.
   */
  doppelBehalten: Record<string, string>;
  lastReport: GenerateResult['report'] | null;
}

export interface PhotoView extends Photo {
  effectiveDate: string | null;
  dateSource: string;
  dateConfidence: string;
  issues: { code: string; detail?: string }[];
  /** Ob `place` von Hand gesetzt ist statt über GPS aufgelöst. */
  placeManual?: boolean;
  /**
   * Von Hand gesetztes Gewicht, wenn eines gesetzt ist.
   *
   * Fehlt bei `normal` und nicht `'normal'`, weil genau das der Unterschied ist:
   * Die Oberfläche soll eine getroffene Auszeichnung zeigen, nicht die Vorgabe
   * als Zustand ausgeben.
   */
  weight?: PhotoWeight;
  /** Eingestellte Bildanpassung, wenn eine gesetzt ist. Fehlt wie `weight` sonst. */
  adjust?: PhotoAdjust;
}

export class Project {
  /**
   * Das Druckprofil zur gewählten Formatkennung.
   *
   * Eine Ableitung und kein Feld: Sonst gäbe es zwei Wahrheiten – die Kennung
   * in den Einstellungen und das Profil daneben –, und ein Formatwechsel
   * müsste beide treffen. Eine unbekannte Kennung fällt auf die Vorgabe
   * zurück, statt den Server beim Laden eines fremden Projekts zu stoppen.
   */
  get profile(): PrintProfile {
    return profileById(this.settings.printProfileId) ?? defaultProfile();
  }
  readonly photos = new Map<PhotoId, Photo>();
  /**
   * Aussortierte Fotos, nach Kennung.
   *
   * Was hier steht, kommt bei keinem Einlesen zurück – auch dann nicht, wenn
   * die Datei noch in ihrer Quelle liegt. Begründung an `Aussortiert`.
   */
  aussortiert: Record<PhotoId, Aussortiert> = {};
  overrides: Record<PhotoId, PhotoOverride> = {};
  /**
   * Was der Benutzer an der Abnahme gesehen und für gut befunden hat:
   * `Befund.schluessel` → Zeitpunkt der Abnahme.
   *
   * Der Schlüssel hängt am **Gegenstand** des Funds (Foto, Textplatz, Art) und
   * nicht an seiner Stelle im Buch. Eine Neuanordnung wirft die Abnahme deshalb
   * nicht um, und die Randachse des Zeitstrahls ist mit einem Eintrag für alle
   * achtzig Doppelseiten erledigt.
   */
  abnahmen: Record<string, string> = {};
  /**
   * Doppel, bei denen alle Bilder bleiben sollen — Schlüssel → Zeitpunkt.
   *
   * Gespeichert und nicht nur in der Ansicht gemerkt: Der Vorschlag entsteht
   * bei jedem Aufruf neu (`project/doppel.ts`), und ein „beide behalten", das
   * den nächsten Aufruf nicht überlebt, wäre keine Entscheidung, sondern eine
   * Geste. Der Schlüssel hängt an den Fotos (`doppelSchluessel`), nicht an
   * einer Nummer in der Liste.
   */
  doppelBehalten: Record<string, string> = {};
  groups: PhotoGroup[] = [];
  spreads: Spread[] = [];
  structure: Structure = { chapters: [], undated: [], photoCount: 0 };
  lastReport: GenerateResult['report'] | null = null;
  /** Stand der Gruppen, aus dem das aktuelle Buch gebaut wurde. */
  private groupStamp: string | undefined;
  /** Stand der Kalendergliederung, aus dem das aktuelle Buch gebaut wurde. */
  private structureStamp: string | undefined;

  /**
   * Gestaltung des Umschlags.
   *
   * Leer heißt „noch nichts entschieden": `coverDesign()` ergänzt dann
   * Titel, Untertitel, Rückentext und Titelbild aus dem Projekt, damit der
   * Umschlag ohne eine einzige Eingabe druckbar ist.
   */
  cover: CoverDesign = {};

  settings: ProjectSettings = {
    targetPages: 160,
    chapterOpeners: true,
    // Aus: Die leere Jahresseite ist der Atemzug vor dem Jahrgang. Wer die
    // Seiten braucht, schaltet die dichten Auftakte im Buchpanel dazu; ein
    // geladenes Projekt ohne dieses Feld bleibt damit beim Bestand.
    chapterOpenersDense: false,
    // An den Zeitstrahl gekoppelt: Läuft er, benennt er die Gruppe auf jeder
    // ihrer Doppelseiten, und eine eigene Trennerseite kostet nur zwei Seiten,
    // ohne etwas hinzuzufügen. Ohne Zeitstrahl bekommen tragfähige Gruppen
    // wieder ihren Auftakt.
    groupOpeners: 'auto',
    groupOpenerMinPhotos: 6,
    // An: Der Zeitstrahl ordnet jede Doppelseite in den Kalender ein und macht
    // damit sichtbar, wie viel Zeit zwischen zwei Seiten liegt.
    timeline: true,
    timelineStyle: 'foot',
    // Der Bestand als Vorgabe: Die drei neuen Fassungen je Achse sind eine
    // Wahl und keine Verbesserung, und ein geladenes Projekt soll aussehen wie
    // vorher. Beim Laden ergänzt `{ ...this.settings, ...data.settings }`
    // fehlende Felder von hier – eine eigene Migration braucht das nicht.
    timelineFootVariant: 'classic',
    timelineSideVariant: 'classic',
    timelineAccent: 'auto',
    // Weiß als Vorgabe – über achtzig Doppelseiten wirkt es allerdings leer,
    // deshalb die Palette in render/background.ts.
    background: DEFAULT_BACKGROUND,
    // An: Die Farbe wechselt am Jahreswechsel und macht die Kapitelgrenze auch
    // dann sichtbar, wenn man die Jahreszahl überschlägt.
    chapterColors: true,
    // An: Ein Raster aus exakt waagerechten Kästen sieht gezeichnet aus, nicht
    // eingeklebt. Der Wert ist bewusst klein – siehe render/tilt.ts.
    tilt: DEFAULT_TILT_DEG,
    // Ohne: Ein Rahmen ist eine Aussage über das ganze Buch, und die trifft man
    // ausdrücklich. Ein geladenes Projekt ohne dieses Feld sieht damit aus wie
    // vorher – siehe render/frame.ts.
    frame: DEFAULT_FRAME,
    // An: Ohne Seitenzahlen gibt es keinen Verweis auf eine Seite – kein
    // Register, keine Jahresübersicht, kein „siehe Seite 44". Ein geladenes
    // Projekt ohne dieses Feld bekommt sie damit, und das ist gewollt: Sie sind
    // im Buch der Normalfall, nicht die Ausnahme.
    pageNumbers: true,
    seed: 1,
    // Das gewählte Buchformat. Ein geladenes Projekt ohne dieses Feld bekommt
    // es hier – die Vorgabe ist dasselbe Format, mit dem vorher gerechnet
    // wurde, also ändert sich für einen bestehenden Stand nichts.
    printProfileId: DEFAULT_PROFILE_ID,
    // Schaltet die Geburtstagserkennung frei: Für ein Buch zum 18. Geburtstag
    // sind das achtzehn sichere Ankerpunkte, die kein anderer Detektor liefert.
    birthDate: '1999-09-11',
    subjectName: 'Frani',
  };

  /**
   * Ereignisse je Jahr für die Kapitelauftakte, von Hand gepflegt.
   *
   * Schlüssel ist das Jahr als Zeichenkette, weil JSON keine Zahlenschlüssel
   * kennt und der Wert unverändert durch die Persistenz laufen soll.
   */
  yearEvents: Record<string, string[]> = {};

  skippedVideos: string[] = [];
  failed: { file: string; reason: string }[] = [];
  importedAt = new Date().toISOString();

  /**
   * Die laufende Ein- oder Zweitlese, solange eine läuft — sonst `null`.
   *
   * `importPhotos`/`reimport` enden mit `z.photos.clear()` und einer
   * Neubefüllung (`project/bestand.ts`). Griffe, die währenddessen den Bestand
   * ändern — Aussortieren, eine Datumskorrektur, ein zweiter Import —, würden
   * sonst stillschweigend verschluckt: Die Änderung träfe eine Kopie, die der
   * Import gleich verwirft. Die Routen fragen `importLaufend()` deshalb vorher
   * ab und lehnen mit `409` ab, statt die Änderung verloren gehen zu lassen.
   */
  private importPromise: Promise<unknown> | null = null;

  /** Ob gerade ein Import läuft. */
  importLaufend(): boolean {
    return this.importPromise !== null;
  }

  /**
   * Was sich zurücknehmen lässt.
   *
   * Der Verlauf hält ganze Stände und rührt sie über zwei Funktionen an: Der
   * Stand ist eine Kopie (`stand()`), das Setzen bildet die Kalendergliederung
   * neu (`setzeStand()`). Mehr braucht er nicht — seit das Aussortieren keine
   * Datei mehr bewegt, wirkt keine Aktion außerhalb des Projektzustands.
   */
  readonly verlauf: Verlauf<Stand>;

  constructor(
    readonly sources: Sources,
    readonly previews: PreviewCache,
    readonly decodes: DecodeCache,
    private readonly projectPath: string,
  ) {
    this.verlauf = new Verlauf<Stand>({
      lies: () => this.stand(),
      schreib: (stand) => this.setzeStand(stand),
    });
  }

  // --------------------------------------------------- Zurücknehmen und wieder

  /**
   * Der aktuelle Stand als eigene Kopie.
   *
   * `structuredClone` und nicht ein Umweg über JSON: Die Fotos liegen als `Map`
   * im Speicher, und die bliebe dabei auf der Strecke. Gemessen an ~830 Fotos
   * und ~80 Doppelseiten kostet die Kopie wenige Millisekunden — billiger als
   * jede Buchführung darüber, was sich geändert hat.
   */
  stand(): Stand {
    return structuredClone({
      quellen: [...this.sources.list()],
      photos: this.photos,
      aussortiert: this.aussortiert,
      overrides: this.overrides,
      groups: this.groups,
      groupStamp: this.groupStamp,
      structureStamp: this.structureStamp,
      spreads: this.spreads,
      settings: this.settings,
      yearEvents: this.yearEvents,
      cover: this.cover,
      abnahmen: this.abnahmen,
      doppelBehalten: this.doppelBehalten,
      lastReport: this.lastReport,
    });
  }

  /** Setzt einen Stand wieder in Kraft. */
  private setzeStand(stand: Stand): void {
    this.sources.restore(stand.quellen);
    // `photos` ist `readonly` und wird an vielen Stellen als dieselbe Map
    // gehalten – also austauschen, nicht ersetzen.
    this.photos.clear();
    for (const [id, photo] of stand.photos) this.photos.set(id, photo);
    this.aussortiert = stand.aussortiert;
    this.overrides = stand.overrides;
    this.groups = stand.groups;
    this.groupStamp = stand.groupStamp;
    this.structureStamp = stand.structureStamp;
    this.spreads = stand.spreads;
    this.settings = stand.settings;
    this.yearEvents = stand.yearEvents;
    this.cover = stand.cover;
    this.abnahmen = stand.abnahmen;
    this.doppelBehalten = stand.doppelBehalten;
    this.lastReport = stand.lastReport;
    this.rebuildStructure();
  }

  /**
   * Nimmt den letzten Schritt zurück und speichert.
   *
   * @returns der zurückgenommene Schritt, oder `null` bei leerem Verlauf.
   */
  async zurueck(): Promise<Schritt<Stand> | null> {
    const schritt = this.verlauf.zurueck();
    if (schritt) await this.save();
    return schritt;
  }

  /** Das Gegenstück: wiederholt den zuletzt zurückgenommenen Schritt. */
  async vor(): Promise<Schritt<Stand> | null> {
    const schritt = this.verlauf.vor();
    if (schritt) await this.save();
    return schritt;
  }

  // ------------------------------------------------- Bestand und Bildquellen

  photosOfSource(sourceId: string): Photo[] {
    return bestand.photosOfSource(this, sourceId);
  }

  addSource(root: string, label?: string): Promise<{ source: PhotoSource } & ImportDiff> {
    return bestand.addSource(this, root, label);
  }

  removeSource(sourceId: string): { source: PhotoSource; entfernt: number; imBuch: number } | null {
    return bestand.removeSource(this, sourceId);
  }

  vergessen(ids: readonly PhotoId[]): { entfernt: number; imBuch: number; spreads: number[] } {
    return bestand.vergessen(this, ids);
  }

  /**
   * Sortiert ein Foto aus: vergisst es und merkt sich, dass es draußen bleibt.
   *
   * Die Datei bleibt unangetastet in ihrer Quelle – gegen den Import steht die
   * Merkliste, nicht das Dateisystem (Begründung an `Aussortiert`). Damit ist
   * auch der Verlauf wieder eine reine Sache des Projektzustands.
   */
  deletePhoto(id: PhotoId): { fileName: string; imBuch: number; spreads: number[] } | null {
    return bestand.deletePhoto(this, id);
  }

  /**
   * Die aussortierten Fotos, zuletzt aussortierte zuerst.
   *
   * Diese Reihenfolge und nicht die des Buches: Wer hier nachsieht, sucht in
   * aller Regel den Fehlgriff von eben.
   */
  aussortierte(): Aussortiert[] {
    return Object.values(this.aussortiert).sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Nimmt ein aussortiertes Foto zurück ins Projekt. */
  wiederAufnehmen(id: PhotoId): Photo | null {
    return bestand.wiederAufnehmen(this, id);
  }

  /**
   * Nimmt eine eingeworfene Datei auf und setzt sie ein.
   *
   * Die einzige Methode, die in eine Bildquelle **schreibt** – Begründung und
   * Grenzen stehen im Kopf von `project/einwurf.ts`.
   */
  einwerfen(
    datei: { name: string; bytes: Buffer },
    ziel: einwurf.Einwurfziel,
  ): Promise<einwurf.Einwurfergebnis> {
    return einwurf.einwerfen(this, datei, ziel);
  }

  importPhotos(limit?: number, nurQuellen?: readonly string[]): Promise<QuellenBericht> {
    return this.mitImportSperre(bestand.importPhotos(this, limit, nurQuellen));
  }

  reimport(limit?: number, nurQuellen?: readonly string[]): Promise<ImportDiff> {
    return this.mitImportSperre(bestand.reimport(this, limit, nurQuellen));
  }

  /**
   * Hält `importPromise`, solange `versuch` läuft — der Kern von
   * `importLaufend()`. Die Zuweisung geschieht synchron, bevor der Aufrufer
   * die zurückgegebene Zusage überhaupt zu fassen bekommt: Wer `reimport()`
   * ruft und danach sofort `importLaufend()` abfragt, sieht `true`, ganz gleich
   * wie schnell der Import selbst durchläuft.
   */
  private async mitImportSperre<T>(versuch: Promise<T>): Promise<T> {
    this.importPromise = versuch;
    try {
      return await versuch;
    } finally {
      if (this.importPromise === versuch) this.importPromise = null;
    }
  }

  warmPreviews(ids: readonly PhotoId[]): void {
    bestand.warmPreviews(this, ids);
  }

  /**
   * Handarbeit an den Doppelseiten, die ein Neugenerieren verwerfen würde.
   *
   * Gezählt, nicht geraten: Der Knopf „Neu anordnen" baut das Buch komplett neu,
   * und was dabei verloren geht, soll vorher dranstehen.
   *
   * Festgehaltene Seiten sind ausgenommen – sie gehen unverändert durch den
   * Generator (`layout/keep.ts`), und was an ihnen Arbeit war, überlebt. Wie
   * viele es sind, steht als `festgehalten` daneben: Die Warnung soll nicht nur
   * sagen, was verloren geht, sondern auch, was bleibt.
   */
  handwork(): {
    crops: number;
    neigungen: number;
    /** Bilder mit einem eigenen Rahmen, abweichend von der Buchvorgabe. */
    rahmen: number;
    /** Bildunterschriften im Fuß eines Rahmens. */
    unterschriften: number;
    hintergruende: number;
    zeitstrahl: number;
    positionen: number;
    /**
     * Bilder mit einer von Hand gesetzten Ebene im Stapel.
     *
     * Gezählt wird der Slot mit einem `layer`, nicht der Stapel: Ein Zug
     * nummeriert alle Plätze der Doppelseite neu, also trägt danach jeder eine
     * Ebene. Die Zahl sagt damit „auf so vielen Bildern liegt eine Aussage über
     * das Vorn und Hinten" – und die verwirft der Neuaufbau, weil die neuen
     * Plätze aus der Vorlage kommen.
     */
    ebenen: number;
    /** Von Hand gesetzte Textblöcke auf Seiten, die neu gebaut werden. */
    texte: number;
    /**
     * Vorlagentexte, die von Hand verschoben, aufgezogen oder gedreht wurden –
     * Jahreszahlen, Gruppentitel, Ereigniszeilen. Der Neuaufbau stellt sie an
     * den Platz der Vorlage zurück.
     *
     * Gezählt wird die Geometrie, dazu der Wortlaut der Jahreszahl, wo er von
     * `chapterYear` abweicht. Ein umbenannter Gruppentitel bleibt ungezählt:
     * Was die Automatik hinschreiben würde, steht in der Gruppe und wäre hier
     * ein zweiter Weg zur Wahrheit – die Zahl soll eine untere Schranke sein,
     * keine geratene.
     */
    textplaetze: number;
    /** Doppelseiten, die das Neuanordnen unverändert übersteht. */
    festgehalten: number;
  } {
    let crops = 0;
    let neigungen = 0;
    let rahmen = 0;
    let unterschriften = 0;
    let hintergruende = 0;
    let zeitstrahl = 0;
    let positionen = 0;
    let ebenen = 0;
    let texte = 0;
    let textplaetze = 0;
    let festgehalten = 0;
    for (const spread of this.spreads) {
      if (spread.locked) {
        festgehalten++;
        continue;
      }
      texte += spread.blocks?.length ?? 0;
      textplaetze += (spread.texts ?? []).filter(
        (t) =>
          t.rect !== undefined ||
          t.rotateDeg !== undefined ||
          (t.role === 'year' &&
            spread.chapterYear !== undefined &&
            t.content !== String(spread.chapterYear)),
      ).length;
      crops += spread.slots.filter((sl) => sl.crop.mode === 'manual').length;
      // Zählt auch die ausdrücklich geradegestellten: Auch eine gesetzte 0 ist
      // eine Entscheidung, die der Neuaufbau verwirft.
      neigungen += spread.slots.filter((sl) => sl.rotateDeg !== undefined).length;
      // Wie bei der Neigung zählt auch das ausdrückliche „keiner": Ein Bild aus
      // dem Rahmen des Buches herauszunehmen ist eine Entscheidung.
      rahmen += spread.slots.filter((sl) => sl.frame !== undefined).length;
      unterschriften += spread.slots.filter((sl) => sl.caption !== undefined).length;
      // Justierte Doppelseiten tragen in jedem Slot ein Rechteck, aber
      // gerechnet und nicht gesetzt: Der Neuaufbau stellt es wieder her.
      if (!isJustified(spread.templateId))
        positionen += spread.slots.filter((sl) => sl.rect !== undefined).length;
      ebenen += spread.slots.filter((sl) => sl.layer !== undefined).length;
      if (spread.background !== undefined || spread.backgroundPhotoId !== undefined)
        hintergruende++;
      if (spread.timeline !== undefined) zeitstrahl++;
    }
    return {
      crops,
      neigungen,
      rahmen,
      unterschriften,
      hintergruende,
      zeitstrahl,
      positionen,
      ebenen,
      texte,
      textplaetze,
      festgehalten,
    };
  }

  // ------------------------------------------------------------- Struktur

  /**
   * Löst für jedes Foto das effektive Datum auf und baut daraus die
   * Kalenderstruktur.
   */
  rebuildStructure(): void {
    const photos = [...this.photos.values()];
    const bulkSeconds = findBulkSeconds(photos);
    const ctx = {
      importedAt: this.importedAt.slice(0, 19) as NaiveDateTime,
      bulkSeconds,
      ...(this.settings.birthDate
        ? { earliestPlausible: `${this.settings.birthDate}T00:00:00` as NaiveDateTime }
        : {}),
    };

    const dated: { id: PhotoId; date: NaiveDateTime; key: string }[] = [];
    const undated: PhotoId[] = [];

    for (const photo of photos) {
      const effective = resolveEffectiveDate(photo, this.overrides[photo.id], ctx);
      if (effective.value) {
        dated.push({
          id: photo.id,
          date: effective.value,
          key: sortKey(effective, this.overrides[photo.id]),
        });
      } else {
        undated.push(photo.id);
      }
    }

    dated.sort((a, b) => a.key.localeCompare(b.key));

    // Kalenderanlässe werden hier nicht mehr eingearbeitet: Sie sind
    // Fotogruppen (`suggestGroups`) und keine Segmenttitel. Die Struktur bleibt
    // damit das, was sie sein soll – die Kalendergliederung des Bestands, ohne
    // eine Meinung darüber, was darin ein Ereignis war.
    this.structure = buildStructure(
      dated.map((d) => ({ id: d.id, date: d.date })),
      undated,
    );
  }

  // ------------------------------------------------------------ Hintergrund

  /**
   * Setzt Farbe oder Bild als Hintergrund einer Doppelseite.
   *
   * `null` heißt jeweils: zurück zur Vorgabe. Ein Bild schlägt die Farbe, und
   * ein zu grobes Bild wird gesetzt, aber gemeldet – die Entscheidung bleibt
   * beim Benutzer, die Warnung erscheint in der Vorschau und im Export.
   */
  setSpreadBackground(
    index: number,
    patch: { color?: string | null; photoId?: PhotoId | null },
  ): { ok: boolean; error?: string; hinweis?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false };

    if (patch.color !== undefined) {
      if (patch.color === null) delete spread.background;
      // Gegen die geschlossene Palette geprüft wie bei `tilt` und `frame`: Ein
      // freier Hexwert wäre auf Dauer ein kräftiges Blau hinter Fotos.
      else if (isBackgroundColor(patch.color)) spread.background = patch.color;
      else return { ok: false, error: 'Unbekannte Hintergrundfarbe' };
    }

    if (patch.photoId !== undefined) {
      if (patch.photoId === null) {
        delete spread.backgroundPhotoId;
      } else {
        const roh = this.photos.get(patch.photoId);
        if (!roh) return { ok: false };
        spread.backgroundPhotoId = patch.photoId;
        // Aufgelöst, weil die Prüfung „taugt als Hintergrund" die Pixelmaße
        // gegen die Seitenmaße stellt – bei gekippter Ausrichtung sind das
        // andere.
        const photo = effectivePhoto(roh, this.overrides[roh.id]);
        const fit = backgroundFit(photo, this.profile);
        if (!fit.taugt) {
          return {
            ok: true,
            hinweis:
              `Das Bild deckt die Doppelseite nur mit ${Math.round(fit.dpi)} dpi ab. ` +
              `Für einen Hintergrund sind ${fit.benoetigtPx} px lange Kante nötig, ` +
              `dieses hat ${Math.max(photo.width, photo.height)} px.`,
          };
        }
      }
    }

    return { ok: true };
  }

  /**
   * Fotos, die als Hintergrund taugen – die besten zuerst.
   *
   * Bei diesem Bestand ist die Liste meist leer; das ist die Antwort, nicht ein
   * Fehler. Deshalb wird auch die Auflösung mitgeliefert: Wer trotzdem eines
   * setzen will, sieht, wie weit es fehlt.
   */
  backgroundCandidates(
    limit = 24,
  ): { photoId: PhotoId; fileName: string; dpi: number; taugt: boolean }[] {
    return [...this.photos.values()]
      .map((p) => ({ photo: p, fit: backgroundFit(p, this.profile) }))
      .sort((a, b) => b.fit.dpi - a.fit.dpi)
      .slice(0, limit)
      .map(({ photo, fit }) => ({
        photoId: photo.id,
        fileName: photo.fileName,
        dpi: Math.round(fit.dpi),
        taugt: fit.taugt,
      }));
  }

  // ------------------------------------------------------ Jahresereignisse

  /**
   * Setzt die Ereignisse eines Jahres und zieht dessen Auftaktseite nach.
   *
   * Bewusst ohne Neugenerieren: Die Ereignisse stehen als Text auf einer
   * einzigen Doppelseite, die Fotoverteilung ändern sie nicht. Ein
   * `generate()` je Eingabe würde beim Pflegen von neunzehn Jahrgängen
   * neunzehnmal das Buch umbauen und dabei jede handgemachte Korrektur
   * verwerfen – Ausschnitte, verschobene Bilder, Zeitstrahlausnahmen.
   *
   * @returns ob eine Auftaktseite gefunden wurde. `false` heißt: Die Zeilen
   * sind gespeichert, erscheinen aber erst beim nächsten Erzeugen – etwa, weil
   * Jahresauftakte gerade abgeschaltet sind.
   */
  setYearEvents(year: number, zeilen: readonly string[]): boolean {
    const sauber = zeilen.map((z) => z.trim()).filter((z) => z.length > 0);
    if (sauber.length === 0) delete this.yearEvents[String(year)];
    else this.yearEvents[String(year)] = [...sauber];

    const auftakt = this.spreads.find((s) => this.istJahresauftakt(s, year));
    if (!auftakt) return false;

    const slot = requireTemplate(auftakt.templateId).textSlots?.find((t) => t.id === 't-events');
    if (!slot) return false;

    const uebrige = (auftakt.texts ?? []).filter((t) => t.slotId !== slot.id);
    auftakt.texts =
      sauber.length === 0
        ? uebrige
        : [
            ...uebrige,
            {
              id: `${auftakt.id}-events`,
              role: 'freeText' as const,
              content: sauber.join('\n'),
              slotId: slot.id,
            },
          ];
    return true;
  }

  // ------------------------------------------------------------ Generieren

  /**
   * Baut das Buch neu.
   *
   * Festgehaltene Doppelseiten sind davon ausgenommen: Sie gehen unverändert
   * hinein und kommen an ihrem Anker wieder heraus (`layout/keep.ts`). Ohne das
   * wäre eine selbst gebaute Seite nach dem ersten Neuanordnen verloren – sie
   * besteht aus Handarbeit, und der Generator kennt nur Fotos und Vorlagen.
   */
  generate(): GenerateResult {
    this.rebuildStructure();
    const { kept } = splitKept(this.spreads);
    const result = generateBook({
      structure: this.structure,
      photos: this.photos,
      overrides: this.overrides,
      profile: this.profile,
      ...(kept.length > 0 ? { kept } : {}),
      targetPages: this.settings.targetPages,
      chapterOpeners: this.settings.chapterOpeners,
      chapterOpenersDense: this.settings.chapterOpenersDense,
      seed: this.settings.seed,
      weightOf: (id) => this.overrides[id]?.weight ?? 'normal',
      groups: this.groups,
      groupOpeners: this.settings.groupOpeners,
      groupOpenerMinPhotos: this.settings.groupOpenerMinPhotos,
      // Löst `groupOpeners: 'auto'` auf.
      timeline: this.settings.timeline,
      chapterColors: this.settings.chapterColors,
      yearEvents: Object.fromEntries(
        Object.entries(this.yearEvents).map(([jahr, zeilen]) => [Number(jahr), zeilen]),
      ),
    });
    this.spreads = result.spreads;
    this.lastReport = result.report;
    this.groupStamp = gruppen.groupFingerprint(this);
    this.structureStamp = structureFingerprint(this.structure);
    return result;
  }

  // -------------------------------------------------------------- Gruppen

  suggestGroups(opts: { reset?: boolean } = {}): { groups: PhotoGroup[]; added: number } {
    return gruppen.suggestGroups(this, opts);
  }

  /**
   * Ob sich die Gruppen geändert haben, seit das Buch gebaut wurde.
   *
   * Was der Zeitstrahl beschriftet, folgt sofort – er liest die Gruppen beim
   * Rendern. Die Verteilung der Fotos auf Doppelseiten und die Auftaktseiten
   * entstehen dagegen beim Erzeugen. Statt das Buch stillschweigend neu zu
   * bauen und dabei jede Handarbeit zu verwerfen, sagt die Oberfläche, dass
   * noch etwas aussteht.
   *
   * Ohne gespeicherten Abdruck (Projekt aus einer älteren Fassung) gilt das
   * Buch als aktuell – ein Fehlalarm bei jedem Start wäre die schlechtere
   * Auskunft.
   */
  groupsPending(): boolean {
    return this.groupStamp !== undefined && this.groupStamp !== gruppen.groupFingerprint(this);
  }

  /**
   * Ob sich die Kalendergliederung geändert hat, seit das Buch gebaut wurde.
   *
   * Dasselbe Versprechen wie `groupsPending()`, für die andere Hälfte der
   * Eingaben: Datumskorrekturen, aussortierte Fotos, ein Nachimport. Verglichen
   * wird die *Gliederung* und nicht die Korrekturen — eine Korrektur um fünf
   * Minuten, die keine Reihenfolge kippt, meldet deshalb nichts, und eine, die
   * ein Foto in ein anderes Jahr trägt, meldet auch dann, wenn sie über
   * mehrere Griffe entstanden ist. Was der Abdruck genau erfasst, steht bei
   * `structureFingerprint` im Kern.
   *
   * Ohne gespeicherten Abdruck (Projekt aus einer älteren Fassung) gilt das Buch
   * als aktuell, wie bei den Gruppen.
   */
  structurePending(): boolean {
    return (
      this.structureStamp !== undefined &&
      this.structureStamp !== structureFingerprint(this.structure)
    );
  }

  // -------------------------------------------------------- Metadatenkorrektur

  /**
   * Korrigiert das Datum mehrerer Fotos und baut die Gliederung neu.
   *
   * Das Buch bleibt, wie es ist. Ein Foto, das jetzt in ein anderes Jahr
   * gehört, steht weiter an seinem alten Platz — `structurePending()` sagt es,
   * und der Neuaufbau bleibt ein ausdrücklicher Griff. Stillschweigend neu zu
   * bauen würde jede Handarbeit verwerfen, und bei einer Serienkorrektur
   * vierzigmal.
   */
  korrigiereDaten(
    ids: readonly PhotoId[],
    edit: DateEdit,
  ): fotodaten.Korrekturergebnis | { fehler: string } {
    const ergebnis = fotodaten.korrigiereDaten(this, ids, edit, this.dateContext());
    if ('fehler' in ergebnis) return ergebnis;
    this.rebuildStructure();
    return ergebnis;
  }

  /** Nimmt die Datumskorrektur mehrerer Fotos zurück. */
  verwirfDatumskorrektur(ids: readonly PhotoId[]): fotodaten.Korrekturergebnis {
    const ergebnis = fotodaten.verwirfDatumskorrektur(this, ids);
    this.rebuildStructure();
    return ergebnis;
  }

  /**
   * Setzt den Ort mehrerer Fotos; `null` gibt ihn an die Automatik zurück.
   *
   * Ohne `rebuildStructure`: Der Ort gliedert das Buch nicht — das tut der
   * Kalender. Er speist die Gruppenvorschläge, und die sind Vorschläge, bis
   * jemand sie bestätigt.
   */
  setzeOrte(
    ids: readonly PhotoId[],
    ort: { label: string; key?: string } | null,
  ): fotodaten.Korrekturergebnis | { fehler: string } {
    return fotodaten.setzeOrte(this, ids, ort);
  }

  /**
   * Kippt die Ausrichtung mehrerer Fotos; `null` gibt sie an die Datei zurück.
   *
   * Ohne `rebuildStructure`: Die Ausrichtung sagt nichts über die Zeit. Sie
   * ändert das Seitenverhältnis und damit, welche Vorlage passen *würde* — das
   * Buch selbst bleibt stehen, bis jemand neu anordnet.
   */
  /**
   * Kippt die Ausrichtung – und zieht die Ausschnitte mit.
   *
   * Zwei Schritte, weil es zwei Zuständigkeiten sind: Die Korrektur steht am
   * Foto, der Ausschnitt am Slot. Ohne den zweiten zeigt ein von Hand gewählter
   * Ausschnitt nach der Drehung auf eine andere Stelle des Bildes.
   */
  kippeAusrichtung(
    ids: readonly PhotoId[],
    turns: 1 | 2 | 3 | null,
  ): fotodaten.Korrekturergebnis | { fehler: string } {
    const ergebnis = fotodaten.kippeAusrichtung(this, ids, turns);
    if ('fehler' in ergebnis) return ergebnis;
    anordnung.dreheAusschnitte(this, ergebnis.gedreht);
    return ergebnis;
  }

  /**
   * Zeichnet Fotos als Hauptbild aus; `'normal'` nimmt es zurück.
   *
   * Ohne `rebuildStructure` und ohne Neuanordnen: Das Gewicht sagt nichts über
   * die Zeit und ändert keine Fotoverteilung, nur welchen Platz ein Bild in
   * seiner Doppelseite verdient. Wirksam wird es beim nächsten Anordnen — wie
   * die Bildschärfe, mit der es in `slotCost` dieselbe Rolle teilt.
   */
  setzeGewicht(
    ids: readonly PhotoId[],
    gewicht: PhotoWeight,
  ): fotodaten.Korrekturergebnis | { fehler: string } {
    return fotodaten.setzeGewicht(this, ids, gewicht);
  }

  /**
   * Stellt Helligkeit, Kontrast, Sättigung, Wärme und Tonung ein.
   *
   * Wie das Gewicht ohne Neuanordnen — aber anders als dieses auch **ohne
   * Warten**: Die Anpassung wird beim Rendern angewandt (`ImageBox.colorMatrix`)
   * und ist damit sofort im Buch, in der Vorschau wie im PDF. Sie verschiebt
   * kein Foto und wählt keine Vorlage; sie färbt nur, was schon liegt.
   */
  setzeAnpassung(
    ids: readonly PhotoId[],
    adjust: PhotoAdjust | undefined,
  ): fotodaten.Korrekturergebnis | { fehler: string } {
    return fotodaten.setzeAnpassung(this, ids, adjust);
  }

  /**
   * Die Orte, die im Bestand vorkommen — mit Kennung und Häufigkeit.
   *
   * Grundlage der Vervollständigung in der Oberfläche. Sie liefert die *Kennung*
   * mit, und das ist der Punkt: Wer „Hamburg" aus der Liste wählt, bekommt
   * `city:Hamburg` und fällt damit mit den über GPS aufgelösten Hamburg-Fotos in
   * einen Gruppenvorschlag. Von Hand getippt entstünde `manual:Hamburg` — zwei
   * Vorschläge für denselben Ort, ohne dass man sieht, warum.
   */
  orte(): { key: string; label: string; count: number }[] {
    const zaehler = new Map<string, { key: string; label: string; count: number }>();
    for (const roh of this.photos.values()) {
      const { place } = effectivePhoto(roh, this.overrides[roh.id]);
      if (!place) continue;
      const eintrag = zaehler.get(place.key);
      if (eintrag) eintrag.count++;
      else zaehler.set(place.key, { key: place.key, label: place.label, count: 1 });
    }
    // Häufigste zuerst: Die Vervollständigung soll den Wohnort nicht hinter
    // einem einmaligen Ausflugsort verstecken.
    return [...zaehler.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'),
    );
  }

  sortedGroups(): PhotoGroup[] {
    return gruppen.sortedGroups(this);
  }

  createGroup(title: string, photoIds: PhotoId[]): PhotoGroup[] {
    this.groups = createGroup(this.groups, title, photoIds);
    return this.groups;
  }

  /**
   * Ändert eine Gruppe.
   *
   * `opener: null` heißt: zurück zur Vorgabe. Deshalb wird das Feld dann
   * entfernt und nicht auf `null` gesetzt – ein gesetztes Feld ist eine
   * Entscheidung, ein fehlendes ist keine, und diese Unterscheidung trägt bis in
   * die Auflösung von `groupOpeners: 'auto'`.
   */
  updateGroup(
    id: string,
    patch: Partial<Pick<PhotoGroup, 'title' | 'coverPhotoId' | 'active' | 'photoIds'>> & {
      opener?: boolean | null;
    },
  ): PhotoGroup[] {
    const { opener, ...rest } = patch;
    this.groups = updateGroup(this.groups, id, rest);
    if (opener !== undefined) {
      this.groups = this.groups.map((g) => {
        if (g.id !== id) return g;
        if (opener === null) {
          const { opener: _entfernt, ...ohne } = g;
          return ohne;
        }
        return { ...g, opener };
      });
    }
    return this.groups;
  }

  removeGroup(id: string): PhotoGroup[] {
    this.groups = removeGroup(this.groups, id);
    return this.groups;
  }

  ungroupPhotos(photoIds: PhotoId[]): PhotoGroup[] {
    this.groups = ungroupPhotos(this.groups, photoIds);
    return this.groups;
  }

  /** Führt die Quellgruppe in die Zielgruppe über; die Quelle verschwindet. */
  mergeGroups(sourceId: string, targetId: string): PhotoGroup[] {
    this.groups = mergeGroups(this.groups, sourceId, targetId);
    return this.groups;
  }

  /** Ordnet Fotos einer bestehenden Gruppe zu. */
  addToGroup(id: string, photoIds: PhotoId[]): PhotoGroup[] {
    this.groups = addToGroup(this.groups, id, photoIds);
    return this.groups;
  }

  // ------------------------------------------------------- Layout-Dokument

  exportLayout(): LayoutDocument {
    // Der Kontext einmal für das ganze Dokument: `findBulkSeconds` läuft über
    // den Bestand, und je Foto neu wäre es ein quadratischer Durchlauf.
    const ctx = this.dateContext();
    return layoutDokument.exportLayout(
      this,
      (photo) => resolveEffectiveDate(photo, this.overrides[photo.id], ctx).value,
    );
  }

  applyLayout(raw: unknown): {
    ok: boolean;
    issues: LayoutIssue[];
    problems: { index: number; photoCount: number; message: string }[];
    spreadCount: number;
  } {
    return layoutDokument.applyLayout(this, raw);
  }

  // --------------------------------------------------------- Eigene Seiten

  /**
   * Fügt eine selbst gestaltete Doppelseite ins Buch ein.
   *
   * Zwei Ausgangspunkte, dieselbe Mechanik: die leere Vorlage für eine Seite,
   * die man ganz selbst baut, oder ein Gruppenauftakt für einen Titel mit einem
   * großen Bild daneben. Beide bekommen keine Fotos zugeteilt – wer eine Seite
   * einfügt, wählt sie selbst, und ein automatisch hineingerechnetes Bild wäre
   * das Gegenteil der Absicht.
   *
   * Die Seite wird gleich festgehalten (`locked`). Ohne das verschwände sie beim
   * nächsten Neuanordnen mitsamt allem, was daran Arbeit war.
   *
   * Hintergrundfarbe und Zeitstrahl kommen von der Nachbarseite: Eine eigene
   * Seite mitten im Jahrgang 2019 soll dessen Farbe tragen, sonst reißt sie ein
   * weißes Loch in die Jahresfarben.
   *
   * @param at Stelle im Buch. `0` heißt ganz vorn, `spreads.length` ganz hinten.
   */
  insertSpread(
    at: number,
    opts: { templateId?: string; title?: string } = {},
  ): { ok: boolean; error?: string; index: number } {
    const ergebnis = seiten.insertSpread(this, at, opts);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  /**
   * Fügt eine einzelne Buchseite ein, statt einer ganzen Doppelseite.
   *
   * Der Unterschied ist nicht die Größe, sondern die Folge: Eine einzelne Seite
   * kippt die Parität, und jedes Blatt dahinter besteht danach aus anderen zwei
   * Buchseiten. Verlustfrei möglich ist das, weil kein Slot der Flussvorlagen
   * über dem Falz liegt – `layout/single-page.ts` zerlegt die Blätter, schiebt
   * die neue Seite ein und paart neu. Kein Foto wechselt dabei seinen Platz im
   * Buch, nur seine Blattzugehörigkeit.
   *
   * Der Titel wird ein Textblock und kein Textelement: Auf einer selbst gebauten
   * Seite gibt es keine Vorlage, an deren Textplatz er hängen könnte – und frei
   * gesetzt ist er ohnehin, was man von ihm erwartet.
   *
   * @param atPage Buchseite, vor der eingefügt wird, nullbasiert.
   */
  insertSinglePage(
    atPage: number,
    opts: { halfId?: string; title?: string } = {},
  ): { ok: boolean; error?: string; index: number; bericht?: SinglePageResult['bericht'] } {
    const ergebnis = seiten.insertSinglePage(this, atPage, opts);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  /**
   * Nimmt eine einzelne Buchseite aus dem Buch.
   *
   * Das Gegenstück zum Einfügen: Die Seite fällt heraus, alles danach rückt eine
   * Halbseite auf, und geht die Rechnung auf, wird das Buch ein Blatt kürzer. Die
   * Bilder dieser Seite liegen danach im Fotopool – verloren ist keines.
   *
   * Nicht jede Seite lässt sich einzeln nehmen: Ein Auftakt trägt seinen Text über
   * beide Hälften, justierte Zeilen ihre Rechtecke. Dort wird abgelehnt und
   * gesagt, warum – statt heimlich das ganze Blatt zu nehmen.
   *
   * @param atPage Buchseite, nullbasiert.
   */
  removeSinglePage(atPage: number): {
    ok: boolean;
    error?: string;
    photoCount: number;
    bericht?: SinglePageResult['bericht'];
  } {
    const ergebnis = seiten.removeSinglePage(this, atPage);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  removeSpread(index: number): { ok: boolean; error?: string; photoCount: number } {
    const ergebnis = seiten.removeSpread(this, index);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  setSpreadLocked(index: number, locked: boolean): { ok: boolean; error?: string } {
    return seiten.setSpreadLocked(this, index, locked);
  }

  insertChoices() {
    return seiten.insertChoices();
  }

  // ------------------------------------------------- Punktuelle Änderungen

  /**
   * Setzt den Ausschnitt eines Slots oder stellt ihn auf automatisch zurück.
   *
   * `crop === null` heißt zurücksetzen: Der gespeicherte Wert wird durch den
   * vollen Bereich im Modus `auto-cover` ersetzt, den `renderSpread` beim
   * nächsten Rendern für die aktuellen Slotmaße neu berechnet. Ein Fokuspunkt
   * fällt dabei weg – „automatisch" heißt Bildmitte.
   */
  setSlotCrop(index: number, slotId: string, crop: Crop | null): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const slot = spread.slots.find((s) => s.slotId === slotId);
    if (!slot) return { ok: false, error: 'Slot nicht gefunden' };

    slot.crop = crop ?? { ...FULL_CROP };
    this.refreshReport();
    return { ok: true };
  }

  /**
   * Setzt die Neigung eines Slots oder gibt sie an die Automatik zurück.
   *
   * `deg === null` heißt: wieder aus Slot, Foto und Seed berechnen. Eine
   * gesetzte `0` ist etwas anderes – sie stellt das Bild ausdrücklich gerade
   * und überlebt damit auch einen Seedwechsel.
   */
  setSlotRotation(
    index: number,
    slotId: string,
    deg: number | null,
  ): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const slot = spread.slots.find((s) => s.slotId === slotId);
    if (!slot) return { ok: false, error: 'Slot nicht gefunden' };

    if (deg === null) {
      delete slot.rotateDeg;
      return { ok: true };
    }
    if (!Number.isFinite(deg)) return { ok: false, error: 'Neigung ist keine Zahl' };

    // In den Bereich -180 … 180 gebracht statt abgewiesen, und auf ein
    // Zehntelgrad gerundet wie die Automatik: Ein von Hand übernommener Wert
    // soll dem berechneten exakt entsprechen und nicht um 0,03° daneben liegen.
    //
    // Nicht auf `MAX_TILT_DEG` geklemmt: Die 4° begrenzen die Automatik, die
    // jedes Bild leicht kippt. Am Drehgriff ist der Winkel eine Absicht
    // (`MAX_MANUAL_ROTATION_DEG`) – 190° sind dann dieselbe Lage wie -170° und
    // werden so gespeichert, damit der Regler sie anzeigen kann.
    slot.rotateDeg = Math.round(normalizeRotation(deg) * 10) / 10;
    return { ok: true };
  }

  /**
   * Gibt einem Slot einen eigenen Rahmen – oder zurück an die Buchvorgabe.
   *
   * `frame === null` heißt: wieder die Vorgabe aus den Einstellungen. Eine
   * gesetzte `'keiner'` ist etwas anderes – sie nimmt dieses Bild dauerhaft aus
   * dem Rahmen des Buches, auch wenn die Vorgabe später wechselt.
   */
  setSlotFrame(
    index: number,
    slotId: string,
    frame: string | null,
  ): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const slot = spread.slots.find((s) => s.slotId === slotId);
    if (!slot) return { ok: false, error: 'Slot nicht gefunden' };

    if (frame === null) {
      delete slot.frame;
      return { ok: true };
    }
    if (!isFrameId(frame)) return { ok: false, error: 'Unbekannter Rahmen' };

    slot.frame = frame;
    return { ok: true };
  }

  /**
   * Beschriftet ein Bild im Fuß seines Rahmens.
   *
   * Ein leerer Text löscht die Unterschrift. Sichtbar wird sie nur beim
   * Polaroid – der einzige Rahmen mit Fuß –, gespeichert bleibt sie in jedem
   * Fall: Wer zwischen den Rahmen hin und her schaltet, soll seine Notiz
   * wiederfinden.
   */
  setSlotCaption(index: number, slotId: string, caption: string): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const slot = spread.slots.find((s) => s.slotId === slotId);
    if (!slot) return { ok: false, error: 'Slot nicht gefunden' };

    // Geklemmt statt abgewiesen: In den Fuß eines Sofortbilds passt eine kurze
    // Zeile. Alles darüber schrumpfte die Schrift so weit, dass sie im Druck
    // nicht mehr lesbar wäre (`unterschrift` in render/frame.ts).
    const text = caption.trim().slice(0, 80);
    if (text.length === 0) delete slot.caption;
    else slot.caption = text;
    // Von Hand getippt, also keine Automatik mehr: Der mengenwertige Zug lässt
    // sie danach stehen, bis jemand ausdrücklich überschreiben sagt.
    delete slot.captionAuto;
    return { ok: true };
  }

  /**
   * Füllt Bildunterschriften aus Ort und Datum – über eine Doppelseite, eine
   * Gruppe oder das ganze Buch (`project/unterschriften.ts`).
   */
  setzeUnterschriften(opts: UnterschriftenOptionen): UnterschriftenErgebnis {
    return setzeUnterschriften(this.unterschriftenstand(), opts);
  }

  /** Nimmt die erzeugten Unterschriften wieder heraus; getippte bleiben. */
  loescheUnterschriften(bereich: Unterschriftenbereich): UnterschriftenErgebnis {
    return loescheUnterschriften(this.unterschriftenstand(), bereich);
  }

  private unterschriftenstand(): Unterschriftenstand {
    const ctx = this.dateContext();
    const rahmenCache = new Map<number, Map<string, FrameId>>();
    return {
      spreads: this.spreads,
      groups: this.groups,
      // Ort und Datum in derselben Fassung, die die Oberfläche zeigt – eine
      // zweite Auflösung derselben Kaskade wäre eine zweite Wahrheit.
      angabenVon: (photoId) => {
        const photo = this.photos.get(photoId);
        if (!photo) return { date: null };
        const override = this.overrides[photoId];
        const wirksam = effectivePhoto(photo, override);
        return {
          ...(wirksam.place ? { place: wirksam.place } : {}),
          date: resolveEffectiveDate(photo, override, ctx).value,
        };
      },
      // Aus dem gerenderten Modell: Nur dort steht, welcher Rahmen wirklich
      // wirkt – ein randabfallender Kasten hat keinen, auch wenn am Slot einer
      // gewählt ist. Einmal je Doppelseite gerendert; über das ganze Buch sind
      // das 21 ms (dieselbe Messung wie beim Abnahmebericht).
      rahmenVon: (spreadIndex, slotId) => {
        const rsm = rahmenCache.get(spreadIndex) ?? this.rahmenJeSlot(spreadIndex);
        rahmenCache.set(spreadIndex, rsm);
        return rsm.get(slotId) ?? 'keiner';
      },
    };
  }

  /** Der wirkende Rahmen je Platz einer Doppelseite, aus ihrem RSM. */
  private rahmenJeSlot(index: number): Map<string, FrameId> {
    const gerendert = this.render(index);
    const map = new Map<string, FrameId>();
    if (!gerendert) return map;
    for (const box of imageBoxes(gerendert)) map.set(box.slotId, box.frame ?? 'keiner');
    return map;
  }

  /**
   * Setzt Position und Größe eines Bildes von Hand – oder zurück auf die Vorlage.
   *
   * `rect === null` heißt zurück ins Raster. Die Werte sind normiert wie ein
   * Templateslot und werden auf die Beschnittfläche geklemmt: Ein Bild ganz
   * außerhalb der Seite wäre kein Gestaltungsmittel, sondern ein verlorenes
   * Foto. Über die Endformatkante hinaus darf es sehr wohl – randabfallend ist
   * gewollt, dafür ist der Beschnitt da.
   */
  setSlotRect(
    index: number,
    slotId: string,
    rect: { x: number; y: number; w: number; h: number } | null,
  ): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const slot = spread.slots.find((s) => s.slotId === slotId);
    if (!slot) return { ok: false, error: 'Slot nicht gefunden' };

    if (rect === null) {
      delete slot.rect;
      return { ok: true };
    }

    const zahlen = [rect.x, rect.y, rect.w, rect.h];
    if (!zahlen.every((v) => Number.isFinite(v))) {
      return { ok: false, error: 'Position ist keine Zahl' };
    }
    if (rect.w <= 0 || rect.h <= 0) return { ok: false, error: 'Größe muss positiv sein' };

    slot.rect = aufsBlatt(rect, this.profile);
    return { ok: true };
  }

  /**
   * Verschiebt ein Bild im Stapel seiner Doppelseite.
   *
   * Gerechnet wird im Kern (`moveSlotLayer`), und zwar auf derselben Reihenfolge,
   * in der `renderSpread` zeichnet – sonst meinten Knopf und Vorschau
   * verschiedene Ebenen. Kein Neuanordnen: Die Ebene wirkt allein beim Rendern,
   * wie Neigung und Rahmen.
   */
  setSlotLayer(index: number, slotId: string, zug: Ebenenzug): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const template = templateById(spread.templateId);
    if (!template) return { ok: false, error: 'Vorlage nicht auflösbar' };

    const neu = moveSlotLayer(spread, template, slotId, zug);
    if (!neu) return { ok: false, error: 'Slot nicht gefunden' };

    this.spreads[index] = neu;
    return { ok: true };
  }

  // --------------------------------------------------------- Vorlagentexte

  /**
   * Ändert einen Text, der an einem Textplatz der Vorlage hängt.
   *
   * Anders als beim Textblock sind hier nur drei Dinge einstellbar: Wortlaut,
   * Rechteck und Winkel. Schrift, Schnitt und Farbe kommen aus dem Textstil und
   * bleiben es – sie sind Aussagen über das Buch, nicht über diese Seite. Wer
   * eine andere Schrift will, will keinen Vorlagentext mehr, sondern einen
   * Block; den gibt es daneben.
   *
   * Eine Größe in Punkt gibt es nicht: Die Schriftgröße hängt an der Kastenhöhe
   * (`TEXT_STYLES`, Versalhöhe als Anteil), ein höheres Rechteck ist also eine
   * größere Schrift. Siehe `TextElement.rect`.
   *
   * `rect: null` bzw. `rotateDeg: null` stellt den Stand der Vorlage wieder her.
   */
  updateTextElement(
    index: number,
    slotId: string,
    patch: {
      content?: string;
      rect?: { x: number; y: number; w: number; h: number } | null;
      rotateDeg?: number | null;
    },
  ): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const textSlot = requireTemplate(spread.templateId).textSlots?.find((t) => t.id === slotId);
    if (!textSlot) return { ok: false, error: 'Diese Vorlage hat dort keinen Textplatz' };

    let text = spread.texts?.find((t) => t.slotId === slotId);
    if (!text) {
      // Ein optionaler Platz kann leer geblieben sein – der Gruppentitel auf
      // einem Auftakt ohne bestätigte Gruppe etwa. Ihn hier anzulegen ist der
      // einzige Weg, ihn überhaupt zu beschriften; ein 404 wäre eine Sackgasse.
      text = { id: `${spread.id}-${slotId}`, role: textSlot.role, content: '', slotId };
      spread.texts = [...(spread.texts ?? []), text];
    }

    if (patch.content !== undefined) {
      // Wie beim Textblock löscht ein leerer Wortlaut nichts: Der Platz bleibt
      // greifbar, sonst verschwände er beim Leeren des Feldes unter den Händen.
      // Die Grenze ist großzügiger als bei einer Bildunterschrift, weil hier
      // auch die Ereigniszeilen eines Jahrgangs stehen – fünf Zeilen Text.
      text.content = patch.content.slice(0, 400);
    }

    if (patch.rect === null) delete text.rect;
    else if (patch.rect) {
      const { x, y, w, h } = patch.rect;
      if (![x, y, w, h].every((v) => Number.isFinite(v))) {
        return { ok: false, error: 'Position ist keine Zahl' };
      }
      if (w <= 0 || h <= 0) return { ok: false, error: 'Größe muss positiv sein' };
      text.rect = aufsBlatt(patch.rect, this.profile);
    }

    if (patch.rotateDeg === null) delete text.rotateDeg;
    else if (patch.rotateDeg !== undefined && Number.isFinite(patch.rotateDeg)) {
      const winkel = ((patch.rotateDeg % 360) + 360) % 360;
      // `0` und „nicht gesetzt" bedeuten am Vorlagentext dasselbe – es gibt hier
      // keine Automatik, die eine ausdrückliche Null übersteuern könnte (anders
      // als bei der Bildneigung).
      if (winkel === 0) delete text.rotateDeg;
      else text.rotateDeg = winkel;
    }

    return { ok: true };
  }

  // ------------------------------------------------------------ Textblöcke

  /**
   * Legt einen Textblock auf eine Doppelseite.
   *
   * Die Vorgaben sind bewusst großzügig: ein Kasten in der Mitte der linken
   * Seite, groß genug, um ihn zu greifen. Wer einen Text setzt, will ihn danach
   * ohnehin verschieben – ein Block, den man erst suchen muss, wäre der
   * schlechtere Anfang.
   */
  addTextBlock(index: number, patch: Partial<TextBlock> = {}): TextBlock | undefined {
    const spread = this.spreads[index];
    if (!spread) return undefined;

    const block: TextBlock = {
      id: `text-${Date.now().toString(36)}-${(spread.blocks?.length ?? 0) + 1}`,
      content: 'Text',
      rect: { x: 0.08, y: 0.44, w: 0.3, h: 0.08 },
      weight: 'regular',
      fontSizePt: 14,
      align: 'left',
    };
    // Dieselbe Prüf- und Klemmlogik wie bei `updateTextBlock` – vorher übernahm
    // das Anlegen `family`, `fontSizePt`, `rotateDeg` & Co. ungeprüft, während
    // die Änderung direkt danach dieselben Felder validierte. Ein Textblock
    // sollte beim Erzeugen keine laxere Prüfung erfahren als bei jeder
    // folgenden Änderung.
    this.wendeTextBlockPatchAn(block, patch);

    spread.blocks = [...(spread.blocks ?? []), block];
    return block;
  }

  /**
   * Ändert einen Textblock.
   *
   * `content: ''` löscht ihn nicht – ein leerer Block bleibt greifbar, bis
   * jemand ihn ausdrücklich entfernt. Sonst verschwände er beim Leeren des
   * Feldes unter den Händen.
   */
  updateTextBlock(
    index: number,
    id: string,
    patch: Partial<Omit<TextBlock, 'id'>>,
  ): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const block = spread.blocks?.find((b) => b.id === id);
    if (!block) return { ok: false, error: 'Textblock nicht gefunden' };

    this.wendeTextBlockPatchAn(block, patch);
    return { ok: true };
  }

  /**
   * Prüft und klemmt ein Textblock-Patch, angewandt auf `block`.
   *
   * Gemeinsam für `addTextBlock` und `updateTextBlock`: Ein Feld, das eine
   * Änderung validiert, soll dieselbe Prüfung schon beim Anlegen erfahren –
   * sonst käme ein unbrauchbarer Wert (eine unbekannte Schriftfamilie, eine
   * Punktgröße von 99999) nur beim zweiten Aufruf ans Licht.
   */
  private wendeTextBlockPatchAn(block: TextBlock, patch: Partial<Omit<TextBlock, 'id'>>): void {
    if (patch.content !== undefined) block.content = patch.content;
    if (patch.weight === 'regular' || patch.weight === 'semibold') block.weight = patch.weight;
    if (patch.family && FONT_FAMILIES.some((f) => f.id === patch.family)) {
      block.family = patch.family;
    }
    if (patch.align) block.align = patch.align;
    if (patch.fontSizePt !== undefined && Number.isFinite(patch.fontSizePt)) {
      // Geklemmt statt abgewiesen: Unter 5 pt ist Text im Druck nicht mehr
      // lesbar, über 200 pt passt keine Zeile mehr auf die Seite.
      block.fontSizePt = Math.min(200, Math.max(5, patch.fontSizePt));
    }
    if (patch.rotateDeg !== undefined) {
      block.rotateDeg = ((patch.rotateDeg % 360) + 360) % 360;
      if (block.rotateDeg === 0) delete block.rotateDeg;
    }
    if (patch.color !== undefined) {
      if (patch.color) block.color = patch.color;
      else delete block.color;
    }
    if (patch.rect) {
      const { x, y, w, h } = patch.rect;
      if ([x, y, w, h].every((v) => Number.isFinite(v)) && w > 0 && h > 0) {
        block.rect = { x, y, w, h };
      }
    }
  }

  removeTextBlock(index: number, id: string): { ok: boolean; error?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

    const uebrig = (spread.blocks ?? []).filter((b) => b.id !== id);
    if (uebrig.length === (spread.blocks?.length ?? 0)) {
      return { ok: false, error: 'Textblock nicht gefunden' };
    }
    if (uebrig.length === 0) delete spread.blocks;
    else spread.blocks = uebrig;
    return { ok: true };
  }

  /** Hängt ein einzelnes Foto um: Slot zu Slot, in den Pool oder aus ihm. */
  movePhoto(source: MoveSource, target: MoveTarget): MoveResult {
    // Der Bildbestand geht immer mit: Ein Zug auf eine ganze Doppelseite ordnet
    // beide Seiten neu an und braucht dafür die Maße jedes beteiligten Fotos.
    const result = movePhoto(this.spreads, source, target, {
      photos: this.photos,
      overrides: this.overrides,
      profile: this.profile,
      weightOf: (id) => this.overrides[id]?.weight ?? 'normal',
    });
    if (result.ok) {
      this.spreads = result.spreads;
      this.refreshReport();
    }
    return result;
  }

  /**
   * Hängt mehrere Fotos in einem Zug um.
   *
   * Nicht `movePhoto` in einer Schleife: Jede berührte Doppelseite wird genau
   * einmal angeordnet, und der Verlauf sieht eine Handlung statt n. Die
   * Begründung steht an `movePhotos` im Kern.
   */
  movePhotos(moves: readonly PhotoMove[]): MoveManyResult {
    const result = movePhotos(this.spreads, moves, {
      photos: this.photos,
      overrides: this.overrides,
      profile: this.profile,
      weightOf: (id) => this.overrides[id]?.weight ?? 'normal',
    });
    if (result.ok) {
      this.spreads = result.spreads;
      this.refreshReport();
    }
    return result;
  }

  setSpreadTemplate(
    index: number,
    templateId: string,
  ): { ok: boolean; error?: string; leftover: PhotoId[] } {
    const ergebnis = anordnung.setSpreadTemplate(this, index, templateId);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  setSpreadHalf(
    index: number,
    side: 'left' | 'right',
    halfId: string,
  ): { ok: boolean; error?: string; leftover: PhotoId[] } {
    const ergebnis = anordnung.setSpreadHalf(this, index, side, halfId);
    if (ergebnis.ok) this.refreshReport();
    return ergebnis;
  }

  halfChoices(index: number) {
    return anordnung.halfChoices(this, index);
  }

  templateChoices(index: number) {
    return anordnung.templateChoices(this, index);
  }

  /**
   * Fotos, die derzeit in keinem Slot liegen – der Fotopool.
   *
   * Keine eigene Liste, sondern die Differenz zum Bestand. Ein Foto aus dem
   * Buch zu nehmen kann es damit nicht verlieren, und ein erneuter Import
   * bringt es von allein wieder in den Pool.
   */
  unplacedPhotos(): {
    id: PhotoId;
    fileName: string;
    date: string | null;
    /** Pixelmaße: Die Oberfläche rechnet daraus die Auflösung je Zielslot. */
    width: number;
    height: number;
  }[] {
    // Dieselbe Rechnung wie der Bestandsfilter: „übrig" darf nicht zweimal
    // etwas anderes heißen (`project/filter.ts`).
    const platziert = platzierteFotos(this.spreads);

    return (
      [...this.photos.values()]
        .filter((photo) => !platziert.has(photo.id))
        .map((photo) => ({
          id: photo.id,
          fileName: photo.fileName,
          date: resolveEffectiveDate(photo, this.overrides[photo.id]).value,
          width: photo.width,
          height: photo.height,
        }))
        // Undatierte ans Ende: Sie sind der Grund, weshalb die meisten Fotos
        // überhaupt im Pool liegen, und sortieren sich sonst zufällig ein.
        .sort((a, b) => (a.date ?? '￿').localeCompare(b.date ?? '￿'))
    );
  }

  /**
   * Zieht die Kennzahlen nach einer punktuellen Änderung nach.
   *
   * Ohne das zeigte die Übersicht nach jedem Umhängen einen veralteten Stand.
   * Neu generiert wird dabei nichts – Seitenzahl, Auftakte und Machbarkeit
   * hängen an der Generierung und bleiben, wie sie waren.
   */
  private refreshReport(): void {
    if (!this.lastReport) return;
    const stats = bookStats({
      spreads: this.spreads,
      photos: this.photos,
      overrides: this.overrides,
      profile: this.profile,
    });
    this.lastReport = { ...this.lastReport, ...stats };
  }

  // -------------------------------------------------------------- Rendern

  render(index: number): RenderedSpread | undefined {
    const spread = this.spreads[index];
    if (!spread) return undefined;
    return renderSpread(spread, {
      profile: this.profile,
      template: requireTemplate(spread.templateId),
      photos: this.photos,
      overrides: this.overrides,
      background: this.settings.background,
      ...(this.settings.timeline ? { timeline: this.timelineContext(index) } : {}),
      // Ohne Angabe trägt das Buch keine Zahlen – der Schalter lebt hier und
      // nicht in der Engine, wie beim Zeitstrahl.
      ...(this.settings.pageNumbers ? { pageNumbers: {} } : {}),
      // Derselbe Seed wie beim Generieren: Ein neu angeordnetes Buch bekommt
      // damit auch neue Winkel, ein unverändertes behält seine.
      ...(this.settings.tilt > 0
        ? { tilt: { maxDeg: this.settings.tilt, seed: this.settings.seed } }
        : {}),
      // Nur ein gewählter Rahmen wird durchgereicht: Ohne die Angabe steht
      // jedes Bild ohne, und das ist die Vorgabe.
      ...(this.settings.frame !== 'keiner' ? { frame: this.settings.frame } : {}),
    });
  }

  renderAll(): RenderedSpread[] {
    return this.spreads.map((_, i) => this.render(i)).filter((s): s is RenderedSpread => !!s);
  }

  /**
   * Der Abnahmebericht: was dem Druck im Weg steht, über das ganze Buch.
   *
   * Bleibt hier bei den `render*`-Methoden und wird kein Modul in `project/`:
   * Gerechnet wird nichts: Die Fachlogik liegt vollständig im Kern
   * (`pruefeBuch`), und was hier steht, ist das Zusammenstellen der Eingaben aus
   * dem gerenderten Buch, dem Umschlag und den beiden Abdrücken. Ein Modul mit
   * eigener Zustandsschnittstelle wäre für diese fünf Zeilen mehr Zeremonie als
   * Auskunft.
   */
  abnahme(): Abnahmebericht {
    return pruefeBuch({
      spreads: this.renderAll(),
      cover: this.renderCover(),
      profile: this.profile,
      groupsPending: this.groupsPending(),
      structurePending: this.structurePending(),
      abgenommen: new Set(Object.keys(this.abnahmen)),
    });
  }

  /**
   * Die Befunde einer schon gerenderten Doppelseite, mit ihrer Abnahme markiert.
   *
   * Für `spreadAntwort`: Die Bühne blendet damit am Bild ein, was der
   * Abnahmebericht über es sagt, ohne dafür das ganze Buch zu rechnen oder eine
   * zweite Anfrage zu stellen. Die gerenderte Seite kommt als Argument, weil der
   * Aufrufer sie ohnehin schon hat — ein zweites `render()` wäre dieselbe
   * Rechnung ein zweites Mal.
   */
  befundeDerSeite(gerendert: RenderedSpread, index: number): Befund[] {
    const abgenommen = new Set(Object.keys(this.abnahmen));
    return seitenbefunde(gerendert, index, this.profile).map((b) => markiere(b, abgenommen));
  }

  /**
   * Je Doppelseite eine Zeile für den Fuß des Korrekturabzugs — oder nichts.
   *
   * Aus demselben Bericht wie der Reiter „Prüfung", damit auf dem Papier nicht
   * etwas anderes steht als auf dem Bildschirm. **Nur die offenen Funde**: Was
   * abgenickt ist, hat man gesehen und für gut befunden, und eine Zeile darüber
   * wäre beim Durchsehen genau das Rauschen, das man dann überliest.
   *
   * Buch- und Umschlagfunde bleiben draußen: Sie hängen an keiner Doppelseite,
   * stünden also auf jeder.
   *
   * Genannt wird die **Art** und nicht der Wortlaut des Funds: „Bild und Platz
   * stehen quer (4)" ist am Blattrand die brauchbarere Auskunft als viermal
   * „nur 42 % der Bildfläche sind zu sehen" — und nur so bündelt die Zeile
   * überhaupt, denn zwei Freitexte sind nie gleich. Die Zahl steht am Bild,
   * nachgelesen wird im Reiter „Prüfung".
   */
  befundzeilen(): (string | undefined)[] {
    const titel = new Map(BEFUNDARTEN.map((a) => [a.art, a.titel]));
    const nachSeite = new Map<number, string[]>();
    for (const befund of this.abnahme().befunde) {
      if (befund.abgenommen || befund.ort.kind !== 'spread') continue;
      const text = titel.get(befund.art) ?? befund.text;
      const bisher = nachSeite.get(befund.ort.index);
      if (bisher) bisher.push(text);
      else nachSeite.set(befund.ort.index, [text]);
    }
    return this.spreads.map((_, i) => befundzeile(nachSeite.get(i) ?? []));
  }

  /**
   * Nickt einen Befund ab: „Weiß ich, ist ok."
   *
   * **Nur, was der Bericht auch meldet.** Der Schlüssel kommt aus einer Anfrage,
   * und er landet als Objektschlüssel im gespeicherten Projekt; ihn gegen den
   * aktuellen Bericht zu prüfen ist billiger als ein Muster, das raten müsste,
   * welche Schlüssel es geben kann — und es hält die Liste frei von Einträgen,
   * zu denen es nie einen Fund gab.
   *
   * Der Zeitpunkt ist die einzige Stelle im Server, an der die Abnahme eine Uhr
   * braucht; im Kern wäre er verboten (Determinismus), hier ist er Auskunft.
   *
   * Der Bericht wird dabei zweimal gerechnet — einmal hier zur Prüfung, einmal
   * für die Antwort der Route. Das kostet am echten Buch 2 × 21 ms und bleibt
   * so: Den Bericht der Prüfung weiterzureichen hieße, ihn nach der Änderung
   * von Hand nachzuziehen (Marke setzen, Bilanz umrechnen) — und damit eine
   * zweite Rechnung für dieselbe Aussage.
   */
  abnicken(schluessel: string): { ok: true } | { ok: false; error: string } {
    // `Object.hasOwn` und nicht der Wahrheitswert: `abnahmen['toString']` ist
    // von der Prototypkette her wahr, und der Aufruf hätte „schon abgenickt"
    // gemeldet, ohne etwas gespeichert zu haben.
    //
    // Und ein Misserfolg statt eines stillen `ok`: Sonst legte der Haken in
    // `routes/undo.ts` einen Schritt an, der nichts zurücknimmt — ein Cmd+Z,
    // das nichts tut, sieht aus wie ein Fehler.
    if (Object.hasOwn(this.abnahmen, schluessel)) {
      return { ok: false, error: 'Dieser Befund ist schon abgenickt' };
    }
    const bekannt = this.abnahme().befunde.some((b) => b.schluessel === schluessel);
    if (!bekannt) {
      return { ok: false, error: 'Diesen Befund meldet die Abnahme gerade nicht' };
    }
    this.abnahmen[schluessel] = new Date().toISOString();
    return { ok: true };
  }

  /**
   * Nimmt eine Abnahme zurück — einzeln oder alle auf einmal.
   *
   * Ohne Schlüssel wird geleert: Wer die Abnahme von vorn durchgehen will, soll
   * das in einem Griff können und nicht in vierzehn. Beides ist ein
   * Undo-Schritt, also nicht endgültig.
   *
   * @returns wie viele Abnahmen aufgehoben wurden.
   */
  abnahmeZurueck(schluessel?: string): number {
    // `0` heißt „nichts geschehen"; die Route macht daraus einen Misserfolg,
    // damit kein leerer Undo-Schritt stehen bleibt.
    if (schluessel === undefined) {
      const anzahl = Object.keys(this.abnahmen).length;
      this.abnahmen = {};
      return anzahl;
    }
    // Wie beim Abnicken über `Object.hasOwn`: Sonst meldete ein Schlüssel wie
    // `toString` eine aufgehobene Abnahme, die es nie gab.
    if (!Object.hasOwn(this.abnahmen, schluessel)) return 0;
    delete this.abnahmen[schluessel];
    return 1;
  }

  /**
   * Was der Zeitstrahl über die Doppelseite hinaus braucht.
   *
   * Das Ersatzjahr entsteht hier und nicht in der Engine: Nur der Projektstand
   * kennt die Reihenfolge der Doppelseiten im Buch.
   */
  private timelineContext(index: number) {
    const ctx = this.dateContext();
    const gruppeVon = new Map<PhotoId, PhotoGroup>();
    for (const group of this.groups) {
      if (!group.active) continue;
      for (const id of group.photoIds) if (!gruppeVon.has(id)) gruppeVon.set(id, group);
    }

    const fallbackYear = this.nearestYear(index);
    const spanne = this.bookYears();
    return {
      style: this.settings.timelineStyle,
      footVariant: this.settings.timelineFootVariant,
      sideVariant: this.settings.timelineSideVariant,
      // Nur ein gewählter Ton wird durchgereicht: Ohne `accentColor` leitet die
      // Engine ihn aus dem Hintergrund der Doppelseite ab, und das ist die
      // Vorgabe – siehe `accentOn`.
      ...(this.settings.timelineAccent !== 'auto'
        ? { accentColor: this.settings.timelineAccent }
        : {}),
      ...(spanne ? { bookYears: spanne } : {}),
      dateOf: (id: PhotoId) => {
        const photo = this.photos.get(id);
        return photo ? resolveEffectiveDate(photo, this.overrides[id], ctx) : undefined;
      },
      groupOf: (id: PhotoId) => {
        const group = gruppeVon.get(id);
        return group ? { id: group.id, title: group.title } : undefined;
      },
      ...(fallbackYear !== undefined ? { fallbackYear } : {}),
    };
  }

  /**
   * Erstes und letztes Jahr des Buches – der Maßstab der Randachse.
   *
   * Aus der Kalenderstruktur und nicht aus den Doppelseiten: Die Struktur kennt
   * auch Jahrgänge, deren Fotos gerade alle im Pool liegen, und die Achse soll
   * beim Umhängen eines Bildes nicht ihren Maßstab wechseln.
   */
  bookYears(): { from: number; to: number } | undefined {
    const jahre = this.structure.chapters.map((c) => c.year);
    if (jahre.length === 0) return undefined;
    return { from: Math.min(...jahre), to: Math.max(...jahre) };
  }

  /**
   * Jahr der nächstgelegenen Doppelseite mit belastbarem Datum.
   *
   * Trägt eine Doppelseite selbst kein solches Datum, bleibt der Zeitstrahl
   * damit an der richtigen Stelle stehen, statt zu verschwinden – nur der
   * Marker entfällt.
   */
  private nearestYear(index: number): number | undefined {
    const ctx = this.dateContext();
    const jahrVon = (i: number): number | undefined => {
      const spread = this.spreads[i];
      if (!spread) return undefined;
      const daten = spread.slots
        .map((s) => (s.photoId ? this.photos.get(s.photoId) : undefined))
        .filter((p): p is Photo => p !== undefined)
        .map((p) => resolveEffectiveDate(p, this.overrides[p.id], ctx))
        .filter((e) => e.value && (e.confidence === 'high' || e.confidence === 'medium'))
        .map((e) => Number(e.value!.slice(0, 4)))
        .sort((a, b) => a - b);
      return daten[Math.floor(daten.length / 2)];
    };

    for (let abstand = 0; abstand < this.spreads.length; abstand++) {
      const jahr = jahrVon(index - abstand) ?? jahrVon(index + abstand);
      if (jahr !== undefined) return jahr;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- Umschlag

  pageCount(): number {
    return umschlag.pageCount(this);
  }

  coverDesign(): CoverDesign {
    return umschlag.coverDesign(this);
  }

  renderCover(): RenderedCover {
    return umschlag.renderCover(this);
  }

  updateCover(patch: Partial<CoverDesign>): CoverDesign {
    return umschlag.updateCover(this, patch);
  }

  coverCandidates(limit = 24): { photoId: PhotoId; label: string }[] {
    return umschlag.coverCandidates(this, limit);
  }

  /**
   * Ein Foto, wie es gilt — mit aufgelösten Korrekturen.
   *
   * Die Auskunft, aus der Vorschau, Export und Ausschnitt-Editor ihre Maße
   * ziehen. Sie gibt deshalb das aufgelöste Foto: Ein Aufrufer, der hier das
   * rohe Importergebnis bekäme, würde eine korrigierte Ausrichtung
   * stillschweigend übergehen. Wer die Datei selbst meint, nimmt
   * `sources.pfad()`.
   */
  photo(id: PhotoId): Photo | undefined {
    // Auch aussortierte Fotos: Die Liste in der Oberfläche zeigt Vorschauen,
    // und ohne Bild ist „046_46.jpeg" keine Auskunft darüber, was man da
    // aussortiert hat. Die Datei liegt ja noch in ihrer Quelle.
    const roh = this.photos.get(id) ?? this.aussortiert[id]?.photo;
    return roh && effectivePhoto(roh, this.overrides[id]);
  }

  /**
   * Der ganze Bestand mit aufgelösten Korrekturen.
   *
   * Für alles, was über *alle* Fotos läuft und ihre geltenden Maße braucht —
   * insbesondere das Vorwärmen der Vorschauen: Ohne Auflösung entstünde dort die
   * ungedrehte Fassung, und die korrigierte müsste später einzeln nachgezogen
   * werden.
   */
  effectivePhotoList(): Photo[] {
    return [...this.photos.values()].map((p) => effectivePhoto(p, this.overrides[p.id]));
  }

  /**
   * Zieht fehlende Bildmerkmale nach — Gesichter und Aufmerksamkeitsschwerpunkt.
   *
   * Läuft im Hintergrund nach dem Anlauf (`main.ts`), nicht im Import: Das Buch
   * ist ohne die Rechtecke vollständig, und sie wirken beim Rendern. Nach dem
   * Durchlauf sind die Ausschnitte besser, ohne dass etwas neu angeordnet wird.
   *
   * Kein Eintrag in `UNDO_ROUTEN`: Es ist keine Route und keine Handlung des
   * Benutzers, sondern eine nachgereichte Auskunft über die Dateien — wie ein
   * später gelesenes EXIF-Feld.
   */
  async merkmaleNachziehen(
    vision: VisionErkennung,
    onProgress?: (fertig: number, gesamt: number) => void,
  ): Promise<MerkmaleBericht> {
    return merkmale.merkmaleNachziehen(this, this.sources, vision, onProgress);
  }

  /**
   * Zieht die fehlende Bildqualität nach — Schärfe und Belichtung.
   *
   * Wie die Bildmerkmale im Hintergrund nach dem Anlauf, und aus demselben
   * Grund: Das Buch steht ohne die Zahlen, sie gewichten nur den Slotplatz
   * (`layout/scoring.ts`) und schlagen innerhalb eines Doppels das schärfere
   * Bild vor. Gemessen wird auf der 320-px-Vorschau, die der Warmlauf ohnehin
   * erzeugt hat.
   */
  async qualitaetNachziehen(
    previews: PreviewCache,
    onProgress?: (fertig: number, gesamt: number) => void,
  ): Promise<QualitaetBericht> {
    return qualitaet.qualitaetNachziehen(this, previews, onProgress);
  }

  /**
   * Schlägt Doppel vor: mehrere Aufnahmen desselben Augenblicks.
   *
   * Bei jedem Aufruf frisch gerechnet und nirgends gespeichert — der Vorschlag
   * hängt an den Datumskorrekturen, und ein gespeicherter wäre nach der
   * nächsten falsch. Kein Eintrag in `UNDO_ROUTEN`: Es ändert nichts, es sagt
   * nur etwas.
   */
  async doppelVorschlagen(
    previews: PreviewCache,
    abstaende: AbstandsErkennung,
    opts: DoppelOptions = {},
  ): Promise<DoppelBericht> {
    const ctx = this.dateContext();
    const datiert: DoppelKandidat[] = [];
    for (const photo of this.photos.values()) {
      const wert = resolveEffectiveDate(photo, this.overrides[photo.id], ctx).value;
      // Undatierte bleiben draußen: Ohne Zeitpunkt gibt es keine zeitliche
      // Nähe, und ein Doppel aus zwei undatierten Fotos wäre geraten.
      if (wert) datiert.push({ id: photo.id, date: wert });
    }
    return doppel.doppelVorschlagen(datiert, this, previews, abstaende, opts);
  }

  /**
   * „Beide behalten" — merkt ein Doppel als erledigt, ohne etwas zu löschen.
   *
   * Gebaut wie das Abnicken eines Befunds und aus demselben Grund: Der
   * Vorschlag entsteht bei jedem Aufruf neu, also käme er sonst nach jedem
   * „Neu rechnen" wieder. Ein Misserfolg statt eines stillen `ok`, damit der
   * Haken in `routes/undo.ts` keinen Schritt anlegt, der nichts zurücknimmt.
   *
   * **Geprüft wird nicht, ob es das Doppel gerade gibt.** Anders als beim
   * Abnahmebericht kostete das eine volle Doppelrechnung samt Bildvergleich
   * (rund 1,5 s) für eine Auskunft, die die Oberfläche schon hat — sie zeigt ja
   * die Zeile, auf die geklickt wurde. Ein Schlüssel, den nichts trifft, ist
   * ein Eintrag ohne Wirkung und kein Schaden.
   */
  doppelMerken(schluessel: string): { ok: true } | { ok: false; error: string } {
    // `Object.hasOwn` wie bei den Abnahmen: `doppelBehalten['toString']` wäre
    // von der Prototypkette her wahr und meldete „schon gemerkt", ohne dass je
    // etwas gespeichert wurde.
    if (Object.hasOwn(this.doppelBehalten, schluessel)) {
      return { ok: false, error: 'Dieses Doppel steht schon auf „beide behalten"' };
    }
    this.doppelBehalten[schluessel] = new Date().toISOString();
    return { ok: true };
  }

  /**
   * Nimmt ein „beide behalten" zurück — einzeln oder alle auf einmal.
   *
   * @returns wie viele Einträge aufgehoben wurden; `0` macht die Route zum
   * Misserfolg, damit kein leerer Undo-Schritt stehen bleibt.
   */
  doppelMerkenZurueck(schluessel?: string): number {
    if (schluessel === undefined) {
      const anzahl = Object.keys(this.doppelBehalten).length;
      this.doppelBehalten = {};
      return anzahl;
    }
    if (!Object.hasOwn(this.doppelBehalten, schluessel)) return 0;
    delete this.doppelBehalten[schluessel];
    return 1;
  }

  /**
   * Kontext der Datumskaskade.
   *
   * Bewusst bei jedem Aufruf neu und ohne Zwischenspeicher: Der teure Teil ist
   * `findBulkSeconds` über alle Fotos – ein einzelner Durchlauf über Zahlen –,
   * ein Zwischenspeicher bräuchte dagegen eine Ungültigkeitsregel für Import,
   * Korrekturen und Gruppenänderungen. Genau die Klasse Fehler, die sich später
   * als veraltetes Datum in der Vorschau zeigt.
   */
  private dateContext(): DateContext {
    return {
      importedAt: this.importedAt.slice(0, 19) as NaiveDateTime,
      bulkSeconds: findBulkSeconds([...this.photos.values()]),
      ...(this.settings.birthDate
        ? { earliestPlausible: `${this.settings.birthDate}T00:00:00` as NaiveDateTime }
        : {}),
    };
  }

  /**
   * Ein Foto, wie die Oberfläche es sieht: mit Korrekturen und Befunden.
   *
   * Über `effectivePhoto`, damit ein von Hand gesetzter Ort überall gilt, wo die
   * Oberfläche einen Ort zeigt — Fotoliste, Gruppenansicht, Inspektor. Dass die
   * Korrektur eine ist, steht als `placeManual` daneben: Dasselbe Versprechen wie
   * beim Datum, wo die Quelle als Etikett erscheint. Ein stillschweigend
   * ersetzter Wert wäre nicht mehr als Entscheidung erkennbar.
   */
  private photoView(photo: Photo, ctx: DateContext): PhotoView {
    const override = this.overrides[photo.id];
    const e = resolveEffectiveDate(photo, override, ctx);
    return {
      ...effectivePhoto(photo, override),
      effectiveDate: e.value,
      dateSource: e.source,
      dateConfidence: e.confidence,
      issues: e.issues,
      ...(override?.placeOverride ? { placeManual: true } : {}),
      ...(override?.weight ? { weight: override.weight } : {}),
      ...(override?.adjust ? { adjust: override.adjust } : {}),
    };
  }

  /**
   * Fotos nach Filter, mit allem, was die Oberfläche zum Anzeigen braucht.
   *
   * Der Filter läuft hier und nicht im Browser: Es ist dieselbe Frage, die
   * `POST /api/export/abzug` und der Kontaktbogen stellen, und eine zweite
   * Fassung derselben Bedingungen liefe irgendwann auseinander. Gerechnet wird
   * über die schon aufgelösten Sichten — der Bestand liegt im Speicher.
   */
  fotosFiltern(filter: Bestandsfilter): PhotoView[] {
    return filtereFotos(this.photoViews(), filter, {
      spreads: this.spreads,
      groups: this.groups,
    });
  }

  /** Fotos mit Datumsangabe und Befunden, für Timeline und Problemliste. */
  photoViews(onlyProblems = false): PhotoView[] {
    const ctx = this.dateContext();

    const views: PhotoView[] = [];
    for (const photo of this.photos.values()) {
      if (
        onlyProblems &&
        !needsAttention(resolveEffectiveDate(photo, this.overrides[photo.id], ctx))
      )
        continue;
      views.push(this.photoView(photo, ctx));
    }
    return views.sort((a, b) => (a.effectiveDate ?? '￿').localeCompare(b.effectiveDate ?? '￿'));
  }

  /**
   * Dieselbe Sicht für einzelne Fotos, in der Reihenfolge der Anfrage.
   *
   * Unbekannte Kennungen fallen weg statt zu scheitern: Ein Slot kann auf ein
   * aussortiertes Foto zeigen, und das ist ein gewöhnlicher Zustand, kein
   * Fehler.
   */
  photoViewsOf(ids: readonly PhotoId[]): PhotoView[] {
    const ctx = this.dateContext();
    const views: PhotoView[] = [];
    for (const id of ids) {
      const photo = this.photos.get(id);
      if (!photo) continue;
      views.push(this.photoView(photo, ctx));
    }
    return views;
  }

  chapters(): { year: number; photoCount: number; firstSpreadIndex: number }[] {
    const result: { year: number; photoCount: number; firstSpreadIndex: number }[] = [];
    // Der erste Spread eines Jahres ist der Kapitelauftakt bzw. der erste,
    // dessen Fotos in dieses Jahr fallen.
    const jahrVon = this.jahrJeFoto();
    const yearOfSpread = this.spreads.map((s) => this.yearOf(s, jahrVon));
    for (const chapter of this.structure.chapters) {
      const idx = yearOfSpread.indexOf(chapter.year);
      result.push({
        year: chapter.year,
        photoCount: chapter.photoCount,
        firstSpreadIndex: idx >= 0 ? idx : 0,
      });
    }
    return result;
  }

  groupMarks(): { spreadIndex: number; id: string; title: string }[] {
    return gruppen.groupMarks(this);
  }

  /** Das Buch als Baum: je Doppelseite ihre Bilder und was an ihr auffällt. */
  baum(): BaumSeite[] {
    return baum(this);
  }

  firstSpreadOfGroup(): Map<string, number> {
    return gruppen.firstSpreadOfGroup(this);
  }

  spreadGroups(index: number): { id: string; title: string; active: boolean; count: number }[] {
    return gruppen.spreadGroups(this, index);
  }

  /**
   * Rettet eine nicht deutbare Projektdatei, statt sie überschreiben zu lassen.
   *
   * Der Zeitstempel steckt im Namen, damit mehrere Versuche einander nicht
   * überschreiben. Schlägt selbst das Umbenennen fehl, startet der Server
   * trotzdem – aber mit einer lauten Meldung, denn dann liegt die einzige
   * Fassung noch unter dem alten Namen und der nächste `save()` trifft sie.
   */
  private async legeBeiseite(pfad: string): Promise<void> {
    const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ziel = `${pfad}.unlesbar-${stempel}`;
    try {
      await rename(pfad, ziel);
      console.warn(`Projektdatei nicht deutbar — beiseitegelegt als ${ziel}`);
    } catch (fehler) {
      console.error(
        `Projektdatei nicht deutbar und nicht zu sichern (${String(fehler)}). ` +
          `Vor dem nächsten Speichern von Hand kopieren: ${pfad}`,
      );
    }
  }

  /**
   * Das Jahr, in das diese Doppelseite gehört.
   *
   * `chapterYear` zuerst, denn das ist die Aussage der Engine. Der Inhalt der
   * Jahreszahl kommt nur noch als Rückfall für Stände, die vor dem Feld erzeugt
   * wurden – und nur, wenn er sich als Zahl lesen lässt: Seit die Jahreszahl
   * editierbar ist, kann dort „2019 – das erste Jahr" stehen, und ein `NaN`
   * hätte die Kapitelnavigation auf Seite 1 geschickt.
   *
   * Der letzte Rückfall liest das Jahr aus der Kalendergliederung und nicht mehr
   * aus dem rohen `takenAt` des ersten Bildes: Sonst stünde ein Bild mit
   * korrigiertem Datum in einem anderen Jahr als dem, in dem die Gliederung es
   * führt, und die Kapitelnavigation sprang ins falsche Kapitel. Die Map baut
   * der Aufrufer einmal — je Doppelseite über den Bestand zu laufen wäre bei
   * achtzig Blättern achtzigmal derselbe Durchlauf.
   */
  private yearOf(spread: Spread, jahrVon: ReadonlyMap<PhotoId, number>): number | undefined {
    if (spread.chapterYear !== undefined) return spread.chapterYear;
    const text = spread.texts?.find((t) => t.role === 'year');
    const ausText = text ? Number(text.content) : Number.NaN;
    if (Number.isInteger(ausText)) return ausText;
    for (const slot of spread.slots) {
      if (!slot.photoId) continue;
      const jahr = jahrVon.get(slot.photoId);
      if (jahr !== undefined) return jahr;
    }
    return undefined;
  }

  /** Jahr je Foto, wie die Kalendergliederung es sieht. */
  private jahrJeFoto(): Map<PhotoId, number> {
    const map = new Map<PhotoId, number>();
    for (const kapitel of this.structure.chapters) {
      for (const segment of kapitel.segments) {
        for (const id of segment.photoIds) map.set(id, kapitel.year);
      }
    }
    return map;
  }

  /**
   * Ist das die Auftaktseite dieses Jahrgangs?
   *
   * Schärfer als `yearOf`, und zwar mit Absicht: Dort darf das Jahr auch aus den
   * Fotos kommen, hier nicht – die Jahresereignisse gehören auf den Auftakt und
   * nicht auf die erste Seite, die zufällig Bilder aus dem Jahr trägt.
   */
  private istJahresauftakt(spread: Spread, year: number): boolean {
    if (spread.chapterYear !== undefined) return spread.chapterYear === year;
    return spread.texts?.some((t) => t.role === 'year' && t.content === String(year)) === true;
  }

  // ------------------------------------------------------------ Persistenz

  /**
   * Läuft gerade ein Schreibvorgang? Der nächste hängt sich daran.
   *
   * Jeder Endpunkt speichert mit `void project.save()`, also nebenläufig. Zwei
   * gleichzeitige Aufrufe schrieben beide in dieselbe Nebendatei und benannten
   * sie beide um – der zweite fand sie nicht mehr und riss mit einem
   * unbehandelten `ENOENT` den ganzen Server um. Ausgelöst hat das der
   * Drehregler eines Textblocks: eine Anfrage je Pixel Reglerweg.
   */
  private schreibvorgang: Promise<void> = Promise.resolve();

  /**
   * Schreibt atomar: erst in eine Nebendatei, dann umbenennen. Damit kann ein
   * Absturz mitten im Schreiben kein halbes Projekt hinterlassen.
   *
   * Die Aufrufe laufen nacheinander, nie gleichzeitig. Und sie werfen nicht:
   * Ein fehlgeschlagener Schreibvorgang ist ärgerlich, ein Serverabsturz mit
   * dem ganzen Projektzustand im Speicher ist schlimmer. Gemeldet wird er
   * deutlich – wer die Ausgabe nicht sieht, merkt es spätestens am Datum der
   * Datei.
   */
  async save(): Promise<void> {
    this.schreibvorgang = this.schreibvorgang.then(
      () => this.schreibeJetzt(),
      () => this.schreibeJetzt(),
    );
    return this.schreibvorgang;
  }

  /** Der Stand in der Form, in der er auf Platte geht. */
  private daten(): PersistedProject {
    return {
      schemaVersion: SCHEMA_VERSION,
      sources: [...this.sources.list()],
      settings: this.settings,
      photos: [...this.photos.values()],
      aussortiert: Object.values(this.aussortiert),
      overrides: this.overrides,
      groups: this.groups,
      ...(this.groupStamp !== undefined ? { groupStamp: this.groupStamp } : {}),
      ...(this.structureStamp !== undefined ? { structureStamp: this.structureStamp } : {}),
      yearEvents: this.yearEvents,
      book: { spreads: this.spreads },
      cover: this.cover,
      abnahmen: this.abnahmen,
      doppelBehalten: this.doppelBehalten,
      importedAt: this.importedAt,
    };
  }

  private async schreibeJetzt(): Promise<void> {
    const data = this.daten();

    const target = join(this.projectPath, 'project.json');
    // Eindeutiger Name je Vorgang: Die Serialisierung oben verhindert das
    // Rennen innerhalb eines Prozesses, zwei Server auf demselben Verzeichnis
    // wären davon unberührt. Ein Name, den nur dieser Vorgang kennt, ist
    // billiger als eine Sperrdatei.
    const tmp = `${target}.${process.pid}-${++this.schreibZaehler}.tmp`;

    try {
      await mkdir(this.projectPath, { recursive: true });
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmp, target);
    } catch (fehler) {
      console.error(`Projekt nicht gespeichert (${target}): ${String(fehler)}`);
      // Die Nebendatei aufräumen, damit kein halber Stand liegen bleibt.
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private schreibZaehler = 0;

  // -------------------------------------------------------------- Notanker

  private get ankerOrdner(): string {
    return join(this.projectPath, ANKER_ORDNER);
  }

  /**
   * Legt den ganzen Stand als Datei ab, vor einer großen Aktion.
   *
   * Aus dem Speicher heraus, nicht als Kopie von `project.json`: Die Datei kann
   * fehlen oder älter sein, weil `save()` nebenläufig läuft.
   */
  async notanker(aktion: string): Promise<Anker | null> {
    try {
      await mkdir(this.ankerOrdner, { recursive: true });
      return await ankerLegen(this.ankerOrdner, this.daten(), aktion);
    } catch (fehler) {
      // Ein misslungener Anker hält die Aktion nicht auf – er ist die
      // Vorsichtsmaßnahme, nicht der Zweck. Gemeldet wird er trotzdem.
      console.error(`Notanker nicht gelegt (${aktion}): ${String(fehler)}`);
      return null;
    }
  }

  /** Die abgelegten Notanker, neuester zuerst. */
  ankerListe(): Promise<Anker[]> {
    return ankerListe(this.ankerOrdner);
  }

  /**
   * Holt einen Notanker zurück.
   *
   * Durch dieselbe `migriere()` wie beim Laden – ein Anker *ist* eine
   * `project.json`, und ein Anker aus einer älteren Fassung ist genau der Fall,
   * für den es Migrationen gibt. Was danach kommt, ist Sache des Aufrufers:
   * Der Endpunkt legt vorher selbst einen Anker und hält den Stand im Verlauf
   * fest, damit auch dieser Griff sich zurücknehmen lässt.
   *
   * @returns `false`, wenn es den Anker nicht gibt oder er unbrauchbar ist.
   */
  async ankerZurueck(name: string): Promise<boolean> {
    const roh = await ankerLesen(this.ankerOrdner, name);
    if (roh === null || !istBrauchbareStruktur(roh)) return false;

    const data = migriere(roh);
    if (data === null) return false;

    if (data.sources?.length) this.sources.restore(data.sources);
    this.photos.clear();
    for (const p of data.photos) this.photos.set(p.id, p);
    this.aussortiert = Object.fromEntries((data.aussortiert ?? []).map((a) => [a.photo.id, a]));
    this.overrides = data.overrides ?? {};
    this.groups = data.groups ?? [];
    this.groupStamp = data.groupStamp;
    this.structureStamp = data.structureStamp;
    this.yearEvents = data.yearEvents ?? {};
    this.spreads = data.book?.spreads ?? [];
    this.cover = data.cover ?? {};
    this.abnahmen = merkkarteAus(data.abnahmen);
    this.doppelBehalten = merkkarteAus(data.doppelBehalten);
    this.settings = { ...this.settings, ...data.settings };
    this.importedAt = data.importedAt ?? this.importedAt;
    this.rebuildStructure();
    this.refreshReport();
    await this.save();
    return true;
  }

  /** @returns ob ein gespeichertes Projekt gefunden wurde. */
  async load(): Promise<boolean> {
    const pfad = join(this.projectPath, 'project.json');
    try {
      const raw = await readFile(pfad, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const data = istBrauchbareStruktur(parsed) ? migriere(parsed) : null;

      if (data === null) {
        // Ein neueres oder unbekanntes Format lieber gar nicht deuten als
        // falsch – der Server importiert dann neu. Die Datei wird dabei zur
        // Seite gelegt, nicht überschrieben: Genau hier sind schon einmal 61
        // bestätigte Gruppen und die Handarbeit eines Nachmittags verschwunden,
        // weil ein laufender Entwicklungsserver mit erhöhter `SCHEMA_VERSION`
        // neu lud, bevor die zugehörige Migration geschrieben war. Ein
        // Neuimport stellt nichts davon wieder her.
        await this.legeBeiseite(pfad);
        return false;
      }

      if (data.sources?.length) this.sources.restore(data.sources);

      this.photos.clear();
      for (const p of data.photos) this.photos.set(p.id, p);
      this.aussortiert = Object.fromEntries((data.aussortiert ?? []).map((a) => [a.photo.id, a]));
      this.overrides = data.overrides ?? {};
      this.groups = data.groups ?? [];
      this.groupStamp = data.groupStamp;
      this.structureStamp = data.structureStamp;
      this.yearEvents = data.yearEvents ?? {};
      this.spreads = data.book?.spreads ?? [];
      this.cover = data.cover ?? {};
      this.abnahmen = merkkarteAus(data.abnahmen);
      this.doppelBehalten = merkkarteAus(data.doppelBehalten);
      this.settings = { ...this.settings, ...data.settings };
      this.importedAt = data.importedAt ?? this.importedAt;
      this.rebuildStructure();
      return this.photos.size > 0;
    } catch {
      return false;
    }
  }
}

export type { Chapter };
