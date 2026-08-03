/**
 * Projektzustand.
 *
 * Hält Fotos, Struktur und Buch im Speicher und schreibt sie atomar auf
 * Platte. Die Originaldateien werden ausschließlich gelesen.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type Chapter,
  type CoverDesign,
  type Crop,
  type DateContext,
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
  type Spread,
  type Structure,
  type TextBlock,
  allTemplates,
  bookStats,
  buildStructure,
  chapterTemplates,
  DEFAULT_BACKGROUND,
  DEFAULT_TILT_DEG,
  MAX_TILT_DEG,
  backgroundFit,
  defaultProfile,
  exportLayout,
  findBulkSeconds,
  FULL_CROP,
  generateBook,
  halfPages,
  halvesOfTemplate,
  layoutSpread,
  movePhoto,
  addToGroup,
  createGroup,
  mergeGroups,
  mergeSuggestions,
  needsAttention,
  parseLayout,
  propagatePlaces,
  rebuildSpreads,
  renderCover,
  renderSpread,
  requireTemplate,
  resolveEffectiveDate,
  sortKey,
  removeGroup,
  templateById,
  templateMeta,
  sortGroupsChronologically,
  suggestDayGroups,
  suggestOccasionGroups,
  suggestPlaceGroups,
  ungroupPhotos,
  updateGroup,
} from '@franibook/core';
import type { DecodeCache } from './decode.js';
import { importSource } from './import.js';
import type { PreviewCache } from './previews.js';
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

/** Fotos zeitlich, Undatiertes ans Ende – dieselbe Ordnung wie im Import. */
function nachAufnahme(a: Photo, b: Photo): number {
  if (a.takenAt && b.takenAt) return a.takenAt.localeCompare(b.takenAt);
  if (a.takenAt) return -1;
  if (b.takenAt) return 1;
  return a.relPath.localeCompare(b.relPath);
}

/** Quellen, die beim Einlesen nicht erreichbar waren. */
export interface QuellenBericht {
  offline: (PhotoSource & { photoCount: number })[];
}

export interface ImportDiff extends QuellenBericht {
  neu: PhotoId[];
  verschwunden: PhotoId[];
  unveraendert: number;
  imBuchVerschwunden: PhotoId[];
}

export interface ProjectSettings {
  targetPages: number;
  chapterOpeners: boolean;
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
    // Weiß als Vorgabe – über achtzig Doppelseiten wirkt es allerdings leer,
    // deshalb die Palette in render/background.ts.
    background: DEFAULT_BACKGROUND,
    // An: Die Farbe wechselt am Jahreswechsel und macht die Kapitelgrenze auch
    // dann sichtbar, wenn man die Jahreszahl überschlägt.
    chapterColors: true,
    // An: Ein Raster aus exakt waagerechten Kästen sieht gezeichnet aus, nicht
    // eingeklebt. Der Wert ist bewusst klein – siehe render/tilt.ts.
    tilt: DEFAULT_TILT_DEG,
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

  // ---------------------------------------------------------------- Quellen

  /** Zu welcher Quelle ein Foto gehört – ohne Angabe zur ersten. */
  private quelleVon(photo: Photo): string | undefined {
    return photo.sourceId ?? this.sources.primary()?.id;
  }

  photosOfSource(sourceId: string): Photo[] {
    return [...this.photos.values()].filter((p) => this.quelleVon(p) === sourceId);
  }

  /**
   * Nimmt eine Bildquelle auf und liest sie ein.
   *
   * Bewusst ohne Neugenerieren, wie beim Reimport: Die neuen Fotos stehen
   * danach im Fotopool und lassen sich von dort einsetzen. Wer das Buch neu
   * bauen will, sagt das eigens.
   */
  async addSource(root: string, label?: string): Promise<{ source: PhotoSource } & ImportDiff> {
    const { source } = await this.sources.add(root, label);
    // Auch eine schon bekannte Quelle wird eingelesen: Der Aufruf heißt für
    // den Benutzer „lies das hier ein", nicht „lege einen Eintrag an".
    const diff = await this.reimport(undefined, [source.id]);
    return { source, ...diff };
  }

