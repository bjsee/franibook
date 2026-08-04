import { describe, expect, it } from 'vitest';
import { effectivePhoto, manualPlaceKey } from './effective-photo.js';
import type { Photo } from './photo.js';

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

describe('manualPlaceKey', () => {
  it('bildet eine Kennung in derselben Form wie der Import', () => {
    expect(manualPlaceKey('Kreta')).toBe('manual:Kreta');
  });

  it('schneidet Leerraum ab, damit „Kreta " und „Kreta" eine Gruppe sind', () => {
    expect(manualPlaceKey('  Kreta ')).toBe(manualPlaceKey('Kreta'));
  });
});
