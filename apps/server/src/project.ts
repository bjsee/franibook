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
  suggestPlaceGroups,
  suggestTitles,
  ungroupPhotos,
  updateGroup,
} from '@franibook/core';
import { importFolder } from './import.js';
import type { PreviewCache } from './previews.js';

const SCHEMA_VERSION = 1;

export interface ProjectSettings {
  targetPages: number;
  chapterOpeners: boolean;
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
    targetPages: 200,
    chapterOpeners: true,
    seed: 1,
  };

  skippedVideos: string[] = [];
  failed: { file: string; reason: string }[] = [];
  importedAt = new Date().toISOString();

  constructor(
    readonly sourceRoot: string,
    readonly previews: PreviewCache,
    private readonly projectPath: string,
  ) {}

  // ---------------------------------------------------------------- Import

  async importPhotos(limit?: number): Promise<void> {
    const result = await importFolder(this.sourceRoot, limit);
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
  suggestGroups(): { groups: PhotoGroup[]; added: number } {
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
    const vorschlaege = suggestPlaceGroups(mitOrt);
    const vorher = this.groups.length;

    this.groups = mergeSuggestions(this.groups, vorschlaege);
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

  updateGroup(
    id: string,
    patch: Partial<Pick<PhotoGroup, 'title' | 'coverPhotoId' | 'active' | 'photoIds'>>,
  ): PhotoGroup[] {
    this.groups = updateGroup(this.groups, id, patch);
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
      },
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
    });
  }

  renderAll(): RenderedSpread[] {
    return this.spreads.map((_, i) => this.render(i)).filter((s): s is RenderedSpread => !!s);
  }

  photo(id: PhotoId): Photo | undefined {
    return this.photos.get(id);
  }

  /** Fotos mit Datumsangabe und Befunden, für Timeline und Problemliste. */
  photoViews(onlyProblems = false): PhotoView[] {
    const bulkSeconds = findBulkSeconds([...this.photos.values()]);
    const ctx = {
      importedAt: this.importedAt.slice(0, 19) as NaiveDateTime,
      bulkSeconds,
      ...(this.settings.birthDate
        ? { earliestPlausible: `${this.settings.birthDate}T00:00:00` as NaiveDateTime }
        : {}),
    };

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
