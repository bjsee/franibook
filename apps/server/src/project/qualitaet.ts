/**
 * Bildqualität nachziehen: Schärfe und Belichtung.
 *
 * Das Gegenstück zu `merkmale.ts` für Issue #19, mit derselben Aufteilung:
 * Gemessen wird außerhalb (`bildqualitaet.ts`), dieses Modul findet die Fotos
 * ohne Auskunft und trägt das Ergebnis ein.
 *
 * **Es läuft nicht im Import, sondern danach und im Hintergrund** — wie die
 * Bildmerkmale und aus demselben Grund: Das Buch steht ohne die Zahlen, sie
 * gewichten nur. Anders als dort hängt hier allerdings der Vorschau-Cache
 * dazwischen, denn gemessen wird auf der 320-px-Vorschau. Nach dem Warmlauf
 * liegt die ohnehin bereit; fehlt sie, wird sie erzeugt.
 *
 * Gemessen wird nur, was noch keine Auskunft hat. Anders als bei `faces: []`
 * gibt es hier keinen leeren Befund: Eine Datei, die sich nicht lesen lässt,
 * bleibt ohne `quality` und wird beim nächsten Start erneut versucht.
 */
import type { Photo, PhotoId } from '@franibook/core';
import { messeQualitaet } from '../bildqualitaet.js';
import type { PreviewCache } from '../previews.js';

/** Was dieses Modul vom Projekt anfasst. */
export interface Qualitaetstand {
  photos: Map<PhotoId, Photo>;
  /** Die Fotos mit aufgelösten Korrekturen — die Drehung geht in den Cachenamen ein. */
  effectivePhotoList(): Photo[];
}

export interface QualitaetBericht {
  /** Fotos, die gemessen wurden. */
  gemessen: number;
  /** Fotos, an denen die Messung scheiterte. */
  gescheitert: number;
  millisekunden: number;
}

/** Fotos ohne Auskunft über ihre Qualität. */
export function ohneQualitaet(stand: Qualitaetstand): Photo[] {
  return [...stand.photos.values()].filter((p) => p.quality === undefined);
}

/**
 * Wie viele Messungen gleichzeitig laufen.
 *
 * Weniger als beim Vorschau-Warmlauf: Die Rechnung ist reines JavaScript auf
 * dem Hauptthread, nur das Decodieren geht an sharps Threadpool. Mehr
 * Nebenläufigkeit verschöbe die Arbeit nur in die Warteschlange.
 */
const GLEICHZEITIG = 4;

/**
 * Misst die fehlenden Qualitätszahlen und meldet, was dabei herauskam.
 *
 * Trägt nur ein, was tatsächlich gemessen wurde. Eine Datei, an der sharp
 * scheitert — ein defektes Bild, eine nicht eingehängte Quelle —, bleibt ohne
 * Auskunft: Eine Null einzutragen hieße, ein unlesbares Foto dauerhaft als
 * unscharf festzuschreiben, und die Zahl gewichtet den Slotplatz.
 */
export async function qualitaetNachziehen(
  stand: Qualitaetstand,
  previews: PreviewCache,
  onProgress?: (fertig: number, gesamt: number) => void,
): Promise<QualitaetBericht> {
  const t0 = Date.now();
  const offen = new Set(ohneQualitaet(stand).map((p) => p.id));
  const bericht: QualitaetBericht = { gemessen: 0, gescheitert: 0, millisekunden: 0 };
  if (offen.size === 0) return bericht;

  // Über die effektiven Fotos, nicht über die rohen: Der Vorschau-Cache trägt
  // die Drehung im Namen, und ein rohes Foto zeigte auf eine zweite Datei, die
  // erst erzeugt werden müsste.
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
          const quality = await messeQualitaet(pfad);
          // Eingetragen wird am **rohen** Foto: `effectivePhoto` liefert eine
          // Kopie, und ein Wert daran wäre nach dem nächsten Aufruf weg.
          const roh = stand.photos.get(effektiv.id);
          if (roh) {
            roh.quality = quality;
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
