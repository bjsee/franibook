/**
 * Der Rundlauf: jede ändernde Route einmal hin und einmal zurück.
 *
 * Die Aussage „Undo nimmt alles zurück" ist ohne diesen Test eine Behauptung.
 * Geprüft wird sie an jeder Route der Tabelle, und zwar hart: Der serialisierte
 * Stand nach dem Zurücknehmen muss **Zeichen für Zeichen** der von vorher sein.
 * Dazwischen wird verlangt, dass sich überhaupt etwas geändert hat — sonst
 * bestünde der Test aus Aufrufen, die nichts tun, und wäre grün, ohne etwas zu
 * sagen.
 *
 * Der Fall, den er wirklich fängt: ein Zustand, der nicht im `Stand` steckt und
 * darum nicht zurückkommt. `groupStamp` und `lastReport` sind genau daran
 * aufgefallen.
 *
 * Jede Route braucht einen Fall — die Prüfung am Ende sagt es. Barrieren
 * (Import, Quellenwechsel) sind ausgenommen: Sie leeren den Verlauf
 * absichtlich, es gibt nichts zurückzunehmen.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireTemplate } from '@franibook/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { DecodeCache } from '../decode.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';
import { UNDO_ROUTEN } from './undo.js';

/** Sechs Dateien, sechs Fotos, über ein Jahr verteilt. */
const DATEIEN = [
  '2017-03-05.jpg',
  '2017-04-11.jpg',
  '2017-06-19.jpg',
  '2017-08-02.jpg',
  '2017-09-27.jpg',
  '2017-12-24.jpg',
];

interface Probe {
  app: FastifyInstance;
  project: Project;
  sourceId: string;
  photoIds: string[];
  /** Der Quellordner – der Einwurf schreibt hinein. */
  quelle: string;
}

/** Ein Bild als Bytes, für den Einwurf. */
async function bildBytes(breite: number, hoehe: number): Promise<Buffer> {
  return await sharp({ create: { width: breite, height: hoehe, channels: 3, background: '#777' } })
    .png()
    .toBuffer();
}

/**
 * Eine Anfrage, die eine Datei einwirft.
 *
 * Als eigene Form, weil der Rumpf hier kein JSON ist: Der Parser hängt am
 * Medientyp (`app.ts`), also muss der Kopf mit.
 */
async function einwurfAnfrage(url: string): Promise<Anfrage> {
  return {
    method: 'POST',
    url,
    payload: await bildBytes(600, 400),
    headers: { 'content-type': 'image/png' },
  };
}

/**
 * Ein Buch aus sechs Fotos, ohne Import.
 *
 * Die Dateien werden angelegt, weil das Aussortieren eine bewegt; ihr Inhalt
 * spielt keine Rolle. Die `Photo`-Objekte entstehen von Hand — der Import ist
 * hier nicht die Sache, und ein echter bräuchte Bilddaten und `sips`.
 */
async function probe(): Promise<Probe> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-rundlauf-'));
  const quelle = join(dir, 'bilder');
  await mkdir(quelle, { recursive: true });
  for (const datei of DATEIEN) await writeFile(join(quelle, datei), 'kein echtes Bild');

  const sources = new Sources();
  const { source } = await sources.add(quelle, 'Probe');
  // Ein echter Decode-Cache, weil der Einwurf die eingeworfene Datei einliest;
  // die Vorschauen bleiben ungebaut – der Einwurf wärmt keine, ein einzelnes Bild
  // entsteht beim ersten Abruf.
  const decodes = new DecodeCache(join(dir, 'cache'), sources);
  const project = new Project(sources, null as never, decodes, dir);

  const photoIds: string[] = [];
  for (const [i, datei] of DATEIEN.entries()) {
    const id = `p${i}`;
    photoIds.push(id);
    project.photos.set(id, {
      id,
      relPath: datei,
      sourceId: source.id,
      fileName: datei,
      bytes: 2_000_000,
      width: 4000,
      height: 3000,
      orientation: 1,
      takenAt: `${datei.slice(0, 10)}T12:00:00`,
    });
  }

  project.settings.targetPages = 12;
  // Mit Jahresauftakt, weil nur eine Auftaktvorlage Textplätze hat – und der
  // Vorlagentext ist eine der Routen.
  project.settings.chapterOpeners = true;
  project.generate();
  project.createGroup('Ostern', [photoIds[0]!, photoIds[1]!]);

  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes,
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, project, sourceId: source.id, photoIds, quelle };
}

