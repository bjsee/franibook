import { describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { defaultProfile } from '../print/profiles/index.js';
import { movePhoto } from './move.js';

/** Zwei Doppelseiten mit je zwei Slots, der letzte bewusst leer. */
function buch(): Spread[] {
  return [
    {
      id: 's0',
      index: 0,
      templateId: 'spread.2up.side',
      slots: [
        { slotId: 'a', photoId: 'p1', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'manual' } },
        { slotId: 'b', photoId: 'p2', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'manual' } },
      ],
    },
    {
      id: 's1',
      index: 1,
      templateId: 'spread.2up.side',
      slots: [
        { slotId: 'a', photoId: 'p3', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
        { slotId: 'b', photoId: null, crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
      ],
    },
  ];
}

const slot = (spreadIndex: number, slotId: string) =>
  ({ kind: 'slot', spreadIndex, slotId }) as const;

describe('movePhoto', () => {
  it('tauscht zwei belegte Slots über Doppelseiten hinweg', () => {
    const r = movePhoto(buch(), slot(0, 'a'), slot(1, 'a'));
    expect(r.ok).toBe(true);
    expect(r.spreads[1]!.slots[0]!.photoId).toBe('p1');
    expect(r.spreads[0]!.slots[0]!.photoId).toBe('p3');
    expect(r.touched).toEqual([0, 1]);
  });

  it('lässt den Ausgangsslot leer, wenn das Ziel leer war', () => {
    const r = movePhoto(buch(), slot(0, 'b'), slot(1, 'b'));
    expect(r.spreads[1]!.slots[1]!.photoId).toBe('p2');
    expect(r.spreads[0]!.slots[1]!.photoId).toBeNull();
  });

  it('stellt verschobene Ausschnitte auf automatisch zurück', () => {
    // Ein manueller Ausschnitt gilt für das Seitenverhältnis seines Slots und
    // wäre im neuen Slot falsch.
    const r = movePhoto(buch(), slot(0, 'a'), slot(1, 'a'));
    expect(r.spreads[1]!.slots[0]!.crop.mode).toBe('auto-cover');
    expect(r.spreads[0]!.slots[0]!.crop.mode).toBe('auto-cover');
  });

  it('nimmt ein Foto aus dem Buch in den Pool', () => {
    const r = movePhoto(buch(), slot(0, 'a'), { kind: 'pool' });
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots[0]!.photoId).toBeNull();
    expect(r.touched).toEqual([0]);
  });

  it('setzt ein Foto aus dem Pool in einen leeren Slot', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, slot(1, 'b'));
    expect(r.ok).toBe(true);
    expect(r.spreads[1]!.slots[1]!.photoId).toBe('p9');
  });

  it('schickt das verdrängte Foto zurück in den Pool', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, slot(0, 'b'));
    expect(r.spreads[0]!.slots[1]!.photoId).toBe('p9');
    const alle = r.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId));
    expect(alle).not.toContain('p2');
  });

  it('verweigert ein Foto, das schon im Buch liegt', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p3' }, slot(1, 'b'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Doppelseite 2');
    expect(r.spreads[1]!.slots[1]!.photoId).toBeNull();
  });

  it('verweigert einen leeren Ausgangsslot', () => {
    const r = movePhoto(buch(), slot(1, 'b'), slot(0, 'a'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Der Ausgangsslot ist leer');
  });

  it('meldet unbekannte Doppelseiten und Slots', () => {
    expect(movePhoto(buch(), slot(0, 'a'), slot(7, 'a')).error).toContain('Doppelseite 8');
    expect(movePhoto(buch(), slot(0, 'a'), slot(1, 'z')).error).toContain('Slot z');
  });

  it('nimmt einen Zug auf denselben Slot ohne Wirkung hin', () => {
    const r = movePhoto(buch(), slot(0, 'a'), slot(0, 'a'));
    expect(r.ok).toBe(true);
    expect(r.touched).toEqual([]);
    expect(r.spreads[0]!.slots[0]!.crop.mode).toBe('manual');
  });

  it('lässt unbeteiligte Doppelseiten unverändert – dieselben Objekte', () => {
    // Die Zusicherung, auf die sich die gezielte Änderung stützt: Alles außer
    // den beiden Slots bleibt bitweise, wie es war.
    const vorher = buch();
    const r = movePhoto(vorher, slot(0, 'a'), { kind: 'pool' });
    expect(r.spreads[1]).toBe(vorher[1]);
    expect(r.spreads[0]!.slots[1]).toBe(vorher[0]!.slots[1]);
  });

  it('verändert die Eingabe nicht', () => {
    const vorher = buch();
    movePhoto(vorher, slot(0, 'a'), slot(1, 'a'));
    expect(vorher[0]!.slots[0]!.photoId).toBe('p1');
    expect(vorher[1]!.slots[0]!.photoId).toBe('p3');
  });
});

