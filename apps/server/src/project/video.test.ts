import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PhotoOverride } from '@franibook/core';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import { findeVideo, standbildName, videoEndung } from '../video.js';
import { adresseSetzen, bekannteAdresse } from './video.js';

describe('Die Adresse gehört zum Video, nicht zum Bild', () => {
  /** Zwei Standbilder desselben Films und ein drittes Bild ohne Verweis. */
  function stand(): { overrides: Record<string, PhotoOverride> } {
    return {
      overrides: {
        a: { video: { kennung: '3f9a1c' } },
        b: { video: { kennung: '3f9a1c' }, caption: 'Ostern' },
        c: { video: { kennung: 'ffffff' } },
        d: { caption: 'kein Video' },
      },
    };
  }

  it('setzt sie an allen Standbildern desselben Films', () => {
    // Zwei Standbilder mit verschiedenen Adressen für denselben Film wären keine
    // Wahl, sondern ein Versehen.
    const z = stand();
    const ergebnis = adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4');

    expect(ergebnis).toMatchObject({ ok: true, geaendert: 2, kennung: '3f9a1c' });
    expect(z.overrides['b']?.video?.url).toBe('https://nas.example/ostern.mp4');
  });

  it('lässt andere Filme und andere Angaben in Ruhe', () => {
    const z = stand();
    adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4');

    expect(z.overrides['c']?.video?.url).toBeUndefined();
    expect(z.overrides['b']?.caption).toBe('Ostern');
  });

  it('meldet eine unbrauchbare Adresse und ändert nichts', () => {
    // Aus derselben Adresse macht die Oberfläche einen anklickbaren Verweis.
    const z = stand();
    const ergebnis = adresseSetzen(z, 'a', 'javascript:alert(1)');

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.geaendert).toBe(0);
    expect(z.overrides['a']?.video?.url).toBeUndefined();
  });

  it('nimmt die Adresse weg, ohne den Videoverweis zu verlieren', () => {
    // Das Standbild bleibt ein Standbild – es druckt nur keinen Code mehr.
    const z = stand();
    adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4');
    const ergebnis = adresseSetzen(z, 'a', '');

    expect(ergebnis).toMatchObject({ ok: true, geaendert: 2 });
    expect(z.overrides['a']?.video).toEqual({ kennung: '3f9a1c' });
  });

  it('legt an einem Bild ohne Video einen Verweis an', () => {
    // Der häufigere Fall: Der Film liegt längst im geteilten Album, und im Buch
    // steht ein Foto von demselben Tag. Ein Standbild aus einem Video zu ziehen,
    // das man ohnehin schon hochgeladen hat, wäre ein Umweg für die Datenhaltung.
    const z = stand();
    const ergebnis = adresseSetzen(z, 'd', 'https://nas.example/x.mp4');

    expect(ergebnis).toMatchObject({ ok: true, geaendert: 1 });
    expect(z.overrides['d']?.video?.url).toBe('https://nas.example/x.mp4');
    expect(z.overrides['d']?.caption).toBe('kein Video');
  });

  it('gibt dem neuen Verweis eine Kennung, die noch frei ist', () => {
    // Zwei Videos unter derselben Kennung wären ein gedruckter Code, der auf den
    // falschen zeigt.
    const z = stand();
    const ergebnis = adresseSetzen(z, 'd', 'https://nas.example/x.mp4');

    expect(ergebnis.kennung).toMatch(/^[0-9a-f]{6}$/);
    expect(['3f9a1c', 'ffffff']).not.toContain(ergebnis.kennung);
  });

  it('tut an einem Bild ohne Video und ohne Adresse nichts', () => {
    // `geaendert: 0` verwirft den leeren Undo-Schritt (`ohneWirkung`).
    const z = stand();
    expect(adresseSetzen(z, 'd', '')).toMatchObject({ ok: true, geaendert: 0 });
    expect(z.overrides['d']?.video).toBeUndefined();
  });

  it('zählt nur, was sich wirklich geändert hat', () => {
    // Sonst legte ein zweiter Klick mit derselben Adresse einen Undo-Schritt an,
    // der nichts zurücknimmt (`ohneWirkung` in `routes/undo.ts`).
    const z = stand();
    adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4');
    expect(adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4').geaendert).toBe(0);
  });

  it('findet eine früher hinterlegte Adresse über die Kennung wieder', () => {
    // Der Grund, warum ein zweites Standbild desselben Films seine Adresse
    // mitbekommt, ohne dass jemand sie zweimal tippt.
    const z = stand();
    adresseSetzen(z, 'a', 'https://nas.example/ostern.mp4');

    expect(bekannteAdresse(z.overrides, '3f9a1c')).toBe('https://nas.example/ostern.mp4');
    expect(bekannteAdresse(z.overrides, 'ffffff')).toBeUndefined();
  });
});

