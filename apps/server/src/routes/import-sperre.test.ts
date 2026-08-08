/**
 * Bestandsverändernde Routen während eines laufenden Imports.
 *
 * `importPhotos`/`reimport` enden mit `z.photos.clear()` und einer
 * Neubefüllung (`project/bestand.ts`) – eine Änderung, die währenddessen den
 * Bestand anfasst, träfe eine Kopie, die der Import gleich verwirft. Die
 * Routen fragen deshalb `project.importLaufend()` ab, bevor sie etwas ändern.
 *
 * Getestet wird hier nur die Reaktion der Route auf ein laufendes Flag – dass
 * das Flag selbst korrekt gesetzt wird, prüft `project.test.ts`. Das Flag wird
 * hier direkt überschrieben: `importLaufend` ist eine gewöhnliche Methode auf
 * der Instanz, kein Privatfeld, das ein Test nicht erreichen könnte.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';

async function server() {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-importsperre-'));
  const sources = new Sources();
  const project = new Project(sources, null as never, null as never, dir);
  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    outDir: dir,
  } as Kontext;
  return { ...baueApp({ kontext, anlauf: () => null, logger: false }), project };
}

describe('Bestandsrouten während eines laufenden Imports', () => {
  it('weist einen zweiten Import ab', async () => {
    const { app, project } = await server();
    project.importLaufend = () => true;

    const antwort = await app.inject({ method: 'POST', url: '/api/import' });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json()).toMatchObject({ error: expect.any(String) });
  });

  it('weist eine neue Bildquelle ab', async () => {
    const { app, project } = await server();
    project.importLaufend = () => true;

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { root: '/irgendwo' },
    });

    expect(antwort.statusCode).toBe(409);
  });

  it('weist eine Datumskorrektur ab', async () => {
    const { app, project } = await server();
    project.importLaufend = () => true;

    const antwort = await app.inject({
      method: 'PATCH',
      url: '/api/photos',
      payload: { ids: ['a1'], date: { kind: 'set', value: '2020-01-01T12:00:00' } },
    });

    expect(antwort.statusCode).toBe(409);
  });

  it('weist das Aussortieren eines Fotos ab', async () => {
    const { app, project } = await server();
    project.importLaufend = () => true;

    const antwort = await app.inject({ method: 'DELETE', url: '/api/photos/a1' });

    expect(antwort.statusCode).toBe(409);
  });

  it('lässt dieselben Routen durch, sobald der Import fertig ist', async () => {
    const { app, project } = await server();
    project.importLaufend = () => false;

    const antwort = await app.inject({ method: 'DELETE', url: '/api/photos/a1' });

    // Kein 409 mehr – das Foto existiert schlicht nicht (404).
    expect(antwort.statusCode).toBe(404);
  });
});
