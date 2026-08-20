/**
 * Was die anderen Fenster erfahren – und was nicht.
 *
 * Drei Ebenen, und jede prüft etwas anderes: der **Strom** die Zustellregeln
 * (wer bekommt was, wer sein eigenes Echo nicht), der **Haken** die Anbindung an
 * die Routen (nur ändernde, nur wirksame), die **Leitung** das Protokoll auf dem
 * Draht. Die dritte braucht als einzige einen lauschenden Server; die ersten
 * beiden kommen ohne aus, weil `Hoerer` eine Schnittstelle ist.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baueApp } from './app.js';
import { Ereignisstrom, FENSTER_KOPF, type Hoerer } from './ereignisse.js';
import { Project } from './project.js';
import { Sources } from './sources.js';
import { Zuletzt } from './zuletzt.js';
import { MELDEENTSCHEIDUNG } from './routes/ereignisse.js';
import type { Kontext } from './routes/kontext.js';
import { UNDO_ROUTEN } from './routes/undo.js';

/** Ein Zuhörer, der mitschreibt statt zu senden. */
function mitschrift(fenster?: string) {
  const zeilen: { art: string; daten: unknown }[] = [];
  const hoerer: Hoerer = {
    ...(fenster !== undefined ? { fenster } : {}),
    schreibe: (art, daten) => void zeilen.push({ art, daten }),
  };
  return {
    hoerer,
    zeilen,
    /** Nur die Änderungsmeldungen – die Fensterzahl interessiert hier selten. */
    aenderungen: () => zeilen.filter((z) => z.art === 'aenderung').map((z) => z.daten),
  };
}

/**
 * Eine Leitung, die erst nach `heil` Zeilen stirbt.
 *
 * Nicht von Anfang an: Ein Hörer, der schon beim Anmelden wirft, fliegt genau
 * dort wieder heraus – die Fensterzahl an alle **ist** ein Schreibversuch. Was
 * hier geprüft werden soll, ist der Fall dahinter: Die Verbindung stand und geht
 * mitten im Betrieb kaputt.
 */
function sterbend(heil: number): Hoerer {
  let geschrieben = 0;
  return {
    schreibe: () => {
      if (++geschrieben > heil) throw new Error('Leitung zu');
    },
  };
}

