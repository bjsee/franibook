/**
 * Die Prüfung, ob die Bilddateien noch da sind — an echten Dateien.
 *
 * Eine Attrappe des Dateisystems prüfte hier gar nichts: Die ganze Frage
 * lautet, was `stat` über einen echten Pfad sagt, und wer sie nachbaut, prüft
 * seine eigene Nachbildung.
 */
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Photo, PhotoId } from '@franibook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sources } from '../sources.js';
import { fehlendeDateien, type Bestandstand } from './bestand.js';

let dir: string;
let zweite: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-dateien-'));
  zweite = await mkdtemp(join(tmpdir(), 'franibook-dateien2-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(zweite, { recursive: true, force: true });
});

function foto(id: string, relPath: string, sourceId?: string): Photo {
  return {
    id,
    relPath,
    fileName: relPath,
    bytes: 3,
    width: 2048,
    height: 1536,
    orientation: 1,
    ...(sourceId ? { sourceId } : {}),
  };
}

/** Ein Bestand aus den genannten Fotos — mehr braucht die Prüfung nicht. */
function stand(sources: Sources, photos: Photo[]): Bestandstand {
  return {
    photos: new Map<PhotoId, Photo>(photos.map((p) => [p.id, p])),
    sources,
  } as unknown as Bestandstand;
}

describe('fehlendeDateien', () => {
  it('schweigt, solange jede Datei an ihrem Platz liegt', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);
    await writeFile(join(dir, 'a.jpg'), 'abc');
    await writeFile(join(dir, 'b.jpg'), 'abc');

    const bericht = await fehlendeDateien(
      stand(quellen, [foto('1', 'a.jpg', source.id), foto('2', 'b.jpg', source.id)]),
    );

    expect(bericht.fehlend).toEqual([]);
    expect(bericht.geprueft).toBe(2);
    expect(bericht.offline).toEqual([]);
  });

  it('findet die eine Datei, die jemand weggenommen hat', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);
    await writeFile(join(dir, 'a.jpg'), 'abc');
    await writeFile(join(dir, 'b.jpg'), 'abc');
    await unlink(join(dir, 'b.jpg'));

    const bericht = await fehlendeDateien(
      stand(quellen, [foto('1', 'a.jpg', source.id), foto('2', 'b.jpg', source.id)]),
    );

    // Am Bildschirm sähe man davon nichts: Die Vorschau liegt im Cache.
    expect(bericht.fehlend).toEqual(['2']);
    expect(bericht.geprueft).toBe(2);
  });

  it('hält einen Ordner nicht für eine Bilddatei', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);

    const bericht = await fehlendeDateien(stand(quellen, [foto('1', '.', source.id)]));
    expect(bericht.fehlend).toEqual(['1']);
  });

  /**
   * Der Unterschied, auf den es ankommt: Ein abgehängtes Netzlaufwerk ist kein
   * Datenverlust. Achthundert Zeilen „Datei fehlt" wären die falsche Auskunft
   * für „das NAS ist aus" — und die richtige steht schon in `GET /api/sources`.
   */
  it('prüft die Fotos einer abgehängten Quelle gar nicht erst', async () => {
    const quellen = new Sources();
    const { source: bestandQuelle } = await quellen.add(dir);
    const { source: nas } = await quellen.add(zweite, 'NAS');
    await writeFile(join(dir, 'a.jpg'), 'abc');
    await rm(zweite, { recursive: true, force: true });

    const bericht = await fehlendeDateien(
      stand(quellen, [
        foto('1', 'a.jpg', bestandQuelle.id),
        foto('2', 'x.jpg', nas.id),
        foto('3', 'y.jpg', nas.id),
      ]),
    );

    expect(bericht.fehlend).toEqual([]);
    expect(bericht.geprueft).toBe(1);
    expect(bericht.offline).toEqual([{ id: nas.id, label: 'NAS', photoCount: 2 }]);
  });

  it('meldet ein Foto, dessen Quelle es gar nicht gibt', async () => {
    const quellen = new Sources();
    await quellen.add(dir);

    // `Sources.pfad` wirft hier, statt einen Pfad zu raten — für das Buch ist
    // das dasselbe wie eine fehlende Datei.
    const bericht = await fehlendeDateien(stand(quellen, [foto('1', 'a.jpg', 'weg')]));
    expect(bericht.fehlend).toEqual(['1']);
  });

  it('kommt mit mehr Bildern zurecht, als gleichzeitig geprüft werden', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);

    const photos: Photo[] = [];
    for (let i = 0; i < 70; i++) {
      const name = `f${i}.jpg`;
      if (i % 7 !== 0) await writeFile(join(dir, name), 'abc');
      photos.push(foto(String(i), name, source.id));
    }

    const bericht = await fehlendeDateien(stand(quellen, photos));

    expect(bericht.geprueft).toBe(70);
    expect(bericht.fehlend).toEqual(['0', '7', '14', '21', '28', '35', '42', '49', '56', '63']);
  });
});
