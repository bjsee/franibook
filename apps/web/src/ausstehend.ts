/**
 * Was noch nicht beim Server ist.
 *
 * Ausschnitt, Neigung und Bildunterschrift gehen erst 250 ms nach der letzten
 * Bewegung raus (`SPEICHER_VERZOEGERUNG_MS` in `spread/useSpreadEditor.ts`) —
 * sonst wäre jede Reglerstellung ein Schreibvorgang auf das ganze Projekt-JSON.
 *
 * Für Cmd+Z ist genau das eine Falle, und keine kosmetische: Wer zieht und
 * sofort zurücknimmt, setzt den Stand von **vor** der Bewegung — und der
 * ausstehende PATCH trifft danach ein und stellt sie wieder her. Das Buch sieht
 * dann so aus, als hätte das Zurücknehmen nicht gewirkt.
 *
 * Deshalb wird vor dem Zurücknehmen erst geleert: Alles Geplante sofort senden,
 * alles Unterwegse abwarten. Das ist ein Wartestrich von Millisekunden und die
 * Voraussetzung dafür, dass ein Undo den Stand meint, den man sieht.
 */

/** Verzögerte Schreibvorgänge, die sich vorziehen lassen. */
const geplant = new Set<() => Promise<void>>();

/** Anfragen, die schon unterwegs sind. */
const unterwegs = new Set<Promise<unknown>>();

/**
 * Meldet einen verzögerten Schreibvorgang an, der sich vorziehen lässt.
 *
 * @returns die Abmeldung, für das Aufräumen des Effekts.
 */
export function planeSofort(senden: () => Promise<void>): () => void {
  geplant.add(senden);
  return () => geplant.delete(senden);
}

/** Hält eine laufende Anfrage fest, bis sie durch ist. Ruft `api.ts` selbst. */
export function imFlug<T>(anfrage: Promise<T>): Promise<T> {
  unterwegs.add(anfrage);
  // Auch ein Fehlschlag ist beendet – sonst wartete das Leeren auf ihn.
  void anfrage.catch(() => undefined).finally(() => unterwegs.delete(anfrage));
  return anfrage;
}

/**
 * Bringt alles zum Server, was noch aussteht.
 *
 * Erst das Geplante vorziehen, dann warten – in dieser Reihenfolge, denn das
 * Vorziehen erzeugt neue Anfragen. Die Schleife, weil eine Antwort ihrerseits
 * einen Schreibvorgang auslösen kann; sie ist beschränkt, damit ein Fehler in
 * einem Aufrufer die Oberfläche nicht anhält.
 */
export async function ausstehendSenden(): Promise<void> {
  for (const senden of [...geplant]) {
    await senden().catch(() => undefined);
  }
  for (let runde = 0; runde < 5 && unterwegs.size > 0; runde++) {
    await Promise.allSettled([...unterwegs]);
  }
}
