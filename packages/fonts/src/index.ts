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
import { type FontFamilyId, type FontWeight } from '@franibook/core';

/**
 * Dateiname je Familie und Schnitt, relativ zu `files/`.
 *
 * Fehlt ein Schnitt, gibt es ihn in dieser Familie nicht; `resolveWeight` in
 * `core` sorgt dafür, dass niemand danach fragt.
 */
export const FONT_FILE_NAMES: Record<FontFamilyId, Partial<Record<FontWeight, string>>> = {
  sans: {
    regular: 'FranibookSans-Regular.ttf',
    semibold: 'FranibookSans-SemiBold.ttf',
  },
  serif: {
    regular: 'CrimsonText-Regular.ttf',
    semibold: 'CrimsonText-SemiBold.ttf',
  },
  hand: {
    regular: 'Kalam-Regular.ttf',
    // Kalam kennt Light, Regular und Bold; Bold steht hier für den zweiten
    // Schnitt – eine Handschrift ohne kräftige Variante kann keinen Akzent.
    semibold: 'Kalam-Bold.ttf',
  },
  display: {
    regular: 'AbrilFatface-Regular.ttf',
  },
};

/**
 * Absoluter Pfad zur Schriftdatei.
 *
 * Aufgelöst über `import.meta.url`, nicht über `process.cwd()`: Der Server
 * wird aus dem Repo-Wurzelverzeichnis gestartet, der Parity-Test aus dem
 * Paketverzeichnis, und Tests aus beidem.
 */
export function fontFilePath(family: FontFamilyId, weight: FontWeight): string {
  const name = FONT_FILE_NAMES[family][weight] ?? FONT_FILE_NAMES[family].regular;
  if (!name) throw new Error(`Keine Schriftdatei für ${family}/${weight}`);
  return fileURLToPath(new URL(`../files/${name}`, import.meta.url));
}
