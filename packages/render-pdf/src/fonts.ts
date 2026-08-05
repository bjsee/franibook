/**
 * Schriftregistrierung für pdfkit.
 *
 * Gemeinsam für Innenteil (`render-pdf.ts`) und Umschlag (`render-cover.ts`):
 * Beide zeichnen `TextBox`-artige Boxen aus demselben Kern und müssen dieselbe
 * Schrift einbetten. Eine zweite Fassung dieser Funktion in `render-cover.ts`
 * hätte irgendwann unbemerkt divergieren können – etwa wenn hier eine weitere
 * Familie dazukäme und dort vergessen würde.
 */
import type { FontFamilyId, FontWeight } from '@franibook/core';
import { resolveWeight } from '@franibook/core';
import { fontFilePath } from '@franibook/fonts';

/** Der Name, unter dem eine Schrift im Dokument registriert ist. */
export function fontKey(family: FontFamilyId, weight: FontWeight): string {
  return `${family}/${weight}`;
}

/** Alles, was zur Wahl der Schrift einer Textbox nötig ist. */
export interface FontUsage {
  family?: FontFamilyId;
  weight: FontWeight;
}

/**
 * Registriert die Schriften, die in den gegebenen Text-Boxen wirklich vorkommen.
 *
 * pdfkit bettet nur ein, was benutzt wurde – registrieren allein kostet nichts.
 * Trotzdem wird hier vorher gesammelt: Eine registrierte Schrift ist eine
 * geöffnete Datei, und bei vier Familien mit je zwei Schnitten wären das acht
 * Dateien für ein Dokument, das oft nur eine braucht. Die Buchschrift kommt in
 * jedem Fall dazu; pdfkit setzt intern sonst Helvetica, und die ist eine der 14
 * Basisschriften, wird nicht eingebettet und hängt beim Druckdienstleister an
 * dessen Interpretation. Genau das war der Anlass für Issue #5.
 */
export function registerFonts(doc: PDFKit.PDFDocument, textBoxes: Iterable<FontUsage>): void {
  const gebraucht = new Set<string>([fontKey('sans', 'regular')]);
  for (const box of textBoxes) {
    const family = box.family ?? 'sans';
    gebraucht.add(fontKey(family, resolveWeight(family, box.weight)));
  }

  for (const key of gebraucht) {
    const [family, weight] = key.split('/') as [FontFamilyId, FontWeight];
    doc.registerFont(key, fontFilePath(family, weight));
  }

  // Voreinstellung, damit nichts auf Helvetica fällt, was pdfkit intern selbst
  // setzt (Lesezeichen, Struktur-Tags).
  doc.font(fontKey('sans', 'regular'));
}
