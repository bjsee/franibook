/**
 * Ein Foto aussortieren.
 *
 * An drei Stellen der Oberfläche erreichbar – Fotopool, ausgewählter Slot,
 * Gruppenansicht – und deshalb hier einmal beschrieben statt dreimal gebaut.
 * Vor allem der Bestätigungstext gehört an eine Stelle: Er muss überall
 * dasselbe versprechen, weil er das Einzige ist, worauf man sich beim Klicken
 * verlässt.
 */
import { type AussortierErgebnis, fehlertext, fotoAussortieren } from './api.js';

export type { AussortierErgebnis as DeleteResult };

interface Optionen {
  /** Für den Bestätigungstext: was der Benutzer gerade vor sich sieht. */
  name: string;
  /**
   * Ob das Foto sicher im Buch steht. `undefined` heißt „von hier aus nicht
   * erkennbar" – dann wird die Folge im Konjunktiv genannt statt behauptet.
   */
  imBuch?: boolean;
}

/**
 * Fragt nach und löscht.
 *
 * @returns das Ergebnis, `null` bei Abbruch, oder eine Fehlermeldung.
 */
export async function fotoLoeschen(
  photoId: string,
  { name, imBuch }: Optionen,
): Promise<{ ok: true; ergebnis: AussortierErgebnis } | { ok: false; fehler: string } | null> {
  const folge =
    imBuch === true
      ? '\n\nEs steht im Buch – dort bleibt der Platz leer, bis du ein anderes Foto hineinziehst.'
      : imBuch === undefined
        ? '\n\nSteht es im Buch, bleibt dort der Platz leer.'
        : '';

  if (
    !window.confirm(
      `„${name}" aussortieren?${folge}\n\n` +
        'Die Datei bleibt unangetastet in ihrer Bildquelle liegen; das Foto wird nur aus dem ' +
        'Projekt genommen und kommt bei keinem Einlesen zurück. ' +
        'Unter „Bildquellen" steht es weiter in der Liste der aussortierten Fotos und lässt ' +
        'sich von dort wieder aufnehmen.',
    )
  ) {
    return null;
  }

  try {
    return { ok: true, ergebnis: await fotoAussortieren(photoId) };
  } catch (e: unknown) {
    return { ok: false, fehler: fehlertext(e) };
  }
}

/** Was passiert ist, in einem Satz. */
export function loeschMeldung(d: AussortierErgebnis): string {
  const teile = [`„${d.fileName}" ist aussortiert`];
  if (d.imBuch === 1) teile.push('ein Platz im Buch bleibt leer');
  else if (d.imBuch > 1) teile.push(`${d.imBuch} Plätze im Buch bleiben leer`);
  teile.push(`${d.photoCount} Fotos übrig`);
  return teile.join(' · ');
}