/**
 * Der Stand als Zeichenkette – über die öffentlichen Auskünfte.
 *
 * Ausdrücklich **nicht** über `project.stand()`: Das ist die Funktion, die
 * geprüft wird, und ein Maßstab aus demselben Holz wäre blind für ihren
 * schlimmsten Fehler. Nimmt man ein Feld aus `stand()` heraus, verschwindet es
 * dann auch aus dem Vergleich, und der Test bleibt grün — genau so ist es beim
 * Schreiben dieses Tests passiert.
 *
 * Gemessen wird deshalb, was die Oberfläche sieht: `/api/project` (samt
 * `groupsPending`, Bericht, Handarbeit, Kapiteln), Gruppen, Umschlag – dazu die
 * Doppelseiten und der Bestand als öffentliche Felder.
 *
 * `undo` fällt heraus: Die Tiefe des Verlaufs ist nach einem Zurücknehmen
 * naturgemäß eine andere.
 */
async function abdruck(p: Probe): Promise<string> {
  const hole = async (url: string) => (await p.app.inject({ method: 'GET', url })).json();
  const info = (await hole('/api/project')) as Record<string, unknown>;
  delete info['undo'];

  return JSON.stringify({
    info,
    gruppen: await hole('/api/groups'),
    umschlag: await hole('/api/cover'),
    aussortiert: await hole('/api/photos/aussortiert'),
    spreads: p.project.spreads,
    overrides: p.project.overrides,
    photos: [...p.project.photos.entries()],
    quellen: p.project.sources.list(),
  });
}

/** Der erste Slot mit Bild – und die Doppelseite, auf der er liegt. */
function ersterSlot(project: Project): { index: number; slotId: string } {
  for (const [index, spread] of project.spreads.entries()) {
    const slot = spread.slots.find((s) => s.photoId);
    if (slot) return { index, slotId: slot.slotId };
  }
  throw new Error('Keine Doppelseite mit Bild – die Probe taugt nicht');
}

/** Die erste Doppelseite mit einem Textplatz in ihrer Vorlage. */
function ersterTextplatz(project: Project): { index: number; slotId: string } {
  for (const [index, spread] of project.spreads.entries()) {
    const platz = requireTemplate(spread.templateId).textSlots?.[0];
    if (platz) return { index, slotId: platz.id };
  }
  throw new Error('Keine Vorlage mit Textplatz – die Probe taugt nicht');
}

interface Anfrage {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: object | Buffer;
  headers?: Record<string, string>;
}

/**
 * Zu jeder Route: was gerufen wird.
 *
 * Als Funktion und nicht als Literal, weil die Kennungen erst im Buch
 * entstehen – Slots, Gruppen, Vorlagen. Manche Fälle richten sich vorher etwas
 * ein (einen Ausschnitt, einen Textblock, einen Notanker); das geschieht hier,
 * also **vor** dem Abdruck, und gehört damit zur Ausgangslage.
 */
