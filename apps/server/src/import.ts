/**
 * Fotoimport.
 *
 * Für Phase 1 bewusst schlank: Ordner scannen, Metadaten lesen, Vorschaubilder
 * erzeugen. Die vollständige Metadatenkaskade mit Plausibilitätsprüfungen
 * folgt in Phase 2.
 *
 * Die Originaldateien werden ausschließlich gelesen.
 */
import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname, join } from 'node:path';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import type { NaiveDateTime, Photo } from '@franibook/core';
import { lookupPlace } from '@franibook/geo';
import type { DecodeCache } from './decode.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.avi']);
const HASH_WINDOW = 64 * 1024;

export interface ImportResult {
  photos: Photo[];
  /** Übersprungene Videos – werden gemeldet, damit nichts unbemerkt fehlt. */
  skippedVideos: string[];
  skippedOther: string[];
  failed: { file: string; reason: string }[];
}

/**
 * Foto-Kennung: Dateigröße plus SHA-256 über Kopf und Ende der Datei.
 *
 * Vollständiges Hashing von mehreren Gigabyte bei jedem Start wäre unnötig;
 * die Kombination ist für die Unterscheidung von Fotos praktisch
 * kollisionsfrei und macht Umbenennen und Verschieben folgenlos. Nebeneffekt:
 * Duplikate im Quellordner fallen sofort auf.
 */
async function contentHash(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.allocUnsafe(Math.min(HASH_WINDOW, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(HASH_WINDOW, Math.max(0, size - head.length));
    const tail = Buffer.allocUnsafe(tailLen);
    if (tailLen > 0) await fh.read(tail, 0, tailLen, size - tailLen);
    return createHash('sha256')
      .update(String(size))
      .update(head)
      .update(tail)
      .digest('hex')
      .slice(0, 16);
  } finally {
    await fh.close();
  }
}

/** exiftool liefert je nach Tag Strings oder ExifDateTime-Objekte. */
function toNaiveDateTime(v: unknown): NaiveDateTime | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    if (Number.isNaN(d.getTime())) return undefined;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return undefined;
}

function toNaive(d: Date): NaiveDateTime {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Datum aus dem Dateinamen.
 *
 * Deckt die verbreiteten Muster ab: `IMG_20150612_141233`,
 * `20150612_163610_DSC_0146`, `2015-06-12 14.12.33`.
 */
function dateFromFileName(name: string): NaiveDateTime | undefined {
  const m = name.match(
    /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2}))?/,
  );
  if (!m) return undefined;

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return undefined;

  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]!);
      }
    }),
  );
  return results;
}

export async function importFolder(
  root: string,
  decodes: DecodeCache,
  limit?: number,
): Promise<ImportResult> {
  const entries = await readdir(root);
  const images: string[] = [];
  const skippedVideos: string[] = [];
  const skippedOther: string[] = [];

  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue;
    const ext = extname(name).toLowerCase();
    if (IMAGE_EXT.has(ext)) images.push(name);
    else if (VIDEO_EXT.has(ext)) skippedVideos.push(name);
    else skippedOther.push(name);
  }

  const selected = limit ? images.slice(0, limit) : images;
  const failed: { file: string; reason: string }[] = [];
  const concurrency = Math.max(1, availableParallelism() - 1);

  const results = await mapLimit(selected, concurrency, async (fileName): Promise<Photo | null> => {
    const path = join(root, fileName);
    try {
      // Der Inhaltshash muss vor den Pixeln bekannt sein: Er benennt das
      // Konvertat im Decode-Cache. Die verlorene Nebenläufigkeit sind 128 KB
      // Lesen je Datei, gegen 2,4 s Metadatenlauf über den ganzen Bestand
      // nicht messbar.
      const st = await stat(path);
      const id = await contentHash(path, st.size);

      const [tags, meta] = await Promise.all([
        exiftool.read(path),
        // Metadaten liest exiftool immer aus dem Original – die Konvertierung
        // betrifft nur die Pixel. Nur die Pixelmaße kommen bei einer für
        // libvips unlesbaren Datei aus dem Konvertat, und `sips` ist maßhaltig.
        decodes.withFallback(id, fileName, (p) => sharp(p).metadata()),
      ]);

      // Pixelmaße sofort orientierungsnormalisieren. Alles Nachgelagerte –
      // Seitenverhältnis, Layoutwahl, Auflösungsrechnung – arbeitet damit
      // ohne Sonderfälle.
      const orientation = meta.orientation ?? 1;
      const swap = orientation >= 5 && orientation <= 8;
      const rawW = meta.width ?? 0;
      const rawH = meta.height ?? 0;
      if (rawW === 0 || rawH === 0) throw new Error('keine Pixelmaße');

      // Alle Quellen der Datumskaskade füllen, nicht nur die erste – sonst
      // fällt sie bei fehlendem DateTimeOriginal sofort auf das Dateidatum
      // zurück, obwohl noch bessere Angaben in der Datei stehen.
      const takenAt = toNaiveDateTime(tags.DateTimeOriginal);
      const secondaryDate =
        toNaiveDateTime(tags.CreateDate) ?? toNaiveDateTime(tags.SubSecCreateDate);
      const gpsDate = toNaiveDateTime(tags.GPSDateTime);
      const nameDate = dateFromFileName(fileName);

      const gps =
        typeof tags.GPSLatitude === 'number' && typeof tags.GPSLongitude === 'number'
          ? { lat: tags.GPSLatitude, lon: tags.GPSLongitude }
          : undefined;

      // Ort direkt beim Import auflösen. Die Ortsdatenbank ist 2,4 MB groß
      // und hat im Browser nichts zu suchen; das Ergebnis dagegen ist ein
      // kurzer String und wandert mit ins Projekt.
      const place = gps ? lookupPlace(gps.lat, gps.lon) : undefined;

      const camera = [tags.Make, tags.Model]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ')
        .replace(/\b(\w+)\s+\1\b/i, '$1') // "Canon Canon EOS" → "Canon EOS"
        .trim();

      return {
        id,
        relPath: fileName,
        fileName,
        bytes: st.size,
        width: swap ? rawH : rawW,
        height: swap ? rawW : rawH,
        orientation,
        ...(takenAt ? { takenAt } : {}),
        ...(secondaryDate ? { secondaryDate } : {}),
        ...(gpsDate ? { gpsDate } : {}),
        ...(nameDate ? { nameDate } : {}),
        fileMtime: toNaive(st.mtime),
        ...(st.birthtime && st.birthtime.getTime() > 0
          ? { fileBirthtime: toNaive(st.birthtime) }
          : {}),
        ...(gps ? { gps } : {}),
        ...(place ? { place: { key: `${place.kind}:${place.label}`, label: place.label } } : {}),
        ...(camera ? { camera } : {}),
      };
    } catch (err) {
      failed.push({ file: fileName, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });

  // Duplikate über den Inhaltshash zusammenführen – im Zielbestand liegen
  // elf Dateien doppelt vor, erkennbar an "… (1).jpeg".
  const byId = new Map<string, Photo>();
  for (const p of results) {
    if (p && !byId.has(p.id)) byId.set(p.id, p);
  }

  const photos = [...byId.values()].sort((a, b) => {
    if (a.takenAt && b.takenAt) return a.takenAt.localeCompare(b.takenAt);
    if (a.takenAt) return -1;
    if (b.takenAt) return 1;
    return a.fileName.localeCompare(b.fileName);
  });

  return { photos, skippedVideos, skippedOther, failed };
}

export async function shutdownImport(): Promise<void> {
  await exiftool.end();
}
