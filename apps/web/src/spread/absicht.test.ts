import { describe, expect, it } from 'vitest';
import { absichtVon } from './absicht.js';

describe('absichtVon', () => {
  it('tauscht, wenn auf dem Zielplatz schon ein Bild liegt', () => {
    expect(
      absichtVon(
        { kind: 'slot', spreadIndex: 3, slotId: 'a' },
        { spreadIndex: 3, slotId: 'b', belegt: true },
      ),
    ).toBe('tauschen');
  });

  it('setzt ein, wenn der Zielplatz leer ist', () => {
    expect(
      absichtVon(
        { kind: 'slot', spreadIndex: 3, slotId: 'a' },
        { spreadIndex: 3, slotId: 'b', belegt: false },
      ),
    ).toBe('einsetzen');
  });

  it('meldet für den Platz, von dem der Zug ausging, keine Änderung', () => {
    expect(
      absichtVon(
        { kind: 'slot', spreadIndex: 3, slotId: 'a' },
        { spreadIndex: 3, slotId: 'a', belegt: true },
      ),
    ).toBe('nichts');
  });

  it('unterscheidet gleichnamige Plätze verschiedener Doppelseiten', () => {
    expect(
      absichtVon(
        { kind: 'slot', spreadIndex: 3, slotId: 'a' },
        { spreadIndex: 4, slotId: 'a', belegt: true },
      ),
    ).toBe('tauschen');
  });

  it('tauscht auch aus dem Fotopool – das verdrängte Bild geht dorthin zurück', () => {
    expect(
      absichtVon({ kind: 'pool', photoId: 'p1' }, { spreadIndex: 3, slotId: 'a', belegt: true }),
    ).toBe('tauschen');
  });
});
