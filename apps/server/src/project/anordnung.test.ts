/**
 * `setSpreadTemplate` — der Vorlagenwechsel einer ganzen Doppelseite.
 *
 * Im Mittelpunkt steht der Fund vom Nutzer: Eine von Hand gezogene Jahreszahl
 * blieb bei einem Vorlagenwechsel an ihrer alten Rohposition hängen, obwohl
 * die neue Vorlage sie auf die andere Buchseite legt.
 */
import { describe, expect, it } from 'vitest';
import type { Photo, Spread } from '@franibook/core';
import { defaultProfile } from '@franibook/core';
import { setSpreadTemplate, type Bestand } from './anordnung.js';

/** Ein Foto, gerade genug für `layoutSpread`. */
function foto(id: string): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width: 3000,
    height: 4000,
    orientation: 1,
    takenAt: '2026-01-01T12:00:00',
  };
}

/** Ein minimaler Bestand mit einer Jahresauftakt-Doppelseite. */
function bestand(templateId: string, texte: NonNullable<Spread['texts']>): Bestand {
  const fotos = [foto('p0'), foto('p1'), foto('p2')];
  const spread: Spread = {
    id: 's0',
    index: 0,
    templateId,
    slots: [],
    texts: texte,
  };
  return {
    spreads: [spread],
    photos: new Map(fotos.map((p) => [p.id, p])),
    profile: defaultProfile(),
    overrides: {},
    settings: { timeline: false, timelineStyle: 'foot' },
  };
}

describe('setSpreadTemplate — Vorlagentexte beim Wechsel', () => {
  it('setzt die Position eines Vorlagentexts zurück, wenn die Vorlage wirklich wechselt', () => {
    const z = bestand('spread.chapter.3up.mirrored', [
      {
        id: 't1',
        role: 'year',
        content: '2026',
        slotId: 't-year',
        // Von Hand gezogen, deutlich rechts vom Falz.
        rect: { x: 0.63, y: 0.15, w: 0.33, h: 0.18 },
        rotateDeg: 3,
      },
    ]);

    const ergebnis = setSpreadTemplate(z, 0, 'spread.chapter.3up');

    expect(ergebnis.ok).toBe(true);
    expect(z.spreads[0]!.templateId).toBe('spread.chapter.3up');
    const jahr = z.spreads[0]!.texts!.find((t) => t.slotId === 't-year')!;
    expect(jahr.rect).toBeUndefined();
    expect(jahr.rotateDeg).toBeUndefined();
    // Wortlaut und Rolle bleiben – nur die Lage fällt auf die Vorlage zurück.
    expect(jahr.content).toBe('2026');
  });

  it('lässt eine von Hand gesetzte Position stehen, wenn dieselbe Vorlage gewählt wird', () => {
    const z = bestand('spread.chapter.3up', [
      {
        id: 't1',
        role: 'year',
        content: '2026',
        slotId: 't-year',
        rect: { x: 0.05, y: 0.1, w: 0.3, h: 0.15 },
      },
    ]);

    const ergebnis = setSpreadTemplate(z, 0, 'spread.chapter.3up');

    expect(ergebnis.ok).toBe(true);
    const jahr = z.spreads[0]!.texts!.find((t) => t.slotId === 't-year')!;
    expect(jahr.rect).toEqual({ x: 0.05, y: 0.1, w: 0.3, h: 0.15 });
  });
});
