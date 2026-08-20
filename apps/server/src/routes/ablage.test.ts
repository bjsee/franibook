/**
 * Die Projektdatei wechseln: öffnen, unter neuem Namen speichern, neu beginnen.
 *
 * Drei Zusagen, die hier hart geprüft werden, weil an jeder von ihnen ein
 * ganzes Buch hängt:
 *
 * 1. **Ein Fehlschlag lässt den offenen Stand unangetastet.** Wer sich im Dialog
 *    verklickt und eine beliebige JSON-Datei wählt, bekommt einen Satz — und
 *    nicht ein Projekt aus zwei Büchern.
 * 2. **„Speichern unter" schreibt auch weiterhin dorthin.** Ein „Speichern
 *    unter", nach dem der nächste Handgriff wieder in die alte Datei geht, wäre
 *    ein Export mit falschem Namen.
 * 3. **„Neues Projekt" überschreibt keine bestehende Datei.** Es ist der einzige
 *    Griff hier, der Arbeit vernichten kann, ohne etwas dafür zu geben.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import type { Dateidialog } from '../dateidialog.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import { Zuletzt } from '../zuletzt.js';
import { ENDUNG } from '../project/ablage.js';
import type { Kontext } from './kontext.js';

const ursprung = { origin: 'http://127.0.0.1:5174' };

interface Probe {
  app: FastifyInstance;
  project: Project;
  zuletzt: Zuletzt;
  /** Das Arbeitsverzeichnis dieses Testlaufs. */
  dir: string;
  /** Wohin der ausgetauschte Dialog antwortet — je Test gesetzt. */
  gewaehlt: { pfad: string | null };
}

/**
 * Ein Projekt mit einem Foto und einer Bildquelle, in einer eigenen Datei.
 *
 * Mit Endung angelegt, denn das ist die Form, um die es hier geht; die alte
 * Verzeichnisform prüft `project/ablage.test.ts` an der Deutung des Pfades.
 */
async function probe(): Promise<Probe> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-ablage-'));
  const quelle = join(dir, 'bilder');
  await mkdir(quelle, { recursive: true });
  await writeFile(join(quelle, '2017-03-05.jpg'), 'kein echtes Bild');

  const sources = new Sources();
  const { source } = await sources.add(quelle, 'Probe');
  const project = new Project(sources, null as never, null as never, join(dir, `erstes${ENDUNG}`));
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
  project.generate();
  await project.save();

  const zuletzt = new Zuletzt(join(dir, 'zuletzt.json'));
  const gewaehlt: { pfad: string | null } = { pfad: null };
  // Ausgetauschter Dialog, aus demselben Grund wie die Videowerkzeuge im
  // Rundlauf: Ein echter ginge im Test auf und wartete auf einen Klick.
  const dialog: Dateidialog = {
    oeffnen: async () => gewaehlt.pfad,
    speichern: async () => gewaehlt.pfad,
  };

  const kontext = {
    project,
    sources,
    zuletzt,
    dialog,
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    cacheDir: '.franibook-cache',
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, project, zuletzt, dir, gewaehlt };
}

/** Ein zweites, vollständiges Projekt als Datei — mit anderen Einstellungen. */
async function zweitesProjekt(dir: string, name: string): Promise<string> {
  const pfad = join(dir, `${name}${ENDUNG}`);
  const quelle = join(dir, `${name}-bilder`);
  await mkdir(quelle, { recursive: true });

  const sources = new Sources();
  const { source } = await sources.add(quelle, name);
  const zweit = new Project(sources, null as never, null as never, pfad);
  zweit.photos.set('q0', {
    id: 'q0',
    relPath: 'a.jpg',
    sourceId: source.id,
    fileName: 'a.jpg',
    bytes: 1_000_000,
    width: 3000,
    height: 2000,
    orientation: 1,
    takenAt: '2020-06-01T12:00:00',
  });
  zweit.photos.set('q1', {
    id: 'q1',
    relPath: 'b.jpg',
    sourceId: source.id,
    fileName: 'b.jpg',
    bytes: 1_000_000,
    width: 3000,
    height: 2000,
    orientation: 1,
    takenAt: '2020-06-02T12:00:00',
  });
  zweit.settings.tilt = 0;
  zweit.generate();
  await zweit.save();
  return pfad;
}