describe('Der Ereignisstrom', () => {
  it('stellt eine Änderung an alle offenen Fenster zu', () => {
    const strom = new Ereignisstrom();
    const eins = mitschrift('eins');
    const zwei = mitschrift('zwei');
    strom.anmelden(eins.hoerer);
    strom.anmelden(zwei.hoerer);

    strom.melde({ label: 'Ausschnitt gesetzt', spreadIndex: 12 });

    expect(eins.aenderungen()).toEqual([{ nr: 1, label: 'Ausschnitt gesetzt', spreadIndex: 12 }]);
    expect(zwei.aenderungen()).toEqual([{ nr: 1, label: 'Ausschnitt gesetzt', spreadIndex: 12 }]);
  });

  it('lässt den Absender aus – er hat die Antwort schon', () => {
    const strom = new Ereignisstrom();
    const taeter = mitschrift('eins');
    const andere = mitschrift('zwei');
    strom.anmelden(taeter.hoerer);
    strom.anmelden(andere.hoerer);

    strom.melde({ label: 'Bild gedreht' }, 'eins');

    expect(taeter.aenderungen()).toEqual([]);
    expect(andere.aenderungen()).toHaveLength(1);
  });

  it('beliefert ein Fenster ohne Kennung immer', () => {
    const strom = new Ereignisstrom();
    const namenlos = mitschrift();
    strom.anmelden(namenlos.hoerer);

    // Ohne Absender und mit: Wer sich nicht nennt, kann nicht der Täter sein.
    strom.melde({ label: 'Gruppe angelegt' });
    strom.melde({ label: 'Gruppe gelöscht' }, 'irgendwer');

    expect(namenlos.aenderungen()).toHaveLength(2);
  });

  it('zählt die Nummern lückenlos hoch', () => {
    const strom = new Ereignisstrom();
    const hoerer = mitschrift();
    strom.anmelden(hoerer.hoerer);

    strom.melde({ label: 'Eins' });
    strom.melde({ label: 'Zwei' }, 'wer-auch-immer');
    strom.melde({ label: 'Drei' });

    expect(hoerer.aenderungen().map((a) => (a as { nr: number }).nr)).toEqual([1, 2, 3]);
    expect(strom.letzteNr).toBe(3);
  });

  it('lässt eine Änderung ohne Seitenbezug das Feld weg', () => {
    const strom = new Ereignisstrom();
    const hoerer = mitschrift();
    strom.anmelden(hoerer.hoerer);

    strom.melde({ label: 'Gruppe angelegt', spreadIndex: undefined });

    expect(hoerer.aenderungen()[0]).toEqual({ nr: 1, label: 'Gruppe angelegt' });
  });

  it('sagt jedem Fenster, wie viele offen sind', () => {
    const strom = new Ereignisstrom();
    const eins = mitschrift('eins');
    strom.anmelden(eins.hoerer);
    expect(eins.zeilen).toEqual([{ art: 'fenster', daten: { anzahl: 1 } }]);

    const zwei = mitschrift('zwei');
    const abmelden = strom.anmelden(zwei.hoerer);
    // Beide erfahren es – das erste, dass es nicht mehr allein ist.
    expect(eins.zeilen.at(-1)).toEqual({ art: 'fenster', daten: { anzahl: 2 } });
    expect(zwei.zeilen.at(-1)).toEqual({ art: 'fenster', daten: { anzahl: 2 } });
    expect(strom.fenster).toBe(2);

    abmelden();
    expect(eins.zeilen.at(-1)).toEqual({ art: 'fenster', daten: { anzahl: 1 } });
    expect(strom.fenster).toBe(1);
  });

  it('meldet ein zweites Abmelden nicht noch einmal', () => {
    const strom = new Ereignisstrom();
    const hoerer = mitschrift();
    const abmelden = strom.anmelden(hoerer.hoerer);
    abmelden();
    const bisher = hoerer.zeilen.length;

    abmelden();

    expect(hoerer.zeilen).toHaveLength(bisher);
  });

  it('stellt an die übrigen zu, auch wenn eine Leitung wirft', () => {
    const strom = new Ereignisstrom();
    // Zuerst angemeldet, also zuerst bedient: Ohne die Klammer in `#zustellen`
    // bräche die Schleife hier ab, und `heil` bekäme nie etwas – lautlos.
    // Zwei heile Zeilen sind die beiden Fensterzahlen der Anmeldungen.
    strom.anmelden(sterbend(2));
    const heil = mitschrift('heil');
    strom.anmelden(heil.hoerer);

    expect(() => strom.melde({ label: 'Bild gedreht' })).not.toThrow();
    expect(heil.aenderungen()).toHaveLength(1);
  });

  it('meldet eine Leitung ab, die wirft – auch ohne `close`', () => {
    const strom = new Ereignisstrom();
    strom.anmelden(sterbend(2));
    const heil = mitschrift('heil');
    strom.anmelden(heil.hoerer);
    expect(strom.fenster).toBe(2);

    strom.melde({ label: 'Bild gedreht' });

    // Eine halboffene Verbindung meldet sich nie ab und bekäme sonst bis zum
    // Serverende jede Zeile zugestellt. Die Übrigen erfahren die neue Zahl.
    expect(strom.fenster).toBe(1);
    expect(heil.zeilen.at(-1)).toEqual({ art: 'fenster', daten: { anzahl: 1 } });
  });
});

/** Ein Server ohne Bilder – genug für die Routen, die nur den Zustand anfassen. */
async function probe() {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-ereignisse-'));
  const sources = new Sources();
  const project = new Project(sources, null as never, null as never, dir);
  const kontext = {
    project,
    sources,
    zuletzt: new Zuletzt(join(dir, 'zuletzt.json')),
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    cacheDir: join(dir, 'cache'),
    outDir: dir,
  } as Kontext;
  return baueApp({ kontext, anlauf: () => null, logger: false });
}

describe('Der Meldehaken an den Routen', () => {
  it('meldet einen wirksamen Griff mit seinem deutschen Satz', async () => {
    const { app, ereignisse } = await probe();
    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);

    const antwort = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { tilt: 3 },
    });

    expect(antwort.statusCode).toBe(200);
    expect(hoerer.aenderungen()).toEqual([{ nr: 1, label: 'Einstellung geändert' }]);
  });

  it('nennt die betroffene Doppelseite, wenn die Tabelle sie kennt', async () => {
    const { app, ereignisse } = await probe();
    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);

    // Ohne Buch gibt es keine Doppelseite 3 – die Route antwortet mit einem
    // Konflikt, und dann darf gerade **nichts** gemeldet werden.
    const antwort = await app.inject({ method: 'PATCH', url: '/api/spreads/3/locked' });

    expect(antwort.statusCode).toBeGreaterThanOrEqual(400);
    expect(hoerer.aenderungen()).toEqual([]);
  });

  it('schweigt bei einer lesenden Route', async () => {
    const { app, ereignisse } = await probe();
    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);

    await app.inject({ method: 'GET', url: '/api/project' });

    expect(hoerer.aenderungen()).toEqual([]);
  });

  it('schweigt gegenüber dem Fenster, das den Griff getan hat', async () => {
    const { app, ereignisse } = await probe();
    const taeter = mitschrift('fenster-a');
    const andere = mitschrift('fenster-b');
    ereignisse.anmelden(taeter.hoerer);
    ereignisse.anmelden(andere.hoerer);

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { [FENSTER_KOPF]: 'fenster-a' },
      payload: { tilt: 2 },
    });

    expect(taeter.aenderungen()).toEqual([]);
    expect(andere.aenderungen()).toHaveLength(1);
  });
});

