import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { Photo } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { panCrop, zoomCrop } from '../model/crop.js';
import { requireTemplate } from '../templates/index.js';
import { renderSpread } from './render-spread.js';
import { imageBoxes } from './rendered-spread.js';
import { dpiInSlot, photoPixelsOf, withAdjust, withCrop, withTextBlock } from './inspect.js';
import { farbmatrix } from '../model/adjust.js';

const profile = saal as PrintProfile;
const template = requireTemplate('spread.4up.grid');

function photo(id: string, width: number, height: number): Photo {
  return {
    id,
    relPath: `${id}.jpeg`,
    fileName: `${id}.jpeg`,
    bytes: 800_000,
    width,
    height,
    orientation: 1,
  };
}

const PHOTOS = new Map<string, Photo>([
  ['p1', photo('p1', 2048, 1536)],
  ['p2', photo('p2', 1536, 2048)],
  ['p3', photo('p3', 2048, 1152)],
  ['p4', photo('p4', 2048, 2048)],
]);

const spread: Spread = {
  id: 's1',
  index: 0,
  templateId: template.id,
  slots: template.slots.map((slot, i) => ({
    slotId: slot.id,
    photoId: ['p1', 'p2', 'p3', 'p4'][i] ?? null,
    crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
  })),
};

const rsm = renderSpread(spread, { profile, template, photos: PHOTOS });
const ersteBox = imageBoxes(rsm)[0]!;

describe('withCrop', () => {
  it('ersetzt den Ausschnitt genau eines Slots', () => {
    const neu = withCrop(rsm, ersteBox.slotId, panCrop(ersteBox.crop, 0.1, 0));
    const boxes = imageBoxes(neu);
    expect(boxes[0]!.crop.mode).toBe('manual');
    expect(boxes[1]!.crop).toEqual(imageBoxes(rsm)[1]!.crop);
  });

  it('lässt die ursprüngliche Doppelseite unberührt', () => {
    const vorher = ersteBox.crop;
    withCrop(rsm, ersteBox.slotId, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, mode: 'manual' });
    expect(imageBoxes(rsm)[0]!.crop).toBe(vorher);
  });

  it('senkt die Auflösung, wenn stärker hineingezoomt wird', () => {
    const enger = zoomCrop(ersteBox.crop, 0.5);
    const neu = imageBoxes(withCrop(rsm, ersteBox.slotId, enger))[0]!;
    expect(neu.effectiveDpi).toBeCloseTo(ersteBox.effectiveDpi * 0.5, 6);
  });

  it('rechnet dieselbe Auflösung wie der Renderer', () => {
    // Die Abkürzung über das Breitenverhältnis darf nicht von der vollen
    // Rechnung abweichen – sonst zeigt der Editor beim Ziehen eine andere Zahl
    // als der Server nach dem Speichern.
    const manuell = zoomCrop(panCrop(ersteBox.crop, 0.05, 0.05), 0.7);
    const geschaetzt = imageBoxes(withCrop(rsm, ersteBox.slotId, manuell))[0]!.effectiveDpi;

    const gerechnet = renderSpread(
      {
        ...spread,
        slots: spread.slots.map((s) =>
          s.slotId === ersteBox.slotId ? { ...s, crop: manuell } : s,
        ),
      },
      { profile, template, photos: PHOTOS },
    );
    const echt = imageBoxes(gerechnet).find((b) => b.slotId === ersteBox.slotId)!;
    // Unterschied nur durch die Pixelrundung in cropToPixels
    expect(geschaetzt).toBeCloseTo(echt.effectiveDpi, 0);
  });
});

describe('photoPixelsOf', () => {
  it('gewinnt die Pixelmaße des Fotos zurück', () => {
    for (const box of imageBoxes(rsm)) {
      const photo = PHOTOS.get(box.photoId)!;
      const px = photoPixelsOf(box)!;
      expect(px.width).toBeCloseTo(photo.width, 0);
      expect(px.height).toBeCloseTo(photo.height, 0);
    }
  });

  it('liefert für ein fehlendes Foto nichts', () => {
    const fehlend = { ...ersteBox, effectiveDpi: 0 };
    expect(photoPixelsOf(fehlend)).toBeUndefined();
  });
});

describe('dpiInSlot', () => {
  it('trifft die Auflösung, die der Renderer für denselben Slot ausweist', () => {
    for (const box of imageBoxes(rsm)) {
      const photo = PHOTOS.get(box.photoId)!;
      expect(dpiInSlot(photo, box)).toBeCloseTo(box.effectiveDpi, 6);
    }
  });

  it('gibt für einen größeren Slot eine niedrigere Auflösung aus', () => {
    const klein = dpiInSlot({ width: 2048, height: 1536 }, { xMm: 0, yMm: 0, wMm: 80, hMm: 60 });
    const gross = dpiInSlot({ width: 2048, height: 1536 }, { xMm: 0, yMm: 0, wMm: 300, hMm: 225 });
    expect(gross).toBeLessThan(klein);
  });
});

