/**
 * Die Plätze einer Doppelseite: die der Vorlage, die freien, die weggenommenen.
 */
import { describe, expect, it } from 'vitest';
import { FULL_CROP } from './crop.js';
import type { Spread } from './spread.js';
import { hiddenSlotsNachWechsel, wirksamePlaetze } from './spread.js';
import type { TemplateSlot } from './template.js';

const VORLAGE: { slots: TemplateSlot[] } = {
  slots: [
    { id: 'a', x: 0, y: 0, w: 0.5, h: 1, prominence: 2 },
    { id: 'b', x: 0.5, y: 0, w: 0.5, h: 0.5, prominence: 1 },
    { id: 'c', x: 0.5, y: 0.5, w: 0.5, h: 0.5, prominence: 1 },
  ],
};

function seite(teil: Partial<Spread>): Spread {
  return {
    id: 's1',
    index: 0,
    templateId: 'spread.4up.grid',
    slots: [{ slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } }],
    ...teil,
  };
}

describe('wirksamePlaetze', () => {
  it('gibt ohne Zutun die Plätze der Vorlage', () => {
    expect(wirksamePlaetze(VORLAGE, seite({})).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('nimmt einen freien Platz dazu, den keine Vorlage kennt', () => {
    // So kommt ein eingeworfenes Bild auf die Seite.
    const spread = seite({
      slots: [
        { slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } },
        {
          slotId: 'frei-1',
          photoId: 'p9',
          crop: { ...FULL_CROP },
          rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
        },
      ],
    });
    expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a', 'b', 'c', 'frei-1']);
  });

  describe('weggenommene Plätze', () => {
    it('lässt einen weggenommenen Platz heraus', () => {
      // Dahinter hängt alles Weitere: kein leerer Kasten im RSM, kein Ziel für
      // einen Zug, kein `platz-leer` im Abnahmebericht.
      const spread = seite({ hiddenSlots: ['b'] });
      expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a', 'c']);
    });

    it('nimmt auch mehrere heraus', () => {
      const spread = seite({ hiddenSlots: ['b', 'c'] });
      expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a']);
    });

    it('lässt ein Bild den Eintrag schlagen', () => {
      // Bekommt der Platz doch eine Zuordnung — Fotopool, eingespieltes
      // Layout-Dokument, Zurücknehmen —, wird er wieder gezeichnet, statt das
      // Bild zu verschlucken.
      const spread = seite({
        slots: [
          { slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } },
          { slotId: 'b', photoId: 'p2', crop: { ...FULL_CROP } },
        ],
        hiddenSlots: ['b'],
      });
      expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('schert sich nicht um eine Kennung, die es nicht gibt', () => {
      const spread = seite({ hiddenSlots: ['gibtsnicht'] });
      expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('kann auch einen freien Platz herauslassen', () => {
      const spread = seite({
        slots: [
          { slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } },
          {
            slotId: 'frei-1',
            photoId: null,
            crop: { ...FULL_CROP },
            rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
          },
        ],
        hiddenSlots: ['frei-1'],
      });
      expect(wirksamePlaetze(VORLAGE, spread).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });
  });
});

describe('hiddenSlotsNachWechsel', () => {
  it('lässt einen Vermerk fallen, dessen Kennung in der neuen Vorlage woanders liegt', () => {
    // Der eigentliche Grund für diese Funktion: `a` steht in 65 der 117
    // Vorlagen. Bliebe der Vermerk, versteckte er nach dem Wechsel einen ganz
    // anderen Kasten — leer, also auch der Abnahme kein `platz-leer` wert, und
    // aus der Oberfläche nicht zurückzuholen.
    const neu: { slots: TemplateSlot[] } = {
      slots: [
        { id: 'a', x: 0, y: 0, w: 1, h: 0.5, prominence: 2 },
        { id: 'b', x: 0, y: 0.5, w: 1, h: 0.5, prominence: 1 },
      ],
    };
    expect(hiddenSlotsNachWechsel(['a'], VORLAGE, neu)).toEqual([]);
  });

  it('behält einen Platz, der an derselben Stelle stehen bleibt', () => {
    // Der Fall des Umstellens einer einzelnen Buchseite: Die Gegenseite bleibt,
    // wie sie ist — mitsamt dem, was von ihr weggenommen wurde.
    const neu: { slots: TemplateSlot[] } = {
      slots: [
        { id: 'a', x: 0, y: 0, w: 0.5, h: 1, prominence: 2 },
        { id: 'b', x: 0.5, y: 0, w: 0.5, h: 0.5, prominence: 1 },
        { id: 'c', x: 0.5, y: 0.5, w: 0.5, h: 0.5, prominence: 1 },
      ],
    };
    expect(hiddenSlotsNachWechsel(['b'], VORLAGE, neu)).toEqual(['b']);
  });

  it('trägt ihn auf die neue Kennung um, wenn er nur umbenannt wurde', () => {
    // Beim seitenweisen Anordnen heißt `b` der Gegenseite danach `r-b`; die
    // Bilder hängt `setHalfPage` über dieselbe Gleichheit um.
    const neu: { slots: TemplateSlot[] } = {
      slots: [
        { id: 'l-a', x: 0, y: 0, w: 0.5, h: 1, prominence: 2 },
        { id: 'r-b', x: 0.5, y: 0, w: 0.5, h: 0.5, prominence: 1 },
        { id: 'r-c', x: 0.5, y: 0.5, w: 0.5, h: 0.5, prominence: 1 },
      ],
    };
    expect(hiddenSlotsNachWechsel(['b'], VORLAGE, neu)).toEqual(['r-b']);
  });

  it('gibt nichts zurück, wo es nichts zu tragen gibt', () => {
    expect(hiddenSlotsNachWechsel(undefined, VORLAGE, VORLAGE)).toEqual([]);
    expect(hiddenSlotsNachWechsel([], VORLAGE, VORLAGE)).toEqual([]);
    expect(hiddenSlotsNachWechsel(['b'], undefined, VORLAGE)).toEqual([]);
    expect(hiddenSlotsNachWechsel(['b'], VORLAGE, undefined)).toEqual([]);
  });

  it('schert sich nicht um eine Kennung, die die alte Vorlage nicht kennt', () => {
    // Ein freier Platz steht in keiner Vorlage. Weggenommen wird er ohnehin
    // ganz aus der Liste genommen statt vermerkt — hier fiele er still weg.
    expect(hiddenSlotsNachWechsel(['frei-1'], VORLAGE, VORLAGE)).toEqual([]);
  });
});
