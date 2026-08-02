/**
 * @franibook/fonts
 *
 * Die Schriftdateien des Buchs und die Pfade darauf. Wer die Schrift
 * *beschreibt* – Familie, Schnitte, Metriken, Stile –, ist `core`
 * (`render/typography.ts`); hier liegen nur die Dateien.
 *
 * Eigenes Paket, weil die beiden Verbraucher unvereinbare Anforderungen haben:
 * Der PDF-Renderer braucht einen absoluten Dateipfad (`doc.registerFont`), der
 * Browser eine URL auf genau dieselbe Datei (`@font-face`). Eine zweite Kopie
 * unter `apps/web/public` wäre die Alternative gewesen – zwei Kopien einer
 * Binärdatei, die auseinanderlaufen können, ohne dass es auffällt.
 */
import { fileURLToPath } from 'node:url';
import { type FontWeight } from '@franibook/core';

/** Dateiname je Schnitt, relativ zu `files/`. */
export const FONT_FILE_NAMES: Record<FontWeight, string> = {
  regular: 'FranibookSans-Regular.ttf',
  semibold: 'FranibookSans-SemiBold.ttf',
};

/**
 * Absoluter Pfad zur Schriftdatei eines Schnitts.
 *
 * Aufgelöst über `import.meta.url`, nicht über `process.cwd()`: Der Server
 * wird aus dem Repo-Wurzelverzeichnis gestartet, der Parity-Test aus dem
 * Paketverzeichnis, und Tests aus beidem.
 */
export function fontFilePath(weight: FontWeight): string {
  return fileURLToPath(new URL(`../files/${FONT_FILE_NAMES[weight]}`, import.meta.url));
}
