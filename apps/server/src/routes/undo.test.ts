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
    abstaende: null as never,
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
    const SATZ = /^[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ ]+$/;
    for (const [kennung, eintrag] of Object.entries(UNDO_ROUTEN)) {
      if (eintrag === null) continue;
      // Kein Code, kein Routenname: Der Satz steht am Knopf und im Hinweis.
      if (typeof eintrag.label === 'string') {
        expect(eintrag.label, kennung).toMatch(SATZ);
        continue;
      }
      // Ein Label darf vom Körper der Anfrage abhängen, wenn eine Route mehr als
      // eine Sache tut. Die Regel gilt dann für jeden Zweig – geprüft an beiden
      // Formen, die vorkommen: mit und ohne die Felder, an denen es sich
      // entscheidet.
      for (const body of [undefined, {}, { place: null }, { place: { label: 'Kreta' } }]) {
        expect(eintrag.label({}, body), `${kennung} bei ${JSON.stringify(body)}`).toMatch(SATZ);
      }
    }
  });

  it('nennt beim Quellenwechsel den Griff, der stattfand', () => {
    // Dieselbe Route benennt eine Quelle um und zieht sie um (`Sources.reroot`).
    // „Quelle umbenannt" über einem zurückgenommenen Umzug kündigte als
    // Kleinigkeit an, was den Weg zum ganzen Bestand zurückstellt.
    const eintrag = UNDO_ROUTEN['PATCH /api/sources/:id'];
    const satz = (body: unknown) =>
      eintrag !== null && typeof eintrag?.label === 'function'
        ? eintrag.label({}, body)
        : undefined;

    expect(satz({ label: 'NAS' })).toBe('Quelle umbenannt');
    expect(satz({ root: '/Volumes/neu/buch' })).toBe('Quelle umgezogen');
    // Dieselbe Bedingung wie im Handler: ein Pfad, der nach dem Trimmen steht.
    expect(satz({ root: '   ' })).toBe('Quelle umbenannt');
  });
});

