import { describe, expect, it } from 'vitest';
import { bildunterschrift } from './caption.js';

const sylt = { place: { key: 'ort:Sylt', label: 'Sylt' }, date: '2017-06-12T14:12:00' };

describe('Bildunterschrift aus Ort und Datum', () => {
  it('setzt die fünf Formen zusammen', () => {
    expect(bildunterschrift(sylt, 'ort')).toBe('Sylt');
    expect(bildunterschrift(sylt, 'tag')).toBe('12. Juni 2017');
    expect(bildunterschrift(sylt, 'monat')).toBe('Juni 2017');
    expect(bildunterschrift(sylt, 'ort-tag')).toBe('Sylt, 12. Juni 2017');
    expect(bildunterschrift(sylt, 'ort-monat')).toBe('Sylt, Juni 2017');
  });

  it('lässt das Komma weg, wo nur eine Angabe steht', () => {
    // Ein Foto ohne Ort in der Form „Ort und Monat" trägt den Monat — und nicht
    // „, Juni 2017".
    expect(bildunterschrift({ date: '2017-06-12T00:00:00' }, 'ort-monat')).toBe('Juni 2017');
    expect(bildunterschrift({ ...sylt, date: null }, 'ort-tag')).toBe('Sylt');
  });

  it('schweigt, wo die Angaben ganz fehlen', () => {
    // `undefined` und kein leerer Text: Der Aufrufer zählt diese Fälle und
    // meldet sie, statt eine leere Zeile ins Buch zu schreiben.
    expect(bildunterschrift({ date: null }, 'ort-tag')).toBeUndefined();
    expect(bildunterschrift({ ...sylt }, 'ort')).toBe('Sylt');
    expect(bildunterschrift({ date: '2017-06-12T00:00:00' }, 'ort')).toBeUndefined();
  });

  it('schreibt den Monat aus und rechnet nicht mit Date', () => {
    // Eine Tabelle statt `Intl`: Node und Browser liefern je nach ICU-Daten
    // verschiedene Schreibweisen, und die Vorschau bekäme eine andere
    // Unterschrift als das PDF.
    expect(bildunterschrift({ date: '2008-03-05T09:00:00' }, 'tag')).toBe('5. März 2008');
    expect(bildunterschrift({ date: '2019-12-24T18:30:00' }, 'monat')).toBe('Dezember 2019');
  });

  it('übergeht ein unbrauchbares Datum, statt Unsinn zu setzen', () => {
    expect(bildunterschrift({ date: 'kein Datum' }, 'tag')).toBeUndefined();
    expect(bildunterschrift({ date: '2017-13-01T00:00:00' }, 'monat')).toBeUndefined();
  });
});
