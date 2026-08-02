import { describe, expect, it } from 'vitest';
import { FULL_CROP, MAX_TILT_DEG } from '@franibook/core';
import { Project, migriere } from './project.js';
import { quellenId } from './sources.js';

/**
 * Ein gespeichertes Projekt im alten Schema, auf das Nötigste gekürzt.
 *
 * Als Literal statt aus einer Fixture: Der Punkt der Migration ist, dass genau
 * diese Felder überleben – Korrekturen, Gruppen und das nachgearbeitete Buch.
 */
function altesProjekt(): Parameters<typeof migriere>[0] {
  return {
    schemaVersion: 1,
    sourceRoot: '/bilder/buch',
    settings: { targetPages: 160 } as never,
    photos: [
      { id: 'a1', relPath: 'IMG_1.jpg', fileName: 'IMG_1.jpg' },
      { id: 'b2', relPath: 'IMG_2.jpg', fileName: 'IMG_2.jpg' },
    ] as never,
    overrides: { a1: { date: '2015-06-12T14:12:33' } } as never,
    groups: [{ id: 'g1', title: 'Ostern' }] as never,
    book: { spreads: [{ slots: [] }] } as never,
    importedAt: '2026-01-01T10:00:00.000Z',
  };
}

describe('migriere', () => {
  it('macht aus dem einen Quellordner eine Quellenliste', () => {
    const neu = migriere(altesProjekt());

    expect(neu?.schemaVersion).toBe(2);
    expect(neu?.sources).toEqual([
      {
        id: quellenId('/bilder/buch'),
        label: 'buch',
        root: '/bilder/buch',
        addedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
  });

  it('trägt jedem Foto seine Quelle ein', () => {
    const neu = migriere(altesProjekt());
    const id = quellenId('/bilder/buch');

    // Ohne diese Zuordnung wäre nach dem ersten zusätzlichen Ordner nicht mehr
    // entscheidbar, wo eine Datei zu suchen ist.
    expect(neu?.photos.map((p) => p.sourceId)).toEqual([id, id]);
  });

  it('lässt Korrekturen, Gruppen und Buch unangetastet', () => {
    const alt = altesProjekt();
    const neu = migriere(alt);

    // Der eigentliche Grund für die Migration: Ein Verwerfen des Projekts
    // stellt nichts davon wieder her.
    expect(neu?.overrides).toEqual(alt.overrides);
    expect(neu?.groups).toEqual(alt.groups);
    expect(neu?.book).toEqual(alt.book);
  });

  it('lässt ein Projekt im aktuellen Schema unverändert', () => {
    const aktuell = { ...altesProjekt(), schemaVersion: 2 };
    expect(migriere(aktuell)).toBe(aktuell);
  });

  it('lehnt ein unbekanntes Schema ab, statt es zu deuten', () => {
    expect(migriere({ ...altesProjekt(), schemaVersion: 99 })).toBeNull();
  });
});

describe('setSlotRotation', () => {
  /**
   * Ein Projekt mit genau einem belegten Slot.
   *
   * Ohne Quellen, Caches und Projektpfad: `setSlotRotation` fasst nur
   * `spreads` an, und eine Attrappe für drei ungenutzte Abhängigkeiten wäre
   * mehr Gerüst als Test.
   */
  function projektMitSlot(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    p.spreads = [
      {
        id: 's1',
        index: 0,
        templateId: 'spread.4up.grid',
        slots: [{ slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } }],
      },
    ];
    return p;
  }

  it('merkt sich einen von Hand gesetzten Winkel', () => {
    const p = projektMitSlot();
    expect(p.setSlotRotation(0, 'a', 2.5).ok).toBe(true);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(2.5);
  });

  /**
   * Der Unterschied, um den es geht: `0` steht gegen die Automatik, `null`
   * gibt an sie zurück.
   */
  it('unterscheidet geradestellen von automatisch', () => {
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 0);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(0);

    p.setSlotRotation(0, 'a', null);
    expect(p.spreads[0]?.slots[0]).not.toHaveProperty('rotateDeg');
  });

  it('klemmt einen übertriebenen Winkel auf den Höchstwert', () => {
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 90);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(MAX_TILT_DEG);
  });

  it('rundet auf ein Zehntelgrad wie die Automatik', () => {
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 1.2345);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(1.2);
  });

  it('weist eine Nichtzahl ab, statt sie zu speichern', () => {
    const p = projektMitSlot();
    expect(p.setSlotRotation(0, 'a', Number.NaN).ok).toBe(false);
    expect(p.spreads[0]?.slots[0]).not.toHaveProperty('rotateDeg');
  });

  it('meldet einen unbekannten Slot', () => {
    expect(projektMitSlot().setSlotRotation(0, 'z', 1).ok).toBe(false);
  });
});
