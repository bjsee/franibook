import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '@franibook/core';
import { ohneQualitaet, qualitaetNachziehen } from './qualitaet.js';
import type { PreviewCache } from '../previews.js';

function foto(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id: id as PhotoId,
    relPath: `${id}.jpeg`,
    fileName: `${id}.jpeg`,
    bytes: 1000,
    width: 2048,
    height: 1536,
    orientation: 1,
    ...extra,
  };
}

function stand(...fotos: Photo[]) {
  const photos = new Map(fotos.map((f) => [f.id, f]));
  return { photos, effectivePhotoList: () => [...photos.values()] };
}

const dir = await mkdtemp(join(tmpdir(), 'franibook-qualitaet-'));
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Zwei echte Bilder, weil die Messung echte Pixel braucht: ein Schachbrett mit
 * harten Kanten und eine gleichmäßige Fläche. Ein Rauschbild wäre der schärfere
 * Gegensatz, aber ein deterministischer Test ist mehr wert als ein extremer.
 */
async function bilder(): Promise<{ kantig: string; flau: string }> {
  const kantig = join(dir, 'kantig.png');
  const flau = join(dir, 'flau.png');
  const gross = 64;
  const pixel = Buffer.alloc(gross * gross);
  for (let y = 0; y < gross; y++) {
    for (let x = 0; x < gross; x++) {
      pixel[y * gross + x] = ((x >> 2) + (y >> 2)) % 2 === 0 ? 0 : 255;
    }
  }
  await sharp(pixel, { raw: { width: gross, height: gross, channels: 1 } })
    .png()
    .toFile(kantig);
  await sharp({ create: { width: gross, height: gross, channels: 3, background: '#808080' } })
    .png()
    .toFile(flau);
  return { kantig, flau };
}

const { kantig, flau } = await bilder();

/** Vorschauen ohne Cache: jedes Foto bekommt eines der beiden Testbilder. */
function previews(zuordnung: Record<string, string>): PreviewCache {
  return {
    get: (p: Photo) => {
      const pfad = zuordnung[p.id];
      return pfad ? Promise.resolve(pfad) : Promise.reject(new Error('keine Vorschau'));
    },
  } as unknown as PreviewCache;
}

describe('ohneQualitaet', () => {
  it('nimmt nur Fotos, die noch nicht gemessen wurden', () => {
    const s = stand(
      foto('a'),
      foto('b', {
        quality: { sharpness: 1, brightness: 1, contrast: 1, clippedDark: 0, clippedLight: 0 },
      }),
    );
    expect(ohneQualitaet(s).map((p) => p.id)).toEqual(['a']);
  });
});

describe('qualitaetNachziehen', () => {
  it('misst die Schärfe und trägt sie am Foto ein', async () => {
    const s = stand(foto('kante'), foto('fleck'));
    const bericht = await qualitaetNachziehen(s, previews({ kante: kantig, fleck: flau }));

    expect(bericht.gemessen).toBe(2);
    expect(bericht.gescheitert).toBe(0);
    // Harte Kanten schlagen eine gleichmäßige Fläche um Größenordnungen — das
    // ist die ganze Aussage des Maßes.
    expect(s.photos.get('kante' as PhotoId)!.quality!.sharpness).toBeGreaterThan(
      s.photos.get('fleck' as PhotoId)!.quality!.sharpness,
    );
  });

  it('liest die Belichtung aus dem Bild', async () => {
    const s = stand(foto('fleck'));
    await qualitaetNachziehen(s, previews({ fleck: flau }));

    const q = s.photos.get('fleck' as PhotoId)!.quality!;
    // Mittelgrau: um 128, keine Streuung, nichts abgesoffen oder ausgefressen.
    expect(q.brightness).toBeGreaterThan(120);
    expect(q.brightness).toBeLessThan(136);
    expect(q.contrast).toBeLessThan(2);
    expect(q.clippedDark).toBe(0);
    expect(q.clippedLight).toBe(0);
  });

  it('lässt ein Foto ohne Vorschau ohne Auskunft', async () => {
    // Eine Null einzutragen hieße, ein unlesbares Bild dauerhaft als unscharf
    // festzuschreiben — und die Zahl gewichtet den Slotplatz.
    const s = stand(foto('gut'), foto('kaputt'));
    const bericht = await qualitaetNachziehen(s, previews({ gut: kantig }));

    expect(bericht.gemessen).toBe(1);
    expect(bericht.gescheitert).toBe(1);
    expect(s.photos.get('kaputt' as PhotoId)!.quality).toBeUndefined();
    expect(ohneQualitaet(s).map((p) => p.id)).toEqual(['kaputt']);
  });

  it('misst beim zweiten Lauf nichts noch einmal', async () => {
    const s = stand(foto('kante'));
    await qualitaetNachziehen(s, previews({ kante: kantig }));
    const zweiter = await qualitaetNachziehen(s, previews({ kante: kantig }));

    expect(zweiter.gemessen).toBe(0);
  });

  it('meldet einen leeren Bericht, wenn nichts offen ist', async () => {
    const s = stand(
      foto('a', {
        quality: { sharpness: 1, brightness: 1, contrast: 1, clippedDark: 0, clippedLight: 0 },
      }),
    );
    const bericht = await qualitaetNachziehen(s, previews({}));

    expect(bericht).toEqual({ gemessen: 0, gescheitert: 0, millisekunden: 0 });
  });
});
