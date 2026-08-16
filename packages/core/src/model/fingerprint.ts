/**
 * Abdruck eines Zustands, um Veralten zu erkennen.
 *
 * Das Muster im Projekt: Beim Bau des Buchs wird ein Abdruck der Eingaben
 * gespeichert; weicht er später ab, sagt die Oberfläche, dass ein Neuaufbau
 * etwas ändern würde. Gebraucht wird das für die Gruppen und für die
 * Kalendergliederung — die Hashfunktion also zweimal, und deshalb steht sie
 * hier statt zweimal daneben.
 */

/**
 * FNV-1a über eine Zeichenkette, als 32-Bit-Zahl.
 *
 * Kurz, stabil und ohne Abhängigkeit. Kollisionen sind bei den Abdrücken
 * folgenlos: Im schlimmsten Fall bleibt ein Hinweis aus, es geht nichts
 * verloren.
 *
 * Der `seed` geht in den Startwert ein und ist der Grund, warum die Zahl
 * öffentlich ist: Neigung (`render/tilt.ts`) und Mosaik (`mosaic/plan.ts`)
 * brauchen zu einer gegebenen Kennung *einen* zugehörigen Wert und keine
 * Folge — ein Pseudozufallsgenerator wie `mulberry32` in `layout/generate.ts`
 * hinge dafür an der Reihenfolge der Aufrufe.
 */
export function fnv1aZahl(text: string, seed = 0): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Derselbe Abdruck als kurze Zeichenkette — die Form, die gespeichert wird. */
export function fnv1a(text: string): string {
  return fnv1aZahl(text).toString(36);
}
