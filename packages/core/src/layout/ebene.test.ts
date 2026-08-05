import { describe, expect, it } from 'vitest';
import { FULL_CROP } from '../model/crop.js';
import type { Spread } from '../model/spread.js';
import { requireTemplate } from '../templates/index.js';
import { moveSlotLayer, slotEbene } from './ebene.js';

const template = requireTemplate('spread.4up.grid');

function seite(): Spread {
  return {
    id: 's1',
    index: 0,
    templateId: template.id,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: `p${i + 1}`,
      crop: { ...FULL_CROP },
    })),
  };
}

/** Die Plätze von hinten nach vorn – so, wie der Renderer sie zeichnet. */
function stapel(spread: Spread): string[] {
  return [...spread.slots].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0)).map((s) => s.slotId);
}

describe('Ebene eines Bildes', () => {
  it('folgt ohne Zutun der Reihenfolge der Vorlage', () => {
    const s = seite();
    expect(s.slots.every((slot) => slot.layer === undefined)).toBe(true);
    // Ebene 1 ist das oberste Bild, gezählt wird von vorn.
    expect(slotEbene(s, template, template.slots[3]!.id)).toEqual({ ebene: 1, von: 4 });
    expect(slotEbene(s, template, template.slots[0]!.id)).toEqual({ ebene: 4, von: 4 });
  });

  it('holt ein Bild ganz nach vorn', () => {
    const s = moveSlotLayer(seite(), template, 'a', 'vorn')!;
    expect(stapel(s)).toEqual(['b', 'c', 'd', 'a']);
    expect(slotEbene(s, template, 'a')).toEqual({ ebene: 1, von: 4 });
  });

  it('stellt ein Bild ganz nach hinten', () => {
    const s = moveSlotLayer(seite(), template, 'd', 'hinten')!;
    expect(stapel(s)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('bewegt ein Bild um genau eine Ebene', () => {
    const vor = moveSlotLayer(seite(), template, 'b', 'vor')!;
    expect(stapel(vor)).toEqual(['a', 'c', 'b', 'd']);
    const zurueck = moveSlotLayer(vor, template, 'b', 'zurueck')!;
    expect(stapel(zurueck)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nummeriert den ganzen Stapel fortlaufend von 0', () => {
    // Sonst driften die Zahlen mit jedem Zug auseinander, und aus dem Modell
    // ist die Ebene nicht mehr zu lesen.
    const s = moveSlotLayer(seite(), template, 'a', 'vorn')!;
    expect(s.slots.map((slot) => slot.layer).sort()).toEqual([0, 1, 2, 3]);
  });

  it('lässt den vordersten Zug nach vorn wirkungslos, statt ihn abzulehnen', () => {
    // Am Anschlag ist „nach vorn" keine Fehlbedienung, sondern eine Bestätigung.
    const einmal = moveSlotLayer(seite(), template, 'd', 'vorn')!;
    const zweimal = moveSlotLayer(einmal, template, 'd', 'vorn')!;
    expect(stapel(zweimal)).toEqual(stapel(einmal));
    expect(stapel(einmal)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('meldet einen Platz, den die Vorlage nicht kennt', () => {
    expect(moveSlotLayer(seite(), template, 'gibtsnicht', 'vorn')).toBeUndefined();
    expect(slotEbene(seite(), template, 'gibtsnicht')).toBeUndefined();
  });

  it('rührt Plätze außerhalb der Vorlage nicht an', () => {
    // Ein Rest aus einem früheren Stand: Gezeichnet wird er nicht, also ist eine
    // Ebene für ihn eine Aussage über etwas, das es nicht gibt.
    const mitRest: Spread = {
      ...seite(),
      slots: [...seite().slots, { slotId: 'alt', photoId: 'p9', crop: { ...FULL_CROP } }],
    };
    const s = moveSlotLayer(mitRest, template, 'a', 'vorn')!;
    expect(s.slots.find((slot) => slot.slotId === 'alt')?.layer).toBeUndefined();
  });
});
