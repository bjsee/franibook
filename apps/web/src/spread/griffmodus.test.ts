import { describe, expect, it } from 'vitest';
import { naechsterGriffmodus } from './griffmodus.js';

describe('naechsterGriffmodus', () => {
  it('führt vom bloß gewählten Bild über die Größe zur Drehung und zurück', () => {
    expect(naechsterGriffmodus('keine', false)).toBe('groesse');
    expect(naechsterGriffmodus('groesse', false)).toBe('drehen');
    expect(naechsterGriffmodus('drehen', false)).toBe('keine');
  });

  it('überspringt die Drehung, wo sie gesperrt ist', () => {
    expect(naechsterGriffmodus('groesse', true)).toBe('keine');
  });

  it('lässt die Sperre den Weg zu den Größengriffen unberührt', () => {
    expect(naechsterGriffmodus('keine', true)).toBe('groesse');
  });
});
