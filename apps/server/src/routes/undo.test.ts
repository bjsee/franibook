/**
 * Die Undo-Tabelle gegen die Wirklichkeit.
 *
 * Der eine Test, der diese Bauweise trägt: Ein Haken, der den Stand festhält,
 * ist nur so vollständig wie seine Tabelle — und eine neue Route, die dort
 * fehlt, ändert das Buch, ohne im Verlauf zu stehen. Das fiele sonst erst auf,
 * wenn jemand Cmd+Z drückt und das Falsche zurückkommt.
 *
 * Geprüft wird in beide Richtungen: keine angemeldete Route ohne Eintrag, kein
 * Eintrag ohne Route. Der zweite Fall ist der leisere — eine umbenannte Route
 * hinterlässt einen Eintrag, der nie mehr greift.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';
import { UNDO_ROUTEN } from './undo.js';

const AENDERND = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function server() {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-undo-'));
  // Echte `Sources`, weil `/api/project` sie abfragt – aber ohne Ordner darin:
  // Kein Test hier liest eine Datei, geprüft wird der Weg durch die Haken.
  const sources = new Sources();
  const project = new Project(sources, null as never, null as never, dir);
  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes: null as never,
    outDir: dir,
  } as Kontext;
  return { ...baueApp({ kontext, anlauf: () => null, logger: false }), project, dir };
}

describe('Undo-Tabelle', () => {
  it('kennt jede Route, die etwas ändern kann', async () => {
    const { routen } = await server();
    const fehlend = routen
      .filter((r) => AENDERND.has(r.method))
      .map((r) => `${r.method} ${r.url}`)
      .filter((kennung) => !(kennung in UNDO_ROUTEN));

    // Eine neue Route gehört in `UNDO_ROUTEN` – mit einer Bezeichnung, wenn sie
    // den Projektzustand ändert, und mit `null`, wenn nicht.
    expect(fehlend).toEqual([]);
  });

  it('führt keinen Eintrag, den es nicht mehr gibt', async () => {
    const { routen } = await server();
    const angemeldet = new Set(routen.map((r) => `${r.method} ${r.url}`));

    expect(Object.keys(UNDO_ROUTEN).filter((k) => !angemeldet.has(k))).toEqual([]);
  });

  it('gibt jeder ändernden Route eine deutsche Bezeichnung', () => {
    for (const [kennung, eintrag] of Object.entries(UNDO_ROUTEN)) {
      if (eintrag === null) continue;
      // Kein Code, kein Routenname: Der Satz steht am Knopf und im Hinweis.
      expect(eintrag.label, kennung).toMatch(/^[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ ]+$/);
    }
  });
});

describe('Verlauf am Server', () => {
  it('hält den Stand fest, ohne dass eine Route etwas davon weiß', async () => {
    const { app, project } = await server();

    await app.inject({ method: 'PATCH', url: '/api/cover', payload: { title: 'Franziska' } });
    expect(project.cover.title).toBe('Franziska');
    expect(project.verlauf.auskunft().zurueck).toBe('Umschlag geändert');

    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ ok: true, label: 'Umschlag geändert' });
    expect(project.cover.title).toBeUndefined();

    await app.inject({ method: 'POST', url: '/api/redo' });
    expect(project.cover.title).toBe('Franziska');
  });

  it('nennt die betroffene Doppelseite, damit die Oberfläche hinspringt', async () => {
    const { app, project } = await server();
    project.spreads = [
      { id: 's0', index: 0, templateId: 'spread.blank', slots: [] },
      { id: 's1', index: 1, templateId: 'spread.blank', slots: [] },
    ];

    await app.inject({
      method: 'PATCH',
      url: '/api/spreads/1/timeline',
      payload: { timeline: false },
    });
    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });

    expect(antwort.json()).toMatchObject({ label: 'Zeitstrahl gesetzt', spreadIndex: 1 });
  });

  it('legt keinen Schritt an, wenn die Anfrage abgelehnt wurde', async () => {
    const { app, project } = await server();

    const antwort = await app.inject({
      method: 'PATCH',
      url: '/api/spreads/7/timeline',
      payload: {},
    });
    expect(antwort.statusCode).toBe(404);
    // Ein Cmd+Z, das nichts tut, sieht aus wie ein Fehler.
    expect(project.verlauf.auskunft().zurueck).toBeNull();
  });

  it('meldet einen leeren Verlauf als Konflikt, statt still nichts zu tun', async () => {
    const { app } = await server();
    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json()).toEqual({ ok: false, error: 'Nichts zurückzunehmen' });
  });

  it('schreibt die Auskunft für die beiden Knöpfe in /api/project', async () => {
    const { app } = await server();
    await app.inject({ method: 'PATCH', url: '/api/cover', payload: { title: 'Franziska' } });

    // `/api/project` fragt die Oberfläche nach jeder Änderung ohnehin ab.
    const antwort = await app.inject({ method: 'GET', url: '/api/project' });
    expect(antwort.json()).toMatchObject({
      undo: { zurueck: 'Umschlag geändert', vor: null, tiefe: { zurueck: 1, vor: 0 } },
    });
  });
});
