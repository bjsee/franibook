/**
 * Der mengenwertige Rechteck-Zug — die Fälle, die nur die Route betreffen.
 *
 * Was `setSlotRects` selbst rechnet (Klemmung, Zwei-Phasen-Validierung), prüft
 * `project/seiten.test.ts` bzw. der Kern. Hier geht es um die Grenze zwischen
 * JSON aus dem Rumpf und dem getippten Modell: Ein Eintrag ganz ohne `rect`
 * (statt ausdrücklich `rect: null`) muss wie bei der einzelnen Route auf die
 * Vorlage zurückfallen und nicht mit einer 500 abbrechen.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import { Zuletzt } from '../zuletzt.js';
import type { Kontext } from './kontext.js';

async function probe(): Promise<{
  app: FastifyInstance;
  project: Project;
  index: number;
  slotId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-slots-'));
  const quelle = join(dir, 'bilder');
  await mkdir(quelle, { recursive: true });
  await writeFile(join(quelle, '2017-03-05.jpg'), 'kein echtes Bild');

  const sources = new Sources();
  const { source } = await sources.add(quelle, 'Probe');
  const project = new Project(sources, null as never, null as never, dir);
  project.photos.set('p0', {
    id: 'p0',
    relPath: '2017-03-05.jpg',
    sourceId: source.id,
    fileName: 'p0.jpg',
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    takenAt: '2017-03-05T12:00:00',
  });
  // Ohne Auftakt: Mit nur einem Foto und eingeschaltetem Kapitelauftakt trägt
  // keine der Doppelseiten einen gewöhnlichen Bildplatz mit Foto.
  project.settings.chapterOpeners = false;
  project.generate();

  const index = project.spreads.findIndex((s) => s.slots.some((sl) => sl.photoId));
  const slotId = project.spreads[index]?.slots.find((s) => s.photoId)?.slotId;
  if (index < 0 || !slotId) throw new Error('Keine Doppelseite mit Bild – die Probe taugt nicht');

  const kontext = {
    project,
    sources,
    zuletzt: new Zuletzt(join(dir, 'zuletzt.json')),
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    cacheDir: '.franibook-cache',
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, project, index, slotId };
}

const ursprung = { origin: 'http://127.0.0.1:5174' };

describe('PATCH /api/spreads/:index/slots/rects', () => {
  it('setzt mehrere Rechtecke in einem Zug', async () => {
    const { app, project, index, slotId } = await probe();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/rects`,
      headers: ursprung,
      payload: { rects: [{ slotId, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }] },
    });

    expect(res.statusCode).toBe(200);
    expect(project.spreads[index]?.slots.find((s) => s.slotId === slotId)?.rect).toBeDefined();
  });

  it('fällt bei fehlendem rect auf die Vorlage zurück, statt abzustürzen', async () => {
    // Genau der Fall, der vorher eine ungefangene TypeError und damit eine 500
    // auslöste: ein Eintrag ganz ohne `rect`-Schlüssel statt `rect: null`.
    const { app, index, slotId } = await probe();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/rects`,
      headers: ursprung,
      payload: { rects: [{ slotId }] },
    });

    expect(res.statusCode).toBe(200);
  });

  it('weist einen Eintrag ohne slotId zurück', async () => {
    const { app } = await probe();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/spreads/0/slots/rects',
      headers: ursprung,
      payload: { rects: [{ rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('weist eine leere oder fehlende Liste zurück', async () => {
    const { app } = await probe();
    const leer = await app.inject({
      method: 'PATCH',
      url: '/api/spreads/0/slots/rects',
      headers: ursprung,
      payload: { rects: [] },
    });
    expect(leer.statusCode).toBe(400);

    const ohne = await app.inject({
      method: 'PATCH',
      url: '/api/spreads/0/slots/rects',
      headers: ursprung,
      payload: {},
    });
    expect(ohne.statusCode).toBe(400);
  });

  it('bricht bei einem unbekannten Slot die ganze Menge ab', async () => {
    const { app, project, index, slotId } = await probe();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/rects`,
      headers: ursprung,
      payload: {
        rects: [
          { slotId, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } },
          { slotId: 'gibtesnicht', rect: null },
        ],
      },
    });

    expect(res.statusCode).toBe(404);
    // Teilweise angewendet wäre die Auswahl danach nicht mehr die, die man
    // gezogen hat — der erste Eintrag darf also nicht durchgekommen sein.
    expect(project.spreads[index]?.slots.find((s) => s.slotId === slotId)?.rect).toBeUndefined();
  });
});
