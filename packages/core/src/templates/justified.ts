/**
 * Trägervorlagen für justierte Zeilen.
 *
 * Die Rechnung in `layout/justify.ts` legt jedes Bild selbst; trotzdem braucht
 * eine Doppelseite eine Vorlage. Sie liefert die Slotkennungen, an denen die
 * Fotozuordnung hängt, und ein Rückfallgitter für den Fall, dass ein Platz kein
 * eigenes Rechteck trägt – nach dem Aussortieren eines Fotos etwa steht dort ein
 * leerer Platz, und der wird nach der Slotgeometrie gezeichnet.
 *
 * Abgeleitet und nicht in `library.json` geschrieben, aus demselben Grund wie
 * die Halbseiten: Es gäbe sie für jede Bilderzahl von 5 bis 16, und alle wären
 * dasselbe Gitter mit anderer Zellenzahl. Die Kennung `justiert.<n>` ist damit
 * die einzige Markierung, die eine justierte Doppelseite braucht – kein neues
 * Feld im Datenmodell und kein Schemasprung.
 */
import type { Template, TemplateId, TemplateSlot } from '../model/template.js';

export const JUSTIFIED_PREFIX = 'justiert.';

/**
 * Ab wie vielen Bildern justierte Zeilen in Frage kommen.
 *
 * Darunter gestaltet die Bibliothek, und sie soll es: Bei sechs Bildern ist die
 * Anordnung die Aussage der Seite – ein Ankerbild, zwei kleine daneben –, und
 * ein Gitter wäre keine. Dort sitzen die Fehlpaarungen auch nicht: Von den 108
 * am echten Buch gemessenen lagen alle auf Doppelseiten mit zehn Bildern und
 * mehr, wo die Bibliothek pro Größe nur zwei oder drei Mosaike anbietet und
 * keines zur Mischung passt.
 */
export const JUSTIFIED_MIN_PHOTOS = 10;

/** Mehr als das trägt eine Doppelseite bei 240 dpi nicht. */
export const JUSTIFIED_MAX_PHOTOS = 16;

/** Kennung der Trägervorlage für diese Bilderzahl. */
export function justifiedTemplateId(photoCount: number): TemplateId {
  return `${JUSTIFIED_PREFIX}${photoCount}`;
}

/** Ob diese Kennung eine justierte Doppelseite bezeichnet. */
export function isJustified(templateId: TemplateId | undefined): boolean {
  return templateId !== undefined && templateId.startsWith(JUSTIFIED_PREFIX);
}

/**
 * Baut die Trägervorlage zu einer Kennung, oder `undefined` bei unbekannter.
 *
 * Die Slots liegen in Leserichtung: erste Hälfte links, zweite rechts – genau
 * die Reihenfolge, in der `justifiedRects` seine Rechtecke liefert.
 */
export function justifiedTemplate(id: TemplateId): Template | undefined {
  if (!id.startsWith(JUSTIFIED_PREFIX)) return undefined;
  const n = Number(id.slice(JUSTIFIED_PREFIX.length));
  if (!Number.isInteger(n) || n < 1 || n > JUSTIFIED_MAX_PHOTOS) return undefined;

  const linksN = Math.ceil(n / 2);
  const slots: TemplateSlot[] = [];
  slots.push(...gitter(linksN, 0, slots.length));
  slots.push(...gitter(n - linksN, 1, slots.length));

  return {
    id,
    name: `Justierte Zeilen (${n})`,
    pageSpan: 2,
    slots,
    tags: ['justiert', 'dicht'],
  };
}

/**
 * Der Rückfall: ein gleichmäßiges Gitter auf einer Seite, normiert.
 *
 * Spaltenzahl aus der Wurzel wie in der Rechnung, damit ein leerer Platz dort
 * steht, wo auch das justierte Rechteck stünde. Die Ränder sind die der
 * Bibliothek (22 mm außen, 16 mm zum Falz auf 300 mm Seitenbreite), hier als
 * Anteile – eine Vorlage kennt kein Druckprofil.
 *
 * Unten ist der Rand größer als oben, und das ist keine Gestaltungslaune:
 * Sicherheitsabstand und Fußraum des Zeitstrahls sind absolute Millimeter, die
 * Vorlage ist normiert. Auf der 300 mm hohen Referenz ließen 22 mm genug Luft,
 * auf den 270 mm des Standardformats nicht mehr – das Gitter ragte 4,2 mm in
 * den Fuß des Zeitstrahls. 28/300 hält auch dort den Abstand.
 */
function gitter(anzahl: number, seite: 0 | 1, idOffset: number): TemplateSlot[] {
  if (anzahl <= 0) return [];

  const rand = 22 / 600;
  const falz = 16 / 600;
  const randYOben = 22 / 300;
  const randYUnten = 28 / 300;
  const spalten = Math.max(1, Math.round(Math.sqrt(anzahl)));
  const zeilen = Math.ceil(anzahl / spalten);
  const gapX = 6 / 600;
  const gapY = 6 / 300;

  const x0 = seite === 0 ? rand : 0.5 + falz;
  const breite = 0.5 - rand - falz;
  const zellW = (breite - gapX * (spalten - 1)) / spalten;
  const hoehe = 1 - randYOben - randYUnten;
  const zellH = (hoehe - gapY * (zeilen - 1)) / zeilen;

  return Array.from({ length: anzahl }, (_, i) => ({
    id: slotId(idOffset + i),
    x: x0 + (i % spalten) * (zellW + gapX),
    y: randYOben + Math.floor(i / spalten) * (zellH + gapY),
    w: zellW,
    h: zellH,
    // Alle Plätze gleich gewichtet: Eine justierte Seite hat kein Hauptbild,
    // sie hat lauter unverzerrte. Wer eine Hierarchie will, nimmt eine Vorlage.
    prominence: 2 as const,
  }));
}

/** a, b, c … z, dann aa. Wie in der Bibliothek. */
function slotId(index: number): string {
  const buchstaben = 'abcdefghijklmnopqrstuvwxyz';
  return index < 26
    ? buchstaben[index]!
    : `${buchstaben[Math.floor(index / 26) - 1]!}${buchstaben[index % 26]!}`;
}