  /**
   * Entfernt eine Quelle samt ihrer Fotos.
   *
   * Die Doppelseiten bleiben stehen; belegte Plätze werden zu fehlenden
   * Bildern (`photo-missing` im RSM), genau wie bei einer gelöschten Datei.
   * Wie viele das sind, steht in der Rückgabe – die Oberfläche fragt damit
   * vorher nach.
   */
  removeSource(sourceId: string): { source: PhotoSource; entfernt: number; imBuch: number } | null {
    const betroffen = this.photosOfSource(sourceId);
    const source = this.sources.remove(sourceId);
    if (!source) return null;

    const { imBuch } = this.vergessen(betroffen.map((p) => p.id));
    return { source, entfernt: betroffen.length, imBuch };
  }

  // ----------------------------------------------------------------- Fotos

  /**
   * Nimmt Fotos aus dem Projekt, ohne die Doppelseiten umzubauen.
   *
   * Die Slots behalten ihre Kennung und werden zu fehlenden Bildern
   * (`photo-missing` im RSM) – die Alternative wäre, das Buch beim Aussortieren
   * eines einzigen Fotos umzuwerfen. Alles andere, was auf ein Foto zeigt, muss
   * dagegen mit: eine Gruppe mit toter Kennung, ein Hintergrundbild oder ein
   * Titelbild, das es nicht mehr gibt, wären stille Fehler.
   *
   * `PhotoOverride` bleibt bewusst erhalten. Er hängt an der Kennung, nicht am
   * Foto, und ist sofort wieder gültig, wenn die Datei aus dem Papierkorb
   * zurückkommt.
   */
  vergessen(ids: readonly PhotoId[]): { entfernt: number; imBuch: number; spreads: number[] } {
    const menge = new Set(ids);
    let entfernt = 0;
    for (const id of menge) {
      if (this.photos.delete(id)) entfernt++;
    }

    const spreads: number[] = [];
    let imBuch = 0;
    this.spreads.forEach((spread, i) => {
      const slots = spread.slots.filter((sl) => sl.photoId && menge.has(sl.photoId)).length;
      imBuch += slots;
      let betroffen = slots > 0;
      if (spread.backgroundPhotoId && menge.has(spread.backgroundPhotoId)) {
        delete spread.backgroundPhotoId;
        betroffen = true;
      }
      if (betroffen) spreads.push(i);
    });

    this.groups = ungroupPhotos(this.groups, [...menge]);
    if (this.cover.frontPhotoId && menge.has(this.cover.frontPhotoId)) {
      delete this.cover.frontPhotoId;
      delete this.cover.frontCrop;
    }
    if (this.cover.backPhotoId && menge.has(this.cover.backPhotoId)) {
      delete this.cover.backPhotoId;
      delete this.cover.backCrop;
    }

    this.rebuildStructure();
    return { entfernt, imBuch, spreads };
  }

  /**
   * Legt die Datei eines Fotos in den Papierkorb seiner Quelle und vergisst es.
   *
   * Der Rückweg bleibt offen: Die Datei liegt unter `.franibook-geloescht` in
   * derselben Quelle und lässt sich im Finder zurücklegen. Ein späterer Reimport
   * holt sie erst wieder ins Projekt, wenn sie dort auch wirklich liegt –
   * versteckte Ordner liest der Scan nicht.
   */
  async deletePhoto(id: PhotoId): Promise<{
    fileName: string;
    papierkorb: string;
    imBuch: number;
    spreads: number[];
  } | null> {
    const photo = this.photos.get(id);
    if (!photo) return null;

    const papierkorb = await this.sources.inDenPapierkorb(photo);
    const { imBuch, spreads } = this.vergessen([id]);
    return { fileName: photo.fileName, papierkorb, imBuch, spreads };
  }

  // ---------------------------------------------------------------- Import

