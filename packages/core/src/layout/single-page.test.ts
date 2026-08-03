import { describe, expect, it } from 'vitest';
import type { PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { HALF_BLANK_ID, HALF_ONE_ID, halvesOfTemplate } from '../templates/halves.js';
import { requireTemplate } from '../templates/index.js';
import { insertSinglePage, zerlegbar } from './single-page.js';

const AUTO = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Ein Blatt aus der Bibliothek, jeder Platz belegt. */
function blatt(id: string, templateId: string, ab: number): Spread {
  const template = requireTemplate(templateId);
  return {
    id,
    index: 0,
    templateId,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: `p${ab + i}`,
      crop: { ...AUTO },
    })),
  };
}

/** Ein Jahresauftakt – nicht zerlegbar, weil sein Text an Textplätzen hängt. */
function auftakt(id: string): Spread {
  return {
    id,
    index: 0,
    templateId: 'spread.chapter.quiet',
    slots: [],
    texts: [{ id: `${id}-y`, role: 'year', content: '2019', slotId: 't-year' }],
  };
}

/** Alle Fotos eines Buches in Buchreihenfolge. */
function fotos(spreads: readonly Spread[]): PhotoId[] {
  return spreads.flatMap((s) =>
    s.slots.map((sl) => sl.photoId).filter((id): id is PhotoId => id !== null),
  );
}

describe('zerlegbar', () => {
  it('erkennt eine gewöhnliche Doppelseite als zerlegbar', () => {
    expect(zerlegbar(blatt('s0', 'spread.4up.grid', 0))).toBe(true);
  });

  it('lässt Auftakte, justierte Zeilen und Hintergrundbilder ganz', () => {
    expect(zerlegbar(auftakt('a0'))).toBe(false);
    expect(zerlegbar({ ...blatt('s0', 'spread.4up.grid', 0), templateId: 'justiert.12' })).toBe(
      false,
    );
    expect(zerlegbar({ ...blatt('s0', 'spread.4up.grid', 0), backgroundPhotoId: 'p99' })).toBe(
      false,
    );
  });
});

describe('insertSinglePage', () => {
  const buch = () => [
    blatt('s0', 'spread.2up.pair', 0),
    blatt('s1', 'spread.2up.pair', 2),
    blatt('s2', 'spread.2up.pair', 4),
  ];

  it('verliert bei der Umpaarung kein Foto und behält die Reihenfolge', () => {
    // Der Kern: Eine eingeschobene Seite verschiebt die Blattgrenzen, nicht die
    // Fotoverteilung. Kein Slot der Flussvorlagen liegt über dem Falz, deshalb
    // ist die Zerlegung verlustfrei.
    const vorher = fotos(buch());
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.ok).toBe(true);
    expect(fotos(r.spreads)).toEqual(vorher);
  });

  it('setzt die neue Seite an die verlangte Buchseite', () => {
    // Buchseite 3 (nullbasiert) ist die rechte Seite des zweiten Blattes.
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    const eigen = r.spreads.find((s) => s.id === 'eigen-1');
    expect(eigen).toBeDefined();
    expect(r.spreads.indexOf(eigen!)).toBe(1);
    // Links das erste Bild des zweiten Blattes, rechts die eigene, leere Seite.
    const halves = halvesOfTemplate(requireTemplate(eigen!.templateId));
    expect(halves.right).toBe(HALF_BLANK_ID);
    expect(eigen!.slots.filter((s) => s.photoId).length).toBe(1);
  });

  it('macht das Buch um ein Blatt länger, wenn die Seiten nicht mehr aufgehen', () => {
    // Sechs Buchseiten plus eine ergeben sieben – das letzte Blatt bleibt
    // halb leer, und die Seitenzahl bleibt gerade.
    const r = insertSinglePage(buch(), { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    expect(r.spreads).toHaveLength(4);
    expect(r.bericht?.leerseiten).toBe(1);
  });

  it('hält die neue Seite fest', () => {
    const r = insertSinglePage(buch(), { atPage: 2, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    expect(r.spreads.find((s) => s.id === 'eigen-1')?.locked).toBe(true);
  });

  it('nimmt Textblöcke der neuen Seite mit', () => {
    const r = insertSinglePage(buch(), {
      atPage: 2,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
      blocks: [
        {
          id: 't1',
          content: 'Einschulung',
          rect: { x: 0.08, y: 0.4, w: 0.3, h: 0.1 },
          weight: 'semibold',
          fontSizePt: 28,
          align: 'left',
        },
      ],
    });
    expect(r.spreads.find((s) => s.id === 'eigen-1')?.blocks?.[0]?.content).toBe('Einschulung');
  });

  it('legt einen Bildplatz an, wenn die Halbseite einen hat', () => {
    const r = insertSinglePage(buch(), { atPage: 2, halfId: HALF_ONE_ID, id: 'eigen-1' });
    const eigen = r.spreads.find((s) => s.id === 'eigen-1')!;
    // Ein leerer Platz, den man selbst füllt – kein automatisch zugeteiltes Bild.
    expect(eigen.slots.filter((s) => s.photoId === null)).toHaveLength(1);
  });

  it('stellt die Parität vor einem unzerlegbaren Blatt wieder her', () => {
    // Genau der Punkt, der den Eingriff lokal hält: Vor dem Auftakt schiebt
    // eine leere Halbseite auf, dahinter ist das Buch unverändert.
    const mitAuftakt = [
      blatt('s0', 'spread.2up.pair', 0),
      auftakt('a1'),
      blatt('s2', 'spread.2up.pair', 2),
    ];
    const r = insertSinglePage(mitAuftakt, {
      atPage: 1,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
    });

    expect(r.ok).toBe(true);
    // Der Auftakt bleibt ganz und trägt seinen Text weiter.
    const gefunden = r.spreads.find((s) => s.templateId === 'spread.chapter.quiet');
    expect(gefunden?.texts?.[0]?.content).toBe('2019');
    expect(r.bericht?.leerseiten).toBeGreaterThan(0);
    expect(fotos(r.spreads)).toEqual(fotos(mitAuftakt));
  });

  it('trägt Ausschnitt, Neigung und freie Position durch die Umpaarung', () => {
    const quelle = buch();
    quelle[1]!.slots[0] = {
      slotId: quelle[1]!.slots[0]!.slotId,
      photoId: 'p2',
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' },
      rotateDeg: 1.7,
      rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    };

    const r = insertSinglePage(quelle, { atPage: 1, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    const wieder = r.spreads.flatMap((s) => s.slots).find((s) => s.photoId === 'p2');

    expect(wieder?.crop.mode).toBe('manual');
    expect(wieder?.rotateDeg).toBe(1.7);
    // Die Seite hat gewechselt, also ist die freie Position gespiegelt – der
    // Außenrand bleibt außen, wie bei jeder Halbseite.
    expect(wieder?.rect).toEqual({ x: 1 - 0.1 - 0.3, y: 0.1, w: 0.3, h: 0.3 });
  });

  it('weist eine unbekannte Halbseite ab, statt ein halbes Blatt zu bauen', () => {
    const r = insertSinglePage(buch(), { atPage: 0, halfId: 'halb:gibt-es-nicht', id: 'e' });
    expect(r.ok).toBe(false);
    expect(r.spreads).toHaveLength(3);
  });

  it('zählt die Indizes über das neue Buch durch', () => {
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    expect(r.spreads.map((s) => s.index)).toEqual(r.spreads.map((_, i) => i));
  });
});