describe('movePhoto auf eine ganze Doppelseite', () => {
  /** Ein Bestand, in dem jedes Foto dieselbe Form hat – die Zuordnung soll hier nicht die Aussage sein. */
  function bestand(ids: readonly string[]): ReadonlyMap<PhotoId, Photo> {
    return new Map(
      ids.map((id) => [
        id,
        {
          id,
          sourceId: 'q',
          relPath: `${id}.jpg`,
          fileName: `${id}.jpg`,
          bytes: 1_000_000,
          width: 4000,
          height: 3000,
          takenAt: '2020-01-01T12:00:00',
        } as Photo,
      ]),
    );
  }

  const reflow = { photos: bestand(['p1', 'p2', 'p3']), profile: defaultProfile() };
  const seite = (spreadIndex: number) => ({ kind: 'spread', spreadIndex }) as const;

  it('nimmt das Bild von der Quellseite und gibt es der Zielseite', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1), reflow);
    expect(r.ok).toBe(true);

    const auf = (i: number) => r.spreads[i]!.slots.map((s) => s.photoId).filter(Boolean);
    expect(auf(0)).toEqual(['p2']);
    expect(auf(1)).toHaveLength(2);
    expect(auf(1)).toContain('p1');
    expect(r.touched).toEqual([0, 1]);
  });

  it('ordnet beide Seiten neu an, statt ein Loch zu hinterlassen', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1), reflow);
    // Die Quellseite hat noch ein Bild und deshalb eine Einbildvorlage.
    expect(r.spreads[0]!.slots).toHaveLength(1);
    expect(r.spreads[0]!.slots.every((s) => s.photoId !== null)).toBe(true);
  });

  it('lehnt ab, wenn die Quellseite dadurch leer stünde', () => {
    // Doppelseite 2 trägt nur p3; für null Bilder gibt es keine Vorlage.
    const r = movePhoto(buch(), slot(1, 'a'), seite(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('leer');
  });

  it('holt ein Bild aus dem Pool auf die Seite', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, seite(0), {
      ...reflow,
      photos: bestand(['p1', 'p2', 'p3', 'p9']),
    });
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots.map((s) => s.photoId).filter(Boolean)).toHaveLength(3);
    expect(r.touched).toEqual([0]);
  });

  it('nimmt einen Zug auf die eigene Seite ohne Wirkung hin', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(0), reflow);
    expect(r.ok).toBe(true);
    expect(r.touched).toEqual([]);
  });

  it('meldet eine unbekannte Zielseite', () => {
    expect(movePhoto(buch(), slot(0, 'a'), seite(7), reflow).error).toContain('Doppelseite 8');
  });

  it('lehnt ein Foto ab, das nicht mehr zum Bestand gehört', () => {
    // Sonst fiele es beim Anordnen heraus: ein verlorenes Foto statt eines
    // abgelehnten Zuges.
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'weg' }, seite(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bestand');
  });

  it('verlangt den Bildbestand – ohne ihn ließe sich nichts anordnen', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bildbestand');
  });
});