  /**
   * Liest die angegebenen Quellen ein (ohne Angabe: alle).
   *
   * Fotos aus Quellen, die gerade nicht lesbar sind, bleiben unangetastet und
   * werden als `offline` gemeldet. Das ist der wichtigste Unterschied zum
   * flachen Ordnerscan von früher: Der Grundbestand liegt auf einem
   * Netzlaufwerk, und ein nicht eingehängtes Laufwerk sieht aus wie ein leerer
   * Ordner – ohne diese Prüfung gälte jedes Foto darin als gelöscht.
   */
  async importPhotos(limit?: number, nurQuellen?: readonly string[]): Promise<QuellenBericht> {
    const gesammelt: Photo[] = [];
    const offline: QuellenBericht['offline'] = [];
    const skippedVideos: string[] = [];
    const failed: { file: string; reason: string }[] = [];
    let rest = limit;

    for (const quelle of this.sources.list()) {
      // Nicht angefragt oder nicht lesbar: Der bisherige Bestand dieser Quelle
      // bleibt, wie er ist.
      if (nurQuellen && !nurQuellen.includes(quelle.id)) {
        gesammelt.push(...this.photosOfSource(quelle.id));
        continue;
      }
      if (!(await this.sources.erreichbar(quelle.id))) {
        const bestand = this.photosOfSource(quelle.id);
        gesammelt.push(...bestand);
        offline.push({ ...quelle, photoCount: bestand.length });
        continue;
      }

      const result = await importSource(quelle, this.decodes, rest);
      gesammelt.push(...result.photos);
      skippedVideos.push(...result.skippedVideos.map((f) => `${quelle.label}/${f}`));
      failed.push(...result.failed.map((f) => ({ ...f, file: `${quelle.label}/${f.file}` })));
      if (rest !== undefined) rest = Math.max(0, rest - result.photos.length);
    }

    // Über Quellen hinweg entscheidet wieder der Inhaltshash: Dasselbe Foto in
    // zwei Ordnern ist ein Foto, und es gehört zu der Quelle, die es zuerst
    // gemeldet hat. Sonst stünde dasselbe Bild zweimal im Pool.
    this.photos.clear();
    for (const photo of gesammelt.sort(nachAufnahme)) {
      if (!this.photos.has(photo.id)) this.photos.set(photo.id, photo);
    }

    this.skippedVideos = skippedVideos;
    this.failed = failed;
    this.importedAt = new Date().toISOString();
    return { offline };
  }

