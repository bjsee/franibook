import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { Photo } from '../model/photo.js';
import type { Spread, TextBlock } from '../model/spread.js';
import { requireTemplate } from '../templates/index.js';
import type { TextBox } from './rendered-spread.js';
import { renderSpread } from './render-spread.js';

const profile = saal as PrintProfile;
const template = requireTemplate('spread.4up.grid');
const photos = new Map<string, Photo>();

function spreadMit(blocks: TextBlock[]): Spread {
  return {
    id: 's1',
    index: 0,
    templateId: template.id,
    slots: template.slots.map((slot) => ({
      slotId: slot.id,
      photoId: null,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
    blocks,
  };
}

function block(patch: Partial<TextBlock> = {}): TextBlock {
  return {
    id: 't1',
    content: 'Kreta',
    rect: { x: 0.1, y: 0.4, w: 0.3, h: 0.08 },
    weight: 'regular',
    fontSizePt: 14,
    align: 'left',
    ...patch,
  };
}

const texte = (s: Spread): TextBox[] =>
  renderSpread(s, { profile, template, photos }).boxes.filter(
    (b): b is TextBox => b.kind === 'text',
  );

describe('Textblöcke von Hand', () => {
  it('setzt den Block an die normierte Stelle', () => {
    const [box] = texte(spreadMit([block()]));
    // 0,1 der Doppelseitenbreite (540 mm) plus 3 mm Beschnitt, und 0,4 der
    // Seitenhöhe (270 mm).
    expect(box!.xMm).toBeCloseTo(3 + 0.1 * 2 * profile.page.trimWidthMm, 6);
    expect(box!.yMm).toBeCloseTo(3 + 0.4 * profile.page.trimHeightMm, 6);
    expect(box!.fontSizePt).toBe(14);
    expect(box!.weight).toBe('regular');
  });

  it('zerlegt mehrere Zeilen in eigene Boxen mit festem Abstand', () => {
    // Der Zeilenabstand ist Geometrie: Überließe man ihn den Renderern,
    // entschiede CSS line-height gegen pdfkit lineGap.
    const boxen = texte(spreadMit([block({ content: 'eins\nzwei\ndrei' })]));
    expect(boxen).toHaveLength(3);
    const abstand = boxen[1]!.yMm - boxen[0]!.yMm;
    expect(abstand).toBeCloseTo(boxen[2]!.yMm - boxen[1]!.yMm, 6);
    // Anderthalbfache Schriftgröße, in Millimetern.
    expect(abstand).toBeCloseTo((14 * 25.4) / 72 / (1 / 1.5), 3);
  });

  it('dreht alle Zeilen um denselben Punkt', () => {
    // Um die je eigene Mitte gedreht, fächerten die Zeilen auseinander.
    const boxen = texte(spreadMit([block({ content: 'eins\nzwei', rotateDeg: 30 })]));
    expect(boxen.every((b) => b.rotateDeg === 30)).toBe(true);
    expect(boxen[0]!.rotateAboutMm).toEqual(boxen[1]!.rotateAboutMm);
    // Der Drehpunkt ist die Mitte des ganzen Kastens.
    const seiteH = profile.page.trimHeightMm;
    expect(boxen[0]!.rotateAboutMm!.yMm).toBeCloseTo(3 + 0.4 * seiteH + (0.08 * seiteH) / 2, 6);
  });

  it('lässt einen leeren Block weg, statt eine leere Zeile zu setzen', () => {
    expect(texte(spreadMit([block({ content: '   ' })]))).toHaveLength(0);
  });

  it('nimmt die Textfarbe des Buches, wenn keine gewählt ist', () => {
    const [box] = texte(spreadMit([block()]));
    expect(box!.color).toBe('#3f3f46');
  });

  it('lässt eine gewählte Farbe stehen', () => {
    const [box] = texte(spreadMit([block({ color: '#b91c1c' })]));
    expect(box!.color).toBe('#b91c1c');
  });

  it('trägt ohne Drehung keinen Winkel ins Modell', () => {
    const [box] = texte(spreadMit([block()]));
    expect(box!.rotateDeg).toBeUndefined();
    expect(box!.rotateAboutMm).toBeUndefined();
  });
});
