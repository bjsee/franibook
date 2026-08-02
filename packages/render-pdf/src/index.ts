/**
 * @franibook/render-pdf
 *
 * Übersetzt ein RenderedSpread in PDF-Seiten. Zweiter Adapter über derselben
 * Quelle wie die Vorschau – jede Abweichung zwischen beiden ist per
 * Konstruktion ein Fehler in einem der Adapter und wird vom Parity-Test
 * gefunden.
 */

export { renderPdf } from './render-pdf.js';
export type { RenderPdfOptions, RenderPdfResult, PhotoSource } from './render-pdf.js';
export { prepareImage } from './prepare-image.js';
export type { PreparedImage, PrepareOptions } from './prepare-image.js';
