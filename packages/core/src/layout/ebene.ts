/**
 * Die Ebene eines Bildes im Stapel einer Doppelseite.
 *
 * Solange jedes Bild in seinem Platz aus der Vorlage sitzt, gibt es keinen
 * Stapel: Kein Slot überlappt einen anderen, das prüft `library.test.ts`. Seit
 * sich Kästen frei ziehen und aufziehen lassen (`SlotAssignment.rect`), gibt es
 * ihn – und damit die Frage, wer vor wem liegt. Vorher hat sie die Reihenfolge
 * der Vorlage beantwortet, also der Zufall des Templateentwurfs.
 *
 * Vier Züge, wie in jedem Grafikprogramm: ganz nach vorn, eine Ebene vor, eine
 * zurück, ganz nach hinten. Kein „auf Ebene 4 setzen": Eine Ebenennummer ist
 * keine Absicht, sondern das Ergebnis einer – und beim Umstellen der Nachbarn
 * wäre die Nummer von gestern die falsche von heute.
 *
 * **Jeder Zug nummeriert den ganzen Stapel neu**, fortlaufend von 0. Der kürzere
 * Weg wäre, dem Bild ein `layer` weit jenseits der anderen zu geben (`+1` über
 * dem Höchsten). Dann driften die Zahlen mit jedem Zug auseinander, und aus dem
 * Modell ist irgendwann nicht mehr zu lesen, in welcher Ebene ein Bild liegt.
 * Nach dem Neunummerieren ist `layer` genau das: die Ebene, von hinten gezählt.
 */
import type { SlotAssignment, Spread } from '../model/spread.js';
import { slotReihenfolge } from '../model/spread.js';
import type { Template } from '../model/template.js';

/** Wohin ein Bild im Stapel wandert. */
export type Ebenenzug = 'vorn' | 'vor' | 'zurueck' | 'hinten';

export const EBENENZUEGE: readonly Ebenenzug[] = ['vorn', 'vor', 'zurueck', 'hinten'];

export function isEbenenzug(wert: unknown): wert is Ebenenzug {
  return typeof wert === 'string' && (EBENENZUEGE as readonly string[]).includes(wert);
}

/**
 * Verschiebt ein Bild im Stapel seiner Doppelseite.
 *
 * @returns die neue Doppelseite – oder `undefined`, wenn die Vorlage diesen
 * Platz nicht kennt. Ein Zug am vorderen Bild „nach vorn" ist kein Fehler: Er
 * ergibt denselben Stapel, und die Nummerierung steht danach ausdrücklich da.
 */
export function moveSlotLayer(
  spread: Spread,
  template: Template,
  slotId: string,
  zug: Ebenenzug,
): Spread | undefined {
  const stapel = slotReihenfolge(template.slots, spread).map((s) => s.id);
  const von = stapel.indexOf(slotId);
  if (von < 0) return undefined;

  const nach =
    zug === 'vorn'
      ? stapel.length - 1
      : zug === 'hinten'
        ? 0
        : Math.min(stapel.length - 1, Math.max(0, von + (zug === 'vor' ? 1 : -1)));

  const neu = [...stapel];
  neu.splice(von, 1);
  neu.splice(nach, 0, slotId);

  const ebene = new Map(neu.map((id, i) => [id, i]));
  return {
    ...spread,
    slots: spread.slots.map((slot) => {
      const wert = ebene.get(slot.slotId);
      // Plätze, die die Vorlage nicht kennt, bleiben unangetastet: Sie werden
      // ohnehin nicht gezeichnet, und ein erfundener Wert wäre eine Aussage
      // über etwas, das es nicht gibt.
      return wert === undefined ? slot : ({ ...slot, layer: wert } satisfies SlotAssignment);
    }),
  };
}

/**
 * In welcher Ebene liegt dieser Platz, und wie viele gibt es?
 *
 * Für die Oberfläche: „Ebene 2 von 5" ist die Auskunft, die sagt, ob ein Zug
 * überhaupt noch etwas ändern kann. Gezählt wird von vorn, weil vorn das ist,
 * was man sieht – Ebene 1 ist das oberste Bild.
 */
export function slotEbene(
  spread: Spread,
  template: Template,
  slotId: string,
): { ebene: number; von: number } | undefined {
  const stapel = slotReihenfolge(template.slots, spread).map((s) => s.id);
  const i = stapel.indexOf(slotId);
  if (i < 0) return undefined;
  return { ebene: stapel.length - i, von: stapel.length };
}