const FAELLE: Record<string, (p: Probe) => Promise<Anfrage> | Anfrage> = {
  'POST /api/generate': () => ({
    method: 'POST',
    url: '/api/generate',
    payload: { targetPages: 20 },
  }),

  'PATCH /api/settings': () => ({
    method: 'PATCH',
    url: '/api/settings',
    payload: { tilt: 3, timeline: false },
  }),

  // Ein anderes Format als die Vorgabe, sonst änderte der Aufruf nichts und
  // der Rundlauf prüfte eine Zustandsgleichheit, die schon vorher galt.
  'PATCH /api/format': () => ({
    method: 'PATCH',
    url: '/api/format',
    payload: { printProfileId: 'format-19x19' },
  }),

  'PUT /api/chapters/:year/events': () => ({
    method: 'PUT',
    url: '/api/chapters/2017/events',
    payload: { events: ['Erster Schultag', 'Umzug'] },
  }),

  'POST /api/book/layout': async ({ app, project }) => {
    // Ein Bild aus der letzten Doppelseite nehmen. Die Vorlage muss dabei auf
    // `auto`: Mit einem Bild weniger passt die alte nicht mehr.
    const antwort = await app.inject({ method: 'GET', url: '/api/book/layout' });
    const doc = antwort.json() as {
      spreads: { n: number; template?: string; photos: unknown[] }[];
    };
    const letzte = doc.spreads.findLast((s) => s.photos.length > 1);
    if (!letzte) throw new Error('Keine Doppelseite mit zwei Bildern');
    letzte.photos.pop();
    letzte.template = 'auto';
    expect(project.spreads.length).toBeGreaterThan(0);
    return { method: 'POST', url: '/api/book/layout', payload: doc };
  },

  'POST /api/book/move': ({ project }) => {
    // Zwei Bilder derselben Doppelseite tauschen: Das ist der Zug, der die
    // Bilderzahl nicht ändert und deshalb immer geht.
    const treffer = project.spreads.findIndex(
      (s) => s.slots.filter((sl) => sl.photoId).length >= 2,
    );
    const spread = project.spreads[treffer];
    if (!spread) throw new Error('Keine Doppelseite mit zwei Bildern');
    const [a, b] = spread.slots.filter((sl) => sl.photoId);
    return {
      method: 'POST',
      url: '/api/book/move',
      payload: {
        source: { kind: 'slot', spreadIndex: treffer, slotId: a!.slotId },
        target: { kind: 'slot', spreadIndex: treffer, slotId: b!.slotId },
      },
    };
  },

  'PATCH /api/spreads/:index/half': ({ project }) => {
    // Nicht die erste Doppelseite: Ist sie ein Jahresauftakt, gibt es dort
    // keine seitenweise Wahl – sie verlöre Jahreszahl und Ereigniszeilen.
    const index = project.spreads.findIndex((_, i) => !project.halfChoices(i).auftakt);
    const { halves, current } = project.halfChoices(index);
    const andere = halves.find((h) => h.id !== current.left);
    if (index < 0 || !andere) throw new Error('Keine zweite Halbseite zur Wahl');
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/half`,
      payload: { side: 'left', halfId: andere.id },
    };
  },

  'PATCH /api/spreads/:index/template': ({ project }) => {
    const andere = project.templateChoices(0).find((t) => !t.current);
    if (!andere) throw new Error('Keine zweite Vorlage zur Wahl');
    return {
      method: 'PATCH',
      url: '/api/spreads/0/template',
      payload: { templateId: andere.id },
    };
  },

  'POST /api/spreads': () => ({ method: 'POST', url: '/api/spreads', payload: { at: 1 } }),

  'POST /api/spreads/page': () => ({
    method: 'POST',
    url: '/api/spreads/page',
    payload: { atPage: 2 },
  }),

  'DELETE /api/spreads/page/:atPage': async ({ app }) => {
    // Erst eine einzelne Seite einfügen: Eine leere Halbseite lässt sich sicher
    // wieder herausnehmen, eine beliebige Seite des Buches nicht.
    const antwort = await app.inject({
      method: 'POST',
      url: '/api/spreads/page',
      payload: { atPage: 2 },
    });
    expect(antwort.statusCode).toBe(200);
    return { method: 'DELETE', url: '/api/spreads/page/2' };
  },

  'DELETE /api/spreads/:index': () => ({ method: 'DELETE', url: '/api/spreads/1' }),

  'PATCH /api/spreads/:index/locked': () => ({
    method: 'PATCH',
    url: '/api/spreads/1/locked',
    payload: { locked: true },
  }),

  'PATCH /api/spreads/:index/background': () => ({
    method: 'PATCH',
    url: '/api/spreads/1/background',
    // Ein Ton aus der geschlossenen Palette (`BACKGROUND_COLORS`): Ein freier
    // Hexwert wird seit der Prüfung in `setSpreadBackground` abgelehnt.
    payload: { color: '#eae5db' },
  }),

  'PATCH /api/spreads/:index/timeline': () => ({
    method: 'PATCH',
    url: '/api/spreads/1/timeline',
    payload: { timeline: false },
  }),

  // Mit Fallstelle: Das Bild bekommt einen freien Platz, die Anordnung bleibt.
  // Der Rundlauf prüft hier vor allem, dass der freie Platz beim Zurücknehmen
  // wieder verschwindet – er steht in `spreads`, das Foto in `photos`.
  'POST /api/spreads/:index/einwurf': async () =>
    await einwurfAnfrage('/api/spreads/1/einwurf?name=Einwurf.png&x=0.3&y=0.4'),

  'POST /api/photos/einwurf': async () => await einwurfAnfrage('/api/photos/einwurf?name=Pool.png'),

  'PATCH /api/spreads/:index/slots/:slotId/crop': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/crop`,
      payload: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 },
    };
  },

  'DELETE /api/spreads/:index/slots/:slotId/crop': async ({ app, project }) => {
    const { index, slotId } = ersterSlot(project);
    // Zurücksetzen ändert nur etwas, wenn vorher einer von Hand gesetzt war.
    await app.inject({
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/crop`,
      payload: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 },
    });
    return { method: 'DELETE', url: `/api/spreads/${index}/slots/${slotId}/crop` };
  },

  'PATCH /api/spreads/:index/slots/:slotId/rotate': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/rotate`,
      payload: { deg: 7 },
    };
  },

  'PATCH /api/spreads/:index/slots/:slotId/frame': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/frame`,
      payload: { frame: 'polaroid' },
    };
  },

  'PATCH /api/spreads/:index/slots/:slotId/caption': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/caption`,
      payload: { caption: 'Am Meer' },
    };
  },

  'PATCH /api/spreads/:index/slots/:slotId/rect': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/rect`,
      payload: { rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.25 } },
    };
  },

  'PATCH /api/spreads/:index/slots/:slotId/layer': ({ project }) => {
    const { index, slotId } = ersterSlot(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/slots/${slotId}/layer`,
      payload: { zug: 'vorn' },
    };
  },

  'PATCH /api/spreads/:index/textslots/:slotId': ({ project }) => {
    const { index, slotId } = ersterTextplatz(project);
    return {
      method: 'PATCH',
      url: `/api/spreads/${index}/textslots/${slotId}`,
      payload: { content: '2017 – das erste Jahr', rotateDeg: 3 },
    };
  },

  'POST /api/spreads/:index/texts': () => ({
    method: 'POST',
    url: '/api/spreads/0/texts',
    payload: { content: 'Ein Zitat' },
  }),

  'PATCH /api/spreads/:index/texts/:id': async ({ app }) => {
    const antwort = await app.inject({ method: 'POST', url: '/api/spreads/0/texts', payload: {} });
    const { block } = antwort.json() as { block: { id: string } };
    return {
      method: 'PATCH',
      url: `/api/spreads/0/texts/${block.id}`,
      payload: { content: 'Am Meer, Juni' },
    };
  },

  'DELETE /api/spreads/:index/texts/:id': async ({ app }) => {
    const antwort = await app.inject({ method: 'POST', url: '/api/spreads/0/texts', payload: {} });
    const { block } = antwort.json() as { block: { id: string } };
    return { method: 'DELETE', url: `/api/spreads/0/texts/${block.id}` };
  },

  // `reset` verwirft die angelegte Gruppe – ohne ihn fände der Vorschlag an
  // sechs Fotos ohne Ort nichts, und der Aufruf wäre wirkungslos.
  'POST /api/groups/suggest': () => ({
    method: 'POST',
    url: '/api/groups/suggest',
    payload: { reset: true },
  }),

  'POST /api/groups': ({ photoIds }) => ({
    method: 'POST',
    url: '/api/groups',
    payload: { title: 'Weihnachten', photoIds: [photoIds[5]] },
  }),

  'PATCH /api/groups/:id': ({ project }) => ({
    method: 'PATCH',
    url: `/api/groups/${project.groups[0]!.id}`,
    payload: { title: 'Ostern 2017' },
  }),

  'DELETE /api/groups/:id': ({ project }) => ({
    method: 'DELETE',
    url: `/api/groups/${project.groups[0]!.id}`,
  }),

  'POST /api/groups/:id/merge': ({ project, photoIds }) => {
    const zweite = project.createGroup('Sommer', [photoIds[3]!]).find((g) => g.title === 'Sommer');
    return {
      method: 'POST',
      url: `/api/groups/${project.groups[0]!.id}/merge`,
      payload: { targetId: zweite!.id },
    };
  },

  'POST /api/groups/:id/add': ({ project, photoIds }) => ({
    method: 'POST',
    url: `/api/groups/${project.groups[0]!.id}/add`,
    payload: { photoIds: [photoIds[4]] },
  }),

  'POST /api/groups/ungroup': ({ photoIds }) => ({
    method: 'POST',
    url: '/api/groups/ungroup',
    payload: { photoIds: [photoIds[0]] },
  }),

  'DELETE /api/photos/:id': ({ photoIds }) => ({
    method: 'DELETE',
    url: `/api/photos/${photoIds[2]}`,
  }),

  // Erst aussortieren, dann die Route: Sie nimmt genau das zurück, und der
  // Rundlauf prüft, dass ein Cmd+Z danach wieder den aussortierten Stand ergibt.
  'DELETE /api/photos/aussortiert/:id': ({ project, photoIds }) => {
    project.deletePhoto(photoIds[2]!);
    return { method: 'DELETE', url: `/api/photos/aussortiert/${photoIds[2]}` };
  },

  // Um einen Monat und nicht um Minuten: Damit wechselt das Foto vom März- ins
  // Aprilsegment, und der Fall deckt neben den Overrides auch den Abdruck der
  // Gliederung ab – das Feld, das `structurePending()` trägt und das nach einem
  // Zurücknehmen wieder stimmen muss.
  'PATCH /api/photos': ({ photoIds }) => ({
    method: 'PATCH',
    url: '/api/photos',
    payload: { ids: [photoIds[0]], date: { kind: 'shift', months: 1 } },
  }),

  'PATCH /api/sources/:id': ({ sourceId }) => ({
    method: 'PATCH',
    url: `/api/sources/${sourceId}`,
    payload: { label: 'Nachzügler' },
  }),

  'PATCH /api/cover': () => ({
    method: 'PATCH',
    url: '/api/cover',
    payload: { title: 'Frani', subtitle: 'Achtzehn Jahre' },
  }),

  'POST /api/history/:name': async ({ app, project }) => {
    const anker = await project.notanker('Buch neu angeordnet');
    if (!anker) throw new Error('Notanker nicht gelegt');
    // Nach dem Anker etwas ändern, damit das Zurückholen etwas zu tun hat.
    await app.inject({ method: 'PATCH', url: '/api/cover', payload: { title: 'Anderer Titel' } });
    return { method: 'POST', url: `/api/history/${anker.name}` };
  },
};

