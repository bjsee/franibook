/**
 * Layout-Dokument: die Buchaufteilung als lesbares, von Hand bearbeitbares JSON.
 *
 * Entwurfsgedanke: Das Dokument beschreibt, **welche Fotos auf welcher
 * Doppelseite** stehen – nicht, in welchem Slot. Denn sobald jemand ein Bild
 * von einer Doppelseite auf eine andere verschiebt, passt die Slotzahl nicht
 * mehr zum bisherigen Template. Die Engine wählt es beim Einlesen neu, sofern
 * es nicht ausdrücklich festgehalten wurde.
 *
 * Damit reduziert sich „Bild umhängen" auf: Zeile ausschneiden, woanders
 * einfügen. Alles Weitere rechnet die Engine nach.
 *
 * Die Metadaten an jedem Bild (Datum, Ort, Pixelmaße, Auflösung) sind
 * ausschließlich Orientierungshilfe. Beim Einlesen wird nur `file` ausgewertet;
 * alles andere darf veraltet oder gelöscht sein.
 */
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import { templateById } from '../templates/index.js';
import { slotCost, slotGeometry } from './scoring.js';

export const LAYOUT_DOCUMENT_VERSION = 1;

export interface LayoutPhotoEntry {
  /** Dateiname – die maßgebliche Referenz. Alles andere ist Beiwerk. */
  file: string;
  /** Aufnahmedatum, `YYYY-MM-DD HH:mm`. */
  date?: string;
  /** Koordinaten als `Breite, Länge`. */
  gps?: string;
  /** Kartenlink zu den Koordinaten. */
  map?: string;
  camera?: string;
  /** Pixelmaße als `Breite×Höhe`. */
  px?: string;
  /** Auflösung, mit der dieses Bild an dieser Stelle gedruckt würde. */
  dpi?: number;
  /** Hinweis, wenn mit diesem Bild etwas nicht stimmt. */
  warn?: string;
}

export interface LayoutGroupEntry {
  id: string;
  title: string;
  /** Ob die Gruppe das Buch gliedert. */
  active: boolean;
  /** Dateiname des Hauptbilds, sofern eines gewählt wurde. */
  cover?: string;
  photoCount: number;
}

export interface LayoutSpreadEntry {
  /** Fortlaufende Nummer, nur zur Orientierung. Beim Einlesen zählt die Reihenfolge. */
  n: number;
  /**
   * Vorlage. Weglassen oder auf `"auto"` setzen, damit die Engine sie neu
   * wählt – nötig, sobald sich die Zahl der Bilder ändert.
   */
  template?: string;
  /** Jahreszahl oder Titel, sofern die Vorlage einen Textplatz hat. */
  text?: string;
  /** Fotogruppe, zu der diese Doppelseite gehört. */
  group?: string;
  /**
   * Zeitstrahl auf dieser Doppelseite. Steht nur da, wenn er von der globalen
   * Vorgabe abweicht – ein Dokument voller `timeline: true` wäre nur Rauschen.
   */
  timeline?: boolean;
  /** Hintergrundfarbe als Hexwert, sofern eine gesetzt ist. */
  background?: string;
  /**
   * Kennung einer festgehaltenen Doppelseite – einer selbst gebauten Seite.
   *
   * Sie wird beim Einlesen nicht neu gerechnet, sondern unverändert übernommen:
   * Vorlage, Textblöcke, Ausschnitte, alles. Umsortieren und Löschen bleiben
   * möglich, denn dafür zählt allein, wo (und ob) die Zeile im Dokument steht.
   *
   * Ihr Inhalt steht bewusst nicht im Dokument. Ein Textblock hat Kasten,
   * Winkel, Schriftgröße und Farbe; das alles hier zu spiegeln, hieße es an zwei
   * Stellen pflegen – und die Seite wäre dennoch nicht von Hand gestaltbar.
   */
  keep?: string;
  photos: LayoutPhotoEntry[];
}

