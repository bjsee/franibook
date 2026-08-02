/**
 * Franibook-Server.
 *
 * Bindet ausschließlich an das Loopback-Interface. Der Server läuft ohne
 * Authentifizierung und darf unter keinen Umständen im Netz stehen.
 *
 * Der Server importiert, rechnet das Layout, liefert Bilder und exportiert PDFs.
 * Die Engine selbst bleibt I/O-frei und könnte ebenso im Browser laufen – das
 * Frontend nutzt aus @franibook/core aber nur die Typen und ruft hier an.
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
  process.env['FRANIBOOK_SOURCE'] ?? '/Users/nutzer/fotos/buch',
);
const CACHE_DIR = resolve(process.env['FRANIBOOK_CACHE'] ?? '.franibook-cache');
const OUT_DIR = resolve(process.env['FRANIBOOK_OUT'] ?? '.franibook-out');
/** Begrenzt den Import beim Start. Ohne Angabe: alles. */
const IMPORT_LIMIT = process.env['FRANIBOOK_LIMIT']
  ? Number(process.env['FRANIBOOK_LIMIT'])
  : undefined;

const app = Fastify({ logger: { level: 'warn' } });

const PROJECT_DIR = resolve(process.env['FRANIBOOK_PROJECT'] ?? '.franibook-project');

const previews = new PreviewCache(CACHE_DIR, SOURCE_ROOT);
const project = new Project(SOURCE_ROOT, previews, PROJECT_DIR);

app.get('/api/health', async () => ({ status: 'ok' }));

app.get('/api/project', async () => ({
  sourceRoot: project.sourceRoot,
  profile: project.profile,
  settings: project.settings,
  photoCount: project.photos.size,
  spreadCount: project.spreads.length,
  skippedVideos: project.skippedVideos,
  failed: project.failed,
  report: project.lastReport,
  chapters: project.chapters(),
  groupMarks: project.groupMarks(),
  undatedCount: project.structure.undated.length,
}));

/** Erzeugt das Buch neu, etwa nach geänderter Seitenzahl. */
app.post<{ Body?: Partial<typeof project.settings> }>('/api/generate', async (req) => {
  if (req.body) project.settings = { ...project.settings, ...req.body };
  const result = project.generate();
  void project.save();
  return { settings: project.settings, report: result.report, budgets: result.budgets };
});

/**
 * Die Buchaufteilung als lesbares JSON.
 *
 * Gedacht zum Herunterladen, Bearbeiten und Zurückspielen. Referenziert Fotos
 * über den Dateinamen statt über den Inhaltshash – von Hand ist nur der
 * brauchbar.
 */
app.get('/api/book/layout', async () => project.exportLayout());

/** Nimmt ein bearbeitetes Layout entgegen. */
app.post<{ Body: unknown }>('/api/book/layout', async (req, reply) => {
  const result = project.applyLayout(req.body);
  if (!result.ok) return reply.code(422).send(result);
  void project.save();
  return result;
});

// ------------------------------------------------------------------ Gruppen

app.get('/api/groups', async () => ({
  groups: project.sortedGroups(),
}));

/**
 * Erzeugt Vorschläge aus den aufgelösten Orten.
 *
 * `reset: true` verwirft zuvor alles, auch von Hand Angelegtes – für den Fall,
 * dass man von vorn anfangen will.
 */
app.post<{ Body?: { reset?: boolean } }>('/api/groups/suggest', async (req) => {
  const result = project.suggestGroups({ reset: req.body?.reset === true });
  void project.save();
  return { groups: project.sortedGroups(), added: result.added };
});

app.post<{ Body: { title: string; photoIds: string[] } }>('/api/groups', async (req, reply) => {
  const { title, photoIds } = req.body ?? {};
  if (!title || !Array.isArray(photoIds) || photoIds.length === 0) {
    return reply.code(400).send({ error: 'title und photoIds sind erforderlich' });
  }
  project.createGroup(title, photoIds);
  void project.save();
  return { groups: project.sortedGroups() };
});

app.patch<{
  Params: { id: string };
  Body: { title?: string; coverPhotoId?: string; active?: boolean; photoIds?: string[] };
}>('/api/groups/:id', async (req) => {
  project.updateGroup(req.params.id, req.body ?? {});
  void project.save();
  return { groups: project.sortedGroups() };
});

app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
  project.removeGroup(req.params.id);
  void project.save();
  return { groups: project.sortedGroups() };
});

/** Führt eine Gruppe in eine andere über. Die Quellgruppe verschwindet. */
app.post<{ Params: { id: string }; Body: { targetId: string } }>(
  '/api/groups/:id/merge',
  async (req, reply) => {
    const targetId = req.body?.targetId;
    if (!targetId) return reply.code(400).send({ error: 'targetId fehlt' });
    project.mergeGroups(req.params.id, targetId);
    void project.save();
    return { groups: project.sortedGroups() };
  },
);

