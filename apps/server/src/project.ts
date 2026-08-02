/**
 * Projektzustand.
 *
 * Für Phase 1 nur im Speicher – die Persistenz auf Platte samt Migrationen
 * folgt in Phase 2 und 7. Was hier schon stimmt: Die Buchstruktur ist von den
 * Fotos getrennt, und die Originale werden ausschließlich gelesen.
 */
import {
  type Photo,
  type PhotoId,
  type PrintProfile,
  type RenderedSpread,
  type Spread,
  defaultProfile,
  renderSpread,
  requireTemplate,
} from '@franibook/core';
import { importFolder } from './import.js';
import { PreviewCache } from './previews.js';

const TEMPLATE_ID = 'spread.4up.grid';
const PHOTOS_PER_SPREAD = 4;

export class Project {
  readonly profile: PrintProfile = defaultProfile();
  readonly photos = new Map<PhotoId, Photo>();
  spreads: Spread[] = [];
  skippedVideos: string[] = [];
  failed: { file: string; reason: string }[] = [];

  constructor(
    readonly sourceRoot: string,
    readonly previews: PreviewCache,
  ) {}

  async load(limit?: number): Promise<void> {
    const result = await importFolder(this.sourceRoot, limit);
    this.photos.clear();
    for (const p of result.photos) this.photos.set(p.id, p);
    this.skippedVideos = result.skippedVideos;
    this.failed = result.failed;
    this.buildSpreads(result.photos);
  }

  /**
   * Verteilt die Fotos chronologisch auf Doppelseiten.
   *
   * Für Phase 1 stur vier je Doppelseite. Die eigentliche Layout-Engine mit
   * Seitenbudget, Gruppierung und Templatewahl entsteht in Phase 5.
   */
  private buildSpreads(photos: readonly Photo[]): void {
    const template = requireTemplate(TEMPLATE_ID);
    this.spreads = [];

    for (let i = 0; i < photos.length; i += PHOTOS_PER_SPREAD) {
      const chunk = photos.slice(i, i + PHOTOS_PER_SPREAD);
      this.spreads.push({
        id: `spread-${this.spreads.length}`,
        index: this.spreads.length,
        templateId: template.id,
        slots: template.slots.map((slot, j) => ({
          slotId: slot.id,
          photoId: chunk[j]?.id ?? null,
          crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
        })),
      });
    }
  }

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
    return this.spreads.map((_, i) => this.render(i)!).filter(Boolean);
  }

  photo(id: PhotoId): Photo | undefined {
    return this.photos.get(id);
  }
}