export interface LayoutDocument {
  version: number;
  _hinweise: string[];
  profile: string;
  settings: {
    targetPages: number;
    chapterOpeners: boolean;
    /** Ob der Jahresauftakt auch auf der Jahresseite Bilder trägt. */
    chapterOpenersDense: boolean;
    /** Zeitstrahl am Fuß jeder Doppelseite. */
    timeline: boolean;
    /** Auftaktseite je Fotogruppe. `"auto"` ist das Gegenteil von `timeline`. */
    groupOpeners: boolean | 'auto';
  };
  summary: {
    spreads: number;
    pages: number;
    photos: number;
    photosPerSpread: number;
  };
  /**
   * Ereignisse je Jahr, wie sie auf dem Kapitelauftakt stehen.
   *
   * Von Hand zu pflegen: Schlüssel ist das Jahr, Wert eine Liste von Zeilen.
   */
  yearEvents?: Record<string, string[]>;
  /** Benannte Fotogruppen. Sie gliedern das Buch, sofern aktiv. */
  groups: LayoutGroupEntry[];
  spreads: LayoutSpreadEntry[];
  /** Fotos, die in keiner Doppelseite vorkommen. */
  unplaced: LayoutPhotoEntry[];
}

const HINWEISE = [
  'Buchaufteilung von Franibook. Diese Datei darf von Hand bearbeitet werden.',
  '',
  'Bild umhängen: die Zeile unter "photos" ausschneiden und bei einer anderen',
  'Doppelseite einfügen. Maßgeblich ist allein "file"; Datum, Ort und Auflösung',
  'sind Orientierungshilfe und werden beim Einlesen ignoriert.',
  '',
  'Ändert sich die Zahl der Bilder einer Doppelseite, passt die bisherige',
  'Vorlage nicht mehr. Setze "template" dann auf "auto" oder lösche die Zeile –',
  'die Engine wählt eine passende. Ein stehengelassener Wert wird beibehalten,',
  'sofern die Slotzahl noch stimmt.',
  '',
  'Doppelseiten dürfen ergänzt, gelöscht und umsortiert werden. Die Nummern "n"',
  'werden beim Einlesen neu vergeben.',
  '',
  'Eine Doppelseite mit "keep" ist selbst gebaut und wird unverändert übernommen –',
  'ihre Vorlage, Textblöcke und Ausschnitte stehen nicht in dieser Datei. Verschiebe',
  'die Zeile, um die Seite anderswohin zu setzen, lösche sie, um die Seite aus dem',
  'Buch zu nehmen. Ihre "photos" sind Orientierungshilfe wie überall.',
  '',
  'Fotos unter "unplaced" sind derzeit nicht im Buch – meist, weil ihnen ein',
  'Aufnahmedatum fehlt. Verschiebe sie in eine Doppelseite, um sie aufzunehmen.',
];

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}

function formatGps(photo: Photo): { gps?: string; map?: string } {
  if (!photo.gps) return {};
  const { lat, lon } = photo.gps;
  return {
    gps: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    // Ein Kartenlink ist konkreter als Koordinaten. Ein Ortsname wäre besser,
    // steht aber in keinem einzigen Foto dieses Bestands – dafür bräuchte es
    // einen Offline-Geocoder, siehe Konzept.
    map: `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=15/${lat.toFixed(4)}/${lon.toFixed(4)}`,
  };
}

function photoEntry(photo: Photo, extras: { dpi?: number; warn?: string } = {}): LayoutPhotoEntry {
  const date = formatDate(photo.takenAt ?? photo.secondaryDate);
  return {
    file: photo.fileName,
    ...(date ? { date } : {}),
    ...formatGps(photo),
    ...(photo.camera ? { camera: photo.camera } : {}),
    px: `${photo.width}×${photo.height}`,
    ...(extras.dpi !== undefined ? { dpi: Math.round(extras.dpi) } : {}),
    ...(extras.warn ? { warn: extras.warn } : {}),
  };
}

