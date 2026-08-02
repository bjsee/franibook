import { describe, expect, it } from 'vitest';
import { FULL_CROP, MAX_TILT_DEG, groupOpenerTemplates } from '@franibook/core';
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

    expect(neu?.schemaVersion).toBe(3);
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
    const aktuell = { ...altesProjekt(), schemaVersion: 3 };
    expect(migriere(aktuell)).toBe(aktuell);
  });

  it('nimmt die Überschrift von einer Doppelseite des Innenteils', () => {
    // Sie stünde sonst als festgeschriebener Text im Buch, während der
    // Zeitstrahl denselben Namen aus den Gruppen holt – und nach dem Auflösen
    // einer Gruppe bliebe der alte Titel stehen.
    const alt = altesProjekt();
    alt.book = {
      spreads: [
        {
          id: 's0',
          index: 0,
          templateId: 'raster-2x2',
          slots: [],
          texts: [{ id: 't', role: 'eventTitle', content: 'Geburt', slotId: 't-title' }],
        },
      ],
    } as never;

    expect(migriere(alt)?.book.spreads[0]!.texts).toBeUndefined();
  });

  it('lässt der Auftaktseite ihren Titel', () => {
    // Sie besteht aus nichts anderem als Hauptbild und Gruppenname.
    const auftakt = groupOpenerTemplates()[0];
    expect(auftakt).toBeDefined();

    const alt = altesProjekt();
    alt.book = {
      spreads: [
        {
          id: 's0',
          index: 0,
          templateId: auftakt!.id,
          slots: [],
          texts: [{ id: 't', role: 'eventTitle', content: 'Kreta', slotId: 't-title' }],
        },
      ],
    } as never;

    expect(migriere(alt)?.book.spreads[0]!.texts).toHaveLength(1);
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

describe('setSpreadTemplate', () => {
  /** Ein Projekt mit einer Doppelseite aus drei gleich geformten Bildern. */
  function projektMitDrei(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    for (const id of ['p1', 'p2', 'p3']) {
      p.photos.set(id, {
        id,
        sourceId: 'q',
        relPath: `${id}.jpg`,
        fileName: `${id}.jpg`,
        bytes: 1_000_000,
        width: 4000,
        height: 3000,
        takenAt: '2020-01-01T12:00:00',
      } as never);
    }
    p.spreads = [
      {
        id: 's0',
        index: 0,
        templateId: 'spread.3up.two-and-one',
        slots: [
          { slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } },
          { slotId: 'b', photoId: 'p2', crop: { ...FULL_CROP } },
          { slotId: 'c', photoId: 'p3', crop: { ...FULL_CROP } },
        ],
      },
    ];
    return p;
  }

  it('setzt die Vorlage und ordnet die Bilder neu zu', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.3up.hero-plus-two');

    expect(r.ok).toBe(true);
    expect(r.leftover).toEqual([]);
    expect(p.spreads[0]!.templateId).toBe('spread.3up.hero-plus-two');
    expect(p.spreads[0]!.slots.filter((s) => s.photoId).length).toBe(3);
  });

  it('schickt überzählige Bilder in den Pool, statt sie zu verlieren', () => {
    // Der Punkt des Wechsels von Hand: Man will die Seite anders aufteilen,
    // auch wenn dann weniger Bilder daraufpassen.
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.2up.pair');

    expect(r.ok).toBe(true);
    expect(r.leftover).toHaveLength(1);
    expect(p.spreads[0]!.slots.filter((s) => s.photoId).length).toBe(2);

    // Was übrig blieb, ist nicht platziert – und damit im Pool.
    const imBuch = new Set(p.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
    expect(imBuch.has(r.leftover[0]!)).toBe(false);
  });

  it('lässt Plätze leer, wenn die Vorlage größer ist', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.4up.grid');

    expect(r.ok).toBe(true);
    expect(p.spreads[0]!.slots).toHaveLength(4);
    expect(p.spreads[0]!.slots.filter((s) => s.photoId === null)).toHaveLength(1);
  });

  it('meldet eine unbekannte Vorlage, statt die Seite zu leeren', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'gibt.es.nicht');

    expect(r.ok).toBe(false);
    expect(p.spreads[0]!.templateId).toBe('spread.3up.two-and-one');
  });
});
