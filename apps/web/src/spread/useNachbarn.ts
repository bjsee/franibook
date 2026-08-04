/**
 * Die Nachbarn der offenen Doppelseite.
 *
 * Ein Bild von einer Seite auf die andere zu ziehen braucht ein Ziel, das man
 * sehen kann. Der Umweg über den Fotopool – Bild herausnehmen, blättern, wieder
 * hineinziehen – geht zwar, verlangt aber drei Handgriffe und ein gutes
 * Gedächtnis dafür, welches der 830 Bilder gerade gemeint war.
 *
 * Zwei Seiten in jede Richtung reichen im Regelfall: Ein Bild sitzt fast immer
 * auf der falschen von zwei benachbarten Seiten, weil die Seitenverteilung an
 * einer Tagesgrenze anders gefallen ist, als man es erzählen würde. Wer zwanzig
 * Seiten weit umhängen will, nimmt den Pool. Der Lesetisch zeigt drei, weil sein
 * Filmstreifen zum Blättern da ist und nicht zum Ablegen.
 *
 * Die Miniaturen ziehen ihre Bilder aus den 320-px-Vorschauen und nicht aus
 * denen, die die Bühne zeigt: Fünf Doppelseiten in voller Vorschauauflösung wären
 * ein Vielfaches an Daten für eine Kachel von 150 Pixeln Breite.
 */
import { useEffect, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { doppelseiteLaden } from '../api.js';

/**
 * Verzögerung, bis die Nachbarn geladen werden.
 *
 * Beim Durchblättern mit den Pfeiltasten wechselt der Index im Sekundentakt;
 * ohne die Pause liefe für jede übersprungene Seite ein Satz Anfragen.
 */
const LADE_VERZOEGERUNG_MS = 250;

/** Vorschau in Miniaturauflösung – siehe Modulkommentar. */
/**
 * Adresse einer Miniatur.
 *
 * `bildVersion` ist derselbe Zähler wie in `App.tsx`: Er hängt an der Adresse,
 * damit eine Ausrichtungskorrektur sichtbar wird, obwohl Vorschauen `immutable`
 * ausgeliefert werden. Ohne Angabe bleibt die Adresse wie bisher — die Miniaturen
 * der Nachbarn und des Buchnavigators ändern sich beim Kippen ohnehin erst beim
 * nächsten Laden.
 */
export const miniaturSrc = (photoId: string, bildVersion = 0) =>
  `/api/photos/${photoId}/preview?size=thumb${bildVersion > 0 ? `&v=${bildVersion}` : ''}`;

export function useNachbarn(
  index: number,
  spreadCount: number,
  reichweite: number,
  version: number,
) {
  const [geladen, setGeladen] = useState<Map<number, RenderedSpread>>(new Map());

  const nachbarn: number[] = [];
  for (let i = index - reichweite; i <= index + reichweite; i++) {
    if (i >= 0 && i < spreadCount) nachbarn.push(i);
  }
  const schluessel = nachbarn.join(',');

  useEffect(() => {
    let abgebrochen = false;
    const timer = setTimeout(() => {
      void (async () => {
        const eintraege = await Promise.all(
          schluessel
            .split(',')
            .filter(Boolean)
            .map(async (s) => {
              const i = Number(s);
              try {
                return [i, (await doppelseiteLaden(i)) as RenderedSpread] as const;
              } catch {
                return undefined;
              }
            }),
        );
        if (abgebrochen) return;
        setGeladen(new Map(eintraege.filter((e): e is [number, RenderedSpread] => !!e)));
      })();
    }, LADE_VERZOEGERUNG_MS);

    return () => {
      abgebrochen = true;
      clearTimeout(timer);
    };
  }, [schluessel, version]);

  return { nachbarn, geladen };
}
