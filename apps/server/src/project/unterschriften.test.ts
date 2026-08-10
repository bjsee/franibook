/**
 * Der mengenwertige Zug „Unterschriften setzen".
 *
 * Den Wortlaut prüft `model/caption.test.ts` im Kern. Hier geht es um das, was
 * nur das Projekt kann: den Bereich einzugrenzen, Handarbeit zu verschonen und
 * zu melden, was liegen blieb.
 */
import { describe, expect, it } from 'vitest';
import type { Photo, PhotoGroup, Spread } from '@franibook/core';
import { requireTemplate } from '@franibook/core';
import { Project } from '../project.js';

const PLAETZE = requireTemplate('spread.4up.grid').slots.map((s) => s.id);

function foto(id: string, patch: Partial<Photo> = {}): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    ...patch,
  };
}

/** Zwei Doppelseiten mit je zwei Bildern; das letzte ohne Datum und ohne Ort. */
function projekt(): Project {
  const p = new Project(null as never, null as never, null as never, '');
  const fotos = [
    foto('a', { takenAt: '2017-06-12T12:00:00', place: { key: 'ort:Sylt', label: 'Sylt' } }),
    foto('b', { takenAt: '2017-06-13T12:00:00' }),
    foto('c', { takenAt: '2018-01-05T12:00:00', place: { key: 'ort:Köln', label: 'Köln' } }),
    foto('d'),
  ];
  for (const f of fotos) p.photos.set(f.id, f);

  const seite = (id: string, index: number, ids: string[]): Spread => ({
    id,
    index,
    templateId: 'spread.4up.grid',
    // Die Kennungen der Vorlage: Ein Platz, den sie nicht kennt, wird nicht
    // gezeichnet — und was nicht gezeichnet wird, beschriftet der Zug auch
    // nicht.
    slots: ids.map((photoId, i) => ({
      slotId: PLAETZE[i]!,
      photoId,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
  });
  p.spreads = [seite('s1', 0, ['a', 'b']), seite('s2', 1, ['c', 'd'])];

  const gruppe: PhotoGroup = {
    id: 'g1',
    title: 'Sylt',
    photoIds: ['a', 'b'],
    active: true,
    origin: 'manual',
  };
  p.groups = [gruppe];
  // Der einzige Rahmen mit Fuß – ohne ihn übersprünge der Zug jeden Slot.
  p.settings.frame = 'polaroid';
  p.rebuildStructure();
  return p;
}

const zeilen = (p: Project) => p.spreads.flatMap((s) => s.slots.map((sl) => sl.caption));

describe('Unterschriften mengenwertig setzen', () => {
  it('füllt das ganze Buch aus Ort und Datum', () => {
    const p = projekt();
    const e = p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort-monat' });

    expect(e.geaendert).toBe(3);
    expect(zeilen(p)).toEqual(['Sylt, Juni 2017', 'Juni 2017', 'Köln, Januar 2018', undefined]);
    // Das Foto ohne jede Angabe bekommt keine leere Zeile, sondern gar keine —
    // und wird gemeldet.
    expect(e.uebersprungen.ohneAngabe).toBe(1);
    expect(e.seiten).toEqual([0, 1]);
  });

  it('bleibt auf einer Doppelseite, wenn man sie nennt', () => {
    const p = projekt();
    p.setzeUnterschriften({ bereich: { kind: 'spread', index: 1 }, form: 'tag' });

    expect(zeilen(p)).toEqual([undefined, undefined, '5. Januar 2018', undefined]);
  });

  it('grenzt eine Gruppe über ihre Fotos ein, nicht über ihre Seiten', () => {
    // Die Bilder einer Gruppe können auf einer Seite mit fremden stehen.
    const p = projekt();
    p.groups = [{ ...p.groups[0]!, photoIds: ['a', 'c'] }];
    p.setzeUnterschriften({ bereich: { kind: 'group', id: 'g1' }, form: 'ort' });

    expect(zeilen(p)).toEqual(['Sylt', undefined, 'Köln', undefined]);
  });

  it('lässt eine getippte Zeile stehen und sagt es', () => {
    const p = projekt();
    p.setSlotCaption(0, PLAETZE[0]!, 'Der Tag am Meer');
    const e = p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort-monat' });

    expect(zeilen(p)[0]).toBe('Der Tag am Meer');
    expect(e.uebersprungen.handarbeit).toBe(1);
  });

  it('ersetzt sie erst, wenn man es ausdrücklich sagt', () => {
    const p = projekt();
    p.setSlotCaption(0, PLAETZE[0]!, 'Der Tag am Meer');
    p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort', ueberschreiben: true });

    expect(zeilen(p)[0]).toBe('Sylt');
  });

  it('überschreibt seine eigene Zeile ohne Nachfrage', () => {
    // Zweimal gesetzt heißt: der zweite Wortlaut gilt. Nur Handarbeit ist
    // geschützt.
    const p = projekt();
    p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });
    const e = p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'monat' });

    expect(zeilen(p)[0]).toBe('Juni 2017');
    expect(e.uebersprungen.handarbeit).toBe(0);
  });

  it('schreibt nichts in einen Rahmen ohne Fuß und meldet es', () => {
    // Der Text bliebe unsichtbar; beim nächsten Rahmenwechsel erschienen
    // vierzig Zeilen, die niemand gelesen hat.
    const p = projekt();
    p.settings.frame = 'keiner';
    const e = p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });

    expect(e.geaendert).toBe(0);
    expect(e.uebersprungen.ohneFuss).toBe(4);
    expect(zeilen(p)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('sieht den Rahmen am Slot vor der Buchvorgabe', () => {
    const p = projekt();
    p.settings.frame = 'keiner';
    p.spreads[0]!.slots[0]!.frame = 'polaroid';
    const e = p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });

    expect(e.geaendert).toBe(1);
    expect(zeilen(p)[0]).toBe('Sylt');
  });

  it('nimmt auf Wunsch nur eine Doppelseite oder eine Gruppe zurück', () => {
    const p = projekt();
    p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });
    p.loescheUnterschriften({ kind: 'spread', index: 1 });
    expect(zeilen(p)).toEqual(['Sylt', undefined, undefined, undefined]);

    const q = projekt();
    q.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });
    q.loescheUnterschriften({ kind: 'group', id: 'g1' });
    expect(zeilen(q)).toEqual([undefined, undefined, 'Köln', undefined]);
  });

  it('meldet eine Gruppe, die es nicht gibt, statt nichts zu tun', () => {
    const p = projekt();
    const e = p.setzeUnterschriften({ bereich: { kind: 'group', id: 'gibtesnicht' }, form: 'ort' });
    expect(e.unbekannteGruppe).toBe(true);
    expect(e.geaendert).toBe(0);
  });

  it('nimmt nur zurück, was es selbst gesetzt hat', () => {
    const p = projekt();
    p.setzeUnterschriften({ bereich: { kind: 'book' }, form: 'ort' });
    p.setSlotCaption(1, PLAETZE[0]!, 'Von Hand');
    const e = p.loescheUnterschriften({ kind: 'book' });

    expect(e.geaendert).toBe(1);
    expect(zeilen(p)).toEqual([undefined, undefined, 'Von Hand', undefined]);
  });
});
