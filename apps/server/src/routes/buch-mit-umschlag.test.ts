/**
 * `POST /api/export/pdf-mit-umschlag` — der eine Uploadweg, der Umschlag und
 * Innenteil in einer Datei erwartet, mit dem Umschlag als erster Seite.
 *
 * Die Geometrie- und Zeichenfragen prüft `render-pdf.cover.test.ts` im
 * Renderer-Paket; hier geht es um die Verdrahtung der Route selbst — dass sie
 * wirklich `renderCover()` und `renderAll()` desselben Projekts kombiniert und
 * eine Datei mit dem Umschlag zuerst herausschreibt.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { mmToPt } from '@franibook/core';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import { Zuletzt } from '../zuletzt.js';
import type { Kontext } from './kontext.js';

async function probe(): Promise<{ app: FastifyInstance; outDir: string; project: Project }> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-export-umschlag-'));
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
    fileName: '2017-03-05.jpg',
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    takenAt: '2017-03-05T12:00:00',
  });
  project.settings.targetPages = 4;
  project.generate();

  const kontext = {
    project,
    sources,
    zuletzt: new Zuletzt(join(dir, 'zuletzt.json')),
    previews: null as never,
    decodes: { rescue: async () => undefined } as never,
    abstaende: null as never,
    cacheDir: join(dir, '.franibook-cache'),
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, outDir: dir, project };
}

/** Wie viele Seiten das fertige PDF wirklich hat, und ihre Maße der Reihe nach. */
function mediaBoxen(pdf: string): string[] {
  return pdf.match(/\/MediaBox \[[^\]]*\]/g) ?? [];
}

describe('POST /api/export/pdf-mit-umschlag', () => {
  it('schreibt eine Datei mit dem Umschlag als erster Seite, gefolgt vom Innenteil', async () => {
    const { app, outDir, project } = await probe();
    const cover = project.renderCover();
    const spreadCount = project.renderAll().length;

    const res = await app.inject({ method: 'POST', url: '/api/export/pdf-mit-umschlag' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { fileName: string; pages: number };
    expect(body.fileName).toBe('buch-mit-umschlag.pdf');
    // Ein Blatt mehr als Doppelseiten – der Umschlag zählt als eigene Seite.
    expect(body.pages).toBe(spreadCount + 1);

    const pdf = (await readFile(join(outDir, body.fileName))).toString('latin1');
    const boxen = mediaBoxen(pdf);
    expect(boxen).toHaveLength(spreadCount + 1);
    // Die erste Seite trägt die Maße des Umschlagbogens, nicht die einer
    // Doppelseite – das ist der ganze Zweck dieser Route.
    expect(boxen[0]).toBe(
      `/MediaBox [0 0 ${mmToPt(cover.widthMm).toFixed(6)} ${mmToPt(cover.heightMm).toFixed(6)}]`,
    );
  });

  it('meldet ein Buch ohne Doppelseite als 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'franibook-export-umschlag-leer-'));
    const sources = new Sources();
    const project = new Project(sources, null as never, null as never, dir);
    // Kein Foto, kein `generate()` – dasselbe „nichts zum Exportieren" wie bei
    // `/api/export/pdf` für ein frisches, leeres Projekt.
    const kontext = {
      project,
      sources,
      zuletzt: new Zuletzt(join(dir, 'zuletzt.json')),
      previews: null as never,
      decodes: { rescue: async () => undefined } as never,
      abstaende: null as never,
      cacheDir: join(dir, '.franibook-cache'),
      outDir: dir,
    } as Kontext;
    const { app } = baueApp({ kontext, anlauf: () => null, logger: false });

    const res = await app.inject({ method: 'POST', url: '/api/export/pdf-mit-umschlag' });

    expect(res.statusCode).toBe(404);
  });
});
