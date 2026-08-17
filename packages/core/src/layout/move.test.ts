import { describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { defaultProfile } from '../print/profiles/index.js';
import { BLANK_TEMPLATE_ID } from '../templates/index.js';
import { movePhoto, movePhotos } from './move.js';

/** Zwei Doppelseiten mit je zwei Slots, der letzte bewusst leer. */
function buch(): Spread[] {
  return [
    {
      id: 's0',
      index: 0,
      templateId: 'spread.2up.side',
      slots: [
        { slotId: 'a', photoId: 'p1', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'manual' } },
        { slotId: 'b', photoId: 'p2', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'manual' } },
      ],
    },
    {
      id: 's1',
      index: 1,
      templateId: 'spread.2up.side',
      slots: [
        { slotId: 'a', photoId: 'p3', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
        { slotId: 'b', photoId: null, crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
      ],
    },
  ];
}

const slot = (spreadIndex: number, slotId: string) =>
  ({ kind: 'slot', spreadIndex, slotId }) as const;

describe('movePhoto', () => {
  it('tauscht zwei belegte Slots über Doppelseiten hinweg', () => {
    const r = movePhoto(buch(), slot(0, 'a'), slot(1, 'a'));
    expect(r.ok).toBe(true);
    expect(r.spreads[1]!.slots[0]!.photoId).toBe('p1');
    expect(r.spreads[0]!.slots[0]!.photoId).toBe('p3');
    expect(r.touched).toEqual([0, 1]);
  });

  it('lässt den Ausgangsslot leer, wenn das Ziel leer war', () => {
    const r = movePhoto(buch(), slot(0, 'b'), slot(1, 'b'));
    expect(r.spreads[1]!.slots[1]!.photoId).toBe('p2');
    expect(r.spreads[0]!.slots[1]!.photoId).toBeNull();
  });

  it('stellt verschobene Ausschnitte auf automatisch zurück', () => {
    // Ein manueller Ausschnitt gilt für das Seitenverhältnis seines Slots und
    // wäre im neuen Slot falsch.
    const r = movePhoto(buch(), slot(0, 'a'), slot(1, 'a'));
    expect(r.spreads[1]!.slots[0]!.crop.mode).toBe('auto-cover');
    expect(r.spreads[0]!.slots[0]!.crop.mode).toBe('auto-cover');
  });

  it('nimmt ein Foto aus dem Buch in den Pool', () => {
    const r = movePhoto(buch(), slot(0, 'a'), { kind: 'pool' });
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots[0]!.photoId).toBeNull();
    expect(r.touched).toEqual([0]);
  });

  it('setzt ein Foto aus dem Pool in einen leeren Slot', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, slot(1, 'b'));
    expect(r.ok).toBe(true);
    expect(r.spreads[1]!.slots[1]!.photoId).toBe('p9');
  });

  it('schickt das verdrängte Foto zurück in den Pool', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, slot(0, 'b'));
    expect(r.spreads[0]!.slots[1]!.photoId).toBe('p9');
    const alle = r.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId));
    expect(alle).not.toContain('p2');
  });

  it('verweigert ein Foto, das schon im Buch liegt', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p3' }, slot(1, 'b'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Doppelseite 2');
    expect(r.spreads[1]!.slots[1]!.photoId).toBeNull();
  });

  it('verweigert einen leeren Ausgangsslot', () => {
    const r = movePhoto(buch(), slot(1, 'b'), slot(0, 'a'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Der Ausgangsslot ist leer');
  });

  it('meldet unbekannte Doppelseiten und Slots', () => {
    expect(movePhoto(buch(), slot(0, 'a'), slot(7, 'a')).error).toContain('Doppelseite 8');
    expect(movePhoto(buch(), slot(0, 'a'), slot(1, 'z')).error).toContain('Slot z');
  });

  it('nimmt einen Zug auf denselben Slot ohne Wirkung hin', () => {
    const r = movePhoto(buch(), slot(0, 'a'), slot(0, 'a'));
    expect(r.ok).toBe(true);
    expect(r.touched).toEqual([]);
    expect(r.spreads[0]!.slots[0]!.crop.mode).toBe('manual');
  });

  it('lässt unbeteiligte Doppelseiten unverändert – dieselben Objekte', () => {
    // Die Zusicherung, auf die sich die gezielte Änderung stützt: Alles außer
    // den beiden Slots bleibt bitweise, wie es war.
    const vorher = buch();
    const r = movePhoto(vorher, slot(0, 'a'), { kind: 'pool' });
    expect(r.spreads[1]).toBe(vorher[1]);
    expect(r.spreads[0]!.slots[1]).toBe(vorher[0]!.slots[1]);
  });

  it('verändert die Eingabe nicht', () => {
    const vorher = buch();
    movePhoto(vorher, slot(0, 'a'), slot(1, 'a'));
    expect(vorher[0]!.slots[0]!.photoId).toBe('p1');
    expect(vorher[1]!.slots[0]!.photoId).toBe('p3');
  });
});

