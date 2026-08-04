/**
 * Projektzustand.
 *
 * Hält Fotos, Struktur und Buch im Speicher und schreibt sie atomar auf
 * Platte. Die Originaldateien werden ausschließlich gelesen.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type Chapter,
  type CoverDesign,
  type Crop,
  type DateContext,
  type FrameId,
  type GenerateResult,
  type LayoutDocument,
  type LayoutIssue,
  type MoveResult,
  type MoveSource,
  type MoveTarget,
  type NaiveDateTime,
  type Photo,
  type PhotoId,
  type PhotoGroup,
  type PhotoOverride,
  type PrintProfile,
  type RenderedCover,
  type RenderedSpread,
  type SinglePageResult,
  type Spread,
  type Structure,
  type TextBlock,
  type TimelineFootVariant,
  type TimelineSideVariant,
  splitKept,
  bookStats,
  buildStructure,
  DEFAULT_BACKGROUND,
  FONT_FAMILIES,
  DEFAULT_FRAME,
  DEFAULT_TILT_DEG,
  normalizeRotation,
  backgroundFit,
  defaultProfile,
  findBulkSeconds,
  FULL_CROP,
  generateBook,
  isFrameId,
  isJustified,
  movePhoto,
  addToGroup,
  createGroup,
  mergeGroups,
  needsAttention,
  renderSpread,
  requireTemplate,
  resolveEffectiveDate,
  sortKey,
  removeGroup,
  templateById,
  ungroupPhotos,
  updateGroup,
} from '@franibook/core';
import type { DecodeCache } from './decode.js';
import type { PreviewCache } from './previews.js';
import * as anordnung from './project/anordnung.js';
import * as bestand from './project/bestand.js';
import type { ImportDiff, QuellenBericht } from './project/bestand.js';
import * as gruppen from './project/gruppen.js';
import * as layoutDokument from './project/layout-dokument.js';
import * as seiten from './project/seiten.js';
import * as umschlag from './project/umschlag.js';
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

/** Beides beschreibt einen Einlesevorgang und steht deshalb bei ihm. */
export type { ImportDiff, QuellenBericht };

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
  seed: number;
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
  overrides: Record<PhotoId, PhotoOverride>;
  book: { spreads: Spread[] };
  groups: PhotoGroup[];
  /** Stand der Gruppen beim letzten Erzeugen; fehlt in älteren Projekten. */
  groupStamp?: string;
  yearEvents?: Record<string, string[]>;
  /** Erst ab Umschlagunterstützung vorhanden; ältere Projekte haben es nicht. */
  cover?: CoverDesign;
  importedAt: string;
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

export interface PhotoView extends Photo {
  effectiveDate: string | null;
  dateSource: string;
  dateConfidence: string;
  issues: { code: string; detail?: string }[];
}

export class Project {
  readonly profile: PrintProfile = defaultProfile();
  readonly photos = new Map<PhotoId, Photo>();
  overrides: Record<PhotoId, PhotoOverride> = {};
  groups: PhotoGroup[] = [];
  spreads: Spread[] = [];
  structure: Structure = { chapters: [], undated: [], photoCount: 0 };
  lastReport: GenerateResult['report'] | null = null;
  /** Stand der Gruppen, aus dem das aktuelle Buch gebaut wurde. */
  private groupStamp: string | undefined;

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
    seed: 1,
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

  constructor(
    readonly sources: Sources,
    readonly previews: PreviewCache,
    readonly decodes: DecodeCache,
    private readonly projectPath: string,
  ) {}

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

  deletePhoto(id: PhotoId): Promise<{
    fileName: string;
    papierkorb: string;
    imBuch: number;
    spreads: number[];
  } | null> {
    return bestand.deletePhoto(this, id);
  }

  importPhotos(limit?: number, nurQuellen?: readonly string[]): Promise<QuellenBericht> {
    return bestand.importPhotos(this, limit, nurQuellen);
  }

  reimport(limit?: number, nurQuellen?: readonly string[]): Promise<ImportDiff> {
    return bestand.reimport(this, limit, nurQuellen);
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
    /** Von Hand gesetzte Textblöcke auf Seiten, die neu gebaut werden. */
    texte: number;
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
    let texte = 0;
    let festgehalten = 0;
    for (const spread of this.spreads) {
      if (spread.locked) {
        festgehalten++;
        continue;
      }
      texte += spread.blocks?.length ?? 0;
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
      texte,
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
  ): { ok: boolean; hinweis?: string } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false };

    if (patch.color !== undefined) {
      if (patch.color === null) delete spread.background;
      else spread.background = patch.color;
    }

