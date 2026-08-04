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
 * FNV-1a über eine Zeichenkette.
 *
 * Kurz, stabil und ohne Abhängigkeit. Kollisionen sind hier folgenlos: Im
 * schlimmsten Fall bleibt ein Hinweis aus, es geht nichts verloren.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
