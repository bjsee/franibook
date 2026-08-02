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

export async function importFolder(root: string, limit?: number): Promise<ImportResult> {
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
      const [st, tags, meta] = await Promise.all([
        stat(path),
        exiftool.read(path),
        sharp(path).metadata(),
      ]);

      // Pixelmaße sofort orientierungsnormalisieren. Alles Nachgelagerte –
      // Seitenverhältnis, Layoutwahl, Auflösungsrechnung – arbeitet damit
      // ohne Sonderfälle.
      const orientation = meta.orientation ?? 1;
      const swap = orientation >= 5 && orientation <= 8;
      const rawW = meta.width ?? 0;
      const rawH = meta.height ?? 0;
      if (rawW === 0 || rawH === 0) throw new Error('keine Pixelmaße');

      const takenAt = toNaiveDateTime(tags.DateTimeOriginal) ?? toNaiveDateTime(tags.CreateDate);

      return {
        id: await contentHash(path, st.size),
        relPath: fileName,
        fileName,
        bytes: st.size,
        width: swap ? rawH : rawW,
        height: swap ? rawW : rawH,
        orientation,
        ...(takenAt ? { takenAt } : {}),
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