describe('movePhoto auf eine ganze Doppelseite', () => {
  /** Ein Bestand, in dem jedes Foto dieselbe Form hat – die Zuordnung soll hier nicht die Aussage sein. */
  function bestand(ids: readonly string[]): ReadonlyMap<PhotoId, Photo> {
    return new Map(
      ids.map((id) => [
        id,
        {
          id,
          sourceId: 'q',
          relPath: `${id}.jpg`,
          fileName: `${id}.jpg`,
          bytes: 1_000_000,
          width: 4000,
          height: 3000,
          takenAt: '2020-01-01T12:00:00',
        } as Photo,
      ]),
    );
  }

  const reflow = { photos: bestand(['p1', 'p2', 'p3']), profile: defaultProfile() };
  const seite = (spreadIndex: number) => ({ kind: 'spread', spreadIndex }) as const;

  it('nimmt das Bild von der Quellseite und gibt es der Zielseite', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1), reflow);
    expect(r.ok).toBe(true);

    const auf = (i: number) => r.spreads[i]!.slots.map((s) => s.photoId).filter(Boolean);
    expect(auf(0)).toEqual(['p2']);
    expect(auf(1)).toHaveLength(2);
    expect(auf(1)).toContain('p1');
    expect(r.touched).toEqual([0, 1]);
  });

  it('ordnet beide Seiten neu an, statt ein Loch zu hinterlassen', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1), reflow);
    // Die Quellseite hat noch ein Bild und deshalb eine Einbildvorlage.
    expect(r.spreads[0]!.slots).toHaveLength(1);
    expect(r.spreads[0]!.slots.every((s) => s.photoId !== null)).toBe(true);
  });

  it('lehnt ab, wenn die Quellseite dadurch leer stünde', () => {
    // Doppelseite 2 trägt nur p3; für null Bilder gibt es keine Vorlage.
    const r = movePhoto(buch(), slot(1, 'a'), seite(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('leer');
  });

  it('holt ein Bild aus dem Pool auf die Seite', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, seite(0), {
      ...reflow,
      photos: bestand(['p1', 'p2', 'p3', 'p9']),
    });
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots.map((s) => s.photoId).filter(Boolean)).toHaveLength(3);
    expect(r.touched).toEqual([0]);
  });

  it('nimmt einen Zug auf die eigene Seite ohne Wirkung hin', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(0), reflow);
    expect(r.ok).toBe(true);
    expect(r.touched).toEqual([]);
  });

  it('meldet eine unbekannte Zielseite', () => {
    expect(movePhoto(buch(), slot(0, 'a'), seite(7), reflow).error).toContain('Doppelseite 8');
  });

  it('lehnt ein Foto ab, das nicht mehr zum Bestand gehört', () => {
    // Sonst fiele es beim Anordnen heraus: ein verlorenes Foto statt eines
    // abgelehnten Zuges.
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'weg' }, seite(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bestand');
  });

  it('verlangt den Bildbestand – ohne ihn ließe sich nichts anordnen', () => {
    const r = movePhoto(buch(), slot(0, 'a'), seite(1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bildbestand');
  });

  it('lässt eine festgehaltene Seite als Ziel und als Quelle stehen', () => {
    // Dieser Zug ordnet beide Seiten neu an und verwürfe damit genau das, wofür
    // eine Seite festgehalten wird – dieselbe Sperre wie im Stapel. Wer dort ein
    // Bild hinlegen will, zieht es auf eine Stelle (`kind: 'frei'`).
    const alsZiel = buch();
    alsZiel[1]!.locked = true;
    expect(movePhoto(alsZiel, slot(0, 'a'), seite(1), reflow).error).toContain('festgehalten');
    expect(alsZiel[1]!.slots.map((s) => s.photoId)).toEqual(['p3', null]);

    const alsQuelle = buch();
    alsQuelle[0]!.locked = true;
    expect(movePhoto(alsQuelle, slot(0, 'a'), seite(1), reflow).error).toContain('festgehalten');
  });
});

