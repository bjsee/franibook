/**
 * Franibook-Server.
 *
 * Bindet ausschließlich an das Loopback-Interface. Der Server läuft ohne
 * Authentifizierung und darf unter keinen Umständen im Netz stehen.
 *
 * Bemerkenswert an der Schnittstelle: Layoutoperationen laufen nicht hier,
 * sondern im Browser über @franibook/core. Der Server importiert, liefert
 * Bilder und exportiert PDFs.
 */
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import Fastify from 'fastify';
import { renderPdf } from '@franibook/render-pdf';
import { PreviewCache } from './previews.js';
import { Project } from './project.js';
import { shutdownImport } from './import.js';

const PORT = Number(process.env['PORT'] ?? 5174);
const SOURCE_ROOT = resolve(
  process.env['FRANIBOOK_SOURCE'] ?? '/Users/see/nas/dokumente/Franziska/buch',
);
const CACHE_DIR = resolve(process.env['FRANIBOOK_CACHE'] ?? '.franibook-cache');
const OUT_DIR = resolve(process.env['FRANIBOOK_OUT'] ?? '.franibook-out');
/** Begrenzt den Import beim Start. Ohne Angabe: alles. */
const IMPORT_LIMIT = process.env['FRANIBOOK_LIMIT']
  ? Number(process.env['FRANIBOOK_LIMIT'])
  : undefined;

const app = Fastify({ logger: { level: 'warn' } });

const previews = new PreviewCache(CACHE_DIR, SOURCE_ROOT);
const project = new Project(SOURCE_ROOT, previews);

app.get('/api/health', async () => ({ status: 'ok' }));

app.get('/api/project', async () => ({
  sourceRoot: project.sourceRoot,
  profile: project.profile,
  photoCount: project.photos.size,
  spreadCount: project.spreads.length,
  skippedVideos: project.skippedVideos,
  failed: project.failed,
}));

app.get('/api/spreads', async () => ({
  count: project.spreads.length,
  spreads: project.renderAll(),
}));

app.get<{ Params: { index: string } }>('/api/spreads/:index', async (req, reply) => {
  const rendered = project.render(Number(req.params.index));
  if (!rendered) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });
  return rendered;
});

/**
 * Setzt den Bildausschnitt eines Slots.
 *
 * In Phase 1 vor allem für den Parity-Test da: Ohne einen manuell
 * verschobenen Ausschnitt prüft der Test nur zentrierte Zuschnitte – und
 * gerade bei denen liefern eine korrekte Ausschnittsberechnung und der naive
 * Weg über `object-position: center` zufällig dasselbe Ergebnis. Der Editor
 * in Phase 6 nutzt denselben Endpunkt.
 */
app.patch<{
  Params: { index: string; slotId: string };
  Body: { x: number; y: number; w: number; h: number };
}>('/api/spreads/:index/slots/:slotId/crop', async (req, reply) => {
  const spread = project.spreads[Number(req.params.index)];
  if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

  const slot = spread.slots.find((s) => s.slotId === req.params.slotId);
  if (!slot) return reply.code(404).send({ error: 'Slot nicht gefunden' });

  const { x, y, w, h } = req.body;
  slot.crop = { x, y, w, h, mode: 'manual' };
  return { ok: true, crop: slot.crop };
});

app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
  '/api/photos/:id/preview',
  async (req, reply) => {
    const photo = project.photo(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

    const size = req.query.size === 'thumb' ? 'thumb' : 'preview';
    const path = await previews.get(photo.id, photo.relPath, size);
    return reply
      .type('image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  },
);

/**
 * Liefert das Original. Wird ausschließlich vom Parity-Test gebraucht, damit
 * er die Vorschau mit denselben Pixeln füttern kann, die der PDF-Export
 * verwendet – sonst würde er WebP-Kompression gegen JPEG-Kompression messen
 * statt Geometrie gegen Geometrie.
 */
app.get<{ Params: { id: string } }>('/api/photos/:id/original', async (req, reply) => {
  const photo = project.photo(req.params.id);
  if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });
  const ext = extname(photo.fileName).toLowerCase();
  const type = ext === '.png' ? 'image/png' : 'image/jpeg';
  return reply
    .type(type)
    .header('Cache-Control', 'public, max-age=31536000, immutable')
    .send(createReadStream(join(SOURCE_ROOT, photo.relPath)));
});

app.post<{ Body?: { spreadIndex?: number; fileName?: string } }>(
  '/api/export/pdf',
  async (req, reply) => {
    const index = req.body?.spreadIndex;
    const spreads =
      index === undefined
        ? project.renderAll()
        : [project.render(index)].filter((s) => s !== undefined);

    if (spreads.length === 0) {
      return reply.code(404).send({ error: 'Keine Doppelseite zum Exportieren' });
    }

    await mkdir(OUT_DIR, { recursive: true });
    const fileName =
      req.body?.fileName ?? (index === undefined ? 'buch.pdf' : `spread-${index}.pdf`);
    const outputPath = join(OUT_DIR, fileName);

    const result = await renderPdf({
      spreads,
      profile: project.profile,
      outputPath,
      resolvePhoto: (photoId) => {
        const photo = project.photo(photoId);
        if (!photo) return undefined;
        return { path: join(SOURCE_ROOT, photo.relPath), orientation: photo.orientation };
      },
    });

    return { outputPath, ...result };
  },
);

async function start(): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(
    `Importiere ${SOURCE_ROOT}${IMPORT_LIMIT ? ` (max. ${IMPORT_LIMIT})` : ''} … `,
  );
  await project.load(IMPORT_LIMIT);
  process.stdout.write(
    `${project.photos.size} Fotos, ${project.spreads.length} Doppelseiten (${Date.now() - t0} ms)\n`,
  );
  if (project.skippedVideos.length) {
    process.stdout.write(`  ${project.skippedVideos.length} Videos übersprungen\n`);
  }
  if (project.failed.length) {
    process.stdout.write(`  ${project.failed.length} Dateien fehlerhaft\n`);
  }

  // Vorschauen im Hintergrund aufwärmen, damit die Oberfläche sofort nutzbar
  // ist. Wer schneller blättert, als der Cache füllt, erzeugt sie on demand.
  void previews
    .warm([...project.photos.values()], 'preview', 6)
    .then(() => process.stdout.write('Vorschaubilder vollständig\n'));

  await app.listen({ port: PORT, host: '127.0.0.1' });
  process.stdout.write(`Server auf http://127.0.0.1:${PORT}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await shutdownImport();
      process.exit(0);
    })();
  });
}

await start();
