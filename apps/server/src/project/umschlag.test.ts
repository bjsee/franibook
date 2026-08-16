/**
 * Was `PATCH /api/cover` mit dem gespeicherten Umschlag macht.
 *
 * Geprüft wird hier vor allem eine Eigenschaft, die man leicht falsch baut: Die
 * Textstile sind das **eine** verschachtelte Feld des Umschlags, und die
 * Oberfläche schickt daraus immer nur, was gerade angefasst wurde. Ein flacher
 * Spread löschte beim Wechseln der Titelschrift dessen Farbe gleich mit — ein
 * Verlust, den niemand mit dem Griff in Verbindung brächte.
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_CROP,
  defaultProfile,
  type CoverDesign,
  type Photo,
  type PhotoId,
} from '@franibook/core';
import { coverDesign, updateCover, type Umschlagstand } from './umschlag.js';

const profile = defaultProfile();

function foto(id: string): Photo {
  return {
    id,
    relPath: `${id}.jpeg`,
    fileName: `${id}.jpeg`,
    bytes: 1000,
    width: 4000,
    height: 3000,
    orientation: 1,
  };
}

function stand(cover: CoverDesign = {}): Umschlagstand {
  const photos = new Map<PhotoId, Photo>([['a', foto('a')]]);
  return {
    cover,
    spreads: [],
    photos,
    overrides: {},
    profile,
    structure: { chapters: [] } as unknown as Umschlagstand['structure'],
    settings: {},
    sortedGroups: () => [],
  };
}

describe('Umschlag ändern', () => {
  it('verschmilzt einen Textstil, statt ihn zu ersetzen', () => {
    const z = stand();
    updateCover(z, { texts: { title: { family: 'display', color: '#ffffff' } } });
    updateCover(z, { texts: { title: { sizePt: 48 } } });

    expect(z.cover.texts?.title).toEqual({
      family: 'display',
      color: '#ffffff',
      sizePt: 48,
    });
  });

  it('lässt die übrigen Texte in Ruhe', () => {
    const z = stand();
    updateCover(z, { texts: { title: { sizePt: 48 }, spine: { family: 'serif' } } });
    updateCover(z, { texts: { title: { sizePt: 30 } } });

    expect(z.cover.texts?.spine).toEqual({ family: 'serif' });
  });

  it('nimmt ein einzelnes Feld mit `null` zurück', () => {
    const z = stand();
    updateCover(z, { texts: { title: { family: 'display', sizePt: 48 } } });
    updateCover(z, { texts: { title: { sizePt: null } } });

    expect(z.cover.texts?.title).toEqual({ family: 'display' });
  });

  it('räumt einen leergeräumten Eintrag ganz weg', () => {
    // Ein leeres Objekt im gespeicherten Projekt sähe aus wie eine Gestaltung
    // und wäre keine.
    const z = stand();
    updateCover(z, { texts: { title: { family: 'display' } } });
    updateCover(z, { texts: { title: { family: null } } });

    expect(z.cover.texts).toBeUndefined();
  });

  it('nimmt eine Deckelfarbe mit dem leeren Text zurück', () => {
    const z = stand();
    updateCover(z, { frontBackground: '#eeeeee' });
    expect(z.cover.frontBackground).toBe('#eeeeee');
    updateCover(z, { frontBackground: '' });
    expect(z.cover).not.toHaveProperty('frontBackground');
  });

  it('entfernt ein Mosaik nur auf dem gemeinten Deckel', () => {
    const z = stand();
    updateCover(z, { frontMosaic: { cols: 44 }, backMosaic: { cols: 30 } });
    updateCover(z, { backMosaic: null });

    expect(z.cover.frontMosaic).toEqual({ cols: 44 });
    expect(z.cover).not.toHaveProperty('backMosaic');
  });
});

describe('Deckelbilder aus Mosaiken', () => {
  it('setzt ein gebackenes Rückseitenmosaik an die Stelle des Einzelbilds', () => {
    const z = stand({ backPhotoId: 'a', backMosaic: { cols: 30 } });
    z.rueckmosaik = { photoId: 'mosaik:abc', photo: foto('mosaik:abc') };

    const d = coverDesign(z);
    expect(d.backPhotoId).toBe('mosaik:abc');
    // Ein Mosaik hat schon die Form der Fläche — ein gespeicherter Ausschnitt
    // des abgelösten Fotos zeigte sonst einen Streifen davon.
    expect(d.backCrop).toEqual({ ...FULL_CROP });
  });

  it('zeigt so lange das Einzelbild, wie das Mosaik noch gebacken wird', () => {
    // Eine gesetzte Anweisung ohne fertiges Bild heißt „läuft noch". Eine leere
    // Fläche wäre die schlechtere Auskunft.
    const z = stand({ backPhotoId: 'a', backMosaic: { cols: 30 } });
    expect(coverDesign(z).backPhotoId).toBe('a');
  });

  it('hält die beiden Deckel auseinander', () => {
    const z = stand({ frontMosaic: { cols: 44 }, backMosaic: { cols: 30 } });
    z.titelmosaik = { photoId: 'mosaik:vorn', photo: foto('mosaik:vorn') };
    z.rueckmosaik = { photoId: 'mosaik:hinten', photo: foto('mosaik:hinten') };

    const d = coverDesign(z);
    expect(d.frontPhotoId).toBe('mosaik:vorn');
    expect(d.backPhotoId).toBe('mosaik:hinten');
  });
});