describe('Welche Dateien als Video gelten', () => {
  it('nimmt die Endungen, die der Import überspringt', () => {
    expect(videoEndung('Ostern.MOV')).toBe('.mov');
    expect(videoEndung('urlaub.mp4')).toBe('.mp4');
  });

  it('lehnt alles andere ab', () => {
    // Sonst schriebe ein Einwurf eine `.sh` in den Cache.
    expect(videoEndung('bild.jpg')).toBeUndefined();
    expect(videoEndung('skript.sh')).toBeUndefined();
    expect(videoEndung('ohne-endung')).toBeUndefined();
  });
});

describe('Die Kennung geht geprüft in einen Pfad', () => {
  it('findet das Video zu einer gültigen Kennung', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'franibook-video-'));
    await mkdir(join(cache, 'videos'), { recursive: true });
    await writeFile(join(cache, 'videos', '3f9a1c.mp4'), 'kein echtes Video');

    expect(await findeVideo(cache, '3f9a1c')).toBe(join(cache, 'videos', '3f9a1c.mp4'));
  });

  it('lässt keine Kennung durch, die aus dem Ordner führt', async () => {
    // Die Kennung kommt aus einer Adresse. Ohne Prüfung wäre die Route ein
    // Leseloch – `findeVideo` ist die Stelle, an der das entschieden wird.
    const cache = await mkdtemp(join(tmpdir(), 'franibook-video-'));
    await mkdir(join(cache, 'videos'), { recursive: true });
    await writeFile(join(cache, 'project.json'), '{}');

    for (const boesartig of ['../project', '../../etc/passwd', '3f9a1c/../../x', 'ABCDEF', '']) {
      expect(await findeVideo(cache, boesartig)).toBeUndefined();
    }
  });

  it('schweigt, wenn der Ordner gar nicht da ist', async () => {
    // Ein frisches Projekt hat noch keinen Videoordner, und das ist kein Fehler.
    const cache = await mkdtemp(join(tmpdir(), 'franibook-video-'));
    expect(await findeVideo(cache, '3f9a1c')).toBeUndefined();
  });
});

describe('Der Name des Standbildes', () => {
  it('nennt die Sekunde, aus der es kommt', () => {
    // Derselbe Film gibt mehrere Standbilder her; zwei Dateien namens
    // `ostern.jpg` im Ordner unterscheidet niemand.
    expect(standbildName('ostern.mov', 12)).toBe('ostern-12s.jpg');
    expect(standbildName('ostern.mov', 12.54)).toBe('ostern-12,5s.jpg');
  });

  it('setzt kein zweites Komma und keinen zweiten Punkt', () => {
    // Ein Punkt im Namen sähe wie eine zweite Endung aus.
    expect(standbildName('a.b.mp4', 3.5)).toBe('a.b-3,5s.jpg');
    expect(standbildName('ostern.mov', 0)).toBe('ostern-0s.jpg');
  });
});

describe('Der Videoparser gilt nur für die Videoroute', () => {
  /**
   * Ein Fastify-Parser wird allein am Medientyp gewählt, nicht an der Adresse.
   * Ohne die Prüfung in `app.ts` bekäme jede Route mit `Content-Type: video/mp4`
   * den rohen Strom als `body` — und damit keine der Grenzen, die sie erwartet.
   *
   * Der Fund kommt aus dem Sicherheitsdurchgang zu diesem Feature; hier steht er
   * als Test, damit er nicht beim nächsten Umbau des Parsers zurückkommt.
   */
  async function app() {
    const dir = await mkdtemp(join(tmpdir(), 'franibook-parser-'));
    const sources = new Sources();
    await sources.add(dir, 'Probe');
    const project = new Project(sources, null as never, null as never, dir);
    const { app: instanz } = baueApp({
      kontext: { project, sources, cacheDir: join(dir, 'cache'), outDir: dir } as never,
      anlauf: () => null,
      logger: false,
    });
    return instanz;
  }

  it('nimmt Videodaten an /api/videos an', async () => {
    const antwort = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/videos?name=probe.mp4',
      payload: Buffer.from('kein echtes Video'),
      headers: { 'content-type': 'video/mp4' },
    });
    // 400 oder 503 – je nachdem, ob ffmpeg auf diesem Rechner liegt. Beides
    // heißt: Die Route hat den Rumpf bekommen und selbst entschieden.
    expect([400, 503]).toContain(antwort.statusCode);
  });

  it('lehnt sie an jeder anderen Route ab', async () => {
    const antwort = await (
      await app()
    ).inject({
      method: 'PATCH',
      url: '/api/photos',
      payload: Buffer.from('kein echtes Video'),
      headers: { 'content-type': 'video/mp4' },
    });
    expect(antwort.statusCode).toBe(415);
  });
});