describe('withTextBlock', () => {
  const block = {
    id: 'text-1',
    content: 'Erster Schnee\nim Garten',
    rect: { x: 0.1, y: 0.2, w: 0.25, h: 0.06 },
    weight: 'regular' as const,
    fontSizePt: 14,
    align: 'left' as const,
  };

  /** Dieselbe Doppelseite, aber mit dem Block darin – so kommt sie vom Server. */
  const mitBlock = renderSpread(
    { ...spread, blocks: [block] },
    { profile, template, photos: PHOTOS },
  );
  const textBoxen = (s: typeof mitBlock) =>
    s.boxes.filter((b) => b.kind === 'text' && b.slotId.startsWith(block.id));
  /** Erste Textbox des Blocks, als Textbox getypt. */
  const ersteZeile = (s: typeof mitBlock) => {
    const box = textBoxen(s)[0];
    if (box?.kind !== 'text') throw new Error('keine Textbox');
    return box;
  };

  it('setzt den Block neu, ohne die anderen Boxen anzufassen', () => {
    const verschoben = withTextBlock(mitBlock, { ...block, rect: { ...block.rect, x: 0.5 } });
    expect(verschoben.boxes.length).toBe(mitBlock.boxes.length);
    expect(imageBoxes(verschoben)).toEqual(imageBoxes(mitBlock));

    // 0,4 der Doppelseitenbreite – im Standardformat 540 mm.
    const spreadW = 2 * profile.page.trimWidthMm;
    expect(ersteZeile(verschoben).xMm - ersteZeile(mitBlock).xMm).toBeCloseTo(0.4 * spreadW, 6);
  });

  it('behält die Zeichenreihenfolge – Text bleibt über den Bildern', () => {
    const verschoben = withTextBlock(mitBlock, { ...block, rect: { ...block.rect, y: 0.5 } });
    const stelle = (s: typeof mitBlock) =>
      s.boxes.findIndex((b) => b.kind === 'text' && b.slotId === `${block.id}-0`);
    expect(stelle(verschoben)).toBe(stelle(mitBlock));
  });

  it('rechnet dieselben Boxen wie der Renderer', () => {
    // Der eigentliche Zweck: Was der Editor beim Ziehen zeigt, muss zeichengleich
    // das sein, was nach dem Speichern gerendert wird.
    const geaendert = { ...block, rect: { ...block.rect, x: 0.42 }, fontSizePt: 22, rotateDeg: 12 };
    const vorschau = withTextBlock(mitBlock, geaendert);
    const gerendert = renderSpread(
      { ...spread, blocks: [geaendert] },
      { profile, template, photos: PHOTOS },
    );
    expect(textBoxen(vorschau)).toEqual(textBoxen(gerendert));
  });

  it('nimmt einen Block auf, der noch keine Box hatte', () => {
    // Ein Block ohne Inhalt steht in keiner Box – wer ihn füllt, soll ihn sehen.
    const leer = { ...block, content: '' };
    const ohne = renderSpread({ ...spread, blocks: [leer] }, { profile, template, photos: PHOTOS });
    expect(textBoxen(ohne)).toHaveLength(0);
    expect(textBoxen(withTextBlock(ohne, block))).toHaveLength(2);
  });
});

describe('withAdjust', () => {
  it('setzt die Farbmatrix an allen Boxen desselben Fotos', () => {
    const neu = withAdjust(rsm, 'p1', { tone: 'sepia' });
    const box = imageBoxes(neu).find((b) => b.photoId === 'p1')!;
    expect(box.colorMatrix).toEqual(farbmatrix({ tone: 'sepia' }));
  });

  it('lässt die anderen Fotos unangetastet', () => {
    const neu = withAdjust(rsm, 'p1', { tone: 'sepia' });
    for (const box of imageBoxes(neu).filter((b) => b.photoId !== 'p1')) {
      expect(box.colorMatrix).toBeUndefined();
    }
  });

  it('geht nach dem Foto und nicht nach dem Slot', () => {
    // Der Unterschied zu `withCrop` und `withRotation`: Liegt dasselbe Bild
    // zweimal auf einer Doppelseite, färbt der Regler beide Vorkommen – so wie
    // es hinterher im Buch steht.
    const doppelt: Spread = {
      ...spread,
      slots: spread.slots.map((s) => ({ ...s, photoId: 'p1' })),
    };
    const neu = withAdjust(renderSpread(doppelt, { profile, template, photos: PHOTOS }), 'p1', {
      contrast: 30,
    });
    expect(imageBoxes(neu).every((b) => b.colorMatrix)).toBe(true);
  });

  it('nimmt die Anpassung sichtbar zurück, statt das Feld stehenzulassen', () => {
    // Ein weggelassenes Feld bliebe beim Spread der vorigen Antwort stehen, und
    // der Regler zöge ins Leere.
    const mit = withAdjust(rsm, 'p1', { tone: 'sw' });
    const ohne = withAdjust(mit, 'p1', undefined);
    expect(imageBoxes(ohne).find((b) => b.photoId === 'p1')!.colorMatrix).toBeUndefined();
  });

  it('setzt für eine wirkungslose Anpassung keine Matrix', () => {
    const neu = withAdjust(rsm, 'p1', { brightness: 0, contrast: 0 });
    expect(imageBoxes(neu).find((b) => b.photoId === 'p1')!.colorMatrix).toBeUndefined();
  });
});
