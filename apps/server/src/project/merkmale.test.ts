import { describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '@franibook/core';
import { merkmaleNachziehen, ohneMerkmale } from './merkmale.js';
import type { Bildmerkmale, VisionErkennung } from '../vision.js';
import type { Sources } from '../sources.js';

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
  return { photos: new Map(fotos.map((f) => [f.id, f])) };
}

/** Löst den Pfad wie `Sources`, ohne Dateisystem. */
const sources = {
  pfad: (p: Photo) => `/quelle/${p.relPath}`,
} as unknown as Sources;

/** Erkennung mit vorgegebenem Ergebnis, ohne Swift und ohne Bilder. */
function vision(antwort: Record<string, Bildmerkmale>, aufrufe: string[][] = []): VisionErkennung {
  return {
    erkenne: (pfade: readonly string[]) => {
      aufrufe.push([...pfade]);
      const map = new Map<string, Bildmerkmale>();
      for (const p of pfade) {
        const treffer = antwort[p];
        if (treffer) map.set(p, treffer);
      }
      return Promise.resolve(map);
    },
    abgeschaltet: false,
  } as unknown as VisionErkennung;
}

const GESICHT = { x: 0.4, y: 0.2, w: 0.1, h: 0.1 };

describe('ohneMerkmale', () => {
  it('nimmt nur Fotos, die noch nicht nachgesehen wurden', () => {
    // `faces: []` ist eine Aussage und kein fehlender Wert — sonst versucht
    // jeder Start die Fotos ohne Gesicht erneut, und das sind 12,7 %.
    const s = stand(foto('a'), foto('b', { faces: [] }), foto('c', { faces: [GESICHT] }));
    expect(ohneMerkmale(s).map((p) => p.id)).toEqual(['a']);
  });
});

describe('merkmaleNachziehen', () => {
  it('trägt Gesichter und Schwerpunkt am Foto ein', async () => {
    const s = stand(foto('a'), foto('b'));
    const bericht = await merkmaleNachziehen(
      s,
      sources,
      vision({
        '/quelle/a.jpeg': { faces: [GESICHT] },
        '/quelle/b.jpeg': { faces: [], salience: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
      }),
    );

    expect(s.photos.get('a' as PhotoId)!.faces).toEqual([GESICHT]);
    expect(s.photos.get('b' as PhotoId)!.faces).toEqual([]);
    expect(s.photos.get('b' as PhotoId)!.salience).toBeDefined();
    expect(bericht).toMatchObject({ geprueft: 2, mitGesicht: 1, nurSalienz: 1 });
  });

  it('hält ein Foto offen, dessen Datei nicht gelesen werden konnte', async () => {
    // Eine gescheiterte Datei fehlt in der Antwort. Sie als „keine Gesichter"
    // einzutragen hieße, ein nicht eingehängtes Netzlaufwerk dauerhaft
    // festzuschreiben — beim nächsten Start soll es erneut versucht werden.
    const s = stand(foto('a'), foto('kaputt'));
    const bericht = await merkmaleNachziehen(
      s,
      sources,
      vision({ '/quelle/a.jpeg': { faces: [] } }),
    );

    expect(s.photos.get('kaputt' as PhotoId)!.faces).toBeUndefined();
    expect(bericht.geprueft).toBe(1);
    expect(ohneMerkmale(s).map((p) => p.id)).toEqual(['kaputt']);
  });

  it('sieht ein Foto nur einmal nach', async () => {
    const s = stand(foto('a'));
    const aufrufe: string[][] = [];
    const erkennung = vision({ '/quelle/a.jpeg': { faces: [] } }, aufrufe);

    await merkmaleNachziehen(s, sources, erkennung);
    const zweiter = await merkmaleNachziehen(s, sources, erkennung);

    expect(aufrufe).toEqual([['/quelle/a.jpeg']]);
    expect(zweiter.geprueft).toBe(0);
  });

  it('lässt den Bestand unberührt, wenn die Erkennung nichts liefert', async () => {
    // Der Fall ohne `swiftc`: kein Fehler, ein fehlendes Merkmal.
    const s = stand(foto('a'));
    const bericht = await merkmaleNachziehen(s, sources, vision({}));

    expect(s.photos.get('a' as PhotoId)!.faces).toBeUndefined();
    expect(bericht.geprueft).toBe(0);
  });

  it('übergeht ein Foto, dessen Quelle sich nicht auflösen lässt', async () => {
    const s = stand(foto('a'));
    const ohneQuelle = {
      pfad: () => {
        throw new Error('Unbekannte Quelle');
      },
    } as unknown as Sources;

    await expect(merkmaleNachziehen(s, ohneQuelle, vision({}))).resolves.toMatchObject({
      geprueft: 0,
    });
  });
});
