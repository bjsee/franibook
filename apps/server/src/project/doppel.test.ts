import { describe, expect, it } from 'vitest';
import type { DoppelKandidat, Photo, PhotoId } from '@franibook/core';
import { doppelVorschlagen } from './doppel.js';
import type { PreviewCache } from '../previews.js';
import type { AbstandsErkennung, Abstandspaar } from '../vision.js';

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
  return {
    photos,
    effectivePhotoList: () => [...photos.values()],
    doppelBehalten: {} as Record<string, string>,
  };
}

/** Vorschauen ohne Dateisystem: der Pfad ist die Kennung. */
const previews = {
  get: (p: Photo) => Promise.resolve(`/cache/${p.id}.webp`),
} as unknown as PreviewCache;

/** Eine Vorschau, die für ein bestimmtes Foto scheitert. */
function previewsOhne(fehlend: string): PreviewCache {
  return {
    get: (p: Photo) =>
      p.id === fehlend
        ? Promise.reject(new Error('keine Vorschau'))
        : Promise.resolve(`/cache/${p.id}.webp`),
  } as unknown as PreviewCache;
}

/**
 * Vergleich mit vorgegebenen Abständen, ohne Swift und ohne Bilder.
 *
 * `abstand` bekommt die beiden Cachepfade und sagt, wie fern sich die Bilder
 * sind — so steht in jedem Test, was er annimmt, statt in einer Tabelle weit
 * oben.
 */
function vergleich(
  abstand: (a: string, b: string) => number,
  abgeschaltet = false,
): AbstandsErkennung {
  return {
    abgeschaltet,
    vergleiche: (gruppen: readonly (readonly string[])[]) => {
      const map = new Map<number, Abstandspaar[]>();
      gruppen.forEach((gruppe, index) => {
        const paare: Abstandspaar[] = [];
        for (let i = 0; i < gruppe.length; i++) {
          for (let j = i + 1; j < gruppe.length; j++) {
            paare.push({ i, j, distanz: abstand(gruppe[i]!, gruppe[j]!) });
          }
        }
        if (paare.length > 0) map.set(index, paare);
      });
      return Promise.resolve(map);
    },
  } as unknown as AbstandsErkennung;
}

function k(id: string, uhrzeit: string): DoppelKandidat {
  return { id: id as PhotoId, date: `2017-05-24T${uhrzeit}` };
}

const NAH = () => 0.5;
const FERN = () => 1.1;

describe('doppelVorschlagen', () => {
  it('schlägt vor, was zeitlich und im Bild zusammengehört', async () => {
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(NAH),
    );

    expect(bericht.doppel).toHaveLength(1);
    expect(bericht.doppel[0]!.photoIds).toEqual(['a', 'b']);
    expect(bericht.fotos).toBe(2);
    expect(bericht.bestaetigt).toBe(true);
  });

  it('verwirft, was nur zeitlich zusammenfiel', async () => {
    // Zwei Kameras auf demselben Fest: gleiche Minute, verschiedene Motive.
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(FERN),
    );

    expect(bericht.doppel).toEqual([]);
    expect(bericht.fotos).toBe(0);
  });

  it('schlägt das schärfste Foto zum Behalten vor', async () => {
    const s = stand(
      foto('a', { quality: q(200) }),
      foto('b', { quality: q(1800) }),
      foto('c', { quality: q(900) }),
    );
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41'), k('c', '18:37:55')],
      s,
      previews,
      vergleich(NAH),
    );

    expect(bericht.doppel[0]!.behalten).toBe('b');
  });

  it('nimmt das erste, wenn keines gemessen wurde', async () => {
    // Ohne Qualitätszahl gibt es keinen Grund, ein anderes vorzuschlagen — die
    // Reihenfolge der Aufnahme ist dann die ehrlichste Antwort.
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(NAH),
    );

    expect(bericht.doppel[0]!.behalten).toBe('a');
  });

  it('meldet ungeprüfte Vorschläge als solche, wenn das Werkzeug fehlt', async () => {
    // Ohne `swiftc` bleibt es bei der Zeit. Das ist die schwächere Auskunft,
    // und `bestaetigt: false` sagt es — sonst gäbe die Oberfläche eine
    // ungeprüfte Liste wie eine geprüfte aus.
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(FERN, true),
    );

    expect(bericht.bestaetigt).toBe(false);
    expect(bericht.doppel).toHaveLength(1);
  });

  it('lässt ein Foto ohne Vorschau heraus', async () => {
    const s = stand(foto('a'), foto('b'), foto('c'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41'), k('c', '18:37:55')],
      s,
      previewsOhne('b'),
      vergleich(NAH),
    );

    expect(bericht.doppel[0]!.photoIds).toEqual(['a', 'c']);
  });

  it('merkt ein Doppel als „beide behalten", ohne es zu verschweigen', async () => {
    // Wie ein abgenickter Befund: Es bleibt in der Antwort, damit die
    // Entscheidung umkehrbar ist — die Oberfläche blendet es aus.
    const s = stand(foto('a'), foto('b'));
    s.doppelBehalten['a+b'] = '2026-08-08T12:00:00.000Z';

    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(NAH),
    );

    expect(bericht.doppel).toHaveLength(1);
    expect(bericht.doppel[0]!.schluessel).toBe('a+b');
    expect(bericht.doppel[0]!.behaltenSeit).toBe('2026-08-08T12:00:00.000Z');
  });

  it('nennt den gemessenen Abstand als Begründung', async () => {
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '18:37:27'), k('b', '18:37:41')],
      s,
      previews,
      vergleich(() => 0.59),
    );

    expect(bericht.doppel[0]!.aehnlichkeit).toBeCloseTo(0.59, 6);
    // Die Schwelle steht daneben: „0,59" allein ist eine Zahl, „0,59 von
    // höchstens 0,85" eine Auskunft.
    expect(bericht.hoechstabstand).toBe(0.85);
    expect(bericht.fensterSekunden).toBe(120);
  });

  it('rechnet nichts, wenn es keine Kandidaten gibt', async () => {
    const s = stand(foto('a'), foto('b'));
    const bericht = await doppelVorschlagen(
      [k('a', '10:00:00'), k('b', '14:00:00')],
      s,
      previews,
      vergleich(NAH),
    );

    expect(bericht.doppel).toEqual([]);
    expect(bericht.fotos).toBe(0);
  });

  it('achtet auf Fenster und Schwelle aus den Optionen', async () => {
    const s = stand(foto('a'), foto('b'));
    const eingabe = [k('a', '10:00:00'), k('b', '10:00:45')];

    expect(
      (await doppelVorschlagen(eingabe, s, previews, vergleich(NAH), { fensterSekunden: 30 }))
        .doppel,
    ).toEqual([]);
    expect(
      (
        await doppelVorschlagen(
          eingabe,
          s,
          previews,
          vergleich(() => 0.8),
          { hoechstabstand: 0.7 },
        )
      ).doppel,
    ).toEqual([]);
  });
});

/** Eine Qualitätsmessung, in der nur die Schärfe zählt. */
function q(sharpness: number) {
  return { sharpness, brightness: 110, contrast: 55, clippedDark: 0, clippedLight: 0 };
}
