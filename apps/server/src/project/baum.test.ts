import { describe, expect, it } from 'vitest';
import { type RenderedSpread, type Spread, FULL_CROP, justifiedTemplateId } from '@franibook/core';
import { type Baumstand, baum } from './baum.js';

/** Eine Doppelseite mit den genannten Bildern; Slotnamen sind hier ohne Belang. */
function seite(index: number, ids: readonly string[], rest: Partial<Spread> = {}): Spread {
  return {
    id: `s${index}`,
    index,
    templateId: `spread.${ids.length}up.grid`,
    slots: ids.map((photoId, i) => ({ slotId: `s${i}`, photoId, crop: { ...FULL_CROP } })),
    ...rest,
  };
}

/** Ein Stand ohne Kapitel, ohne Gruppen und mit tadellosen Auflösungen. */
function stand(spreads: Spread[], rest: Partial<Baumstand> = {}): Baumstand {
  return {
    spreads,
    chapters: () => [],
    groupMarks: () => [],
    render: () => ({ boxes: [] }) as unknown as RenderedSpread,
    ...rest,
  };
}

describe('baum', () => {
  it('nennt die Bilder jeder Doppelseite mit ihrem Platz, in Slotreihenfolge', () => {
    // Der Platz gehört dazu, weil ein Zug seine Quelle als Platz nennt.
    const b = baum(stand([seite(0, ['p1', 'p2'])]));
    expect(b[0]!.bilder).toEqual([
      { slotId: 's0', photoId: 'p1' },
      { slotId: 's1', photoId: 'p2' },
    ]);
  });

  it('übergeht leere Plätze', () => {
    const mitLuecke = seite(0, ['p1', 'p2']);
    mitLuecke.slots[0]!.photoId = null;
    expect(baum(stand([mitLuecke]))[0]!.bilder).toEqual([{ slotId: 's1', photoId: 'p2' }]);
  });

  it('trägt jeder Seite ihren Jahrgang ein, nicht nur dem Auftakt', () => {
    // Die Gliederung des Baums hängt daran: Ohne das Jahr an jeder Seite gäbe
    // es nichts, worunter sie stehen könnte.
    const b = baum(
      stand([seite(0, ['p1']), seite(1, ['p2']), seite(2, ['p3']), seite(3, ['p4'])], {
        chapters: () => [
          { year: 2019, photoCount: 2, firstSpreadIndex: 0 },
          { year: 2020, photoCount: 2, firstSpreadIndex: 2 },
        ],
      }),
    );
    expect(b.map((s) => s.year)).toEqual([2019, 2019, 2020, 2020]);
  });

  it('lässt Seiten vor dem ersten Kapitel ohne Jahrgang', () => {
    const b = baum(
      stand([seite(0, ['p1']), seite(1, ['p2'])], {
        chapters: () => [{ year: 2020, photoCount: 1, firstSpreadIndex: 1 }],
      }),
    );
    expect(b[0]!.year).toBeUndefined();
    expect(b[1]!.year).toBe(2020);
  });

  it('meldet die Fotogruppe an der Seite, an der sie beginnt', () => {
    const b = baum(
      stand([seite(0, ['p1']), seite(1, ['p2'])], {
        groupMarks: () => [{ spreadIndex: 1, id: 'g1', title: 'Kreta' }],
      }),
    );
    expect(b[0]!.groupTitle).toBeUndefined();
    expect(b[1]!.groupTitle).toBe('Kreta');
  });

  it('erkennt Handarbeit an einem Bild', () => {
    const mitCrop = seite(0, ['p1']);
    mitCrop.slots[0]!.crop = { ...FULL_CROP, mode: 'manual' };
    expect(baum(stand([mitCrop]))[0]!.handarbeit).toBe(true);
    expect(baum(stand([seite(0, ['p1'])]))[0]!.handarbeit).toBe(false);
  });

  it('zählt das gerechnete Rechteck einer justierten Seite nicht als Handarbeit', () => {
    // Der Neuaufbau stellt es wieder her – es steht also nichts auf dem Spiel.
    const justiert = seite(0, ['p1'], { templateId: justifiedTemplateId(1) });
    justiert.slots[0]!.rect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(baum(stand([justiert]))[0]!.handarbeit).toBe(false);
  });

  it('zählt die Bilder, die quer zu ihrem Platz stehen', () => {
    const b = baum(
      stand([seite(0, ['p1', 'p2'])], {
        render: () =>
          ({
            boxes: [
              { kind: 'image', warnings: [{ code: 'orientation-mismatch', sichtbar: 0.42 }] },
              { kind: 'image', warnings: [] },
            ],
          }) as unknown as RenderedSpread,
      }),
    );
    expect(b[0]!.falscheLage).toBe(1);
    expect(b[0]!.zuKlein).toBe(0);
  });

  it('zählt die Bilder, deren Auflösung nicht reicht', () => {
    const b = baum(
      stand([seite(0, ['p1', 'p2'])], {
        render: () =>
          ({
            boxes: [
              { kind: 'image', warnings: [{ code: 'below-min-dpi' }] },
              { kind: 'image', warnings: [] },
              { kind: 'text', warnings: [] },
            ],
          }) as unknown as RenderedSpread,
      }),
    );
    expect(b[0]!.zuKlein).toBe(1);
  });

  it('markiert leere Seiten, Auftakte und festgehaltene Seiten', () => {
    const b = baum(
      stand([
        seite(0, []),
        seite(1, ['p1'], { texts: [{ id: 't', role: 'year', content: '2019', slotId: 'jahr' }] }),
        seite(2, ['p2'], { locked: true }),
      ]),
    );
    expect(b[0]!.leer).toBe(true);
    expect(b[1]!.auftakt).toBe(true);
    expect(b[2]!.locked).toBe(true);
  });
});