  /**
   * Liest die Bildquellen erneut ein, ohne das Buch anzutasten.
   *
   * Die Foto-Kennung ist der Inhaltshash, deshalb bleiben unveränderte Dateien
   * dieselben Fotos – auch wenn sie umbenannt, in einen Unterordner verschoben
   * oder in eine andere Quelle umgezogen wurden. Neue kommen hinzu,
   * verschwundene fehlen; die Doppelseiten bleiben stehen, wie sie sind.
   *
   * Bewusst ohne Neugenerieren: Ein Reimport ist meistens „ich habe zwanzig
   * Bilder nachgelegt", nicht „baue das Buch neu". Die neuen Fotos stehen danach
   * im Fotopool der Doppelseitenansicht und lassen sich von dort einsetzen. Wer
   * doch neu bauen will, ruft anschließend `generate()`.
   *
   * Korrekturen (`PhotoOverride`) bleiben in jedem Fall erhalten: Sie hängen an
   * der Kennung, nicht am Importergebnis.
   */
  async reimport(limit?: number, nurQuellen?: readonly string[]): Promise<ImportDiff> {
    const vorher = new Set(this.photos.keys());
    const { offline } = await this.importPhotos(limit, nurQuellen);
    const nachher = new Set(this.photos.keys());

    const neu = [...nachher].filter((id) => !vorher.has(id));
    const verschwunden = [...vorher].filter((id) => !nachher.has(id));

    // Fehlt ein Foto, das im Buch steht, bleibt die Doppelseite intakt und der
    // Platz wird als fehlendes Bild gemeldet – siehe `photo-missing` im RSM.
    const imBuch = new Set(this.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
    const imBuchVerschwunden = verschwunden.filter((id) => imBuch.has(id));

    this.rebuildStructure();
    return {
      neu,
      verschwunden,
      unveraendert: [...nachher].filter((id) => vorher.has(id)).length,
      imBuchVerschwunden,
      offline,
    };
  }

  /**
   * Wärmt die Vorschauen der genannten Fotos auf.
   *
   * Nach einem Reimport nötig, nicht bloß nett: Ohne sie erzeugt der Fotopool
   * jede Vorschau einzeln beim Scrollen, und bei ein paar hundert Nachzüglern
   * ruckelt genau die Ansicht, in der man sie einsetzen will.
   */
  warmPreviews(ids: readonly PhotoId[]): void {
    const photos = ids.map((id) => this.photos.get(id)).filter((p): p is Photo => p !== undefined);
    if (photos.length === 0) return;
    void this.previews.warm(photos, 'preview', 6);
  }

  /**
   * Handarbeit an den Doppelseiten, die ein Neugenerieren verwerfen würde.
   *
   * Gezählt, nicht geraten: Der Knopf „Neu anordnen" baut das Buch komplett neu,
   * und was dabei verloren geht, soll vorher dranstehen.
   */
  handwork(): {
    crops: number;
    neigungen: number;
    hintergruende: number;
    zeitstrahl: number;
    positionen: number;
  } {
    let crops = 0;
    let neigungen = 0;
    let hintergruende = 0;
    let zeitstrahl = 0;
    let positionen = 0;
    for (const spread of this.spreads) {
      crops += spread.slots.filter((sl) => sl.crop.mode === 'manual').length;
      // Zählt auch die ausdrücklich geradegestellten: Auch eine gesetzte 0 ist
      // eine Entscheidung, die der Neuaufbau verwirft.
      neigungen += spread.slots.filter((sl) => sl.rotateDeg !== undefined).length;
      positionen += spread.slots.filter((sl) => sl.rect !== undefined).length;
      if (spread.background !== undefined || spread.backgroundPhotoId !== undefined)
        hintergruende++;
      if (spread.timeline !== undefined) zeitstrahl++;
    }
    return { crops, neigungen, hintergruende, zeitstrahl, positionen };
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

  generate(): GenerateResult {
    this.rebuildStructure();
    const result = generateBook({
      structure: this.structure,
      photos: this.photos,
      profile: this.profile,
      targetPages: this.settings.targetPages,
      chapterOpeners: this.settings.chapterOpeners,
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
    this.groupStamp = this.groupFingerprint();
    return result;
  }

  // -------------------------------------------------------------- Gruppen

  /**
   * Erzeugt Gruppenvorschläge aus den aufgelösten Orten.
   *
   * Von Hand angelegte Gruppen bleiben unangetastet; frühere Umbenennungen und
   * Abschaltungen werden übernommen. Ein erneuter Aufruf darf nichts
   * überschreiben, was jemand eingerichtet hat.
   */
  suggestGroups(opts: { reset?: boolean } = {}): { groups: PhotoGroup[]; added: number } {
    // Beim vollständigen Neuaufbau werden auch von Hand angelegte Gruppen
    // verworfen. Nur auf ausdrückliche Anforderung – sonst gilt der schonende
    // Weg, der Bearbeitetes stehen lässt.
    if (opts.reset) this.groups = [];

    const kandidaten = [...this.photos.values()]
      .map((photo) => {
        const e = resolveEffectiveDate(photo, this.overrides[photo.id]);
        if (!e.value) return undefined;
        return {
          photoId: photo.id,
          date: e.value,
          ...(photo.place ? { place: photo.place } : {}),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    const mitOrt = propagatePlaces(kandidaten);

    const detection = {
      ...(this.settings.birthDate ? { birthDate: this.settings.birthDate } : {}),
      ...(this.settings.subjectName ? { name: this.settings.subjectName } : {}),
    };

    // Die Rangfolge der drei Quellen ist zugleich ihre Aussagekraft, und sie
    // entscheidet bei Überschneidung: Ein Kalenderanlass ist belegt, ein Ort
    // erschlossen, ein dichter Tag nur vermutet. Seit die Anlässe das Buch
    // beschriften, muss ihre Gruppe auch dann entstehen, wenn zufällig ein
    // Ortsname danebensteht – sonst stünde im Zeitstrahl „Bremerhaven“, wo
    // „Weihnachten 2019“ gemeint ist.
    const anlaesse = suggestOccasionGroups(mitOrt, { detection });
    const vergeben = new Set(anlaesse.flatMap((g) => g.photoIds));
    const orte = suggestPlaceGroups(mitOrt);
    for (const g of orte) for (const id of g.photoIds) vergeben.add(id);
    const tage = suggestDayGroups(mitOrt, { taken: vergeben, detection });

    const vorher = this.groups.length;
    this.groups = mergeSuggestions(this.groups, [...anlaesse, ...orte, ...tage]);
    return { groups: this.groups, added: this.groups.length - vorher };
  }

  /**
   * Fingerabdruck dessen, was an den Gruppen das Buch verändern kann.
   *
   * Ein Flag „Gruppen geändert“ in jeder der sieben Mutationen wäre die
   * naheliegende Lösung und die brüchigere: Die achte Stelle vergisst es. Der
   * Abdruck vergleicht stattdessen den Stand mit dem, aus dem das Buch gebaut
   * wurde, und kann gar nicht veralten. Nicht enthalten sind `origin` und
   * `reason` – sie sagen etwas über die Herkunft des Vorschlags, nicht über das
   * Buch.
   */
  private groupFingerprint(): string {
    const zeilen = [...this.groups]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((g) =>
        [
          g.id,
          g.active ? '1' : '0',
          g.opener === undefined ? '-' : g.opener ? '1' : '0',
          g.coverPhotoId ?? '-',
          g.title,
          g.photoIds.join(','),
        ].join('|'),
      );

    // FNV-1a: kurz, stabil und ohne Abhängigkeit. Kollisionen sind hier
    // folgenlos – im schlimmsten Fall bleibt ein Hinweis aus.
    let hash = 0x811c9dc5;
    const text = zeilen.join('\n');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
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
    return this.groupStamp !== undefined && this.groupStamp !== this.groupFingerprint();
  }

  /** Gruppen in Buchreihenfolge, also nach dem frühesten enthaltenen Foto. */
  sortedGroups(): PhotoGroup[] {
    const dateOf = (id: PhotoId) => {
      const photo = this.photos.get(id);
      if (!photo) return undefined;
      return resolveEffectiveDate(photo, this.overrides[id]).value ?? undefined;
    };
    return sortGroupsChronologically(this.groups, dateOf);
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

  /** Die Buchaufteilung als lesbares, bearbeitbares JSON. */
  exportLayout(): LayoutDocument {
    const platziert = new Set<PhotoId>();
    for (const spread of this.spreads) {
      for (const slot of spread.slots) if (slot.photoId) platziert.add(slot.photoId);
    }
    const unplaced = [...this.photos.keys()].filter((id) => !platziert.has(id));

    return exportLayout({
      spreads: this.spreads,
      photos: this.photos,
      profile: this.profile,
      settings: {
        targetPages: this.settings.targetPages,
        chapterOpeners: this.settings.chapterOpeners,
        timeline: this.settings.timeline,
        groupOpeners: this.settings.groupOpeners,
      },
      yearEvents: this.yearEvents,
      unplaced,
      groups: this.sortedGroups(),
    });
  }

  /**
   * Übernimmt ein von Hand bearbeitetes Layout.
   *
   * Vorlagen und Ausschnitte werden neu berechnet, weil sich beim Umhängen
   * regelmäßig die Zahl der Bilder je Doppelseite ändert. Was sich nicht
   * auflösen lässt, wird gemeldet statt stillschweigend verworfen.
   */
  applyLayout(raw: unknown): {
    ok: boolean;
    issues: LayoutIssue[];
    problems: { index: number; photoCount: number; message: string }[];
    spreadCount: number;
  } {
    const parsed = parseLayout(raw, this.photos);
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues, problems: [], spreadCount: 0 };
    }

    const rebuilt = rebuildSpreads({
      spreads: parsed.spreads,
      photos: this.photos,
      profile: this.profile,
      weightOf: (id) => this.overrides[id]?.weight ?? 'normal',
    });

    if (rebuilt.problems.length > 0) {
      // Doppelseiten ohne passende Vorlage würden verschwinden – das wäre ein
      // stiller Datenverlust. Lieber gar nichts übernehmen.
      return {
        ok: false,
        issues: parsed.issues,
        problems: rebuilt.problems,
        spreadCount: rebuilt.spreads.length,
      };
    }

    this.spreads = rebuilt.spreads;
    if (parsed.settings?.targetPages) this.settings.targetPages = parsed.settings.targetPages;
    if (parsed.settings?.chapterOpeners !== undefined) {
      this.settings.chapterOpeners = parsed.settings.chapterOpeners;
    }
    if (parsed.settings?.timeline !== undefined) this.settings.timeline = parsed.settings.timeline;
    if (parsed.settings?.groupOpeners !== undefined) {
      this.settings.groupOpeners = parsed.settings.groupOpeners;
    }
    // Ereignisse dürfen im Dokument bearbeitet werden. Sie wirken erst beim
    // nächsten Erzeugen, weil sie auf der Auftaktseite stehen, die der
    // Neuaufbau nicht anfasst.
    if (parsed.yearEvents) this.yearEvents = parsed.yearEvents;

    return { ok: true, issues: parsed.issues, problems: [], spreadCount: rebuilt.spreads.length };
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

    // Geklemmt statt abgewiesen, und auf ein Zehntelgrad gerundet wie die
    // Automatik: Ein von Hand übernommener Wert soll dem berechneten exakt
    // entsprechen und nicht um 0,03° daneben liegen.
    const begrenzt = Math.min(MAX_TILT_DEG, Math.max(-MAX_TILT_DEG, deg));
    slot.rotateDeg = Math.round(begrenzt * 10) / 10;
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

  /**
   * Setzt eine andere Vorlage für eine Doppelseite.
   *
   * Die Fotos bleiben dieselben und werden den neuen Plätzen zugeordnet – nach
   * Passung, nicht nach ihrer bisherigen Reihenfolge. Hat die Vorlage weniger
   * Plätze, wandern die überzähligen Bilder in den Pool; hat sie mehr, bleiben
   * Plätze leer. Beides ist erlaubt, denn genau darum geht es beim Wechsel von
   * Hand: Man will die Seite anders aufteilen, nicht dieselbe Aufteilung mit
   * anderen Kanten.
   */
  setSpreadTemplate(
    index: number,
    templateId: string,
  ): { ok: boolean; error?: string; leftover: PhotoId[] } {
    const spread = this.spreads[index];
    if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', leftover: [] };
    if (!templateById(templateId)) {
      return { ok: false, error: `Vorlage ${templateId} gibt es nicht`, leftover: [] };
    }

    const photos = spread.slots
      .map((s) => (s.photoId ? this.photos.get(s.photoId) : undefined))
      .filter((p): p is Photo => p !== undefined);

    const angeordnet = layoutSpread({
      photos,
      profile: this.profile,
      templateId,
      weightOf: (id) => this.overrides[id]?.weight ?? 'normal',
    });
    if (!angeordnet) {
      return { ok: false, error: `Vorlage ${templateId} lässt sich nicht anwenden`, leftover: [] };
    }

    spread.templateId = angeordnet.templateId;
    spread.slots = angeordnet.slots;
    this.refreshReport();
    return { ok: true, leftover: angeordnet.leftover };
  }

  /**
   * Die Anordnungen, unter denen eine einzelne Seite wählen kann.
   *
   * Der Vorlagenwechsel betrifft sonst beide Seiten, und das hilft nicht: Man
   * will die eine Seite ändern, auf der das Bild falsch steht. Zurückgegeben
   * werden alle Halbseiten in Linksform samt Slotgeometrie; für die rechte
   * Seite spiegelt sie die Oberfläche beim Zeichnen, so wie es die Engine beim
   * Zusammensetzen tut.
   */
  halfChoices(index: number): {
    halves: {
      id: string;
      slotCount: number;
      slots: { x: number; y: number; w: number; h: number }[];
    }[];
    current: { left?: string; right?: string };
    /** Bilder auf der linken und rechten Seite dieser Doppelseite. */
    counts: { left: number; right: number };
  } {
    const spread = this.spreads[index];
    if (!spread) return { halves: [], current: {}, counts: { left: 0, right: 0 } };

    const template = templateById(spread.templateId);
    const belegt = (pruefe: (x: number, w: number) => boolean) =>
      (template?.slots ?? []).filter((s, i) => pruefe(s.x, s.w) && spread.slots[i]?.photoId).length;

    return {
      halves: halfPages().map((h) => ({
        id: h.id,
        slotCount: h.slots.length,
        slots: h.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
      })),
      current: template ? halvesOfTemplate(template) : {},
      counts: {
        left: belegt((x, w) => x + w <= 0.5001),
        right: belegt((x) => x >= 0.4999),
      },
    };
  }

  /**
   * Die Vorlagen, unter denen eine Doppelseite wählen kann.
   *
   * Nach Bilderzahl sortiert und mit der Slotgeometrie, damit die Oberfläche
   * jede Anordnung als Skizze zeigen kann statt als Kennung. Vorlagen mit
   * Überschriftenstreifen bleiben draußen, solange die Seite keinen Text trägt –
   * der Streifen bliebe leer und die Bilder stünden kleiner.
   */
  templateChoices(index: number): {
    id: string;
    name: string;
    slotCount: number;
    slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
    current: boolean;
  }[] {
    const spread = this.spreads[index];
    if (!spread) return [];

    const hatText = (spread.texts ?? []).length > 0;
    const belegt = spread.slots.filter((s) => s.photoId).length;
    const meta = templateMeta(spread.templateId);

    // Kapitelauftakte und Gruppenauftakte bleiben unter sich: Ihre Vorlagen
    // tragen Text und werden gezielt vergeben, nicht über die Slotzahl gefunden.
    const auswahl = meta.chapterOnly
      ? chapterTemplates().filter((t) => t.slots.length > 0)
      : allTemplates().filter((t) => {
          const m = templateMeta(t.id);
          if (m.chapterOnly || t.tags?.includes('veraltet')) return false;
          if (!hatText && t.tags?.includes('mit-titel')) return false;
          return true;
        });

    return auswahl
      .map((t) => ({
        id: t.id,
        name: t.name,
        slotCount: t.slots.length,
        slots: t.slots.map((s) => ({
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          ...(s.bleed ? { bleed: true } : {}),
        })),
        current: t.id === spread.templateId,
      }))
      .sort(
        (a, b) =>
          Math.abs(a.slotCount - belegt) - Math.abs(b.slotCount - belegt) ||
          a.slotCount - b.slotCount ||
          a.id.localeCompare(b.id),
      );
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

  /**
   * Seitenzahl des Innenteils – und damit die Rückenbreite.
   *
   * Jede Doppelseite sind zwei Seiten. Solange die endgültige Seitenzahl nicht
   * feststeht (#4), ändert sich mit jedem Neuaufbau auch das Cover; deshalb
   * wird es nie gespeichert, sondern immer neu gerechnet.
   */
  pageCount(): number {
    return this.spreads.length * 2;
  }

  /**
   * Das Cover mit den Vorgaben aus dem Projekt.
   *
   * Der Titel ist der Name des Kindes, der Untertitel der Zeitraum des
   * Bestands, der Rückentitel beides zusammen – die schlichteste Fassung, die
   * ein Buchrücken im Regal überhaupt braucht. Alles davon ist überschreibbar;
   * gespeicherte Werte haben Vorrang.
   */
  coverDesign(): CoverDesign {
    const jahre = this.structure.chapters.map((c) => c.year).sort((a, b) => a - b);
    const von = jahre[0];
    const bis = jahre[jahre.length - 1];
    const zeitraum = von === undefined ? undefined : von === bis ? `${von}` : `${von} – ${bis}`;
    const titel = this.settings.subjectName ?? 'Fotobuch';
    const vorschlag = this.coverCandidates(1)[0];

    return {
      title: titel,
      ...(zeitraum ? { subtitle: zeitraum } : {}),
      spineText: zeitraum ? `${titel} · ${zeitraum}` : titel,
      // Ein Titelbild wird vorbelegt, damit der Umschlag ohne Eingabe
      // druckbar ist. Der Benutzer wählt in der Coveransicht ein anderes.
      ...(vorschlag ? { frontPhotoId: vorschlag.photoId } : {}),
      ...this.cover,
    };
  }

  renderCover(): RenderedCover {
    return renderCover(this.coverDesign(), {
      profile: this.profile,
      pageCount: this.pageCount(),
      photos: this.photos,
    });
  }

  /** Übernimmt Änderungen am Umschlag. Leerer Text löscht das Feld. */
  updateCover(patch: Partial<CoverDesign>): CoverDesign {
    const naechste: CoverDesign = { ...this.cover, ...patch };
    for (const key of ['title', 'subtitle', 'spineText', 'backText'] as const) {
      if (naechste[key] === '') delete naechste[key];
    }
    this.cover = naechste;
    return this.coverDesign();
  }

  /**
   * Bilder, die als Titelbild in Frage kommen.
   *
   * Die Hauptbilder der aktiven Fotogruppen zuerst: Sie sind vom Benutzer
   * bestätigt und damit die beste Auswahl, die das Projekt kennt. Erst wenn es
   * keine gibt, wird auf die ersten Bilder der Doppelseiten zurückgefallen.
   */
  coverCandidates(limit = 24): { photoId: PhotoId; label: string }[] {
    const kandidaten: { photoId: PhotoId; label: string }[] = [];
    const gesehen = new Set<PhotoId>();

    const nimm = (id: PhotoId | null | undefined, label: string): void => {
      if (!id || gesehen.has(id) || !this.photos.has(id)) return;
      gesehen.add(id);
      kandidaten.push({ photoId: id, label });
    };

    for (const g of this.sortedGroups()) {
      if (!g.active) continue;
      nimm(g.coverPhotoId ?? g.photoIds[0], g.title);
    }
    for (const [i, spread] of this.spreads.entries()) {
      if (kandidaten.length >= limit) break;
      nimm(spread.slots.find((s) => s.photoId)?.photoId, `Doppelseite ${i + 1}`);
    }

    return kandidaten.slice(0, limit);
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

  /**
   * Wo im Buch beginnt welche Gruppe?
   *
   * Für die Übersicht: Sie markiert die erste Doppelseite jeder Gruppe, so wie
   * sie es für die Jahre tut.
   */
  groupMarks(): { spreadIndex: number; id: string; title: string }[] {
    const marks: { spreadIndex: number; id: string; title: string }[] = [];
    for (const [id, spreadIndex] of this.firstSpreadOfGroup()) {
      // Nur was das Buch gliedert: Der abgeschaltete Wohnort käme sonst als
      // Marke über die halbe Übersicht.
      const gruppe = this.groups.find((g) => g.id === id);
      if (gruppe?.active) marks.push({ spreadIndex, id, title: gruppe.title });
    }
    return marks.sort((a, b) => a.spreadIndex - b.spreadIndex);
  }

  /**
   * Erste Doppelseite jeder Gruppe, an ihrer Kennung.
   *
   * Auch abgeschaltete Gruppen sind dabei: Sie gliedern das Buch zwar nicht,
   * ihre Fotos stehen aber darin, und die Gruppenansicht soll auch zu ihnen
   * sagen können, wo man sie findet. Gruppen ohne Foto im Buch fehlen – ihre
   * Bilder liegen im Pool.
   */
  firstSpreadOfGroup(): Map<string, number> {
    const gruppeVon = new Map<PhotoId, string>();
    for (const g of this.groups) {
      for (const id of g.photoIds) if (!gruppeVon.has(id)) gruppeVon.set(id, g.id);
    }

    const erste = new Map<string, number>();
    this.spreads.forEach((spread, i) => {
      const bilder = [
        ...spread.slots.map((s) => s.photoId),
        ...(spread.backgroundPhotoId ? [spread.backgroundPhotoId] : []),
      ];
      for (const photoId of bilder) {
        if (!photoId) continue;
        const gruppenId = gruppeVon.get(photoId);
        if (gruppenId !== undefined && !erste.has(gruppenId)) erste.set(gruppenId, i);
      }
    });

    return erste;
  }

  /**
   * Die Gruppen einer Doppelseite, die stärkste zuerst.
   *
   * Dieselbe Rangfolge wie beim Zeitstrahl-Label: Die Gruppe mit den meisten
   * Fotos benennt die Seite. Die Oberfläche zeigt sie deshalb an erster Stelle
   * und kann von dort in die Gruppenansicht springen – bislang war nicht
   * erkennbar, woher ein Name auf einer Doppelseite stammt.
   */
  spreadGroups(index: number): { id: string; title: string; active: boolean; count: number }[] {
    const spread = this.spreads[index];
    if (!spread) return [];

    const gruppeVon = new Map<PhotoId, PhotoGroup>();
    for (const g of this.groups) {
      for (const id of g.photoIds) if (!gruppeVon.has(id)) gruppeVon.set(id, g);
    }

    const zaehler = new Map<string, { group: PhotoGroup; count: number }>();
    for (const slot of spread.slots) {
      if (!slot.photoId) continue;
      const group = gruppeVon.get(slot.photoId);
      if (!group) continue;
      const bestand = zaehler.get(group.id);
      if (bestand) bestand.count++;
      else zaehler.set(group.id, { group, count: 1 });
    }

    return [...zaehler.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ group, count }) => ({
        id: group.id,
        title: group.title,
        active: group.active,
        count,
      }));
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
   * Schreibt atomar: erst in eine Nebendatei, dann umbenennen. Damit kann ein
   * Absturz mitten im Schreiben kein halbes Projekt hinterlassen.
   */
  async save(): Promise<void> {
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

    await mkdir(this.projectPath, { recursive: true });
    const target = join(this.projectPath, 'project.json');
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, target);
  }

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