describe('Ein anderes Projekt öffnen', () => {
  it('tauscht Bestand, Buch und Bildquellen aus', async () => {
    const p = await probe();
    const pfad = await zweitesProjekt(p.dir, 'zweites');

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad },
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ ok: true, name: 'zweites', photoCount: 2 });
    expect([...p.project.photos.keys()]).toEqual(['q0', 'q1']);
    expect(p.project.sources.list().map((q) => q.label)).toEqual(['zweites']);
    expect(p.project.ablageInfo.pfad).toBe(pfad);
  });

  it('erbt die Einstellungen des vorherigen Buches nicht', async () => {
    const p = await probe();
    // Ein Regler, den das erste Buch gesetzt hat und das zweite gar nicht kennt.
    p.project.settings.targetPages = 60;
    const pfad = await zweitesProjekt(p.dir, 'zweites');

    await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad },
    });

    // 160 ist die Vorgabe, mit der das zweite Projekt gespeichert wurde – nicht
    // die 60 des ersten. Auf `this.settings` aufzusetzen hieße, dass ein Buch
    // die Regler seines Vorgängers erbt.
    expect(p.project.settings.targetPages).toBe(160);
  });

  it('schreibt das geöffnete Projekt in die Liste der letzten', async () => {
    const p = await probe();
    const pfad = await zweitesProjekt(p.dir, 'zweites');

    await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad },
    });

    expect((await p.zuletzt.vermerke())[0]).toMatchObject({ pfad, name: 'zweites' });
  });

  it('lässt den offenen Stand bei einer fremden Datei unangetastet', async () => {
    const p = await probe();
    const fremd = join(p.dir, `fremd${ENDUNG}`);
    await writeFile(fremd, JSON.stringify({ irgendwas: true }), 'utf8');

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad: fremd },
    });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error).toContain('Franibook-Projekt');
    expect([...p.project.photos.keys()]).toEqual(['p0']);
    expect(p.project.ablageInfo.name).toBe('erstes');
  });

  it('nennt die fehlende Datei und legt nichts beiseite', async () => {
    const p = await probe();
    const weg = join(p.dir, `nie-dagewesen${ENDUNG}`);

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad: weg },
    });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error).toContain('keine Datei');
  });

  it('weist einen relativen Pfad mit 400 ab', async () => {
    const p = await probe();

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/oeffnen',
      headers: ursprung,
      payload: { pfad: `../woanders${ENDUNG}` },
    });

    expect(antwort.statusCode).toBe(400);
  });
});

describe('Speichern unter', () => {
  it('schreibt den Stand an die neue Stelle und arbeitet dort weiter', async () => {
    const p = await probe();
    const ziel = join(p.dir, 'kopie');

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/speichern-unter',
      headers: ursprung,
      payload: { pfad: ziel },
    });

    expect(antwort.statusCode).toBe(200);
    // Die Endung wird ergänzt: Wer „kopie" tippt, meint keine Verzeichnisform.
    expect(antwort.json()).toMatchObject({ ok: true, name: 'kopie' });

    // Der nächste Griff muss an der neuen Stelle landen, sonst wäre das
    // „Speichern unter" ein Export mit falschem Namen gewesen.
    await p.app.inject({
      method: 'PATCH',
      url: '/api/cover',
      headers: ursprung,
      payload: { title: 'Anderer Titel' },
    });
    // Die Endpunkte speichern nebenläufig (`void project.save()`); ein eigenes
    // `save()` reiht sich in dieselbe Kette und ist damit auch das Warten auf
    // den vorherigen Schreibvorgang.
    await p.project.save();
    const geschrieben = JSON.parse(await readFile(`${ziel}${ENDUNG}`, 'utf8')) as {
      cover: { title?: string };
    };
    expect(geschrieben.cover.title).toBe('Anderer Titel');
  });

  it('lässt die alte Datei liegen — sie ist der Stand von vorher', async () => {
    const p = await probe();

    await p.app.inject({
      method: 'POST',
      url: '/api/ablage/speichern-unter',
      headers: ursprung,
      payload: { pfad: join(p.dir, 'kopie') },
    });

    const alt = JSON.parse(await readFile(join(p.dir, `erstes${ENDUNG}`), 'utf8')) as {
      photos: unknown[];
    };
    expect(alt.photos).toHaveLength(1);
  });
});

