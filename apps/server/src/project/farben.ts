/**
 * Farbwerte nachziehen.
 *
 * Dritter im Bunde nach `merkmale.ts` und `qualitaet.ts`, mit derselben
 * Aufteilung: Gemessen wird außerhalb (`bildfarben.ts`), dieses Modul findet
 * die Fotos ohne Auskunft und trägt das Ergebnis ein.
 *
 * **Im Hintergrund und ganz am Ende der Kette**, wie die beiden davor: Das Buch
 * steht ohne die Farbwerte, allein das Titelmosaik braucht sie. Ein Bestand,
 * der sie noch nicht hat, ergibt kein falsches Mosaik, sondern ein leeres mit
 * einem Hinweis (`mosaicWarningText`) — und beim nächsten Start ist er
 * nachgezogen.
 *
 * Gemessen wird nur, was noch keine Auskunft hat. Eine Datei, die sich nicht
 * lesen lässt, bleibt ohne `tone` und wird beim nächsten Start erneut versucht;
 * ein eingetragenes Grau wäre eine Farbe, die das Bild nicht hat, und das
 * Mosaik setzte sie an eine graue Stelle.
 */
import { type Photo, type PhotoId, type PhotoTone, rotatePhotoTone } from '@franibook/core';
import { messeFarben } from '../bildfarben.js';
import type { PreviewCache } from '../previews.js';

/** Was dieses Modul vom Projekt anfasst. */
export interface Farbstand {
  photos: Map<PhotoId, Photo>;
  /** Die Fotos mit aufgelösten Korrekturen — die Drehung geht in den Cachenamen ein. */
  effectivePhotoList(): Photo[];
}

export interface FarbBericht {
  gemessen: number;
  gescheitert: number;
  millisekunden: number;
}

/** Fotos ohne Auskunft über ihre Farben. */
export function ohneFarben(stand: Farbstand): Photo[] {
  return [...stand.photos.values()].filter((p) => p.tone === undefined);
}

/**
 * Wie viele Messungen gleichzeitig laufen.
 *
 * Höher als bei der Qualität: Dort rechnet die Laplace-Varianz in JavaScript
 * auf dem Hauptthread, hier tut libvips alles im eigenen Threadpool und JS
 * addiert am Ende neun Pixel.
 */
const GLEICHZEITIG = 8;

/**
 * Misst die fehlenden Farbwerte und meldet, was dabei herauskam.
 *
 * Eingetragen wird am **rohen** Foto: `effectivePhoto` liefert eine Kopie, und
 * ein Wert daran wäre nach dem nächsten Aufruf weg. Die gemessene Vorschau ist
 * dabei die schon gedrehte — genau richtig, denn `PhotoTone` steht relativ zur
 * angezeigten Bildkante, und `effectivePhoto` dreht es beim Lesen erneut.
 * Deshalb wird hier die Drehung wieder herausgerechnet, bevor der Wert ans rohe
 * Foto geht.
 */
export async function farbenNachziehen(
  stand: Farbstand,
  previews: PreviewCache,
  onProgress?: (fertig: number, gesamt: number) => void,
): Promise<FarbBericht> {
  const t0 = Date.now();
  const offen = new Set(ohneFarben(stand).map((p) => p.id));
  const bericht: FarbBericht = { gemessen: 0, gescheitert: 0, millisekunden: 0 };
  if (offen.size === 0) return bericht;

  const zuMessen = stand.effectivePhotoList().filter((p) => offen.has(p.id));

  let naechstes = 0;
  let fertig = 0;
  await Promise.all(
    Array.from({ length: Math.min(GLEICHZEITIG, zuMessen.length) }, async () => {
      for (;;) {
        const i = naechstes++;
        if (i >= zuMessen.length) return;
        const effektiv = zuMessen[i]!;
        try {
          const pfad = await previews.get(effektiv, 'thumb');
          const tone = await messeFarben(pfad);
          const roh = stand.photos.get(effektiv.id);
          if (roh) {
            // Zurückdrehen, damit der gespeicherte Wert wie jedes andere Feld
            // von `Photo` die Datei beschreibt und nicht die Korrektur darauf.
            // Vier minus die angewandte Drehung ist die Umkehrung; 4 selbst ist
            // die Identität und damit 0.
            const turns = effektiv.quarterTurns;
            roh.tone = turns ? rueckdrehen(tone, turns) : tone;
            bericht.gemessen++;
          }
        } catch {
          bericht.gescheitert++;
        }
        onProgress?.(++fertig, zuMessen.length);
      }
    }),
  );

  bericht.millisekunden = Date.now() - t0;
  return bericht;
}

/**
 * Die Umkehrung einer Vierteldrehung.
 *
 * Gedreht wird mit derselben Funktion, die `effectivePhoto` beim Lesen
 * anwendet — nur um den Gegenwinkel. Eine eigene Rückdrehung wäre eine zweite
 * Fassung derselben Rechnung und die Gelegenheit, sie auseinanderlaufen zu
 * lassen.
 */
function rueckdrehen(tone: PhotoTone, turns: 1 | 2 | 3): PhotoTone {
  return rotatePhotoTone(tone, ((4 - turns) % 4) as 0 | 1 | 2 | 3);
}
