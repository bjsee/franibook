/**
 * Prüft die Schriftdateien gegen die Konstanten, mit denen `core` rechnet.
 *
 * Beide Renderer setzen die Grundlinie über die Versalhöhe aus
 * `FONT_METRICS`. Steht dort ein anderer Wert als in der Datei, verschiebt sich
 * jeder Text im Buch – ohne dass ein Test es merkte, denn Vorschau und PDF
 * wären sich einig, nur eben beide falsch. Dieser Test liest die Metriken aus
 * den Tabellen zurück.
 *
 * Bewusst mit einem kleinen eigenen Leser statt mit fontkit: Die drei
 * gebrauchten Tabellen sind zwei Dutzend Zeilen, eine zusätzliche Abhängigkeit
 * nur für einen Test wären sie nicht wert.
 */
import { readFileSync } from 'node:fs';
import {
  BOOK_FONT_FAMILY,
  CSS_FONT_WEIGHT,
  FONT_FAMILIES,
  FONT_METRICS,
  FONT_WEIGHTS,
  type FontFamilyId,
  type FontWeight,
} from '@franibook/core';
import { describe, expect, it } from 'vitest';
import { fontFilePath } from './index.js';

interface SfntFont {
  view: DataView;
  tables: Map<string, number>;
}

function readFont(weight: FontWeight, family: FontFamilyId = 'sans'): SfntFont {
  const buf = readFileSync(fontFilePath(family, weight));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = new Map<string, number>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((k) => view.getUint8(rec + k)));
    tables.set(tag, view.getUint32(rec + 8));
  }
  return { view, tables };
}

function table(font: SfntFont, tag: string): number {
  const offset = font.tables.get(tag);
  if (offset === undefined) throw new Error(`Tabelle ${tag} fehlt`);
  return offset;
}

/** Die Metriken, die in die Geometrie eingehen. */
function metricsOf(font: SfntFont) {
  const head = table(font, 'head');
  const hhea = table(font, 'hhea');
  const os2 = table(font, 'OS/2');
  return {
    unitsPerEm: font.view.getUint16(head + 18),
    ascender: font.view.getInt16(hhea + 4),
    descender: font.view.getInt16(hhea + 6),
    // sCapHeight gibt es erst ab OS/2-Version 2.
    capHeight: font.view.getInt16(os2 + 88),
    typoAscender: font.view.getInt16(os2 + 68),
    typoDescender: font.view.getInt16(os2 + 70),
    weightClass: font.view.getUint16(os2 + 4),
  };
}

/** Namenseinträge, Windows/Unicode bevorzugt. */
function names(font: SfntFont): Map<number, string> {
  const base = table(font, 'name');
  const { view } = font;
  const count = view.getUint16(base + 2);
  const stringBase = base + view.getUint16(base + 4);
  const found = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformId = view.getUint16(rec);
    if (platformId !== 3) continue;
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = stringBase + view.getUint16(rec + 10);
    let text = '';
    for (let k = 0; k < length; k += 2) text += String.fromCharCode(view.getUint16(offset + k));
    found.set(nameId, text);
  }
  return found;
}

/** Ob ein Zeichen eine Glyphe hat. Liest cmap-Format 4, mehr enthält die Datei nicht. */
function hasGlyph(font: SfntFont, codePoint: number): boolean {
  const base = table(font, 'cmap');
  const { view } = font;
  const count = view.getUint16(base + 2);
  let subtable = -1;
  for (let i = 0; i < count; i++) {
    const rec = base + 4 + i * 8;
    if (view.getUint16(rec) === 3 && view.getUint16(rec + 2) === 1) {
      subtable = base + view.getUint32(rec + 4);
    }
  }
  if (subtable < 0) throw new Error('cmap (3,1) fehlt');
  if (view.getUint16(subtable) !== 4) throw new Error('cmap ist nicht Format 4');

  const segCount = view.getUint16(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let s = 0; s < segCount; s++) {
    const end = view.getUint16(endCodes + s * 2);
    if (codePoint > end) continue;
    const start = view.getUint16(startCodes + s * 2);
    if (codePoint < start) return false;
    const rangeOffset = view.getUint16(idRangeOffsets + s * 2);
    if (rangeOffset === 0) {
      return ((codePoint + view.getInt16(idDeltas + s * 2)) & 0xffff) !== 0;
    }
    const glyphAddr = idRangeOffsets + s * 2 + rangeOffset + (codePoint - start) * 2;
    return view.getUint16(glyphAddr) !== 0;
  }
  return false;
}