export interface ExportOptions {
  spreads: readonly Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  settings: {
    targetPages: number;
    chapterOpeners: boolean;
    chapterOpenersDense: boolean;
    timeline: boolean;
    groupOpeners: boolean | 'auto';
  };
  /** Fotos, die in keiner Doppelseite stehen. */
  unplaced?: readonly PhotoId[];
  /** Ereignisse je Jahr, zur Bearbeitung im Dokument. */
  yearEvents?: Record<string, string[]>;
  /** Benannte Fotogruppen, zur Orientierung im Dokument. */
  groups?: readonly {
    id: string;
    title: string;
    active: boolean;
    photoIds: readonly PhotoId[];
    coverPhotoId?: PhotoId;
  }[];
}

/** Erzeugt das Layout-Dokument aus der aktuellen Buchstruktur. */
export function exportLayout(opts: ExportOptions): LayoutDocument {
  const { spreads, photos, profile, settings } = opts;

  // Welche Gruppe gehört zu welchem Foto? Damit trägt jede Doppelseite ihren
  // Gruppennamen und man sieht beim Bearbeiten sofort, was zusammengehört.
  const gruppeVon = new Map<PhotoId, string>();
  for (const g of opts.groups ?? []) {
    for (const id of g.photoIds) gruppeVon.set(id, g.title);
  }

  const entries: LayoutSpreadEntry[] = spreads.map((spread, i) => {
    const template = templateById(spread.templateId);
    const photoEntries: LayoutPhotoEntry[] = [];

    for (const assignment of spread.slots) {
      if (!assignment.photoId) continue;
      const photo = photos.get(assignment.photoId);
      if (!photo) continue;

      const slot = template?.slots.find((s) => s.id === assignment.slotId);
      let dpi: number | undefined;
      let warn: string | undefined;

      if (slot) {
        const cost = slotCost(photo, slot, slotGeometry(slot, profile), {
          profile,
          weightOf: () => 'normal',
        });
        dpi = cost.dpi;
        if (cost.dpi < profile.resolution.minDpi) {
          warn = `nur ${Math.round(cost.dpi)} dpi – unter der Mindestauflösung von ${profile.resolution.minDpi}`;
        }
      }

      photoEntries.push(
        photoEntry(photo, { ...(dpi !== undefined ? { dpi } : {}), ...(warn ? { warn } : {}) }),
      );
    }

    const text = spread.texts?.[0]?.content;

    // Nur wenn alle Bilder derselben Gruppe angehören
    const gruppen = new Set(
      spread.slots.map((s) => (s.photoId ? gruppeVon.get(s.photoId) : undefined)).filter(Boolean),
    );
    const group = gruppen.size === 1 ? [...gruppen][0] : undefined;

    return {
      n: i + 1,
      template: spread.templateId,
      ...(spread.locked ? { keep: spread.id } : {}),
      ...(text ? { text } : {}),
      ...(group ? { group } : {}),
      ...(spread.timeline !== undefined ? { timeline: spread.timeline } : {}),
      ...(spread.background !== undefined ? { background: spread.background } : {}),
      photos: photoEntries,
    };
  });

  const placed = entries.reduce((n, e) => n + e.photos.length, 0);

  return {
    version: LAYOUT_DOCUMENT_VERSION,
    _hinweise: HINWEISE,
    profile: profile.id,
    settings,
    summary: {
      spreads: entries.length,
      pages: entries.length * 2,
      photos: placed,
      photosPerSpread: entries.length > 0 ? Number((placed / entries.length).toFixed(1)) : 0,
    },
    ...(opts.yearEvents && Object.keys(opts.yearEvents).length > 0
      ? { yearEvents: opts.yearEvents }
      : {}),
    groups: (opts.groups ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      active: g.active,
      ...(g.coverPhotoId ? { cover: photos.get(g.coverPhotoId)?.fileName ?? g.coverPhotoId } : {}),
      photoCount: g.photoIds.length,
    })),
    spreads: entries,
    unplaced: (opts.unplaced ?? [])
      .map((id) => photos.get(id))
      .filter((p): p is Photo => p !== undefined)
      .map((p) => photoEntry(p)),
  };
}