describe('Die Leitung', () => {
  it('liefert einen Ereignisstrom, in dem eine Änderung als Zeile ankommt', async () => {
    const { app, ereignisse } = await probe();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const adresse = app.server.address();
    if (typeof adresse === 'string' || adresse === null) throw new Error('Kein Port');

    try {
      const strom = await fetch(`http://127.0.0.1:${adresse.port}/api/ereignisse`, {
        headers: { [FENSTER_KOPF]: 'leser' },
      });
      expect(strom.headers.get('content-type')).toContain('text/event-stream');

      const leser = strom.body?.getReader();
      if (!leser) throw new Error('Kein Körper');
      const text = new TextDecoder();

      // Die Fensterzahl kommt sofort – daran ist zu sehen, dass die Verbindung
      // steht, bevor der Test etwas auslöst.
      const erste = text.decode((await leser.read()).value);
      expect(erste).toContain('event: fenster');
      expect(erste).toContain('"anzahl":1');

      ereignisse.melde({ label: 'Foto umgehängt', spreadIndex: 7 });

      const zweite = text.decode((await leser.read()).value);
      expect(zweite).toContain('event: aenderung');
      expect(zweite).toContain('"label":"Foto umgehängt"');
      expect(zweite).toContain('"spreadIndex":7');

      await leser.cancel();
    } finally {
      await app.close();
    }
  });

  /**
   * Der Test, der einen echten Fehler gefunden hätte.
   *
   * Die Fensterkennung kam ursprünglich **nur** aus dem Kopf
   * `x-franibook-fenster`. Die Tests darüber waren grün, weil sie mit `fetch`
   * verbinden und dort jeden Kopf setzen können — der Browser kann das nicht:
   * `EventSource` hat keine Möglichkeit, eigene Kopfzeilen mitzugeben. In der
   * echten Oberfläche blieb jede Leitung damit namenlos, und ein namenloses
   * Fenster bekommt absichtlich alles: Jeder eigene Griff ließ das Fenster neu
   * laden, mit der Meldung, ein anderes hätte ihn getan.
   *
   * Dieser Test geht deshalb den Weg des Browsers — Kennung in der **Adresse**,
   * kein Kopf — und verlangt, dass das eigene Echo ausbleibt.
   */
  it('erkennt das Fenster an der Adresse, nicht nur am Kopf', async () => {
    // Ohne `ereignisse`: Dieser Test greift den Strom nirgends direkt ab – er
    // geht ausschließlich den Weg, den der Browser auch geht.
    const { app } = await probe();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const adresse = app.server.address();
    if (typeof adresse === 'string' || adresse === null) throw new Error('Kein Port');
    const basis = `http://127.0.0.1:${adresse.port}`;

    try {
      // Wie `EventSource`: ohne jede eigene Kopfzeile.
      const strom = await fetch(`${basis}/api/ereignisse?fenster=fenster-a`);
      const leser = strom.body?.getReader();
      if (!leser) throw new Error('Kein Körper');
      const text = new TextDecoder();
      expect(text.decode((await leser.read()).value)).toContain('event: fenster');

      // Derselbe Griff, den dieses Fenster selbst getan hat.
      const geaendert = await fetch(`${basis}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [FENSTER_KOPF]: 'fenster-a' },
        body: JSON.stringify({ tilt: 4 }),
      });
      expect(geaendert.status).toBe(200);

      // Und ein zweiter aus einem fremden Fenster, damit der Test nicht bloß
      // an einer stummen Leitung grün ist: Er **muss** ankommen.
      await fetch(`${basis}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [FENSTER_KOPF]: 'fenster-b' },
        body: JSON.stringify({ tilt: 9 }),
      });

      const zeile = text.decode((await leser.read()).value);
      expect(zeile).toContain('event: aenderung');
      // Die erste Meldung trägt Nummer 1 und ging nur an die anderen; hier
      // kommt die zweite an. Käme das eigene Echo durch, stünde hier `"nr":1`.
      expect(zeile).toContain('"nr":2');

      await leser.cancel();
    } finally {
      await app.close();
    }
  });

  it('meldet das Fenster ab, wenn die Leitung geht', async () => {
    const { app, ereignisse } = await probe();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const adresse = app.server.address();
    if (typeof adresse === 'string' || adresse === null) throw new Error('Kein Port');

    try {
      const abbruch = new AbortController();
      const strom = await fetch(`http://127.0.0.1:${adresse.port}/api/ereignisse`, {
        signal: abbruch.signal,
      });
      // Auf die erste Zeile warten: Erst danach steht die Verbindung sicher.
      await strom.body?.getReader().read();
      expect(ereignisse.fenster).toBe(1);

      abbruch.abort();
      // Das `close`-Ereignis kommt über den Ereignisumlauf, nicht sofort.
      await new Promise<void>((fertig) => setTimeout(fertig, 50));

      expect(ereignisse.fenster).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('Die Routen ohne Verlaufsschritt', () => {
  /**
   * Der Fehler, den dieser Test verhindert, ist schon einmal passiert.
   *
   * `POST /api/undo` steht in `UNDO_ROUTEN` mit `null` – zu Recht, denn ein
   * Schritt auf das Zurücknehmen wäre eine Schleife. Der Meldehaken las das als
   * „ändert nichts" und schwieg, und im zweiten Fenster blieb nach einem Cmd+Z
   * im ersten die alte Seite stehen. `null` heißt eben **nicht** „ändert
   * nichts", und diese Doppelbedeutung fällt niemandem auf, der eine neue Route
   * einträgt.
   *
   * Deshalb muss jede `null`-Route in genau einer der beiden Listen stehen.
   * Beides ist eine Aussage; nichts zu sagen ist keine.
   */
  it('sind alle entweder gemeldet oder ausdrücklich stumm', () => {
    const ohneSchritt = Object.entries(UNDO_ROUTEN)
      .filter(([, wert]) => wert === null)
      .map(([route]) => route);

    // Ohne diese Zusicherung wäre der Test grün, wenn die Tabelle keine
    // `null`-Route mehr hätte – und niemand merkte, dass er nichts prüft.
    expect(ohneSchritt.length).toBeGreaterThan(0);

    const unentschieden = ohneSchritt.filter(
      (route) => !(route in MELDEENTSCHEIDUNG.ohneSchritt) && !MELDEENTSCHEIDUNG.nicht.has(route),
    );
    expect(
      unentschieden,
      'Diese Routen stehen mit `null` in UNDO_ROUTEN. Sag in `routes/ereignisse.ts`, ' +
        'ob die anderen Fenster davon erfahren müssen (MELDET_OHNE_SCHRITT) oder nicht (MELDET_NICHT).',
    ).toEqual([]);
  });

  it('kennen keine Route, die es nicht mehr gibt', () => {
    const bekannt = new Set(Object.keys(UNDO_ROUTEN));
    const verwaist = [
      ...Object.keys(MELDEENTSCHEIDUNG.ohneSchritt),
      ...MELDEENTSCHEIDUNG.nicht,
    ].filter((route) => !bekannt.has(route));

    expect(verwaist).toEqual([]);
  });
});

describe('Zurücknehmen und Wiederholen', () => {
  it('meldet ein Zurücknehmen samt dem, was zurückgenommen wurde', async () => {
    const { app, ereignisse } = await probe();
    // Erst ein Griff, den es zurückzunehmen gibt.
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { tilt: 5 } });

    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);
    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });

    expect(antwort.statusCode).toBe(200);
    expect(hoerer.aenderungen()).toEqual([
      { nr: 2, label: 'Zurückgenommen: Einstellung geändert' },
    ]);
  });

  it('schweigt, wenn es nichts zurückzunehmen gibt', async () => {
    const { app, ereignisse } = await probe();
    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);

    const antwort = await app.inject({ method: 'POST', url: '/api/undo' });

    expect(antwort.statusCode).toBe(409);
    expect(hoerer.aenderungen()).toEqual([]);
  });

  it('meldet ein Wiederholen mit der Doppelseite, die es betrifft', async () => {
    const { app, ereignisse } = await probe();
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { tilt: 5 } });
    await app.inject({ method: 'POST', url: '/api/undo' });

    const hoerer = mitschrift();
    ereignisse.anmelden(hoerer.hoerer);
    const antwort = await app.inject({ method: 'POST', url: '/api/redo' });

    expect(antwort.statusCode).toBe(200);
    const gemeldet = hoerer.aenderungen()[0] as { label: string };
    expect(gemeldet.label).toBe('Wiederholt: Einstellung geändert');
  });
});
