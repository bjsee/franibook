import { describe, expect, it } from 'vitest';
import type { Spread } from '@franibook/core';
import { type Buch, moveSpread } from './seiten.js';

const AUTO = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Eine Doppelseite des Flusses mit diesen Bildern. */
function fluss(id: string, index: number, photoIds: (string | null)[]): Spread {
  return {
    id,
    index,
    templateId: 'spread.2up.pair',
    slots: photoIds.map((photoId, i) => ({
      slotId: String.fromCharCode(97 + i),
      photoId,
      crop: { ...AUTO },
    })),
  };
}

/** Eine festgehaltene Seite ohne eigenes Bild. */
function eigen(id: string, index: number, anchor?: Spread['anchor']): Spread {
  return {
    id,
    index,
    templateId: 'spread.leer',
    slots: [],
    locked: true,
    ...(anchor ? { anchor } : {}),
  };
}

describe('moveSpread', () => {
  it('verschiebt eine Doppelseite nach hinten und nummeriert neu', () => {
    const buch: Buch = {
      spreads: [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2']), fluss('s2', 2, ['p3'])],
    };

    const ergebnis = moveSpread(buch, 0, 3);

    expect(ergebnis).toEqual({ ok: true, index: 2 });
    expect(buch.spreads.map((s) => s.id)).toEqual(['s1', 's2', 's0']);
    expect(buch.spreads.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('verschiebt eine Doppelseite nach vorn', () => {
    const buch: Buch = {
      spreads: [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2']), fluss('s2', 2, ['p3'])],
    };

    const ergebnis = moveSpread(buch, 2, 0);

    expect(ergebnis).toEqual({ ok: true, index: 0 });
    expect(buch.spreads.map((s) => s.id)).toEqual(['s2', 's0', 's1']);
  });

  it('tut nichts, wenn die Lücke schon die heutige Stelle ist', () => {
    const buch: Buch = {
      spreads: [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2'])],
    };

    // Lücke 1 heißt „vor der Seite, die heute an Stelle 1 steht" – für Seite 0
    // ist das ihre eigene Stelle.
    const ergebnis = moveSpread(buch, 0, 1);

    expect(ergebnis).toEqual({ ok: true, index: 0 });
    expect(buch.spreads.map((s) => s.id)).toEqual(['s0', 's1']);
  });

  it('meldet eine unbekannte Doppelseite', () => {
    const buch: Buch = { spreads: [fluss('s0', 0, ['p1'])] };
    expect(moveSpread(buch, 5, 0)).toEqual({
      ok: false,
      error: 'Doppelseite nicht gefunden',
      index: -1,
    });
  });

  it('legt den Anker einer festgehaltenen Seite an die neue Stelle', () => {
    const buch: Buch = {
      spreads: [
        eigen('e0', 0),
        fluss('s1', 1, ['p1']),
        fluss('s2', 2, ['p2']),
        fluss('s3', 3, ['p3']),
      ],
    };

    moveSpread(buch, 0, 3);

    // Die eigene Seite steht jetzt vor s3 (Lücke 3, nach dem Herausnehmen
    // Index 2) und ankert auf deren erstes Bild.
    expect(buch.spreads.map((s) => s.id)).toEqual(['s1', 's2', 'e0', 's3']);
    expect(buch.spreads[2]!.anchor).toEqual({ photoId: 'p3', where: 'before' });
  });

  it('zieht auch den Anker einer nur halb festgehaltenen Seite nach', () => {
    // Regressionstest: `spread.locked` allein trifft eine `lockedSide`-Seite
    // nicht, und ohne Ausschluss ihrer eigenen neuen Stelle fände die
    // Rückwärtssuche sie selbst statt den wirklichen Nachbarn.
    const halbFest: Spread = {
      ...fluss('s1', 1, ['p3']),
      lockedSide: 'left',
      anchor: { photoId: 'p99', where: 'before' },
    };
    const buch: Buch = {
      spreads: [fluss('s0', 0, ['p1']), halbFest, fluss('s2', 2, ['p2'])],
    };

    moveSpread(buch, 1, 3);

    expect(buch.spreads.map((s) => s.id)).toEqual(['s0', 's2', 's1']);
    expect(buch.spreads[2]!.anchor).toEqual({ photoId: 'p2', where: 'after' });
  });

  it('lässt den Anker weg, wenn kein Nachbar mehr im Fluss läuft', () => {
    const buch: Buch = {
      spreads: [eigen('e0', 0), eigen('e1', 1)],
    };

    moveSpread(buch, 1, 0);

    expect(buch.spreads.map((s) => s.id)).toEqual(['e1', 'e0']);
    expect(buch.spreads[0]!.anchor).toBeUndefined();
  });
});