describe('movePhoto auf eine Stelle des Papiers', () => {
  function bestand(ids: readonly string[]): ReadonlyMap<PhotoId, Photo> {
    return new Map(
      ids.map((id) => [
        id,
        {
          id,
          sourceId: 'q',
          relPath: `${id}.jpg`,
          fileName: `${id}.jpg`,
          bytes: 1_000_000,
          width: 4000,
          height: 3000,
          takenAt: '2020-01-01T12:00:00',
        } as Photo,
      ]),
    );
  }

  const reflow = { photos: bestand(['p1', 'p2', 'p3', 'p9']), profile: defaultProfile() };
  const stelle = (spreadIndex: number, x = 0.5, y = 0.5) =>
    ({ kind: 'frei', spreadIndex, punkt: { x, y } }) as const;

  it('legt ein Bild aus dem Pool dazu, ohne die Anordnung anzufassen', () => {
    const vorher = buch();
    const r = movePhoto(vorher, { kind: 'pool', photoId: 'p9' }, stelle(0, 0.3, 0.6), reflow);

    expect(r.ok).toBe(true);
    // Die beiden bisherigen Bilder liegen unverändert in ihren Plätzen …
    expect(r.spreads[0]!.slots.slice(0, 2)).toEqual(vorher[0]!.slots);
    expect(r.spreads[0]!.templateId).toBe(vorher[0]!.templateId);
    // … und das neue steht als freier Platz dahinter, also obenauf.
    const neu = r.spreads[0]!.slots.at(-1)!;
    expect(neu.photoId).toBe('p9');
    expect(neu.rect).toBeDefined();
    expect(r.slotId).toBe(neu.slotId);
    expect(r.touched).toEqual([0]);
  });

  it('zählt das Bild zur Seite – die Anordnungen für eine mehr stehen danach zur Wahl', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, stelle(0), reflow);
    // Genau das ist der Zweck: Eine Seite mit zwei Bildern hat danach drei, und
    // ein Vorlagenwechsel rechnet mit dreien.
    expect(r.spreads[0]!.slots.filter((s) => s.photoId !== null)).toHaveLength(3);
  });

  it('nimmt auch eine festgehaltene Seite an', () => {
    // `locked` schützt vor der Automatik, nicht vor der eigenen Hand: Hier
    // ordnet niemand um.
    const spreads = buch();
    spreads[0]!.locked = true;
    const r = movePhoto(spreads, { kind: 'pool', photoId: 'p9' }, stelle(0), reflow);
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots).toHaveLength(3);
  });

  it('räumt den Ausgangsplatz und lässt ihn leer stehen', () => {
    const r = movePhoto(buch(), slot(0, 'a'), stelle(1), reflow);
    expect(r.ok).toBe(true);
    // Ein Platz der Vorlage bleibt – dort ist der Kasten die Anordnung.
    expect(r.spreads[0]!.slots[0]!.photoId).toBeNull();
    expect(r.spreads[1]!.slots.at(-1)!.photoId).toBe('p1');
    expect(r.touched).toEqual([0, 1]);
  });

  it('lässt einem Platz, der seine Lage selbst trägt, sein Rechteck', () => {
    // Justierte Zeilen und die wörtlich übernommene Gegenseite (`halb:leer`)
    // stehen in keiner Vorlage: Ohne `rect` gäbe `wirksamePlaetze` den Kasten
    // nicht mehr aus, und der leere Platz verschwände statt stehen zu bleiben.
    const spreads = buch();
    spreads[0]!.templateId = 'justiert.2';
    spreads[0]!.slots[0]!.rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const r = movePhoto(spreads, slot(0, 'a'), stelle(1), reflow);

    expect(r.ok).toBe(true);
    const geraeumt = r.spreads[0]!.slots[0]!;
    expect(geraeumt.photoId).toBeNull();
    expect(geraeumt.rect).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('nimmt einen frei gesetzten Ausgangsplatz ganz weg', () => {
    // Sonst bliebe ein leerer Rahmen genau dort stehen, von wo man das Bild
    // eben weggezogen hat – ein freier Platz beschreibt nichts ohne sein Bild.
    const gelegt = movePhoto(buch(), { kind: 'pool', photoId: 'p9' }, stelle(0, 0.2, 0.2), reflow);
    const frei = gelegt.slotId!;
    const r = movePhoto(gelegt.spreads, slot(0, frei), stelle(1, 0.8, 0.8), reflow);

    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots.map((s) => s.slotId)).not.toContain(frei);
    expect(r.spreads[1]!.slots.at(-1)!.photoId).toBe('p9');
  });

  it('verweigert ein Foto, das schon im Buch liegt', () => {
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'p3' }, stelle(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Doppelseite 2');
  });

  it('lehnt ein Foto ab, das nicht mehr zum Bestand gehört', () => {
    // Ohne Maße hätte der Kasten keine Form – das Bild stünde als Quadrat da.
    const r = movePhoto(buch(), { kind: 'pool', photoId: 'weg' }, stelle(0), reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bestand');
  });

  it('meldet eine unbekannte Zielseite', () => {
    expect(movePhoto(buch(), slot(0, 'a'), stelle(7), reflow).error).toContain('Doppelseite 8');
  });

  it('verlangt den Bildbestand – ohne ihn hätte der Kasten keine Form', () => {
    const r = movePhoto(buch(), slot(0, 'a'), stelle(1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bildbestand');
  });
});

describe('movePhotos – mehrere Bilder in einem Zug', () => {
  function foto(id: string): Photo {
    return {
      id,
      sourceId: 'q',
      relPath: `${id}.jpg`,
      fileName: `${id}.jpg`,
      bytes: 1_000_000,
      width: 4000,
      height: 3000,
      takenAt: '2020-01-01T12:00:00',
    } as Photo;
  }

  // Dreizehn, weil eine Auftaktseite bis zwölf Bilder trägt: Die Ablehnung
  // darüber lässt sich nur mit einem dreizehnten prüfen.
  const ALLE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'pa', 'pb', 'pc', 'pd'];
  const reflow = {
    photos: new Map(ALLE.map((id) => [id, foto(id)])) as ReadonlyMap<PhotoId, Photo>,
    profile: defaultProfile(),
  };

  /** Eine Doppelseite mit `ids` als Bildern; Slotnamen sind hier ohne Belang. */
  function seiteMit(index: number, ids: readonly string[], rest: Partial<Spread> = {}): Spread {
    return {
      id: `s${index}`,
      index,
      templateId: `spread.${ids.length}up.test`,
      slots: ids.map((id, i) => ({
        slotId: `s${i}`,
        photoId: id,
        crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
      })),
      ...rest,
    };
  }

  /** Acht Bilder auf der ersten Doppelseite, vier auf der zweiten. */
  const achtUndVier = (): Spread[] => [
    seiteMit(0, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']),
    seiteMit(1, ['p9', 'pa', 'pb', 'pc']),
  ];

  const zug = (spreadIndex: number, slotId: string, ziel: number) => ({
    source: { kind: 'slot', spreadIndex, slotId } as const,
    target: { kind: 'spread', spreadIndex: ziel } as const,
  });

  const bilderAuf = (spreads: readonly Spread[], i: number) =>
    spreads[i]!.slots.map((s) => s.photoId).filter(Boolean);

  it('macht aus acht und vier ein sechs und sechs', () => {
    const r = movePhotos(achtUndVier(), [zug(0, 's0', 1), zug(0, 's1', 1)], reflow);
    expect(r.ok).toBe(true);
    expect(bilderAuf(r.spreads, 0)).toHaveLength(6);
    expect(bilderAuf(r.spreads, 1)).toHaveLength(6);
    expect(bilderAuf(r.spreads, 1)).toContain('p1');
    expect(bilderAuf(r.spreads, 1)).toContain('p2');
    expect(r.touched).toEqual([0, 1]);
    expect(r.leer).toEqual([]);
  });

  it('ordnet die Zielseite einmal an und nicht je Bild', () => {
    // Der beobachtbare Ausdruck dafür: Die Seite hat am Ende genau so viele
    // Plätze, wie sie Bilder trägt. Nacheinander gerechnet bliebe die Vorlage
    // eines Zwischenstandes stehen, und ein Platz stünde leer.
    const r = movePhotos(achtUndVier(), [zug(0, 's0', 1), zug(0, 's1', 1)], reflow);
    expect(r.spreads[1]!.slots).toHaveLength(6);
    expect(r.spreads[1]!.slots.every((s) => s.photoId !== null)).toBe(true);
  });

  it('lässt eine leer gezogene Seite stehen und meldet sie', () => {
    const buch = [seiteMit(0, ['p1', 'p2']), seiteMit(1, ['p3'])];
    const r = movePhotos(buch, [zug(0, 's0', 1), zug(0, 's1', 1)], reflow);
    expect(r.ok).toBe(true);
    expect(r.leer).toEqual([0]);
    expect(r.spreads[0]!.templateId).toBe(BLANK_TEMPLATE_ID);
    expect(r.spreads[0]!.slots).toEqual([]);
    // Das Buch bleibt gleich lang: Herausnehmen ist eine eigene Entscheidung.
    expect(r.spreads).toHaveLength(2);
  });

  it('ordnet die Quellseite auch beim Zug in den Pool neu an', () => {
    // Anders als beim Einzelzug, der nur den Slot leert: Drei Löcher in einer
    // Achterseite wären keine Aufteilung.
    const moves = ['s0', 's1', 's2'].map((slotId) => ({
      source: { kind: 'slot', spreadIndex: 0, slotId } as const,
      target: { kind: 'pool' } as const,
    }));
    const r = movePhotos(achtUndVier(), moves, reflow);
    expect(r.ok).toBe(true);
    expect(r.spreads[0]!.slots).toHaveLength(5);
    expect(r.spreads[0]!.slots.every((s) => s.photoId !== null)).toBe(true);
    expect(r.touched).toEqual([0]);
  });

  it('holt Bilder aus dem Pool auf eine Seite', () => {
    const buch = [seiteMit(0, ['p1', 'p2']), seiteMit(1, ['p3'])];
    const moves = ['p4', 'p5'].map((photoId) => ({
      source: { kind: 'pool', photoId } as const,
      target: { kind: 'spread', spreadIndex: 1 } as const,
    }));
    const r = movePhotos(buch, moves, reflow);
    expect(r.ok).toBe(true);
    expect(bilderAuf(r.spreads, 1)).toHaveLength(3);
    expect(r.touched).toEqual([1]);
  });

  it('lehnt den ganzen Stapel ab, wenn ein Zug nicht geht', () => {
    const vorher = achtUndVier();
    const r = movePhotos(
      vorher,
      [
        zug(0, 's0', 1),
        { source: { kind: 'pool', photoId: 'weg' }, target: { kind: 'spread', spreadIndex: 1 } },
      ],
      reflow,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Bestand');
    expect(r.spreads[0]).toBe(vorher[0]);
    expect(r.spreads[1]).toBe(vorher[1]);
  });

  it('nimmt dasselbe Foto nicht zweimal in den Stapel', () => {
    const r = movePhotos(achtUndVier(), [zug(0, 's0', 1), zug(0, 's0', 1)], reflow);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('zweimal');
  });

  it('lässt unbeteiligte Doppelseiten bitweise unverändert', () => {
    const vorher = [...achtUndVier(), seiteMit(2, ['p1'])];
    vorher[2] = seiteMit(2, ['p1']);
    const r = movePhotos(vorher, [zug(0, 's0', 1)], reflow);
    expect(r.spreads[2]).toBe(vorher[2]);
  });

  it('rührt eine festgehaltene Seite nicht an', () => {
    const buch = [seiteMit(0, ['p1', 'p2']), seiteMit(1, ['p3'], { locked: true })];
    expect(movePhotos(buch, [zug(0, 's0', 1)], reflow).error).toContain('festgehalten');
    expect(movePhotos(buch, [zug(1, 's0', 0)], reflow).error).toContain('festgehalten');
  });

  /** Ein Kapitelauftakt mit `n` Bildern, samt Jahreszahl. */
  function auftaktMit(index: number, ids: readonly string[]): Spread {
    return seiteMit(index, ids, {
      templateId: 'spread.chapter.4up',
      texts: [{ id: 't', role: 'year', content: '2019', slotId: 'jahr' }],
      chapterYear: 2019,
    });
  }

  it('lässt einen Auftakt wachsen und hält ihn in seiner Familie', () => {
    // Vier auf sechs Bilder: Es gibt eine Auftaktfassung dafür, also geht der
    // Zug – und die Seite behält ihre Textplätze.
    const buch = [seiteMit(0, ['p1', 'p2', 'p3']), auftaktMit(1, ['p4', 'p5', 'p6', 'p7'])];
    const r = movePhotos(buch, [zug(0, 's0', 1), zug(0, 's1', 1)], reflow);

    expect(r.ok).toBe(true);
    expect(bilderAuf(r.spreads, 1)).toHaveLength(6);
    expect(r.spreads[1]!.templateId).toMatch(/^spread\.chapter\./);
    expect(r.spreads[1]!.texts).toHaveLength(1);
  });

  it('gibt einem Auftakt auch Bilder ab', () => {
    const buch = [seiteMit(0, ['p1', 'p2']), auftaktMit(1, ['p3', 'p4', 'p5', 'p6'])];
    const r = movePhotos(buch, [zug(1, 's0', 0)], reflow);

    expect(r.ok).toBe(true);
    expect(bilderAuf(r.spreads, 1)).toHaveLength(3);
    expect(r.spreads[1]!.templateId).toMatch(/^spread\.chapter\./);
  });

  it('nimmt einem Jahresauftakt auch fünf Bilder ab', () => {
    // Vorher lag zwischen dem Vierer und dem Sechser nichts, und derselbe Zug
    // wurde abgelehnt. Seit es Fassungen für jede Bilderzahl gibt, geht er –
    // und die Seite behält ihre Textplätze.
    const buch = [seiteMit(0, ['p1', 'p2']), auftaktMit(1, ['p3', 'p4', 'p5', 'p6'])];
    const r = movePhotos(buch, [zug(0, 's0', 1)], reflow);

    expect(r.ok).toBe(true);
    expect(bilderAuf(r.spreads, 1)).toHaveLength(5);
    expect(r.spreads[1]!.templateId).toMatch(/^spread\.chapter\./);
    expect(r.spreads[1]!.texts).toHaveLength(1);
  });

  it('lehnt eine Bilderzahl ab, für die es keine Auftaktfassung gibt', () => {
    // Dreizehn Bilder: Bei zwölf hört die Familie auf. Weil die Zahlen darunter
    // lückenlos abgedeckt sind, nennt die Meldung die Grenze und nicht die
    // Aufzählung – „0, 1, 2, 3 … 12 Bilder" wäre eine Zahlenreihe.
    const buch = [seiteMit(0, ['p1']), auftaktMit(1, ALLE.slice(1, 13))];
    const r = movePhotos(buch, [zug(0, 's0', 1)], reflow);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('Auftaktseite trägt höchstens 12 Bilder');
    expect(r.spreads[1]!.slots).toHaveLength(12);
  });

  it('nimmt einen leeren Stapel ohne Wirkung hin', () => {
    const r = movePhotos(achtUndVier(), [], reflow);
    expect(r.ok).toBe(true);
    expect(r.touched).toEqual([]);
  });
});
