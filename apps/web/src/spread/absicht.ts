/**
 * Was ein Zug am Platz unter dem Zeiger bedeutet.
 *
 * Getauscht wurde schon immer: Trifft ein Foto auf einen belegten Slot, nehmen
 * die beiden ihre Plätze ein (`movePhoto` in `layout/move.ts`) – ein Bild
 * stillschweigend zu überschreiben darf nicht passieren. Nur sah man es dem Zug
 * nicht an. Während des Ziehens leuchteten **alle** Plätze gleich und nannten
 * ihre Auflösung; ob unter dem Zeiger etwas weichen würde oder sich ein leerer
 * Platz füllt, stand nirgends. Diese Funktion sagt es vorher, damit die Bühne
 * das passende Zeichen setzen kann.
 *
 * Sie steht neben der Bühne und nicht in ihr, weil sie sich ohne DOM prüfen
 * lässt – dieselbe Trennung wie bei `auswahl.ts`. Und sie nimmt die `MoveSource`
 * des Kerns statt des Zugs aus `useSpreadEditor`: Was ein Zug bedeutet, hängt an
 * seiner Herkunft, nicht an den Pixelmaßen, die er für die Auflösungsanzeige
 * mitträgt.
 */
import type { MoveSource } from '@franibook/core';

/**
 * `nichts` ist kein Fehler, sondern der Platz, von dem der Zug ausging – der
 * Server nimmt ihn an und lässt alles, wie es ist.
 */
export type Absicht = 'tauschen' | 'einsetzen' | 'nichts';

export function absichtVon(
  quelle: MoveSource,
  ziel: { spreadIndex: number; slotId: string; belegt: boolean },
): Absicht {
  if (
    quelle.kind === 'slot' &&
    quelle.spreadIndex === ziel.spreadIndex &&
    quelle.slotId === ziel.slotId
  ) {
    return 'nichts';
  }
  // Auch aus dem Fotopool ist es ein Tausch: Das verdrängte Bild wandert
  // dorthin zurück, wo das gezogene herkam. Der Pool ist ja keine Liste,
  // sondern „alle Fotos minus die platzierten".
  return ziel.belegt ? 'tauschen' : 'einsetzen';
}

/** Das Wort am Zeiger. Kurz, weil es über einem Bild steht. */
export const ABSICHT_WORT: Record<Absicht, string> = {
  tauschen: 'Tauschen',
  einsetzen: 'Einsetzen',
  nichts: 'bleibt',
};
