/**
 * `fileName` beim PDF-Export ist ein Anfrageparameter, der über `join(outDir,
 * fileName)` auf die Platte trifft – ohne Prüfung wäre `../../etc/…` ein
 * Schreibloch außerhalb von `outDir`. Dieser Test hält fest, dass alle
 * Export-Routen einen solchen Namen ablehnen, statt ihn zu verwenden.
 *
 * Seit es `GET /api/export/:fileName` gibt, gilt dasselbe in Leserichtung: Dort
 * wäre ein `..` ein Leseloch auf jede Datei, die der Serverprozess öffnen darf.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import { EXPORT_DATEINAME, type Kontext } from './kontext.js';

async function probe(): Promise<{ app: FastifyInstance; outDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-export-'));
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
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, outDir: dir };
}

describe('Export-Dateiname', () => {
  it('lehnt einen Pfad-Traversal-Namen beim Buchexport ab', async () => {
    const { app } = await probe();

    const res = await app.inject({
      method: 'POST',
      url: '/api/export/pdf',
      payload: { fileName: '../../../evil.pdf' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('lehnt einen Pfad-Traversal-Namen beim Korrekturabzug ab', async () => {
    const { app } = await probe();

    const res = await app.inject({
      method: 'POST',
      url: '/api/export/abzug',
      payload: { fileName: '../../../evil.pdf' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('lehnt einen Pfad-Traversal-Namen beim Umschlagexport ab', async () => {
    const { app } = await probe();

    const res = await app.inject({
      method: 'POST',
      url: '/api/export/cover',
      payload: { fileName: '../../../evil.pdf' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('liefert keine Datei außerhalb des Ausgabeordners aus', async () => {
    const { app, outDir } = await probe();
    // Eine lesbare Datei eine Ebene über `outDir` – das Ziel, das ein `..`
    // erreichen wollte.
    await writeFile(join(outDir, '..', 'geheim.pdf'), 'nicht für die Route');

    for (const pfad of [
      '/api/export/..%2Fgeheim.pdf',
      '/api/export/%2E%2E%2Fgeheim.pdf',
      '/api/export/geheim.txt',
    ]) {
      const res = await app.inject({ method: 'GET', url: pfad });
      // Ausdrücklich 400 und nicht bloß „nicht 200": Fastify dekodiert `%2F`
      // im Segment, die Anfrage erreicht den Handler also wirklich. Ein 404
      // hieße, der Router hätte sie vorher abgefangen — dann prüfte dieser Test
      // die Namensprüfung gar nicht.
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain('nicht für die Route');
    }
  });

  it('meldet eine noch nicht erzeugte Datei als fehlend, nicht als Fehler', async () => {
    const { app } = await probe();

    const res = await app.inject({ method: 'GET', url: '/api/export/abzug.pdf' });

    expect(res.statusCode).toBe(404);
  });

  it('liefert eine erzeugte Datei aus', async () => {
    const { app, outDir } = await probe();
    await writeFile(join(outDir, 'abzug.pdf'), '%PDF-1.3 Platzhalter');

    const res = await app.inject({ method: 'GET', url: '/api/export/abzug.pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // `inline`, damit der Browser sie zeigt statt sie in den Download-Ordner zu
    // legen – das ist der ganze Zweck des Öffnen-Links.
    expect(res.headers['content-disposition']).toContain('inline');
  });

  it('lässt unverfängliche Dateinamen weiterhin durch', () => {
    expect(EXPORT_DATEINAME.test('mein-export.pdf')).toBe(true);
    expect(EXPORT_DATEINAME.test('buch.pdf')).toBe(true);
    expect(EXPORT_DATEINAME.test('spread-3.pdf')).toBe(true);
    expect(EXPORT_DATEINAME.test('../../etc/evil.pdf')).toBe(false);
    expect(EXPORT_DATEINAME.test('/etc/evil.pdf')).toBe(false);
    expect(EXPORT_DATEINAME.test('evil.pdf/../x')).toBe(false);
  });
});
