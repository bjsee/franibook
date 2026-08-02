import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecodeCache, istDecoderFehler } from './decode.js';
import type { PathResolver } from './sources.js';

/** Wortgleich die Meldung, an der der erste Vollexport ein Bild verlor. */
const LESEFEHLER = new Error('vipspng: libpng read error');

const QUELLE = '/quelle';
const ID = 'ab12cd34';

/** Ein Foto samt Auflösung seines Pfads – mehr braucht der Cache nicht. */
const FOTO = { id: ID, relPath: 'foto.png' };
const QUELLEN: PathResolver = { pfad: (photo) => join(QUELLE, photo.relPath) };

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'franibook-decode-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/**
 * Cache mit ausgetauschter Konvertierung: Die Tests kommen ohne echte
 * Bilddateien und ohne `sips` aus, prüfen aber die volle Kette.
 */
function cacheMit(opts: { erfolg?: boolean } = {}): {
  cache: DecodeCache;
  konvertierungen: { src: string; dst: string }[];
} {
  const konvertierungen: { src: string; dst: string }[] = [];
  const cache = new DecodeCache(cacheDir, QUELLEN, async (src, dst) => {
    konvertierungen.push({ src, dst });
    if (opts.erfolg === false) throw new Error('sips: Error 4: unable to open file');
    await writeFile(dst, 'jpeg');
  });
  return { cache, konvertierungen };
}

/** Pfad des Konvertats, wie ihn der Cache vergibt. */
const konvertat = (): string => join(cacheDir, 'decoded', ID.slice(0, 2), `${ID}.jpg`);

describe('istDecoderFehler', () => {
  it('erkennt den libpng-Lesefehler', () => {
    expect(istDecoderFehler(LESEFEHLER)).toBe(true);
  });

  it('erkennt eine für libheif zu stark gekachelte HEIC', () => {
    expect(istDecoderFehler(new Error('Input file contains unsupported image format'))).toBe(true);
  });

  it('hält eine fehlende Datei nicht für einen Decoderfehler', () => {
    expect(istDecoderFehler(new Error('Input file is missing: /quelle/weg.png'))).toBe(false);
  });

  it('hält einen Fehler der eigenen Prüfungen nicht für einen Decoderfehler', () => {
    expect(istDecoderFehler(new Error('Bild ohne Pixelmaße'))).toBe(false);
  });
});

describe('DecodeCache', () => {
  it('lässt das Original durch, solange sharp es lesen kann', async () => {
    const { cache, konvertierungen } = cacheMit();
    const gesehen: string[] = [];

    const wert = await cache.withFallback(FOTO, async (path) => {
      gesehen.push(path);
      return 'gelesen';
    });

    expect(wert).toBe('gelesen');
    expect(gesehen).toEqual([join(QUELLE, 'foto.png')]);
    // Der Regelfall darf keinen Prozess starten.
    expect(konvertierungen).toHaveLength(0);
  });

  it('wiederholt einen Lesefehler auf dem sips-Konvertat', async () => {
    const { cache, konvertierungen } = cacheMit();
    const gesehen: string[] = [];

    const wert = await cache.withFallback(FOTO, async (path) => {
      gesehen.push(path);
      if (path.endsWith('.png')) throw LESEFEHLER;
      return 'gerettet';
    });

    expect(wert).toBe('gerettet');
    expect(gesehen).toEqual([join(QUELLE, 'foto.png'), konvertat()]);
    expect(konvertierungen).toHaveLength(1);
    expect(konvertierungen[0]?.src).toBe(join(QUELLE, 'foto.png'));
    // Über eine Nebendatei, damit ein Abbruch kein halbes JPEG hinterlässt.
    expect(konvertierungen[0]?.dst).not.toBe(konvertat());
  });

  it('reicht Fehler durch, die nicht vom Decoder kommen', async () => {
    const { cache, konvertierungen } = cacheMit();

    await expect(
      cache.withFallback(FOTO, () => Promise.reject(new Error('Bild ohne Pixelmaße'))),
    ).rejects.toThrow('Bild ohne Pixelmaße');
    expect(konvertierungen).toHaveLength(0);
  });

  it('versucht das Original beim zweiten Zugriff nicht erneut', async () => {
    const { cache, konvertierungen } = cacheMit();
    const lese = async (path: string): Promise<string> => {
      if (path.endsWith('.png')) throw LESEFEHLER;
      return path;
    };

    await cache.withFallback(FOTO, lese);
    const gesehen: string[] = [];
    await cache.withFallback(FOTO, async (path) => {
      gesehen.push(path);
      return lese(path);
    });

    // Vorschau, Aufwärmen und Export greifen dreimal auf dasselbe Bild zu –
    // dreimal in denselben Fehler zu laufen wäre reine Verschwendung.
    expect(gesehen).toEqual([konvertat()]);
    expect(konvertierungen).toHaveLength(1);
  });

  it('startet für nebenläufige Zugriffe nur einen sips-Aufruf', async () => {
    const { cache, konvertierungen } = cacheMit();
    const lese = (path: string): Promise<string> =>
      path.endsWith('.png') ? Promise.reject(LESEFEHLER) : Promise.resolve(path);

    // So greifen die sechs Vorschau-Worker auf dasselbe Bild zu.
    const werte = await Promise.all([
      cache.withFallback(FOTO, lese),
      cache.withFallback(FOTO, lese),
      cache.withFallback(FOTO, lese),
    ]);

    expect(werte).toEqual([konvertat(), konvertat(), konvertat()]);
    expect(konvertierungen).toHaveLength(1);
  });

  it('meldet den ursprünglichen Fehler, wenn auch sips scheitert', async () => {
    const { cache, konvertierungen } = cacheMit({ erfolg: false });

    await expect(cache.withFallback(FOTO, () => Promise.reject(LESEFEHLER))).rejects.toThrow(
      'libpng read error',
    );

    // Ein zweiter Zugriff versucht es nicht noch einmal.
    await expect(cache.withFallback(FOTO, () => Promise.reject(LESEFEHLER))).rejects.toThrow(
      'libpng read error',
    );
    expect(konvertierungen).toHaveLength(1);
  });

  it('nutzt ein Konvertat aus einem früheren Lauf, statt neu zu konvertieren', async () => {
    const { cache, konvertierungen } = cacheMit();
    await cache.withFallback(FOTO, async (path) => {
      if (path.endsWith('.png')) throw LESEFEHLER;
      return path;
    });

    // Zweiter Serverstart: neuer Cache, dieselbe Platte.
    const neu = cacheMit();
    expect(await neu.cache.existing(ID)).toBe(konvertat());
    expect(await neu.cache.rescue(FOTO)).toBe(konvertat());
    expect(neu.konvertierungen).toHaveLength(0);
    expect(konvertierungen).toHaveLength(1);
  });

  it('liefert kein Konvertat für ein unauffälliges Foto', async () => {
    const { cache } = cacheMit();
    expect(await cache.existing(ID)).toBeUndefined();
  });
});
