/**
 * Der Vorschaucache dedupliziert gleichzeitige Anfragen.
 *
 * Ohne das schreiben zwei Anfragen nach derselben noch nicht gecachten
 * Vorschau (Warmlauf und ein Scroll-Zugriff auf dasselbe Foto etwa) unabhängig
 * voneinander in dieselbe Datei – dieselbe Sorge wie bei `DecodeCache.rescue()`.
 *
 * `decodes.withFallback` wird hier durch eine Attrappe ersetzt, die den echten
 * `op`-Aufruf (sharp auf einer echten Datei) gar nicht erst ausführt: Der Punkt
 * des Tests ist die Zusammenführung in `PreviewCache`, nicht die Bildverarbeitung.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecodeCache } from './decode.js';
import { PreviewCache } from './previews.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-previews-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('PreviewCache', () => {
  it('führt gleichzeitige Anfragen nach derselben Vorschau zusammen', async () => {
    let aufrufe = 0;
    let freigeben: (() => void) | undefined;
    const wartet = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    const decodes = {
      withFallback: async () => {
        aufrufe++;
        // Hält beide Aufrufer an, bis der Test sicher weiß, dass beide
        // `get()`-Aufrufe unterwegs sind.
        await wartet;
        return Buffer.from('nicht wirklich ein webp, aber genug für den Test');
      },
    } as unknown as DecodeCache;

    const cache = new PreviewCache(dir, decodes);
    const photo = { id: 'foto1', relPath: 'foto1.jpg' };

    const a = cache.get(photo, 'preview');
    const b = cache.get(photo, 'preview');
    freigeben?.();

    const [wegA, wegB] = await Promise.all([a, b]);

    expect(wegA).toBe(wegB);
    // Der Punkt des Tests: Nur eine Erzeugung, nicht zwei.
    expect(aufrufe).toBe(1);
  });

  it('erzeugt eine erneut angefragte Vorschau kein zweites Mal, wenn die erste fertig ist', async () => {
    let aufrufe = 0;
    const decodes = {
      withFallback: async () => {
        aufrufe++;
        return Buffer.from('webp-attrappe');
      },
    } as unknown as DecodeCache;

    const cache = new PreviewCache(dir, decodes);
    const photo = { id: 'foto2', relPath: 'foto2.jpg' };

    await cache.get(photo, 'preview');
    await cache.get(photo, 'preview');

    expect(aufrufe).toBe(1);
  });
});
