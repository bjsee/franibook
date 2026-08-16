/**
 * Der Origin-Schutz gegen CSRF-artige Anfragen.
 *
 * Der Server läuft ohne Authentifizierung nur auf `127.0.0.1` – seine einzige
 * Zusage ist, dass niemand von außen mitspielt. Ein body-loses `POST` durchläuft
 * aber keinen CORS-Preflight: Jede im selben Browser offene Seite könnte
 * `POST /api/generate` oder `POST /api/import` auslösen. Dieser Test prüft, dass
 * ein fremder `Origin`-Header eine mutierende Route ablehnt, während kein
 * Header (curl, Playwright, `same-origin`) und ein Header vom selben Rechner
 * durchgelassen werden.
 */
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';

async function server() {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-ursprung-'));
  const sources = new Sources();
  const project = new Project(sources, null as never, null as never, dir);
  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    cacheDir: '.franibook-cache',
    outDir: dir,
  } as Kontext;
  return { ...baueApp({ kontext, anlauf: () => null, logger: false }), project };
}

describe('Origin-Schutz', () => {
  it('weist eine mutierende Route mit fremdem Origin ab', async () => {
    const { app, project } = await server();

    const antwort = await app.inject({
      method: 'PATCH',
      url: '/api/cover',
      payload: { title: 'Frani' },
      headers: { origin: 'https://boesartig.example' },
    });

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json()).toMatchObject({ error: expect.any(String) });
    // Die Anfrage hat nichts geändert.
    expect(project.cover.title).toBeUndefined();
  });

  it('lässt dieselbe Route ohne Origin-Header durch', async () => {
    const { app, project } = await server();

    const antwort = await app.inject({
      method: 'PATCH',
      url: '/api/cover',
      payload: { title: 'Frani' },
    });

    expect(antwort.statusCode).toBe(200);
    expect(project.cover.title).toBe('Frani');
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost'])(
    'lässt einen Origin vom selben Rechner durch (%s)',
    async (origin) => {
      const { app, project } = await server();

      const antwort = await app.inject({
        method: 'PATCH',
        url: '/api/cover',
        payload: { title: 'Frani' },
        headers: { origin },
      });

      expect(antwort.statusCode).toBe(200);
      expect(project.cover.title).toBe('Frani');
    },
  );

  it('legt bei einer abgelehnten Anfrage keinen Undo-Schritt an', async () => {
    const { app, project } = await server();

    await app.inject({
      method: 'PATCH',
      url: '/api/cover',
      payload: { title: 'Frani' },
      headers: { origin: 'https://boesartig.example' },
    });

    expect(project.verlauf.auskunft().zurueck).toBeNull();
  });

  it('weist einen Einwurf mit fremdem Origin ab, ohne eine Datei anzulegen', async () => {
    // Die schwerste Folge, die dieser Schutz verhindert: Der Einwurf ist die
    // einzige Route, die in eine Bildquelle **schreibt**. Ohne Eintrag in
    // `UNDO_ROUTEN` – und damit ohne Origin-Prüfung – könnte jede im selben
    // Browser offene Seite Dateien in den Fotobestand legen.
    const dir = await mkdtemp(join(tmpdir(), 'franibook-ursprung-quelle-'));
    const quelle = join(dir, 'bilder');
    await mkdir(quelle, { recursive: true });

    const sources = new Sources();
    await sources.add(quelle, 'Probe');
    const project = new Project(sources, null as never, null as never, dir);
    const kontext = {
      project,
      sources,
      previews: null as never,
      decodes: null as never,
      abstaende: null as never,
      cacheDir: '.franibook-cache',
      outDir: dir,
    } as Kontext;
    const { app } = baueApp({ kontext, anlauf: () => null, logger: false });

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/photos/einwurf?name=fremd.png',
      payload: Buffer.from('was auch immer'),
      headers: { origin: 'https://boesartig.example', 'content-type': 'image/png' },
    });

    expect(antwort.statusCode).toBe(403);
    expect(project.photos.size).toBe(0);
    // Kein Ordner, keine Datei – der Haken läuft vor dem Handler.
    await expect(readdir(join(quelle, 'eingeworfen'))).rejects.toThrow();
  });

  it('rührt eine lesende Route nicht an, egal welcher Origin', async () => {
    const { app } = await server();

    const antwort = await app.inject({
      method: 'GET',
      url: '/api/project',
      headers: { origin: 'https://boesartig.example' },
    });

    expect(antwort.statusCode).toBe(200);
  });
});
