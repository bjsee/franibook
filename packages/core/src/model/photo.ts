/**
 * Fotos im Domänenmodell.
 *
 * `Photo` spiegelt ausschließlich, was in der Datei steht, und ist nach dem
 * Import unveränderlich. Alle Benutzerkorrekturen leben getrennt davon, damit
 * ein erneuter Import sie nicht überschreibt.
 */

export type PhotoId = string;

/** Lokale Zeit ohne Zonenversatz: `YYYY-MM-DDTHH:mm:ss`. */
export type NaiveDateTime = string;

export interface Photo {
  id: PhotoId;
  /** Relativ zur Bildquelle des Projekts. */
  relPath: string;
  fileName: string;
  bytes: number;

  /**
   * Pixelmaße NACH Anwendung der EXIF-Orientierung. Alles Nachgelagerte –
   * Seitenverhältnis, Layoutwahl, Auflösungsrechnung – arbeitet damit ohne
   * Sonderfälle.
   */
  width: number;
  height: number;
  /** Wie in der Datei vorgefunden, 1..8. Der PDF-Renderer braucht das noch. */
  orientation: number;

  /** EXIF DateTimeOriginal – die verlässlichste Quelle. */
  takenAt?: NaiveDateTime;
  /** CreateDate, XMP oder ähnliches, wenn DateTimeOriginal fehlt. */
  secondaryDate?: NaiveDateTime;
  /** GPS-Zeitstempel. Dient auch als Gegenprobe zum Aufnahmedatum. */
  gpsDate?: NaiveDateTime;
  /** Aus dem Dateinamen geraten, etwa IMG_20150612_141233.jpg. */
  nameDate?: NaiveDateTime;
  fileMtime?: NaiveDateTime;
  fileBirthtime?: NaiveDateTime;

  gps?: { lat: number; lon: number };
  /**
   * Beim Import aufgelöster Ort.
   *
   * Wird gespeichert statt bei Bedarf berechnet: Die Ortsdatenbank ist 2,4 MB
   * groß, das Ergebnis ein kurzer String – und die Oberfläche braucht ihn in
   * jeder Zeile der Fotoliste.
   */
  place?: { key: string; label: string };
  camera?: string;
}

/** Seitenverhältnis, orientierungskorrigiert. */
export function aspectRatio(photo: Pick<Photo, 'width' | 'height'>): number {
  return photo.width / photo.height;
}

/** Lange Kante in Pixeln. */
export function longEdgePx(photo: Pick<Photo, 'width' | 'height'>): number {
  return Math.max(photo.width, photo.height);
}

export type Orientation = 'landscape' | 'portrait' | 'square';

export function orientationOf(photo: Pick<Photo, 'width' | 'height'>): Orientation {
  const ar = aspectRatio(photo);
  if (Math.abs(ar - 1) < 0.05) return 'square';
  return ar > 1 ? 'landscape' : 'portrait';
}