describe('Ein neues Projekt beginnen', () => {
  it('leert Fotos und Buch, behält aber die Bildquellen', async () => {
    const p = await probe();

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/neu',
      headers: ursprung,
      payload: { pfad: join(p.dir, 'drittes') },
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().hinweise[0]).toContain('Bildquelle bleibt');
    expect(p.project.photos.size).toBe(0);
    expect(p.project.spreads).toHaveLength(0);
    // Die Quellen bleiben, weil ein neues Buch fast immer aus demselben Archiv
    // entsteht (Begründung an `Project.neu`).
    expect(p.project.sources.list()).toHaveLength(1);
    expect(p.project.ablageInfo.name).toBe('drittes');
  });

  it('überschreibt keine bestehende Datei', async () => {
    const p = await probe();
    const belegt = await zweitesProjekt(p.dir, 'belegt');

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/neu',
      headers: ursprung,
      payload: { pfad: belegt },
    });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error).toContain('gibt es schon');
    // Weder die fremde Datei noch der offene Stand haben sich gerührt.
    const unberuehrt = JSON.parse(await readFile(belegt, 'utf8')) as { photos: unknown[] };
    expect(unberuehrt.photos).toHaveLength(2);
    expect(p.project.photos.size).toBe(1);
  });
});

describe('Der Dateidialog', () => {
  it('gibt den gewählten Pfad zurück', async () => {
    const p = await probe();
    p.gewaehlt.pfad = join(p.dir, `aus-dem-dialog${ENDUNG}`);

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/dialog',
      headers: ursprung,
      payload: { art: 'oeffnen' },
    });

    expect(antwort.json()).toEqual({ pfad: p.gewaehlt.pfad });
  });

  it('meldet einen Abbruch als Antwort und nicht als Fehler', async () => {
    const p = await probe();
    p.gewaehlt.pfad = null;

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/dialog',
      headers: ursprung,
      payload: { art: 'speichern' },
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ pfad: null });
  });

  it('weist eine unbekannte Art ab', async () => {
    const p = await probe();

    const antwort = await p.app.inject({
      method: 'POST',
      url: '/api/ablage/dialog',
      headers: ursprung,
      payload: { art: 'loeschen' },
    });

    expect(antwort.statusCode).toBe(400);
  });
});

describe('Die Liste der letzten Projekte', () => {
  it('sagt zu jedem Eintrag, ob seine Datei noch da ist', async () => {
    const p = await probe();
    await p.zuletzt.merke({ pfad: join(p.dir, `weg${ENDUNG}`), name: 'weg' });
    await p.zuletzt.merke(p.project.ablageInfo);

    const antwort = await p.app.inject({ method: 'GET', url: '/api/ablage' });
    const daten = antwort.json() as {
      ablage: { name: string };
      zuletzt: { name: string; vorhanden: boolean }[];
    };

    expect(daten.ablage.name).toBe('erstes');
    expect(daten.zuletzt.map((v) => [v.name, v.vorhanden])).toEqual([
      ['erstes', true],
      ['weg', false],
    ]);
  });

  it('vergisst einen Eintrag auf Verlangen, ohne die Datei anzufassen', async () => {
    const p = await probe();
    await p.zuletzt.merke(p.project.ablageInfo);

    const antwort = await p.app.inject({
      method: 'DELETE',
      url: `/api/ablage/zuletzt?pfad=${encodeURIComponent(p.project.ablageInfo.pfad)}`,
      headers: ursprung,
    });

    expect(antwort.statusCode).toBe(200);
    expect(await p.zuletzt.vermerke()).toEqual([]);
    // Die Datei selbst bleibt: Die Liste ist eine Merkhilfe, kein Papierkorb.
    await expect(readFile(p.project.ablageInfo.pfad, 'utf8')).resolves.toContain('schemaVersion');
  });
});
