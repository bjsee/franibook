import { describe, expect, it } from 'vitest';
import { FULL_CROP } from '../model/crop.js';
import type { Photo } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { defaultProfile } from '../print/profiles/index.js';
import { renderSpread } from '../render/render-spread.js';
import { requireTemplate } from '../templates/index.js';
import { moveSlotLayer } from './ebene.js';
import { aufsBlatt, einwurfPlatzId, einwurfRect, EINWURF_HOEHE, mitEinwurf } from './einwurf.js';

const profile = defaultProfile();
const template = requireTemplate('spread.4up.grid');

function foto(id: string, width = 4000, height = 3000): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width,
    height,
    orientation: 1,
    fileMtime: '2019-06-12T14:12:33',
  };
}

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

describe('Ein eingeworfenes Bild', () => {
  it('kommt an die Stelle, an der es fallen gelassen wurde', () => {
    const { spread, slotId } = mitEinwurf(seite(), foto('neu'), { x: 0.3, y: 0.5 }, profile);
    const platz = spread.slots.find((s) => s.slotId === slotId)!;

    expect(platz.rect).toBeDefined();
    // Um den Punkt herum, nicht mit der Ecke daran: Man zielt auf die Stelle,
    // an der das Bild stehen soll.
    expect(platz.rect!.x + platz.rect!.w / 2).toBeCloseTo(0.3, 5);
    expect(platz.rect!.y + platz.rect!.h / 2).toBeCloseTo(0.5, 5);
  });

  it('lässt die übrigen Bilder unangetastet', () => {
    const vorher = seite();
    const { spread } = mitEinwurf(vorher, foto('neu'), { x: 0.5, y: 0.5 }, profile);

    expect(spread.templateId).toBe(vorher.templateId);
    expect(spread.slots.slice(0, 4)).toEqual(vorher.slots);
    expect(spread.slots).toHaveLength(5);
  });

  it('behält das Seitenverhältnis des Fotos, damit nichts abgeschnitten wird', () => {
    const hoch = einwurfRect({ x: 0.5, y: 0.5 }, foto('hoch', 3000, 4000), profile);
    const quer = einwurfRect({ x: 0.5, y: 0.5 }, foto('quer', 4000, 3000), profile);
    const { trimWidthMm, trimHeightMm } = profile.page;

    const mm = (r: { w: number; h: number }) => (r.w * 2 * trimWidthMm) / (r.h * trimHeightMm);
    expect(mm(hoch)).toBeCloseTo(3 / 4, 4);
    expect(mm(quer)).toBeCloseTo(4 / 3, 4);
    // Beide stehen gleich hoch da – der Maßstab ist die Höhe, nicht die Fläche.
    expect(hoch.h).toBeCloseTo(EINWURF_HOEHE, 5);
    expect(quer.h).toBeCloseTo(EINWURF_HOEHE, 5);
  });

  it('wird flacher statt beschnitten, wenn es breiter als das Blatt wäre', () => {
    // Ein Handy-Panorama: 10:1 und damit bei einem Drittel Seitenhöhe 900 mm
    // breit. Würde nur die Breite geklemmt, hätte der Kasten ein anderes
    // Seitenverhältnis als das Foto – und `coverCrop` schnitte die Seiten ab.
    const rect = einwurfRect({ x: 0.5, y: 0.5 }, foto('pano', 10000, 1000), profile);
    const { trimWidthMm, trimHeightMm, bleedMm } = profile.page;

    expect((rect.w * 2 * trimWidthMm) / (rect.h * trimHeightMm)).toBeCloseTo(10, 4);
    expect(rect.w * 2 * trimWidthMm).toBeLessThanOrEqual(2 * trimWidthMm + 2 * bleedMm + 0.001);
    expect(rect.h).toBeLessThan(EINWURF_HOEHE);
  });

  it('wird am Blattrand hineingeschoben statt halb hinausgeworfen', () => {
    const rect = einwurfRect({ x: 0.02, y: 0.98 }, foto('neu'), profile);
    const geklemmt = aufsBlatt(rect, profile);

    expect(rect).toEqual(geklemmt);
    expect(rect.x + rect.w).toBeLessThanOrEqual(1.01);
    expect(rect.y).toBeGreaterThan(0);
  });

  it('zählt seine Kennung fortlaufend und erbt keine freigewordene', () => {
    const eins = mitEinwurf(seite(), foto('a'), { x: 0.3, y: 0.3 }, profile);
    const zwei = mitEinwurf(eins.spread, foto('b'), { x: 0.6, y: 0.3 }, profile);

    expect(eins.slotId).toBe('frei.1');
    expect(zwei.slotId).toBe('frei.2');

    // Der erste wird herausgenommen: Der nächste Einwurf darf seine Kennung
    // nicht bekommen, solange sie noch belegt ist – hier ist sie frei.
    const ohne = { ...zwei.spread, slots: zwei.spread.slots.filter((s) => s.slotId !== 'frei.2') };
    expect(einwurfPlatzId(ohne)).toBe('frei.2');
  });

  it('wird gezeichnet, obwohl die Vorlage seinen Platz nicht kennt', () => {
    const neu = foto('neu');
    const { spread, slotId } = mitEinwurf(seite(), neu, { x: 0.5, y: 0.5 }, profile);
    const photos = new Map([
      ...spread.slots
        .filter((s) => s.photoId && s.photoId !== neu.id)
        .map((s) => [s.photoId!, foto(s.photoId!)] as const),
      [neu.id, neu] as const,
    ]);

    const rsm = renderSpread(spread, { profile, template, photos });
    const box = rsm.boxes.find((b) => b.kind === 'image' && b.slotId === slotId);

    expect(box).toBeDefined();
    // Zuletzt in der Liste und damit obenauf: Wer eben etwas eingeworfen hat,
    // will es sehen.
    expect(rsm.boxes.filter((b) => b.kind === 'image').at(-1)).toBe(box);
    expect(box?.kind === 'image' && box.manualRect).toBe(true);
  });

  it('liegt im selben Stapel wie die Bilder der Vorlage', () => {
    const { spread, slotId } = mitEinwurf(seite(), foto('neu'), { x: 0.5, y: 0.5 }, profile);
    const nachHinten = moveSlotLayer(spread, template, slotId, 'hinten')!;

    expect(nachHinten.slots.find((s) => s.slotId === slotId)?.layer).toBe(0);
    expect(nachHinten.slots.map((s) => s.layer).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