describe('Schriftdateien', () => {
  it.each(FONT_WEIGHTS)('%s ist über fontFilePath lesbar', (weight) => {
    expect(readFont(weight).tables.has('glyf')).toBe(true);
  });

  it.each(FONT_WEIGHTS)('%s bringt die Metriken mit, mit denen core rechnet', (weight) => {
    const m = metricsOf(readFont(weight));
    expect(m.unitsPerEm).toBe(FONT_METRICS.unitsPerEm);
    expect(m.ascender).toBe(FONT_METRICS.ascender);
    expect(m.descender).toBe(FONT_METRICS.descender);
    expect(m.capHeight).toBe(FONT_METRICS.capHeight);
    // Der Browser nimmt die Typo-Metriken (fsSelection Bit 7 ist gesetzt), das
    // PDF die aus hhea. Beide müssen übereinstimmen, sonst hängt die Zeile im
    // Browser anders als im PDF.
    expect(m.typoAscender).toBe(FONT_METRICS.ascender);
    expect(m.typoDescender).toBe(FONT_METRICS.descender);
  });

  it.each(FONT_WEIGHTS)('%s trägt das Gewicht, das die Vorschau anfordert', (weight) => {
    expect(metricsOf(readFont(weight)).weightClass).toBe(CSS_FONT_WEIGHT[weight]);
  });

  it.each(FONT_WEIGHTS)('%s deckt den deutschen Zeichensatz ab', (weight) => {
    const font = readFont(weight);
    // ß und Umlaute, typografische Anführungen, Halbgeviertstrich, Ziffern,
    // dazu Akzente aus europäischen Ortsnamen.
    for (const ch of 'äöüÄÖÜßéèêàçñíóúåøœ„“”‚‘’–—…€0123456789') {
      expect(hasGlyph(font, ch.codePointAt(0) ?? 0), `${ch} fehlt`).toBe(true);
    }
  });

  it.each(FONT_WEIGHTS)('%s führt keinen Reserved Font Name', (weight) => {
    const found = names(readFont(weight));
    expect(found.get(1)).toBe(BOOK_FONT_FAMILY);
    // Die OFL reserviert „Source“ für Source Sans; diese Dateien sind geändert
    // und dürfen den Namen deshalb nicht tragen. Herkunft steht in Name-ID 10.
    for (const nameId of [1, 2, 3, 4, 6]) {
      expect(found.get(nameId) ?? '').not.toContain('Source');
    }
    expect(found.get(10) ?? '').toContain('Source Sans 3');
  });

  /**
   * Die Zusatzschriften für Textblöcke.
   *
   * Sie sind unverändert übernommen – deshalb hier keine Prüfung auf einen
   * Reserved Font Name, sondern das Gegenteil: Der Familienname in der Datei
   * muss der sein, mit dem Vorschau und PDF sie ansprechen. Ein Tippfehler
   * darin bliebe sonst unbemerkt, bis der Browser auf eine Systemschrift
   * zurückfällt und das PDF nicht.
   */
  const zusatz = FONT_FAMILIES.filter((f) => f.id !== 'sans');

  it.each(zusatz.flatMap((f) => f.weights.map((w) => [f.id, f.cssName, w] as const)))(
    '%s/%s ist lesbar und trägt ihren Namen',
    (id, cssName, weight) => {
      const font = readFont(weight, id);
      expect(font.tables.has('glyf')).toBe(true);
      // Name-ID 1 ist bei Schnitten außerhalb von Regular/Bold der Schnittname
      // („Crimson Text SemiBold"); der typografische Familienname steht in 16.
      const found = names(font);
      expect(found.get(16) ?? found.get(1)).toBe(cssName);
    },
  );

  it.each(zusatz.map((f) => [f.id, f.cssName] as const))(
    '%s deckt den deutschen Zeichensatz ab',
    (id) => {
      const font = readFont('regular', id);
      for (const ch of 'äöüÄÖÜßéèêàçñíóú„“–…0123456789') {
        expect(hasGlyph(font, ch.codePointAt(0) ?? 0), `${ch} fehlt`).toBe(true);
      }
    },
  );

  it('kennt für jede Familie eine Datei je angebotenem Schnitt', () => {
    // Sonst böte die Oberfläche einen Schnitt an, den es nicht gibt.
    for (const f of FONT_FAMILIES) {
      for (const w of f.weights) {
        expect(() => readFont(w, f.id), `${f.id}/${w}`).not.toThrow();
      }
    }
  });
});
