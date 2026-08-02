/**
 * Projektzustand.
 *
 * Hält Fotos, Struktur und Buch im Speicher und schreibt sie atomar auf
 * Platte. Die Originaldateien werden ausschließlich gelesen.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Chapter,
  type DateContext,
  type GenerateResult,
  type LayoutDocument,
  type LayoutIssue,
  type NaiveDateTime,
  type Photo,
  type PhotoId,
  type PhotoGroup,
  type PhotoOverride,
  type PrintProfile,
  type RenderedSpread,
  type Spread,
  type Structure,
  allSegments,
  buildStructure,
  defaultProfile,
  exportLayout,
  findBulkSeconds,
  generateBook,
  addToGroup,
  createGroup,
  mergeGroups,
  mergeSuggestions,
  needsAttention,
  parseLayout,
  propagatePlaces,
  rebuildSpreads,
  renderSpread,
  requireTemplate,
  resolveEffectiveDate,
  sortKey,
  removeGroup,
  sortGroupsChronologically,
  suggestDayGroups,
  suggestPlaceGroups,
  suggestTitles,
  ungroupPhotos,
  updateGroup,
} from '@franibook/core';
import type { DecodeCache } from './decode.js';
import { importFolder } from './import.js';
import type { PreviewCache } from './previews.js';

const SCHEMA_VERSION = 1;

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
  seed: number;
  /** Für die Geburtstagserkennung und die Plausibilitätsprüfung. */
  birthDate?: string;
  subjectName?: string;
}

interface PersistedProject {
  schemaVersion: number;
  sourceRoot: string;
  settings: ProjectSettings;
  photos: Photo[];
  overrides: Record<PhotoId, PhotoOverride>;
  book: { spreads: Spread[] };
  groups: PhotoGroup[];
  yearEvents?: Record<string, string[]>;
  importedAt: string;
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
    readonly sourceRoot: string,
    readonly previews: PreviewCache,
    readonly decodes: DecodeCache,
    private readonly projectPath: string,
  ) {}

  // ---------------------------------------------------------------- Import

  async importPhotos(limit?: number): Promise<void> {
    const result = await importFolder(this.sourceRoot, this.decodes, limit);
    this.photos.clear();
    for (const p of result.photos) this.photos.set(p.id, p);
    this.skippedVideos = result.skippedVideos;
    this.failed = result.failed;
    this.importedAt = new Date().toISOString();
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

    const structure = buildStructure(
      dated.map((d) => ({ id: d.id, date: d.date })),
      undated,
    );

    // Titelvorschläge einarbeiten
    const titled = suggestTitles(allSegments(structure), {
      ...(this.settings.birthDate ? { birthDate: this.settings.birthDate } : {}),
      ...(this.settings.subjectName ? { name: this.settings.subjectName } : {}),
    });
    const byId = new Map(titled.map((s) => [s.id, s]));
    for (const chapter of structure.chapters) {
      chapter.segments = chapter.segments.map((s) => byId.get(s.id) ?? s);
    }

    this.structure = structure;
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
      yearEvents: Object.fromEntries(
        Object.entries(this.yearEvents).map(([jahr, zeilen]) => [Number(jahr), zeilen]),
      ),
    });
    this.spreads = result.spreads;
    this.lastReport = result.report;
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

    // Zuerst die Orte: Ein Ortsname sagt mehr als ein Datum. Was dabei keiner
    // Gruppe zufällt, wird anschließend nach Tagen geprüft – wer an einem Tag
    // mehr als zwei Fotos macht, war meist bei etwas.
    const orte = suggestPlaceGroups(mitOrt);
    const vergeben = new Set(orte.flatMap((g) => g.photoIds));
    const tage = suggestDayGroups(mitOrt, {
      taken: vergeben,
      detection: {
        ...(this.settings.birthDate ? { birthDate: this.settings.birthDate } : {}),
        ...(this.settings.subjectName ? { name: this.settings.subjectName } : {}),
      },
    });

    const vorher = this.groups.length;
    this.groups = mergeSuggestions(this.groups, [...orte, ...tage]);
    return { groups: this.groups, added: this.groups.length - vorher };
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

  // -------------------------------------------------------------- Rendern

  render(index: number): RenderedSpread | undefined {
    const spread = this.spreads[index];
    if (!spread) return undefined;
    return renderSpread(spread, {
      profile: this.profile,
      template: requireTemplate(spread.templateId),
      photos: this.photos,
      ...(this.settings.timeline ? { timeline: this.timelineContext(index) } : {}),
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
    return {
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
  groupMarks(): { spreadIndex: number; title: string }[] {
    const gruppeVon = new Map<PhotoId, string>();
    for (const g of this.groups) {
      if (!g.active) continue;
      for (const id of g.photoIds) gruppeVon.set(id, g.title);
    }

    const marks: { spreadIndex: number; title: string }[] = [];
    const gesehen = new Set<string>();

    this.spreads.forEach((spread, i) => {
      for (const slot of spread.slots) {
        if (!slot.photoId) continue;
        const titel = gruppeVon.get(slot.photoId);
        if (titel && !gesehen.has(titel)) {
          gesehen.add(titel);
          marks.push({ spreadIndex: i, title: titel });
          return;
        }
      }
    });

    return marks;
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
      sourceRoot: this.sourceRoot,
      settings: this.settings,
      photos: [...this.photos.values()],
      overrides: this.overrides,
      groups: this.groups,
      yearEvents: this.yearEvents,
      book: { spreads: this.spreads },
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
    try {
      const raw = await readFile(join(this.projectPath, 'project.json'), 'utf8');
      const data = JSON.parse(raw) as PersistedProject;

      if (data.schemaVersion !== SCHEMA_VERSION) {
        // Migrationen kommen in Phase 7; bis dahin lieber neu importieren als
        // ein unbekanntes Format falsch zu deuten.
        return false;
      }

      this.photos.clear();
      for (const p of data.photos) this.photos.set(p.id, p);
      this.overrides = data.overrides ?? {};
      this.groups = data.groups ?? [];
      this.yearEvents = data.yearEvents ?? {};
      this.spreads = data.book?.spreads ?? [];
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
