import { describe, expect, it } from 'vitest';
import {
  effectivePhoto,
  effectivePhotos,
  manualPlaceKey,
  quarterTurnsOf,
} from './effective-photo.js';
import type { Photo } from './photo.js';
import { orientationOf } from './photo.js';

function photo(partial: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    relPath: 'p1.jpeg',
    fileName: 'p1.jpeg',
    bytes: 800_000,
    width: 2048,
    height: 1536,
    orientation: 1,
    ...partial,
  };
}

describe('effectivePhoto', () => {
  it('gibt dasselbe Objekt zurück, wenn nichts zu korrigieren ist', () => {
    // Wichtig, weil die Funktion über den ganzen Bestand läuft: Eine Kopie je
    // Foto wäre bei 830 Fotos Arbeit für nichts.
    const p = photo();
    expect(effectivePhoto(p)).toBe(p);
    expect(effectivePhoto(p, { dateOverride: '2015-06-12T14:00:00' })).toBe(p);
  });

  it('setzt den von Hand gesetzten Ort', () => {
    const p = photo({ place: { key: 'country:Dänemark', label: 'Dänemark' } });
    const e = effectivePhoto(p, {
      placeOverride: { key: 'manual:Ferienhaus', label: 'Ferienhaus' },
    });
    expect(e.place).toEqual({ key: 'manual:Ferienhaus', label: 'Ferienhaus' });
  });

  it('lässt das Importergebnis unangetastet', () => {
    const p = photo({ place: { key: 'country:Dänemark', label: 'Dänemark' } });
    effectivePhoto(p, { placeOverride: { key: 'manual:Ferienhaus', label: 'Ferienhaus' } });
    expect(p.place?.label).toBe('Dänemark');
  });

  it('gibt einem Foto ohne Koordinaten einen Ort', () => {
    const e = effectivePhoto(photo(), { placeOverride: { key: 'manual:Kreta', label: 'Kreta' } });
    expect(e.place?.label).toBe('Kreta');
    // Die Koordinaten bleiben leer: Ein Ortsname ist keine Position, und die
    // Engine liest ohnehin nur `place`.
    expect(e.gps).toBeUndefined();
  });

  it('rührt das Datum nicht an', () => {
    // `takenAt` heißt „EXIF DateTimeOriginal" und soll das auch bleiben – das
    // effektive Datum kommt aus der Kaskade, die Quelle und Befunde mitliefert.
    const e = effectivePhoto(photo({ takenAt: '2015-06-12T14:00:00' }), {
      dateOverride: '2010-01-01T10:00:00',
      placeOverride: { key: 'manual:Kreta', label: 'Kreta' },
    });
    expect(e.takenAt).toBe('2015-06-12T14:00:00');
  });
});

describe('Ausrichtung kippen', () => {
  it('tauscht Breite und Höhe bei 90° und 270°', () => {
    for (const turns of [1, 3] as const) {
      const e = effectivePhoto(photo({ width: 4000, height: 3000 }), {
        orientationTurns: turns,
      });
      expect([e.width, e.height], `${turns} Vierteldrehungen`).toEqual([3000, 4000]);
    }
  });

  it('lässt die Maße bei 180° wie sie sind', () => {
    const e = effectivePhoto(photo({ width: 4000, height: 3000 }), { orientationTurns: 2 });
    expect([e.width, e.height]).toEqual([4000, 3000]);
  });

  it('trägt die Drehung für die Renderer weiter', () => {
    // Vorschau und PDF-Export drehen die Pixel danach; das Layout rechnet schon
    // mit den getauschten Maßen.
    expect(quarterTurnsOf(effectivePhoto(photo(), { orientationTurns: 3 }))).toBe(3);
    expect(quarterTurnsOf(photo())).toBe(0);
  });

  it('lässt die EXIF-Orientierung unangetastet', () => {
    // Sie beschreibt die Datei. Die Korrektur kommt obendrauf – als geänderte
    // `orientation` wäre sie wirkungslos, weil die Aufbereitung daraus nur *ob*
    // liest und die Orientierung dann aus der Datei nimmt.
    const e = effectivePhoto(photo({ orientation: 6 }), { orientationTurns: 1 });
    expect(e.orientation).toBe(6);
  });

  it('kippt das Seitenverhältnis, das die Vorlagenwahl sieht', () => {
    // Der Zweck der ganzen Übung: Ein hochkant gescanntes Bild, das als Querformat
    // im Modell steht, bekommt sonst einen querformatigen Platz.
    const quer = photo({ width: 4000, height: 3000 });
    expect(orientationOf(quer)).toBe('landscape');
    expect(orientationOf(effectivePhoto(quer, { orientationTurns: 1 }))).toBe('portrait');
  });
});

describe('effectivePhotos über den Bestand', () => {
  const BESTAND = new Map([
    ['a', photo({ id: 'a', width: 4000, height: 3000 })],
    ['b', photo({ id: 'b' })],
  ]);

  it('gibt dieselbe Map zurück, wenn keine Korrektur greift', () => {
    expect(effectivePhotos(BESTAND)).toBe(BESTAND);
    expect(effectivePhotos(BESTAND, {})).toBe(BESTAND);
    // Eine Datumskorrektur betrifft das Foto nicht – auch dann keine Kopie.
    expect(effectivePhotos(BESTAND, { a: { dateOverride: '2015-06-12T14:00:00' } })).toBe(BESTAND);
  });

  it('löst nur die betroffenen Fotos auf und lässt die anderen dieselben', () => {
    const auf = effectivePhotos(BESTAND, { a: { orientationTurns: 1 } });
    expect(auf).not.toBe(BESTAND);
    expect([auf.get('a')!.width, auf.get('a')!.height]).toEqual([3000, 4000]);
    // Unverändertes bleibt dasselbe Objekt – die Kopie ist flach.
    expect(auf.get('b')).toBe(BESTAND.get('b'));
  });

  it('lässt den übergebenen Bestand unangetastet', () => {
    effectivePhotos(BESTAND, { a: { orientationTurns: 1 } });
    expect(BESTAND.get('a')!.width).toBe(4000);
  });
});

describe('manualPlaceKey', () => {
  it('bildet eine Kennung in derselben Form wie der Import', () => {
    expect(manualPlaceKey('Kreta')).toBe('manual:Kreta');
  });

  it('schneidet Leerraum ab, damit „Kreta " und „Kreta" eine Gruppe sind', () => {
    expect(manualPlaceKey('  Kreta ')).toBe(manualPlaceKey('Kreta'));
  });
});