/** Ordnet Fotos einer bestehenden Gruppe zu. */
app.post<{ Params: { id: string }; Body: { photoIds: string[] } }>(
  '/api/groups/:id/add',
  async (req, reply) => {
    const photoIds = req.body?.photoIds;
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'photoIds fehlen' });
    }
    project.addToGroup(req.params.id, photoIds);
    void project.save();
    return { groups: project.sortedGroups() };
  },
);

/** Nimmt Fotos aus ihren Gruppen heraus, ohne sie zu löschen. */
app.post<{ Body: { photoIds: string[] } }>('/api/groups/ungroup', async (req) => {
  project.ungroupPhotos(req.body?.photoIds ?? []);
  void project.save();
  return { groups: project.sortedGroups() };
});

/** Fotos mit aufgelöstem Datum. `?problems` filtert auf zweifelhafte. */
app.get<{ Querystring: { problems?: string } }>('/api/photos', async (req) => {
  const views = project.photoViews(req.query.problems !== undefined);
  return { count: views.length, photos: views };
});

app.get('/api/spreads', async () => ({
  count: project.spreads.length,
  spreads: project.renderAll(),
}));

app.get<{ Params: { index: string } }>('/api/spreads/:index', async (req, reply) => {
  const index = Number(req.params.index);
  const rendered = project.render(index);
  if (!rendered) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });
  // `timelineOverride` ist kein Teil des Rendered Spread Model, sondern die
  // Entscheidung des Benutzers zu dieser Doppelseite. Die Oberfläche braucht
  // sie, um den Schalter richtig zu stellen; die Renderer sehen sie nie.
  return { ...rendered, timelineOverride: project.spreads[index]?.timeline ?? null };
});

/**
 * Ändert Einstellungen, die nur die Darstellung betreffen.
 *
 * Getrennt von `/api/generate`: Der Zeitstrahl ändert das Rendered Spread
 * Model, nicht die Fotoverteilung. Ihn über ein Neugenerieren zu schalten würde
 * jede handgemachte Korrektur im Buch verwerfen, nur um eine Linie ein- oder
 * auszublenden.
 */
app.patch<{ Body: { timeline?: boolean } }>('/api/settings', async (req) => {
  if (req.body.timeline !== undefined) project.settings.timeline = req.body.timeline;
  await project.save();
  return { settings: project.settings };
});

/** Zeitstrahl einer einzelnen Doppelseite, abweichend von der Vorgabe. */
app.patch<{ Params: { index: string }; Body: { timeline: boolean | null } }>(
  '/api/spreads/:index/timeline',
  async (req, reply) => {
    const spread = project.spreads[Number(req.params.index)];
    if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

    // `null` heißt: zurück zur globalen Vorgabe.
    if (req.body.timeline === null) delete spread.timeline;
    else spread.timeline = req.body.timeline;

    await project.save();
    return { ok: true, timeline: spread.timeline ?? null };
  },
);

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

  // Ein gespeichertes Projekt hat Vorrang: Es enthält die Korrekturen des
  // Benutzers, die ein erneuter Import nicht wiederherstellen könnte.
  const geladen = process.env['FRANIBOOK_FRESH'] ? false : await project.load();

  if (geladen) {
    process.stdout.write(
      `Projekt geladen: ${project.photos.size} Fotos, ${project.spreads.length} Doppelseiten\n`,
    );
  } else {
    process.stdout.write(
      `Importiere ${SOURCE_ROOT}${IMPORT_LIMIT ? ` (max. ${IMPORT_LIMIT})` : ''} … `,
    );
    await project.importPhotos(IMPORT_LIMIT);
    process.stdout.write(`${project.photos.size} Fotos (${Date.now() - t0} ms)\n`);

    if (project.skippedVideos.length) {
      process.stdout.write(`  ${project.skippedVideos.length} Videos übersprungen\n`);
    }
    if (project.failed.length) {
      process.stdout.write(`  ${project.failed.length} Dateien fehlerhaft\n`);
    }

    const r = project.generate().report;
    process.stdout.write(
      `Buch erzeugt: ${r.spreadCount} Doppelseiten, ${r.pageCount} Seiten, ` +
        `${r.photosPerSpread.toFixed(1)} Fotos je Doppelseite\n`,
    );
    process.stdout.write(
      `  Auflösung: schlechtester Slot ${Math.round(r.worstDpi)} dpi, ` +
        `${r.belowTargetDpi} Slots unter Zielauflösung\n`,
    );
    if (!r.feasibility.achievable) process.stdout.write(`  Hinweis: ${r.feasibility.hint}\n`);
    if (project.structure.undated.length) {
      process.stdout.write(`  ${project.structure.undated.length} Fotos ohne Datum\n`);
    }
    await project.save();
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
