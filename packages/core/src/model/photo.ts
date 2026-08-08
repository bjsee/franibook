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

  /**
   * Wo im Bild etwas Wichtiges ist — Gesichter und, wenn keines gefunden wurde,
   * der Aufmerksamkeitsschwerpunkt.
   *
   * Beim Import erkannt und gespeichert, nicht bei Bedarf gerechnet: Der Kern
   * hat keine Pixel (`.claude/rules/kern-rein.md`), und eine Erkennung je
   * Anordnung wäre 55 s je Lauf statt 55 s je Bestand. Beide Rechtecke sind
   * **relativ zur angezeigten Bildkante, Ursprung oben links** — dasselbe
   * System wie `Crop` und wie `width`/`height`, die der Import bei
   * Orientierung 5–8 tauscht.
   *
   * Verwendet wird das ausschließlich für den Fokuspunkt des automatischen
   * Ausschnitts (`focalForCrop`). Wer Personen benennen oder zählen will,
   * braucht mehr als ein Rechteck; das ist ausdrücklich nicht der Zweck.
   *
   * Fehlt bei Fotos, die vor der Erkennung eingelesen wurden, und wenn auf dem
   * Rechner kein Erkenner verfügbar ist. Dann bleibt es bei der Bildmitte.
   */
  faces?: FocusRect[];
  salience?: FocusRect;

  /**
   * Wie gut das Bild technisch ist — Schärfe und Belichtung.
   *
   * Wie `faces` beim Import nachgezogen und gespeichert, nicht bei Bedarf
   * gerechnet: Der Kern hat keine Pixel (`.claude/rules/kern-rein.md`), und die
   * Generierung soll deterministisch bleiben. Fehlt bei Fotos, die vor der
   * Bewertung eingelesen wurden.
   *
   * Die Zahl darf **gewichten, nicht entscheiden** (Issue #19): Ein unscharfes
   * Foto kann das einzige von einem Tag sein. Verwendet wird sie als Zuschlag
   * in `slotCost` — der große Platz für das bessere Bild — und als Vorauswahl
   * innerhalb eines Doppels (`structure/doppel.ts`).
   */
  quality?: PhotoQuality;
}

/**
 * Technische Bildqualität, gemessen auf der 320-px-Vorschau.
 *
 * **Die feste Kantenlänge ist Teil der Definition.** Die Laplace-Varianz hängt
 * an der Bildgröße; auf verschieden großen Bildern gerechnet wären zwei Zahlen
 * nicht vergleichbar, und genau das Vergleichen ist ihr einziger Zweck.
 *
 * Wertebereiche am echten Bestand (`docs/spikes/serien.md`, 956 Fotos):
 * Schärfe 20–6.346 (Median 1.036), Helligkeit 9–201, Kontrast 14–95.
 */
export interface PhotoQuality {
  /**
   * Varianz der Laplace-Antwort: klein heißt unscharf oder verwackelt.
   *
   * Eine Schwelle „unscharf" gibt der Bestand nicht her — unterhalb von etwa
   * 110 sind die Bilder tatsächlich verwackelt, aber darüber geht es stetig
   * weiter, und jeder Strich wäre gesetzt statt gemessen.
   */
  sharpness: number;
  /** Mittlere Helligkeit, 0–255. */
  brightness: number;
  /** Streuung der Helligkeit: klein heißt flau, wie bei alten Scans. */
  contrast: number;
  /** Anteil abgesoffener Pixel (unter 16), 0–1. */
  clippedDark: number;
  /** Anteil ausgefressener Pixel (über 240), 0–1. */
  clippedLight: number;
}

/**
 * Ein Bereich im Bild, relativ zur angezeigten Kante, Ursprung oben links.
 *
 * Absichtlich nicht `Rect` aus `geometry/`: Das rechnet in Millimetern auf dem
 * Papier, das hier in Anteilen des Bildes. Ein gemeinsamer Typ hätte die
 * Verwechslung eher gestiftet als verhindert.
 */
export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dreht einen Bildbereich um Vierteldrehungen im Uhrzeigersinn.
 *
 * Das Gegenstück zu `rotateCrop` (`model/crop.ts`) für Gesichter und Salienz:
 * Sie stehen in Bildkoordinaten und zeigten nach einer Ausrichtungskorrektur
 * sonst auf eine andere Stelle. Bei 90° und 270° tauschen Breite und Höhe, wie
 * `effectivePhoto` es für das Foto selbst tut.
 */
export function rotateFocusRect(r: FocusRect, turns: 0 | 1 | 2 | 3): FocusRect {
  switch (turns) {
    case 1:
      return { x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w };
    case 2:
      return { x: 1 - (r.x + r.w), y: 1 - (r.y + r.h), w: r.w, h: r.h };
    case 3:
      return { x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w };
    default:
      return r;
  }
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
