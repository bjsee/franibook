/**
 * Die beiden Routen des Unterschriftenzugs.
 *
 * Was gefüllt wird, prüft `project/unterschriften.test.ts`. Hier geht es um das,
 * was nur die Route kann: einen Bereich aus dem Rumpf lesen — und einen, der
 * nicht taugt, als Fehler melden statt als leeres Ergebnis.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';

async function probe(): Promise<{ app: FastifyInstance; project: Project }> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-captions-'));
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
  project.settings.frame = 'polaroid';
  // Ohne Auftakt: Sein Bild liegt randabfallend, bekommt beim Rendern also
  // keinen Rahmen — und damit keine Unterschrift.
  project.settings.chapterOpeners = false;
  project.generate();

  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, project };
}

const ursprung = { origin: 'http://127.0.0.1:5174' };

describe('Unterschriften über die Route', () => {
  it('füllt eine Doppelseite und liefert sie gerendert zurück', async () => {
    const { app } = await probe();
    const res = await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'book' }, form: 'monat' },
    });
    const body = res.json() as { geaendert: number; spreads: { boxes: unknown[] }[] };

    expect(res.statusCode).toBe(200);
    expect(body.geaendert).toBeGreaterThan(0);
    // Wie bei `POST /api/book/move`: das RSM direkt, nicht in `{ spread }`
    // verpackt — die Oberfläche setzt es ohne Nachfrage ein.
    expect(Array.isArray(body.spreads[0]?.boxes)).toBe(true);
  });

  it('weist einen Bereich zurück, den es nicht gibt', async () => {
    const { app } = await probe();

    const ohne = await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { form: 'monat' },
    });
    expect(ohne.statusCode).toBe(400);

    const seite = await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'spread', index: 99 }, form: 'monat' },
    });
    expect(seite.statusCode).toBe(400);

    const gruppe = await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'group', id: 'gibtesnicht' }, form: 'monat' },
    });
    expect(gruppe.statusCode).toBe(404);
  });

  it('weist eine unbekannte Form zurück und nennt die brauchbaren', async () => {
    const { app } = await probe();
    const res = await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'book' }, form: 'erzählung' },
    });

    expect(res.statusCode).toBe(400);
    expect(String((res.json() as { error: string }).error)).toContain('ort-monat');
  });

  it('löscht nur, was gefüllt wurde — und verlangt auch dafür einen Bereich', async () => {
    const { app, project } = await probe();
    await app.inject({
      method: 'POST',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'book' }, form: 'monat' },
    });

    const ohne = await app.inject({
      method: 'DELETE',
      url: '/api/book/captions',
      headers: ursprung,
    });
    expect(ohne.statusCode).toBe(400);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/book/captions',
      headers: ursprung,
      payload: { bereich: { kind: 'book' } },
    });
    expect(res.statusCode).toBe(200);
    expect(project.spreads.every((s) => s.slots.every((sl) => sl.caption === undefined))).toBe(
      true,
    );
  });
});
