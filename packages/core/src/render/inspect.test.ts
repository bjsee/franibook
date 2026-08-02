import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { Photo } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { panCrop, zoomCrop } from '../model/crop.js';
import { requireTemplate } from '../templates/index.js';
import { renderSpread } from './render-spread.js';
import { imageBoxes } from './rendered-spread.js';
import { dpiInSlot, photoPixelsOf, withCrop } from './inspect.js';

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