describe('Verlauf am Server', () => {
  it('hält den Stand fest, ohne dass eine Route etwas davon weiß', async () => {
    const { app, project } = await server();

    await app.inject({ method: 'PATCH', url: '/api/cover', payload: { title: 'Frani' } });
    expect(project.cover.title).toBe('Frani');
    expect(project.verlauf.auskunft().zurueck).toBe('Umschlag geändert');

    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ ok: true, label: 'Umschlag geändert' });
    expect(project.cover.title).toBeUndefined();

    await app.inject({ method: 'POST', url: '/api/redo' });
    expect(project.cover.title).toBe('Frani');
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

  it('legt für eine wirkungslose Abnahme keinen Schritt an', async () => {
    // Der Fall, den der Haken abfangen muss: Ein zweites „ist ok" auf denselben
    // Befund ändert nichts — bliebe der Schritt stehen, nähme ein Cmd+Z einen
    // Stand zurück, der derselbe ist.
    const { app, project } = await server();
    const schluessel = project.abnahme().befunde[0]?.schluessel;
    expect(schluessel, 'die Probe braucht einen Befund').toBeDefined();

    const erste = await app.inject({
      method: 'POST',
      url: '/api/book/pruefung/abnahmen',
      payload: { schluessel },
    });
    expect(erste.statusCode).toBe(200);
    expect(project.verlauf.auskunft().zurueck).toBe('Befund abgenickt');

    const zweite = await app.inject({
      method: 'POST',
      url: '/api/book/pruefung/abnahmen',
      payload: { schluessel },
    });
    expect(zweite.statusCode).toBe(409);
    expect(project.verlauf.auskunft().tiefe.zurueck).toBe(1);
  });

  it('legt für einen wirkungslosen Stapelgriff keinen Schritt an', async () => {
    // Der Unterschied zur abgelehnten Anfrage: Diese hier *gelingt* — Status 200,
    // mit der Liste, welches Foto warum übersprungen wurde. Geändert hat sie
    // trotzdem nichts, und ein Schritt darauf nähme einen Stand zurück, der
    // derselbe ist.
    const { app, project } = await server();
    project.photos.set('a', {
      id: 'a',
      relPath: 'a.jpg',
      fileName: 'a.jpg',
      bytes: 1000,
      width: 4000,
      height: 3000,
      orientation: 1,
    });

    const erste = await app.inject({
      method: 'PATCH',
      url: '/api/photos',
      payload: { ids: ['a'], weight: 'hero' },
    });
    expect(erste.json()).toMatchObject({ geaendert: 1 });
    expect(project.verlauf.auskunft().tiefe.zurueck).toBe(1);

    // Dasselbe Gewicht noch einmal: Die Antwort ist eine 200 mit Begründung.
    const zweite = await app.inject({
      method: 'PATCH',
      url: '/api/photos',
      payload: { ids: ['a'], weight: 'hero' },
    });
    expect(zweite.statusCode).toBe(200);
    expect(zweite.json()).toMatchObject({
      geaendert: 0,
      uebersprungen: [{ id: 'a', grund: 'Schon Hauptbild' }],
    });
    expect(project.verlauf.auskunft().tiefe.zurueck).toBe(1);

    // Und der eine Schritt, der steht, nimmt auch das Richtige zurück.
    await app.inject({ method: 'POST', url: '/api/undo' });
    expect(project.overrides['a']).toBeUndefined();
  });

  it('weist eine Abnahme ohne brauchbaren Schlüssel ab', async () => {
    const { app } = await server();

    const ohne = await app.inject({ method: 'POST', url: '/api/book/pruefung/abnahmen' });
    expect(ohne.statusCode).toBe(400);

    const erfunden = await app.inject({
      method: 'POST',
      url: '/api/book/pruefung/abnahmen',
      payload: { schluessel: 'ausgedacht#foto:xyz' },
    });
    expect(erfunden.statusCode).toBe(409);

    // Und ein Zurücknehmen, das nichts vorfindet, ist ebenfalls ein Konflikt.
    const leer = await app.inject({ method: 'DELETE', url: '/api/book/pruefung/abnahmen' });
    expect(leer.statusCode).toBe(409);
  });

  it('meldet einen leeren Verlauf als Konflikt, statt still nichts zu tun', async () => {
    const { app } = await server();
    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json()).toEqual({ ok: false, error: 'Nichts zurückzunehmen' });
  });

  it('hängt die Befunde der Abnahme an jede Doppelseitenantwort', async () => {
    // Die Bühne blendet sie am Bild ein. Käme `befunde` nicht mit, sähe man
    // beim Bearbeiten nichts von dem, was die Liste meldet.
    const { app, project } = await server();
    // Eine Doppelseite ohne Bilder genügt: Sie meldet „ganz leer", und damit
    // gibt es einen Befund an einer Seite, den die Antwort tragen muss.
    project.spreads = [{ id: 's1', index: 0, templateId: 'spread.4up.grid', slots: [] }];
    const schluessel = project.abnahme().befunde.find((b) => b.ort.kind === 'spread')?.schluessel;
    expect(schluessel, 'die Probe braucht einen Befund an einer Doppelseite').toBeDefined();
    await app.inject({
      method: 'POST',
      url: '/api/book/pruefung/abnahmen',
      payload: { schluessel },
    });

    const antwort = await app.inject({ method: 'GET', url: '/api/spreads/0' });
    const befunde = antwort.json<{ befunde?: { schluessel: string; abgenommen?: true }[] }>()
      .befunde;

    expect(befunde?.length).toBeGreaterThan(0);
    // Und markiert: Die Bühne zeigt eine abgenickte Marke leise statt gar nicht.
    expect(befunde?.find((b) => b.schluessel === schluessel)?.abgenommen).toBe(true);
  });

  it('schreibt die Auskunft für die beiden Knöpfe in /api/project', async () => {
    const { app } = await server();
    await app.inject({ method: 'PATCH', url: '/api/cover', payload: { title: 'Frani' } });

    // `/api/project` fragt die Oberfläche nach jeder Änderung ohnehin ab.
    const antwort = await app.inject({ method: 'GET', url: '/api/project' });
    expect(antwort.json()).toMatchObject({
      undo: { zurueck: 'Umschlag geändert', vor: null, tiefe: { zurueck: 1, vor: 0 } },
    });
  });
});
