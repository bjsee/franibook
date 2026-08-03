/**
 * Der Umschlag.
 *
 * Er wird getrennt vom Innenteil exportiert, weil der Druckdienstleister es so
 * verlangt – einer der wenigen verifizierten Punkte des Profils.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CoverDesign } from '@franibook/core';
import { renderCoverPdf } from '@franibook/render-pdf';
import { coverAntwort, type Kontext } from './kontext.js';

export function umschlagRouten(app: FastifyInstance, { project, sources, outDir }: Kontext): void {
  app.get('/api/cover', async () => coverAntwort(project));

  /** Nimmt Titel, Untertitel, Rückentext oder ein anderes Titelbild entgegen. */
  app.patch<{ Body?: Partial<CoverDesign> }>('/api/cover', async (req) => {
    project.updateCover(req.body ?? {});
    void project.save();
    return coverAntwort(project);
  });

  /** Der Umschlag als eigene PDF-Datei. */
  app.post<{ Body?: { fileName?: string } }>('/api/export/cover', async (req) => {
    await mkdir(outDir, { recursive: true });
    const outputPath = join(outDir, req.body?.fileName ?? 'cover.pdf');

    const result = await renderCoverPdf({
      cover: project.renderCover(),
      profile: project.profile,
      outputPath,
      resolvePhoto: (photoId) => {
        const photo = project.photo(photoId);
        if (!photo) return undefined;
        return { path: sources.pfad(photo), orientation: photo.orientation };
      },
    });

    return { outputPath, ...result };
  });
}
