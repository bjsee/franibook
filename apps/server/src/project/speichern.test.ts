import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { echteWerkzeuge, schreibeAtomar, type SchreibWerkzeuge } from './speichern.js';

const ALT = '{"schemaVersion":3,"stand":"alt"}';
const NEU = '{"schemaVersion":3,"stand":"neu"}';

/** Ein Verzeichnis mit einer bereits gespeicherten Projektdatei. */
async function verzeichnis(): Promise<{ dir: string; ziel: string; tmp: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-speichern-'));
  const ziel = join(dir, 'project.json');
  await writeFile(ziel, ALT, 'utf8');
  return { dir, ziel, tmp: `${ziel}.4711-1.tmp` };
}

/**
 * Der Stromausfall: Ab dem `n`-ten Aufruf tut das Werkzeug nichts mehr, sondern
 * wirft — und zwar so, wie ein abgeschnittener Vorgang es hinterlässt.
 *
 * Kein Mock des ganzen Dateisystems: Geschrieben wird auf eine echte Platte,
 * geprüft wird an echten Dateien. Nur der Abbruch ist gestellt.
 */
function bricht(bei: 'schreiben' | 'umbenennen', halb = false): SchreibWerkzeuge {
  return {
    schreibe: async (pfad, inhalt) => {
      if (bei === 'schreiben') {
        // Ein Stromausfall mitten im Schreiben hinterlässt eine halbe Datei,
        // kein leeres Verzeichnis.
        if (halb) await writeFile(pfad, inhalt.slice(0, Math.floor(inhalt.length / 2)), 'utf8');
        throw new Error('ENOSPC: no space left on device');
      }
      await echteWerkzeuge.schreibe(pfad, inhalt);
    },
    benenneUm: async (von, nach) => {
      if (bei === 'umbenennen') throw new Error('EIO: i/o error');
      await echteWerkzeuge.benenneUm(von, nach);
    },
  };
}

describe('schreibeAtomar', () => {
  it('ersetzt den alten Stand vollständig', async () => {
    const { ziel, tmp, dir } = await verzeichnis();
    await schreibeAtomar(ziel, NEU, tmp);

    expect(await readFile(ziel, 'utf8')).toBe(NEU);
    // Keine Nebendatei bleibt liegen.
    expect(await readdir(dir)).toEqual(['project.json']);
  });

  it('legt eine Datei an, wo noch keine war', async () => {
    const { dir } = await verzeichnis();
    const ziel = join(dir, 'neu.json');
    await schreibeAtomar(ziel, NEU, `${ziel}.tmp`);
    expect(await readFile(ziel, 'utf8')).toBe(NEU);
  });

  /**
   * Der Fall, für den es das ganze Verfahren gibt.
   *
   * Wer in die Zieldatei selbst schriebe, hätte hier ein halbes JSON stehen —
   * und ein halbes JSON ist kein Projekt mehr, sondern eine Datei, aus der
   * niemand 830 Fotos und 61 Gruppen zurückholt.
   */
  it('lässt den alten Stand unberührt, wenn das Schreiben mitten abbricht', async () => {
    const { ziel, tmp, dir } = await verzeichnis();

    await expect(schreibeAtomar(ziel, NEU, tmp, bricht('schreiben', true))).rejects.toThrow(
      'ENOSPC',
    );

    expect(await readFile(ziel, 'utf8')).toBe(ALT);
    expect(JSON.parse(await readFile(ziel, 'utf8'))).toEqual({
      schemaVersion: 3,
      stand: 'alt',
    });
    // Die halbe Nebendatei ist weggeräumt.
    expect(await readdir(dir)).toEqual(['project.json']);
  });

  it('lässt den alten Stand unberührt, wenn schon das Anlegen scheitert', async () => {
    const { ziel, tmp } = await verzeichnis();
    await expect(schreibeAtomar(ziel, NEU, tmp, bricht('schreiben'))).rejects.toThrow('ENOSPC');
    expect(await readFile(ziel, 'utf8')).toBe(ALT);
  });

  /**
   * Zwischen Schreiben und Umbenennen: Beide Stände sind vollständig da.
   *
   * Die Nebendatei bleibt hier ausdrücklich liegen. Sie wegzuräumen hieße, den
   * einzigen vollständigen neuen Stand zu verwerfen — und wer nach einem
   * Absturz sucht, findet ihn lieber, als dass er ihn vermisst.
   */
  it('hinterlässt beim Abbruch vor dem Umbenennen zwei ganze Dateien', async () => {
    const { ziel, tmp, dir } = await verzeichnis();

    await expect(schreibeAtomar(ziel, NEU, tmp, bricht('umbenennen'))).rejects.toThrow('EIO');

    expect(await readFile(ziel, 'utf8')).toBe(ALT);
    expect(await readFile(tmp, 'utf8')).toBe(NEU);
    expect((await readdir(dir)).sort()).toEqual(['project.json', 'project.json.4711-1.tmp']);
  });

  it('kommt zwei gleichzeitigen Vorgängen nicht in die Quere', async () => {
    const { ziel, dir } = await verzeichnis();

    // Verschiedene Nebendateien, wie `Project` sie über Prozesskennung und
    // Zähler vergibt. Mit einem gemeinsamen Namen benannten beide dieselbe
    // Datei um, und der zweite fände sie nicht mehr — das hat den Server
    // schon einmal mit einem unbehandelten ENOENT umgerissen.
    await Promise.all([
      schreibeAtomar(ziel, NEU, `${ziel}.4711-1.tmp`),
      schreibeAtomar(ziel, NEU, `${ziel}.4711-2.tmp`),
    ]);

    expect(await readFile(ziel, 'utf8')).toBe(NEU);
    expect(await readdir(dir)).toEqual(['project.json']);
  });
});
