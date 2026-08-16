/**
 * Der eine Fehler, den man dem Ergebnis nicht ansieht.
 *
 * Ein Foto mit Ausrichtungskorrektur wird vom Vorschau-Cache unter einem
 * eigenen Namen geführt (`<hash>-q1.webp`), und **welche Fassung er liefert,
 * entscheidet allein `photo.quarterTurns`** — ein Feld, das nur `effectivePhoto`
 * setzt. Wer dem Backen die rohen Fotos gibt, bekommt die ungedrehte Datei,
 * während der Plan für das aufgerichtete Bild gerechnet ist: Die Kachel steht
 * quer, zeigt eine andere Bildstelle als die, nach deren Farbe sie gewählt
 * wurde, und wird von `fit: 'fill'` obendrein gestaucht.
 *
 * Am fertigen Mosaik ist das unter tausend Kacheln nicht zu sehen. Deshalb
 * dieser Test: Er hält fest, welche Fassung überhaupt angefragt wird.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  type Photo,
  type PhotoId,
  type PhotoOverride,
  type Rgb,
  defaultProfile,
} from '@franibook/core';
import type { PreviewSize } from '../previews.js';
import { backeUmschlagmosaik } from './umschlagmosaik.js';

/** Ein Foto mit Farbwerten — mehr braucht die Zuordnung nicht. */
function foto(id: string, farbe: Rgb): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 1000,
    width: 4000,
    height: 3000,
    orientation: 1,
    tone: { mean: farbe, grid: Array.from({ length: 9 }, () => farbe) },
  };
}

/**
 * Eine Bildquelle, die jede Anfrage protokolliert und immer dieselbe kleine
 * Testdatei liefert. Was gezeichnet wird, ist hier gleichgültig — geprüft wird,
 * *wonach* gefragt wurde.
 */
function protokollquelle(pfad: string) {
  const angefragt: { id: PhotoId; turns: number; size: PreviewSize }[] = [];
  return {
    angefragt,
    get(photo: { id: PhotoId; quarterTurns?: 1 | 2 | 3 }, size: PreviewSize) {
      angefragt.push({ id: photo.id, turns: photo.quarterTurns ?? 0, size });
      return Promise.resolve(pfad);
    },
  };
}

let ordner: string;
let bildpfad: string;

beforeAll(async () => {
  ordner = await mkdtemp(join(tmpdir(), 'franibook-mosaik-'));
  bildpfad = join(ordner, 'kachel.png');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
    .png()
    .toFile(bildpfad);
});

afterAll(async () => {
  await rm(ordner, { recursive: true, force: true });
});

describe('Titelmosaik backen', () => {
  const profile = defaultProfile();

  it('holt die Kacheln in der Fassung, für die der Plan gerechnet ist', async () => {
    // Ein Bestand aus einem einzigen Foto, das um eine Vierteldrehung
    // korrigiert wurde. Jede Kachel muss aus der gedrehten Vorschau kommen.
    const photos = new Map<PhotoId, Photo>([['a', foto('a', [200, 60, 60])]]);
    const overrides: Record<PhotoId, PhotoOverride> = { a: { orientationTurns: 1 } };
    const quelle = protokollquelle(bildpfad);

    await backeUmschlagmosaik(
      { photos, overrides, profile },
      { cols: 6 },
      'front',
      80,
      quelle,
      join(ordner, 'cache-1'),
    );

    expect(quelle.angefragt.length).toBeGreaterThan(0);
    expect(quelle.angefragt.every((a) => a.turns === 1)).toBe(true);
  });

  it('lässt ein unkorrigiertes Foto unangetastet', async () => {
    const photos = new Map<PhotoId, Photo>([['b', foto('b', [60, 200, 60])]]);
    const quelle = protokollquelle(bildpfad);

    await backeUmschlagmosaik(
      { photos, overrides: {}, profile },
      { cols: 6 },
      'front',
      80,
      quelle,
      join(ordner, 'cache-2'),
    );

    expect(quelle.angefragt.every((a) => a.turns === 0)).toBe(true);
  });

  it('holt auch das Zielbild in seiner korrigierten Fassung', async () => {
    // Derselbe Fehler an zweiter Stelle: Wer ein gekipptes Foto als Vorlage
    // wählt, bekäme sein Motiv um 90° gedreht ins Raster.
    const photos = new Map<PhotoId, Photo>([
      ['a', foto('a', [200, 60, 60])],
      ['ziel', foto('ziel', [60, 60, 200])],
    ]);
    const overrides: Record<PhotoId, PhotoOverride> = { ziel: { orientationTurns: 2 } };
    const quelle = protokollquelle(bildpfad);

    await backeUmschlagmosaik(
      { photos, overrides, profile },
      { cols: 6, photoId: 'ziel' },
      'front',
      80,
      quelle,
      join(ordner, 'cache-3'),
    );

    const vorlage = quelle.angefragt.find((a) => a.id === 'ziel' && a.size === 'preview');
    expect(vorlage?.turns).toBe(2);
  });

  it('meldet ein fehlendes Zielbild als Satz ohne Dateipfad', async () => {
    // Der Text landet über `umschlagmosaikeSicherstellen` in der Antwort des
    // Servers. Eine rohe Exception trüge den vollen Pfad hinein.
    const photos = new Map<PhotoId, Photo>([['a', foto('a', [200, 60, 60])]]);
    const quelle = protokollquelle(bildpfad);

    await expect(
      backeUmschlagmosaik(
        { photos, overrides: {}, profile },
        { cols: 6, photoId: 'weg' },
        'front',
        80,
        quelle,
        join(ordner, 'cache-4'),
      ),
    ).rejects.toThrow(/nicht mehr im Bestand/);
  });
});
