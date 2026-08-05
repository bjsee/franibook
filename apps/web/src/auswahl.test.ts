import { describe, expect, it } from 'vitest';
import { auswahlKlick, zugMenge } from './auswahl.js';

const SICHTBAR = ['a', 'b', 'c', 'd', 'e'];
const schlicht = { shiftKey: false, metaKey: false, ctrlKey: false };
const umschalt = { ...schlicht, shiftKey: true };
const cmd = { ...schlicht, metaKey: true };

const klick = (selected: Iterable<string>, id: string, e = schlicht, anker: string | null = null) =>
  auswahlKlick(new Set(selected), id, e, SICHTBAR, anker);

describe('auswahlKlick', () => {
  it('ersetzt die Auswahl bei einem schlichten Klick', () => {
    expect([...klick(['a', 'b'], 'd').selected]).toEqual(['d']);
  });

  it('nimmt mit Cmd einzelne dazu und wieder heraus', () => {
    expect([...klick(['a'], 'c', cmd).selected].sort()).toEqual(['a', 'c']);
    expect([...klick(['a', 'c'], 'c', cmd).selected]).toEqual(['a']);
  });

  it('schließt mit Umschalt den Bereich bis zum Anker ein', () => {
    expect([...klick([], 'd', umschalt, 'b').selected].sort()).toEqual(['b', 'c', 'd']);
  });

  it('nimmt den Bereich auch rückwärts', () => {
    expect([...klick([], 'b', umschalt, 'd').selected].sort()).toEqual(['b', 'c', 'd']);
  });

  it('wählt ohne Anker nur das Angeklickte, auch mit Umschalt', () => {
    expect([...klick(['a'], 'c', umschalt, null).selected]).toEqual(['c']);
  });

  it('merkt sich das Angeklickte als neuen Anker', () => {
    expect(klick([], 'c').anker).toBe('c');
  });
});

describe('zugMenge', () => {
  it('zieht die ganze Auswahl, wenn das angefasste Bild darin liegt', () => {
    expect(zugMenge(new Set(['a', 'b']), 'a').sort()).toEqual(['a', 'b']);
  });

  it('zieht nur das angefasste Bild, wenn es außerhalb der Auswahl liegt', () => {
    // Sonst wanderten zwanzig ausgewählte Bilder mit, weil man ein
    // einundzwanzigstes anfasst.
    expect(zugMenge(new Set(['a', 'b']), 'c')).toEqual(['c']);
  });
});
