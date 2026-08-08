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
 * Der Satz, auf den man sich beim Klicken verlässt.
 *
 * Er steht an einer Stelle, weil er überall dasselbe versprechen muss — und
 * weil genau dieses Versprechen einmal falsch war: Vor der Merkliste verschob
 * das Aussortieren die Datei, und ein Sync-Dienst spielte sie zurück
 * (`.claude/rules/server.md`).
 */
const ZUSAGE =
  'Die Datei bleibt unangetastet in ihrer Bildquelle liegen; das Foto wird nur aus dem ' +
  'Projekt genommen und kommt bei keinem Einlesen zurück. ' +
  'Unter „Bildquellen" steht es weiter in der Liste der aussortierten Fotos und lässt ' +
  'sich von dort wieder aufnehmen.';

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

  if (!window.confirm(`„${name}" aussortieren?${folge}\n\n${ZUSAGE}`)) {
    return null;
  }

  try {
    return { ok: true, ergebnis: await fotoAussortieren(photoId) };
  } catch (e: unknown) {
    return { ok: false, fehler: fehlertext(e) };
  }
}

/**
 * Sortiert mehrere Fotos auf einmal aus — für „von diesen das behalten".
 *
 * **Eine Bestätigung, aber mehrere Anfragen**, denn `DELETE /api/photos/:id`
 * nimmt eine Kennung. Bei einem Doppel aus zwei Fotos ist das eine Löschung und
 * ein Cmd+Z; bei vieren sind es drei. Eine mengenwertige Route wäre die
 * sauberere Antwort (wie `PATCH /api/photos` beim Datum) — sie lohnt, sobald
 * hier regelmäßig mehr als ein Bild fällt. Am Bestand sind 45 der 49 Doppel
 * Paare.
 *
 * Bricht beim ersten Fehler ab und meldet, was bis dahin durchging: Ein halb
 * ausgeführter Stapel, der sich als Erfolg ausgibt, wäre die schlechtere Hälfte
 * beider Antworten.
 */
export async function fotosLoeschen(
  ids: readonly string[],
  { behalten }: { behalten: string },
): Promise<
  // Die Kennung steht daneben, weil `AussortierErgebnis` sie nicht trägt: Der
  // Aufrufer muss wissen, *welche* Zeilen verschwinden, nicht nur wie viele.
  | { ok: true; entfernt: { id: string; ergebnis: AussortierErgebnis }[] }
  | { ok: false; fehler: string }
  | null
> {
  if (ids.length === 0) return { ok: true, entfernt: [] };

  const wieViele = ids.length === 1 ? 'das andere Foto' : `die anderen ${String(ids.length)} Fotos`;
  if (
    !window.confirm(
      `„${behalten}" behalten und ${wieViele} dieses Doppels aussortieren?\n\n${ZUSAGE}`,
    )
  ) {
    return null;
  }

  const entfernt: { id: string; ergebnis: AussortierErgebnis }[] = [];
  for (const id of ids) {
    try {
      entfernt.push({ id, ergebnis: await fotoAussortieren(id) });
    } catch (e: unknown) {
      const bisher = entfernt.length > 0 ? ` (${String(entfernt.length)} schon aussortiert)` : '';
      return { ok: false, fehler: `${fehlertext(e)}${bisher}` };
    }
  }
  return { ok: true, entfernt };
}

/** Was passiert ist, in einem Satz. */
export function loeschMeldung(d: AussortierErgebnis): string {
  const teile = [`„${d.fileName}" ist aussortiert`];
  if (d.imBuch === 1) teile.push('ein Platz im Buch bleibt leer');
  else if (d.imBuch > 1) teile.push(`${d.imBuch} Plätze im Buch bleiben leer`);
  teile.push(`${d.photoCount} Fotos übrig`);
  return teile.join(' · ');
}
