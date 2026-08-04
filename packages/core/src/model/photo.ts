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
  /** Relativ zur Bildquelle, aus der das Foto stammt. */
  relPath: string;
  /**
   * Aus welcher Bildquelle das Foto stammt.
   *
   * Fehlt bei Fotos aus Projekten vor der Quellenliste; sie gehören dann zur
   * ersten Quelle. Die Engine liest das Feld nie – nur der Server braucht es,
   * um von `relPath` zu einem Dateipfad zu kommen.
   */
  sourceId?: string;
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
  /**
   * Zusätzliche Vierteldrehungen im Uhrzeigersinn, über die EXIF-Orientierung
   * hinaus.
   *
   * Beim Import **immer** leer — die Datei kennt das nicht. Gesetzt wird es
   * ausschließlich von `effectivePhoto` aus `PhotoOverride.orientationTurns`,
   * für Scans und Bilder, deren EXIF-Orientierung fehlt oder falsch ist. Bei 1
   * und 3 sind `width`/`height` in diesem Foto schon getauscht, das Layout
   * rechnet also ohne Sonderfall.
   *
   * Es steht hier und nicht nur im Override, weil beide Renderer es brauchen und
   * die Aufbereitung ohnehin `orientation` aus dem Foto liest: Ein zweiter Weg
   * für dieselbe Frage wäre eine Gelegenheit, die zwei auseinanderlaufen zu
   * lassen. Nicht als geänderte `orientation` (etwa 1 → 6), weil die Aufbereitung
   * daraus nur *ob* liest und dann `.rotate()` ohne Argument aufruft — das nimmt
   * die Orientierung aus der Datei, nicht aus dem Modell, und die Korrektur wäre
   * wirkungslos.
   */
  quarterTurns?: 1 | 2 | 3;

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
