/**
 * Was die beiden Vergrößerungsknöpfe einer Buchseite anzubieten haben.
 *
 * Steht neben der Komponente und nicht in ihr, weil es sich ohne DOM prüfen
 * lässt – dieselbe Trennung wie bei `absicht.ts` und `griffmodus.ts`. Und sie
 * hat einen Anlass: Der Vergleich war einmal falsch geschrieben
 * (`maxY > max * 1.02`), und weil `max` das Minimum aus beiden Richtungen ist,
 * war er immer unwahr, sobald die Höhe die knappe Richtung war. Der Knopf
 * „füllen" blieb dann aus – auch an einem hochkanten Bild, das sich um das
 * Vierfache verbreitern ließe. Ein Test hätte das gesehen, die Oberfläche nicht.
 */
import type { Vergroesserungsauskunft } from '../api.js';

/** Ab wann sich ein Griff lohnt: ein halbes Prozent ist keine Vergrößerung. */
const SCHWELLE = 1.005;

/** Und ab wann das Einpassen mehr bringt als das proportionale Wachsen. */
const LOHNT_MEHR = 1.02;

/**
 * Lohnt sich das **proportionale** Vergrößern dieser Buchseite?
 *
 * `max` ist der Faktor, der die Form aller Kästen wahrt — also das Minimum aus
 * Breiten- und Höhenpassung.
 */
export function lohntProportional(wert: Vergroesserungsauskunft | string | undefined): boolean {
  return typeof wert === 'object' && wert.max > SCHWELLE;
}

/**
 * Lohnt sich das **Einpassen**, also Höhe und Breite getrennt?
 *
 * Verglichen wird die **größere** der beiden Richtungen mit dem proportionalen
 * Faktor: Nur wenn eine davon deutlich weiter reicht, bringt das Einpassen etwas,
 * das die Formtreue nicht schon hergibt.
 */
export function lohntEinpassen(wert: Vergroesserungsauskunft | string | undefined): boolean {
  if (typeof wert !== 'object') return false;
  return Math.max(wert.maxX, wert.maxY) > wert.max * LOHNT_MEHR;
}
