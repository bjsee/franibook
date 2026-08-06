/**
 * Der Import an echten Dateien.
 *
 * Zwei winzige PNGs statt Attrappen: Was hier geprüft wird – Kennung aus dem
 * Inhalt, Übergehen aussortierter Dateien – hängt an genau den Bytes auf der
 * Platte. Ein Test mit erfundenen Kennungen prüfte die Verabredung des Tests
 * mit sich selbst.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecodeCache } from './decode.js';
import { importSource } from './import.js';
import { type PhotoSource, quellenId } from './sources.js';

let dir: string;
let quelle: PhotoSource;
let decodes: DecodeCache;

/** Ein Bild, dessen Maße es von jedem anderen unterscheiden. */
async function bild(name: string, breite: number, hoehe: number): Promise<void> {
  await sharp({
    create: { width: breite, height: hoehe, channels: 3, background: '#888' },
  })
    .png()
    .toFile(join(dir, name));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-import-'));
  quelle = { id: quellenId(dir), label: 'Probe', root: dir, addedAt: '2026-08-06T00:00:00.000Z' };
  decodes = new DecodeCache(join(dir, '.cache'), { pfad: (p) => join(dir, p.relPath) });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('importSource', () => {
  it('liest die Bilder einer Quelle samt Maßen ein', async () => {
    await bild('eins.png', 40, 30);
    await bild('zwei.png', 30, 40);

    const { photos, aussortiert } = await importSource(quelle, decodes);

    expect(photos.map((p) => p.fileName).sort()).toEqual(['eins.png', 'zwei.png']);
    expect(photos.find((p) => p.fileName === 'eins.png')).toMatchObject({ width: 40, height: 30 });
    expect(aussortiert).toEqual([]);
  });

  it('übergeht aussortierte Dateien, obwohl sie im Ordner liegen', async () => {
    await bild('bleibt.png', 40, 30);
    await bild('raus.png', 30, 40);

    const erst = await importSource(quelle, decodes);
    const raus = erst.photos.find((p) => p.fileName === 'raus.png');

    // Genau der Fall aus dem Bestand: Die Datei liegt noch da – ein Sync-Dienst
    // hat sie zurückgespielt –, und trotzdem darf sie nicht wiederkommen.
    const zweit = await importSource(quelle, decodes, undefined, new Set([raus!.id]));

    expect(zweit.photos.map((p) => p.fileName)).toEqual(['bleibt.png']);
    expect(zweit.aussortiert).toEqual(['raus.png']);
  });

  it('erkennt dieselbe Datei unter neuem Namen an ihrem Inhalt wieder', async () => {
    await bild('alt.png', 40, 30);
    const { photos } = await importSource(quelle, decodes);

    await rm(join(dir, 'alt.png'));
    await bild('neu.png', 40, 30);

    // Umbenennen ist folgenlos, also greift die Merkliste auch danach.
    const zweit = await importSource(quelle, decodes, undefined, new Set([photos[0]!.id]));
    expect(zweit.photos).toEqual([]);
    expect(zweit.aussortiert).toEqual(['neu.png']);
  });
});
