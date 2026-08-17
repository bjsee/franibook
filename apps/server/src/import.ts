/**
 * Fotoimport.
 *
 * Eine Bildquelle rekursiv scannen, Metadaten lesen, Fotos aufbauen. Welche
 * Quellen es gibt und wie sie zu Dateipfaden werden, steht in `sources.ts`.
 *
 * Die Originaldateien werden ausschließlich gelesen.
 */
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, extname, join } from 'node:path';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';
import type { NaiveDateTime, Photo } from '@franibook/core';
import { lookupPlace } from '@franibook/geo';
import type { DecodeCache } from './decode.js';
import type { PhotoSource } from './sources.js';

/**
 * Was als Bild gilt.
 *
 * Exportiert, weil der Einwurf dieselbe Menge braucht: Eine Datei, die der Scan
 * übergehen würde, darf auch nicht durch ein Fallenlassen ins Buch kommen –
 * sonst läge sie im Quellordner und wäre nach dem nächsten Einlesen wieder weg.
 */
export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff']);
/**
 * Endungen, die der Scan als Video überspringt – und die der Videoeinwurf
 * annimmt.
 *
 * Eine Liste für beides: Was der Import als Video erkennt, muss man einwerfen
 * können, sonst hieße es „übersprungen" und ließe sich doch nicht nachholen.
 */
export const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.avi']);
const HASH_WINDOW = 64 * 1024;

export interface ImportResult {
  photos: Photo[];
  /** Übersprungene Videos – werden gemeldet, damit nichts unbemerkt fehlt. */
  skippedVideos: string[];
  skippedOther: string[];
  /**
   * Dateien, die als aussortiert vermerkt sind.
   *
   * Sie liegen im Ordner und werden trotzdem nicht aufgenommen – das ist der
   * ganze Sinn der Merkliste. Gezählt wird trotzdem, damit „6 aussortierte
   * übersprungen" in der Meldung steht und niemand nach den fehlenden Bildern
   * sucht.
   */
  aussortiert: string[];
  failed: { file: string; reason: string }[];
}

/**
 * Foto-Kennung aus Größe, Kopf und Ende – die Formel, an einer Stelle.
 *
 * Vollständiges Hashing von mehreren Gigabyte bei jedem Start wäre unnötig;
 * die Kombination ist für die Unterscheidung von Fotos praktisch
 * kollisionsfrei und macht Umbenennen und Verschieben folgenlos. Nebeneffekt:
 * Duplikate im Quellordner fallen sofort auf.
 */
