/**
 * Die Filter an `GET /api/photos`.
 *
 * Was gefiltert wird, prüft `project/filter.test.ts`. Hier geht es um das, was
 * nur die Route kann: eine Query in Bedingungen übersetzen — und einen Wert,
 * der keine ergibt, als Fehler melden statt stillschweigend zu übergehen. Eine
 * Liste, die etwas anderes zeigt als angefragt, glaubt man sonst.
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
  const dir = await mkdtemp(join(tmpdir(), 'franibook-fotofilter-'));
  const quelle = join(dir, 'bilder');
  await mkdir(quelle, { recursive: true });
  await writeFile(join(quelle, '2017-03-05.jpg'), 'kein echtes Bild');

  const sources = new Sources();
  const { source } = await sources.add(quelle, 'Probe');
  const project = new Project(sources, null as never, null as never, dir);
  for (const [id, takenAt] of [
    ['p0', '2017-03-05T12:00:00'],
    ['p1', '2018-07-14T12:00:00'],
  ] as const) {
    project.photos.set(id, {
      id,
      relPath: '2017-03-05.jpg',
      sourceId: source.id,
      fileName: `${id}.jpg`,
      bytes: 2_000_000,
      width: 4000,
      height: 3000,
      orientation: 1,
      takenAt,
    });
  }
  project.rebuildStructure();

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

async function fotos(app: FastifyInstance, query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/photos${query}` });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('Bestand filtern über die Route', () => {
  it('gibt ohne Query den ganzen Bestand und keine Gesamtzahl daneben', async () => {
    const { app } = await probe();
    const { status, body } = await fotos(app, '');

    expect(status).toBe(200);
    expect(body.count).toBe(2);
    // `gesamt` steht nur da, wo gefiltert wurde – sonst wäre es dieselbe Zahl
    // zweimal.
    expect(body.gesamt).toBeUndefined();
  });

  it('übersetzt Zeitraum und Platzierung und nennt die Gesamtzahl', async () => {
    const { app } = await probe();
    const { body } = await fotos(app, '?von=2018-01-01&platziert=nein');

    expect(body.count).toBe(1);
    expect(body.gesamt).toBe(2);
  });

  it('weist einen unbrauchbaren Wert zurück, statt ihn zu übergehen', async () => {
    const { app } = await probe();

    const datum = await fotos(app, '?von=14.07.2018');
    expect(datum.status).toBe(400);
    expect(String(datum.body.error)).toContain('JJJJ-MM-TT');

    const platziert = await fotos(app, '?platziert=vielleicht');
    expect(platziert.status).toBe(400);

    const konfidenz = await fotos(app, '?konfidenz=mittel');
    expect(konfidenz.status).toBe(400);
  });

  it('nimmt eine unbekannte Kennung als Frage und antwortet mit null Treffern', async () => {
    // Anders als ein Formfehler: „Gibt es Fotos aus dieser Quelle?" ist eine
    // Frage, und die Antwort lautet nein.
    const { app } = await probe();
    const { status, body } = await fotos(app, '?quelle=gibtesnicht');

    expect(status).toBe(200);
    expect(body.count).toBe(0);
  });

  it('weist einen mehrfach angegebenen Parameter zurück', async () => {
    // Fastify macht daraus ein Array; ungeprüft rief der Filter darauf eine
    // Zeichenkettenfunktion auf und quittierte mit einem 500er.
    const { app } = await probe();
    const { status, body } = await fotos(app, '?ort=a&ort=b');

    expect(status).toBe(400);
    expect(String(body.error)).toContain('einmal');
  });

  it('weist zwei Bedingungen zurück, die einander ausschließen', async () => {
    const { app } = await probe();
    const { status } = await fotos(app, '?ohneDatum=1&von=2018-01-01');

    expect(status).toBe(400);
  });

  it('nimmt den leeren Text als eigene Frage', async () => {
    // `?ort=` sucht die Fotos ohne Ort, `?gruppe=` die in keiner Gruppe. Das
    // hängt daran, dass Fastify `''` und nicht `undefined` liefert.
    const { app } = await probe();
    expect((await fotos(app, '?ort=')).body.count).toBe(2);
    expect((await fotos(app, '?gruppe=')).body.count).toBe(2);
  });

  it('lässt `konfidenz=none` zu', async () => {
    // Ein Wert der Kaskade und kein Formfehler, auch wenn `ohneDatum` dieselbe
    // Menge trifft.
    const { app } = await probe();
    expect((await fotos(app, '?konfidenz=none')).status).toBe(200);
  });

  it('behält `?problems` in seiner alten Form', async () => {
    const { app } = await probe();
    const { status, body } = await fotos(app, '?problems=1');

    expect(status).toBe(200);
    expect(body.count).toBe(0);
  });
});