// ---------------------------------------------------------------- Einlesen

export interface LayoutIssue {
  severity: 'error' | 'warning';
  /** Doppelseite, auf die sich der Befund bezieht. */
  spread?: number;
  message: string;
}

export interface ParsedLayout {
  /** Je Doppelseite die Fotokennungen in der gewünschten Reihenfolge. */
  spreads: {
    photoIds: PhotoId[];
    templateId?: string;
    text?: string;
    timeline?: boolean;
    background?: string;
    /**
     * Kennung einer festgehaltenen Doppelseite.
     *
     * Nur die Kennung: Was sie enthält, weiß allein der Projektstand. Ihn
     * kennt diese Datei nicht, und deshalb löst der Aufrufer sie auf.
     */
    keepId?: string;
  }[];
  settings?: {
    targetPages?: number;
    chapterOpeners?: boolean;
    chapterOpenersDense?: boolean;
    timeline?: boolean;
    groupOpeners?: boolean | 'auto';
  };
  /** Ereignisse je Jahr, sofern im Dokument angegeben. */
  yearEvents?: Record<string, string[]>;
  issues: LayoutIssue[];
  /** Ob das Dokument übernommen werden kann. */
  ok: boolean;
}

/**
 * Liest ein bearbeitetes Layout-Dokument ein und prüft es.
 *
 * Fehlerhafte Angaben führen nicht dazu, dass alles verworfen wird: Was sich
 * auflösen lässt, wird übernommen, der Rest gemeldet. Nur strukturelle Fehler
 * – kaputtes JSON, fehlende Doppelseitenliste – blockieren.
 */