function kennungAus(size: number, head: Buffer, tail: Buffer): string {
  return createHash('sha256')
    .update(String(size))
    .update(head)
    .update(tail)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Die Kennung einer Datei, die noch nicht gescannt wurde.
 *
 * Gebraucht für Videos: Sie liegen nicht im Bestand und gehen deshalb nie durch
 * `scanSource`, brauchen aber eine Kennung aus demselben Verfahren – dasselbe
 * Video zweimal eingeworfen soll dieselbe sein, sonst zeigt ein längst
 * gedruckter Code plötzlich woandershin (`model/video.ts` im Kern).
 */
export async function dateiKennung(path: string): Promise<string> {
  const { size } = await stat(path);
  return contentHash(path, size);
}

/** Die Kennung einer Datei, gelesen mit zwei Sprüngen statt einem Durchlauf. */
async function contentHash(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.allocUnsafe(Math.min(HASH_WINDOW, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(HASH_WINDOW, Math.max(0, size - head.length));
    const tail = Buffer.allocUnsafe(tailLen);
    if (tailLen > 0) await fh.read(tail, 0, tailLen, size - tailLen);
    return kennungAus(size, head, tail);
  } finally {
    await fh.close();
  }
}

/**
 * Die Kennung von Bytes, die noch keine Datei sind.
 *
 * Gebraucht beim Einwurf: Ob dieses Bild schon im Bestand liegt oder auf der
 * Aussortierliste steht, muss **vor** dem Schreiben feststehen – sonst legt ein
 * versehentlich zweimal eingeworfenes Foto eine zweite Datei im Quellordner an,
 * die niemand mehr von der ersten unterscheidet. Dieselbe Formel wie beim
 * Import, damit dieselbe Datei dieselbe Kennung bekommt, ob sie gescannt oder
 * eingeworfen wurde.
 */
export function inhaltsKennung(bytes: Buffer): string {
  const kopf = bytes.subarray(0, Math.min(HASH_WINDOW, bytes.length));
  const endeLaenge = Math.min(HASH_WINDOW, Math.max(0, bytes.length - kopf.length));
  const ende = bytes.subarray(bytes.length - endeLaenge);
  return kennungAus(bytes.length, kopf, ende);
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

/**
 * Sammelt Bilddateien einer Quelle, Unterordner eingeschlossen.
 *
 * Rekursiv, weil Nachschub typischerweise als ganzer Ordner ankommt – ein
 * Kartenexport, ein geteiltes Album. Ein flacher Scan hätte davon nichts
 * gesehen und die Dateien stillschweigend unter „übersprungen" abgelegt.
 *
 * Versteckte Einträge bleiben außen vor: `.DS_Store`, `.Trashes` und
 * Fotos-Mediatheken haben im Bestand nichts verloren.
 */
export async function sammleDateien(root: string): Promise<{
  images: string[];
  skippedVideos: string[];
  skippedOther: string[];
}> {
  const images: string[] = [];
  const skippedVideos: string[] = [];
  const skippedOther: string[] = [];

  async function ordner(rel: string): Promise<void> {
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await ordner(relPath);
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE_EXT.has(ext)) images.push(relPath);
      else if (VIDEO_EXT.has(ext)) skippedVideos.push(relPath);
      else skippedOther.push(relPath);
    }
  }

  await ordner('');
  return { images, skippedVideos, skippedOther };
}

/**
 * Kennung und Dateistatus – was vor dem teuren Teil feststehen muss.
 *
 * Der Inhaltshash muss vor den Pixeln bekannt sein: Er benennt das Konvertat im
 * Decode-Cache, und er entscheidet, ob die Datei überhaupt gelesen wird
 * (Aussortierliste). Die verlorene Nebenläufigkeit sind 128 KB Lesen je Datei,
 * gegen 2,4 s Metadatenlauf über den ganzen Bestand nicht messbar.
 */
async function kennung(path: string): Promise<{ id: string; st: Stats }> {
  const st = await stat(path);
  return { id: await contentHash(path, st.size), st };
}

/**
 * Liest eine Bilddatei zu einem `Photo`.
 *
 * @param vorab Kennung und Status – der Aufrufer hat sie schon, weil er an der
 * Kennung entscheidet, ob die Datei überhaupt gelesen wird.
 * @throws wenn die Datei unlesbar ist oder keine Pixelmaße hergibt.
 */
async function leseFoto(
  source: PhotoSource,
  relPath: string,
  decodes: DecodeCache,
  vorab: { id: string; st: Stats },
): Promise<Photo> {
  const path = join(source.root, relPath);
  const fileName = basename(relPath);
  const { id, st } = vorab;

  const [tags, meta] = await Promise.all([
    exiftool.read(path),
    // Metadaten liest exiftool immer aus dem Original – die Konvertierung
    // betrifft nur die Pixel. Nur die Pixelmaße kommen bei einer für
    // libvips unlesbaren Datei aus dem Konvertat, und `sips` ist maßhaltig.
    decodes.withFallback({ id, relPath, sourceId: source.id }, (p) => sharp(p).metadata()),
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
  const secondaryDate = toNaiveDateTime(tags.CreateDate) ?? toNaiveDateTime(tags.SubSecCreateDate);
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
    relPath,
    sourceId: source.id,
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
    ...(st.birthtime && st.birthtime.getTime() > 0 ? { fileBirthtime: toNaive(st.birthtime) } : {}),
    ...(gps ? { gps } : {}),
    ...(place ? { place: { key: `${place.kind}:${place.label}`, label: place.label } } : {}),
    ...(camera ? { camera } : {}),
  };
}

/**
 * Liest **eine** Datei einer Quelle zu einem `Photo`.
 *
 * Für den Einwurf: Die Datei ist gerade geschrieben worden, ihre Kennung steht
 * schon fest (sie wurde vor dem Schreiben aus den Bytes gerechnet). Derselbe
 * Weg wie im Scan, damit ein eingeworfenes Foto genau dieselben Felder trägt
 * wie ein gescanntes – Datumskaskade, Ort, Kamera, orientierungsnormalisierte
 * Maße. Ein eigener kleiner Leser hätte hier die Hälfte davon vergessen.
 *
 * @throws wenn die Datei unlesbar ist oder keine Pixelmaße hergibt.
 */
export async function leseEinzelfoto(
  source: PhotoSource,
  relPath: string,
  decodes: DecodeCache,
  id: string,
): Promise<Photo> {
  const st = await stat(join(source.root, relPath));
  return await leseFoto(source, relPath, decodes, { id, st });
}

/**
 * Liest eine Bildquelle ein.
 *
 * @param limit Höchstzahl einzulesender Fotos. Bei mehreren Quellen gibt der
 * Aufrufer das Restkontingent weiter, damit `FRANIBOOK_LIMIT` weiterhin die
 * Gesamtzahl begrenzt und nicht die je Ordner.
 * @param aussortiert Kennungen, die nicht ins Projekt zurückkehren sollen.
 * Geprüft wird direkt nach dem Hash: EXIF und Pixelmaße einer Datei zu lesen,
 * die man gleich wegwirft, ist die Arbeit, die man sich hier spart.
 */
export async function importSource(
  source: PhotoSource,
  decodes: DecodeCache,
  limit?: number,
  aussortiert: ReadonlySet<string> = new Set(),
): Promise<ImportResult> {
  const root = source.root;
  const { images, skippedVideos, skippedOther } = await sammleDateien(root);

  const selected = limit ? images.slice(0, limit) : images;
  const failed: { file: string; reason: string }[] = [];
  const uebersprungen: string[] = [];
  const concurrency = Math.max(1, availableParallelism() - 1);

  const results = await mapLimit(selected, concurrency, async (relPath): Promise<Photo | null> => {
    const path = join(root, relPath);
    try {
      const vorab = await kennung(path);
      if (aussortiert.has(vorab.id)) {
        uebersprungen.push(relPath);
        return null;
      }
      return await leseFoto(source, relPath, decodes, vorab);
    } catch (err) {
      failed.push({ file: relPath, reason: err instanceof Error ? err.message : String(err) });
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
    return a.relPath.localeCompare(b.relPath);
  });

  return { photos, skippedVideos, skippedOther, aussortiert: uebersprungen, failed };
}

export async function shutdownImport(): Promise<void> {
  await exiftool.end();
}