describe('Rundlauf über alle ändernden Routen', () => {
  for (const [kennung, fall] of Object.entries(FAELLE)) {
    const eintrag = UNDO_ROUTEN[kennung];

    it(`nimmt „${kennung}" vollständig zurück`, async () => {
      const p = await probe();
      const anfrage = await fall(p);

      const vorher = await abdruck(p);
      const antwort = await p.app.inject({
        method: anfrage.method,
        url: anfrage.url,
        ...(anfrage.payload !== undefined ? { payload: anfrage.payload } : {}),
        ...(anfrage.headers ? { headers: anfrage.headers } : {}),
      });

      expect(antwort.statusCode, antwort.body.slice(0, 300)).toBeLessThan(400);
      expect(await abdruck(p), 'die Aktion hat nichts geändert').not.toBe(vorher);
      // Das Label darf vom Körper der Anfrage abhängen (`PATCH /api/photos`
      // setzt Datum oder Ort), also wird es hier genauso aufgelöst wie im Haken.
      const erwartet =
        typeof eintrag?.label === 'function' ? eintrag.label({}, anfrage.payload) : eintrag?.label;
      expect(p.project.verlauf.auskunft().zurueck).toBe(erwartet);

      await p.project.zurueck();

      expect(await abdruck(p)).toBe(vorher);
    });
  }

  it('hat für jede ändernde Route einen Fall', () => {
    const fehlend = Object.entries(UNDO_ROUTEN)
      .filter(([, e]) => e !== null && !e.barriere)
      .map(([kennung]) => kennung)
      .filter((kennung) => !(kennung in FAELLE));

    // Eine neue Route braucht hier einen Aufruf. Ohne ihn steht ihre Rücknahme
    // nur in der Tabelle und ist nie gelaufen.
    expect(fehlend).toEqual([]);
  });

  it('führt keinen Fall zu einer Route ohne Eintrag', () => {
    expect(Object.keys(FAELLE).filter((k) => !UNDO_ROUTEN[k])).toEqual([]);
  });
});