    if (patch.photoId !== undefined) {
      if (patch.photoId === null) {
        delete spread.backgroundPhotoId;
      } else {
        const photo = this.photos.get(patch.photoId);
        if (!photo) return { ok: false };
        spread.backgroundPhotoId = patch.photoId;
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

    const auftakt = this.spreads.find((s) =>
      s.texts?.some((t) => t.role === 'year' && t.content === String(year)),
    );
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
    return layoutDokument.exportLayout(this);
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
    return { ok: true };
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

    // Der Beschnitt in normierten Einheiten: So weit darf ein Bild über das
    // Endformat hinausragen, ohne dass es aus dem Blatt fällt.
    const { bleedMm, trimWidthMm, trimHeightMm } = this.profile.page;
    const randX = bleedMm / (2 * trimWidthMm);
    const randY = bleedMm / trimHeightMm;
    const klemme = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

    slot.rect = {
      x: klemme(rect.x, -randX, 1 + randX - rect.w),
      y: klemme(rect.y, -randY, 1 + randY - rect.h),
      w: klemme(rect.w, 0.02, 1 + 2 * randX),
      h: klemme(rect.h, 0.02, 1 + 2 * randY),
    };
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
      content: patch.content ?? 'Text',
      rect: patch.rect ?? { x: 0.08, y: 0.44, w: 0.3, h: 0.08 },
      weight: patch.weight ?? 'regular',
      ...(patch.family ? { family: patch.family } : {}),
      fontSizePt: patch.fontSizePt ?? 14,
      align: patch.align ?? 'left',
      ...(patch.color ? { color: patch.color } : {}),
      ...(patch.rotateDeg !== undefined ? { rotateDeg: patch.rotateDeg } : {}),
    };

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
    return { ok: true };
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
    const platziert = new Set<PhotoId>();
    for (const spread of this.spreads) {
      for (const slot of spread.slots) if (slot.photoId) platziert.add(slot.photoId);
    }

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
    const stats = bookStats({ spreads: this.spreads, photos: this.photos, profile: this.profile });
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
      background: this.settings.background,
      ...(this.settings.timeline ? { timeline: this.timelineContext(index) } : {}),
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

  photo(id: PhotoId): Photo | undefined {
    return this.photos.get(id);
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

  /** Fotos mit Datumsangabe und Befunden, für Timeline und Problemliste. */
  photoViews(onlyProblems = false): PhotoView[] {
    const ctx = this.dateContext();

    const views: PhotoView[] = [];
    for (const photo of this.photos.values()) {
      const e = resolveEffectiveDate(photo, this.overrides[photo.id], ctx);
      if (onlyProblems && !needsAttention(e)) continue;
      views.push({
        ...photo,
        effectiveDate: e.value,
        dateSource: e.source,
        dateConfidence: e.confidence,
        issues: e.issues,
      });
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
      const e = resolveEffectiveDate(photo, this.overrides[id], ctx);
      views.push({
        ...photo,
        effectiveDate: e.value,
        dateSource: e.source,
        dateConfidence: e.confidence,
        issues: e.issues,
      });
    }
    return views;
  }

  chapters(): { year: number; photoCount: number; firstSpreadIndex: number }[] {
    const result: { year: number; photoCount: number; firstSpreadIndex: number }[] = [];
    // Der erste Spread eines Jahres ist der Kapitelauftakt bzw. der erste,
    // dessen Fotos in dieses Jahr fallen.
    const yearOfSpread = this.spreads.map((s) => this.yearOf(s));
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

  private yearOf(spread: Spread): number | undefined {
    const text = spread.texts?.find((t) => t.role === 'year');
    if (text) return Number(text.content);
    for (const slot of spread.slots) {
      if (!slot.photoId) continue;
      const photo = this.photos.get(slot.photoId);
      const date = photo?.takenAt ?? photo?.secondaryDate;
      if (date) return Number(date.slice(0, 4));
    }
    return undefined;
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

  private async schreibeJetzt(): Promise<void> {
    const data: PersistedProject = {
      schemaVersion: SCHEMA_VERSION,
      sources: [...this.sources.list()],
      settings: this.settings,
      photos: [...this.photos.values()],
      overrides: this.overrides,
      groups: this.groups,
      ...(this.groupStamp !== undefined ? { groupStamp: this.groupStamp } : {}),
      yearEvents: this.yearEvents,
      book: { spreads: this.spreads },
      cover: this.cover,
      importedAt: this.importedAt,
    };

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

  /** @returns ob ein gespeichertes Projekt gefunden wurde. */
  async load(): Promise<boolean> {
    const pfad = join(this.projectPath, 'project.json');
    try {
      const raw = await readFile(pfad, 'utf8');
      const data = migriere(JSON.parse(raw) as PersistedProject);

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
      this.overrides = data.overrides ?? {};
      this.groups = data.groups ?? [];
      this.groupStamp = data.groupStamp;
      this.yearEvents = data.yearEvents ?? {};
      this.spreads = data.book?.spreads ?? [];
      this.cover = data.cover ?? {};
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
