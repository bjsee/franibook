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
import { coverAntwort, EXPORT_DATEINAME, istDateiFehler, type Kontext } from './kontext.js';

export function umschlagRouten(app: FastifyInstance, { project, sources, outDir }: Kontext): void {
  app.get('/api/cover', async () => coverAntwort(project));

  /** Nimmt Titel, Untertitel, Rückentext oder ein anderes Titelbild entgegen. */
  app.patch<{ Body?: Partial<CoverDesign> }>('/api/cover', async (req) => {
    project.updateCover(req.body ?? {});
    void project.save();
    return coverAntwort(project);
  });

  /** Der Umschlag als eigene PDF-Datei. */
  app.post<{ Body?: { fileName?: string } }>('/api/export/cover', async (req, reply) => {
    const fileName = req.body?.fileName ?? 'cover.pdf';
    if (!EXPORT_DATEINAME.test(fileName)) {
      return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
    }

    await mkdir(outDir, { recursive: true });
    const outputPath = join(outDir, fileName);

    try {
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

      // `fileName` neben `outputPath`, wie beim Innenteil: Er ist die Adresse
      // für `GET /api/export/:fileName`.
      return { outputPath, fileName, ...result };
    } catch (err) {
      if (istDateiFehler(err)) {
        return reply.code(503).send({
          error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
        });
      }
      throw err;
    }
  });
}
