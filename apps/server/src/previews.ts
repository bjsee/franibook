/**
 * Vorschaubild-Cache.
 *
 * Die Doppelseitenvorschau darf niemals das Original laden – bei 900
 * hochauflösenden Bildern wäre das weder für den Speicher noch für die
 * Ladezeit tragbar. Für den PDF-Export gilt umgekehrt: immer das Original.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DecodeCache } from './decode.js';
import type { PhotoRef } from './sources.js';

export type PreviewSize = 'thumb' | 'preview';

const LONG_EDGE: Record<PreviewSize, number> = {
  thumb: 320,
  preview: 1600,
};

const QUALITY: Record<PreviewSize, number> = {
  thumb: 80,
  preview: 82,
};

export class PreviewCache {
  constructor(
    private readonly cacheDir: string,
    /**
     * Löst den Quellpfad auf und rettet Bilder, an denen sharp scheitert. Die
     * Vorschau war der stille Verlierer solcher Dateien: `warm` schluckt
     * Fehler, das Bild blieb einfach grau.
     */
    private readonly decodes: DecodeCache,
  ) {}

  /**
   * Zweistufig gefächert, damit kein Verzeichnis mit hunderten Einträgen
   * entsteht.
   *
   * Eine Ausrichtungskorrektur geht in den Namen ein (`<hash>-q1.webp`). Damit
   * bleibt die Zusage der Bild-Endpunkte wörtlich wahr — „ändert sich das Bild,
   * ändert sich die URL" —, und `immutable` gilt weiter. Die alte Datei bleibt
   * liegen (~40 KB, belanglos) und wird beim Zurücknehmen der Korrektur sofort
   * wiedergefunden, ohne neu zu rendern.
   */
  private pathFor(photoId: string, size: PreviewSize, turns = 0): string {
    const name = turns ? `${photoId}-q${turns}.webp` : `${photoId}.webp`;
    return join(this.cacheDir, size, photoId.slice(0, 2), name);
  }

  async get(photo: PhotoRef, size: PreviewSize): Promise<string> {
    const turns = photo.quarterTurns ?? 0;
    const target = this.pathFor(photo.id, size, turns);
    try {
      await access(target);
      return target;
    } catch {
      // noch nicht erzeugt
    }

    await mkdir(join(this.cacheDir, size, photo.id.slice(0, 2)), { recursive: true });
    const buffer = await this.decodes.withFallback(photo, (path) =>
      sharp(path)
        // Wendet die EXIF-Orientierung an, damit die Vorschau dieselbe
        // Ausrichtung zeigt wie das Modell sie annimmt.
        .rotate()
        // Und darauf die Korrektur von Hand. Beide Aufrufe in einer Kette und
        // ohne Zwischenpuffer, weil sharp EXIF-Orientierung und expliziten
        // Winkel *zusammen* anwendet — gemessen an einem Bild mit Orientierung 6:
        // `.rotate()` allein ergibt 50 × 100, `.rotate().rotate(90)` ergibt
        // 100 × 50, genau wie zwei getrennte Durchgänge. Bei mehreren
        // `resize`-artigen Operationen gilt das nicht (siehe den Zweischritt in
        // `render-pdf/prepare-image.ts`), bei Drehungen schon.
        .rotate(90 * turns)
        .resize({
          width: LONG_EDGE[size],
          height: LONG_EDGE[size],
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: QUALITY[size] })
        .toBuffer(),
    );

    await writeFile(target, buffer);
    return target;
  }

  /** Erzeugt Vorschauen im Voraus, mit begrenzter Nebenläufigkeit. */
  async warm(
    photos: readonly PhotoRef[],
    size: PreviewSize,
    concurrency: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    let next = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, photos.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= photos.length) return;
          const p = photos[i]!;
          try {
            await this.get(p, size);
          } catch {
            // Ein defektes Bild darf den Import nicht anhalten; es fällt
            // später als fehlende Vorschau auf.
          }
          onProgress?.(++done, photos.length);
        }
      }),
    );
  }
}
