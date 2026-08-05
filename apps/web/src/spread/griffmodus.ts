/**
 * Was der nächste Klick auf das schon gewählte Bild anbietet.
 *
 * Drei Stufen statt zweier, und vor allem: **kein Umschalter mehr.** Vorher
 * stand neben der Bühne ein Segmentknopf „Ziehen bewegt: Ausschnitt | Position",
 * und die Griffe kannten nur Größe und Drehung. Zwei Wege, dieselbe Hand zu
 * führen – einer am Rand des Fensters, einer am Bild –, und man musste den einen
 * stellen, bevor der andere tat, was man meinte.
 *
 * Jetzt entscheidet der **Ort des Griffs**, nicht ein Modus: Im Bild gezogen
 * wandert der Ausschnitt, am Rand gezogen wandert der Kasten über die Seite. Der
 * Klickzyklus regelt daneben nur noch, was die **Griffe** anbieten – gar nichts,
 * Größe, Drehung –, und schließt sich wieder.
 *
 * Randabfallende Bilder überspringen die Drehung: Geneigt entstünden weiße
 * Zwickel an der Papierkante (`neigungGesperrt`). Übersprungen, nicht abgelehnt –
 * ein Klick, der nichts tut, sieht aus wie ein Fehler.
 */
export type Griffmodus = 'keine' | 'groesse' | 'drehen';

export function naechsterGriffmodus(aktuell: Griffmodus, drehenGesperrt: boolean): Griffmodus {
  if (aktuell === 'keine') return 'groesse';
  if (aktuell === 'groesse') return drehenGesperrt ? 'keine' : 'drehen';
  return 'keine';
}
