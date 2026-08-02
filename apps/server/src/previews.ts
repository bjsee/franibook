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
    private readonly sourceRoot: string,
  ) {}

  /**
   * Zweistufig gefächert, damit kein Verzeichnis mit hunderten Einträgen
   * entsteht.
   */
  private pathFor(photoId: string, size: PreviewSize): string {
    return join(this.cacheDir, size, photoId.slice(0, 2), `${photoId}.webp`);
  }

  async get(photoId: string, relPath: string, size: PreviewSize): Promise<string> {
    const target = this.pathFor(photoId, size);
    try {
      await access(target);
      return target;
    } catch {
      // noch nicht erzeugt
    }

    await mkdir(join(this.cacheDir, size, photoId.slice(0, 2)), { recursive: true });
    const buffer = await sharp(join(this.sourceRoot, relPath))
      // Wendet die EXIF-Orientierung an, damit die Vorschau dieselbe
      // Ausrichtung zeigt wie das Modell sie annimmt.
      .rotate()
      .resize({
        width: LONG_EDGE[size],
        height: LONG_EDGE[size],
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: QUALITY[size] })
      .toBuffer();

    await writeFile(target, buffer);
    return target;
  }

  /** Erzeugt Vorschauen im Voraus, mit begrenzter Nebenläufigkeit. */
  async warm(
    photos: readonly { id: string; relPath: string }[],
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
            await this.get(p.id, p.relPath, size);
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