export function parseLayout(raw: unknown, photos: ReadonlyMap<PhotoId, Photo>): ParsedLayout {
  const issues: LayoutIssue[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return {
      spreads: [],
      issues: [{ severity: 'error', message: 'Kein JSON-Objekt.' }],
      ok: false,
    };
  }

  const doc = raw as Partial<LayoutDocument>;

  if (doc.version !== undefined && doc.version !== LAYOUT_DOCUMENT_VERSION) {
    issues.push({
      severity: 'warning',
      message: `Dokumentversion ${doc.version}, erwartet ${LAYOUT_DOCUMENT_VERSION}. Wird trotzdem versucht.`,
    });
  }

  if (!Array.isArray(doc.spreads)) {
    return {
      spreads: [],
      issues: [{ severity: 'error', message: 'Feld "spreads" fehlt oder ist keine Liste.' }],
      ok: false,
    };
  }

  // Dateiname → Kennung. Der Dateiname ist die Referenz im Dokument, weil er
  // lesbar ist; intern arbeitet alles mit dem Inhaltshash.
  const byFileName = new Map<string, PhotoId>();
  for (const photo of photos.values()) {
    byFileName.set(photo.fileName, photo.id);
    byFileName.set(photo.fileName.toLowerCase(), photo.id);
  }

  const seen = new Map<PhotoId, number[]>();
  const spreads: ParsedLayout['spreads'] = [];

  doc.spreads.forEach((entry, i) => {
    const nummer = i + 1;

    if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.photos)) {
      issues.push({
        severity: 'error',
        spread: nummer,
        message: 'Doppelseite ohne gültige "photos"-Liste.',
      });
      return;
    }

    // Eine festgehaltene Seite wird nicht gerechnet, sondern übernommen. Sie
    // darf deshalb ohne Bilder auskommen – eine selbst gebaute Titelseite
    // besteht oft aus nichts als Text.
    const keep = typeof entry.keep === 'string' && entry.keep.length > 0 ? entry.keep : undefined;

    const photoIds: PhotoId[] = [];

    for (const p of entry.photos) {
      const file = typeof p === 'string' ? p : (p as LayoutPhotoEntry)?.file;
      if (typeof file !== 'string' || file.length === 0) {
        issues.push({ severity: 'error', spread: nummer, message: 'Eintrag ohne "file".' });
        continue;
      }

      const id = byFileName.get(file) ?? byFileName.get(file.toLowerCase());
      if (!id) {
        issues.push({
          severity: 'error',
          spread: nummer,
          message: `Datei nicht im Bestand: ${file}`,
        });
        continue;
      }

      photoIds.push(id);
      seen.set(id, [...(seen.get(id) ?? []), nummer]);
    }

    // Eine Vorlage ohne Bildplatz ist absichtlich bildlos: der Jahresauftakt,
    // der nur die Jahreszahl trägt, und die leere Doppelseite. Sie zu entfernen
    // war ein stiller Datenverlust – am echten Buch verschwanden so drei
    // Jahresauftakte samt ihrer Jahreszahl, sobald das Dokument einmal durch
    // den Rundlauf ging.
    const genannt =
      entry.template && entry.template !== 'auto' ? templateById(entry.template) : undefined;
    const bildlosGewollt = genannt?.slots.length === 0;

    if (photoIds.length === 0 && !keep && !bildlosGewollt) {
      issues.push({
        severity: 'warning',
        spread: nummer,
        message: 'Doppelseite ohne Bilder – wird entfernt.',
      });
      return;
    }

    if (keep) {
      spreads.push({
        photoIds,
        keepId: keep,
        ...(typeof entry.timeline === 'boolean' ? { timeline: entry.timeline } : {}),
        ...(entry.background ? { background: entry.background } : {}),
      });
      return;
    }

    // Ein festgehaltenes Template gilt nur, solange die Slotzahl passt.
    let templateId: string | undefined;
    if (entry.template && entry.template !== 'auto') {
      const template = templateById(entry.template);
      if (!template) {
        issues.push({
          severity: 'warning',
          spread: nummer,
          message: `Unbekannte Vorlage "${entry.template}" – wird automatisch gewählt.`,
        });
      } else if (template.slots.length !== photoIds.length) {
        issues.push({
          severity: 'warning',
          spread: nummer,
          message:
            `Vorlage "${entry.template}" hat ${template.slots.length} Plätze, ` +
            `angegeben sind ${photoIds.length} Bilder – wird automatisch gewählt.`,
        });
      } else {
        templateId = entry.template;
      }
    }

    spreads.push({
      photoIds,
      ...(templateId ? { templateId } : {}),
      ...(entry.text ? { text: entry.text } : {}),
      ...(typeof entry.timeline === 'boolean' ? { timeline: entry.timeline } : {}),
      ...(entry.background ? { background: entry.background } : {}),
    });
  });

  // Mehrfachverwendung ist erlaubt, aber selten Absicht
  for (const [id, nummern] of seen) {
    if (nummern.length > 1) {
      const photo = photos.get(id);
      issues.push({
        severity: 'warning',
        message: `${photo?.fileName ?? id} kommt auf den Doppelseiten ${nummern.join(', ')} vor.`,
      });
    }
  }

  const fehlend = [...photos.keys()].filter((id) => !seen.has(id));
  if (fehlend.length > 0) {
    issues.push({
      severity: 'warning',
      message: `${fehlend.length} Fotos kommen in keiner Doppelseite vor und bleiben außen vor.`,
    });
  }

  return {
    spreads,
    ...(doc.settings ? { settings: doc.settings } : {}),
    ...(doc.yearEvents ? { yearEvents: doc.yearEvents } : {}),
    issues,
    ok: !issues.some((i) => i.severity === 'error') && spreads.length > 0,
  };
}
