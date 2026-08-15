import { describe, expect, it } from 'vitest';
import type { Spread } from '../model/spread.js';
import { ankerNeben, insertKept, keptOpeners, keptPhotos, splitKept } from './keep.js';

const AUTO = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Eine Doppelseite des Flusses mit diesen Bildern. */
function fluss(id: string, index: number, photoIds: (string | null)[]): Spread {
  return {
    id,
    index,
    templateId: 'spread.2up.pair',
    slots: photoIds.map((photoId, i) => ({
      slotId: String.fromCharCode(97 + i),
      photoId,
      crop: { ...AUTO },
    })),
  };
}

/** Eine selbst gebaute Seite: festgehalten, ohne Bildplatz, mit Textblock. */
function eigen(id: string, index: number, anchor?: Spread['anchor']): Spread {
  return {
    id,
    index,
    templateId: 'spread.leer',
    slots: [],
    locked: true,
    ...(anchor ? { anchor } : {}),
    blocks: [
      {
        id: `${id}-t1`,
        content: 'Einschulung',
        rect: { x: 0.1, y: 0.4, w: 0.3, h: 0.1 },
        weight: 'semibold',
        fontSizePt: 28,
        align: 'left',
      },
    ],
  };
}

describe('splitKept', () => {
  it('trennt festgehaltene Doppelseiten vom Fluss', () => {
    const { kept, flow } = splitKept([
      fluss('s0', 0, ['p1']),
      eigen('e1', 1),
      fluss('s2', 2, ['p2']),
    ]);
    expect(kept.map((s) => s.id)).toEqual(['e1']);
    expect(flow.map((s) => s.id)).toEqual(['s0', 's2']);
  });
});

describe('keptPhotos', () => {
  it('sammelt Bilder aus Slots und Hintergrund', () => {
    const seite: Spread = {
      ...fluss('e1', 0, ['p1', null]),
      locked: true,
      backgroundPhotoId: 'p9',
    };
    expect([...keptPhotos([seite])].sort()).toEqual(['p1', 'p9']);
  });
});

describe('keptOpeners', () => {
  const gruppeVon = new Map([
    ['p1', 'reise'],
    ['p2', 'reise'],
  ]);

  it('nennt das Jahr einer festgehaltenen Jahresseite', () => {
    const seite: Spread = { ...fluss('e1', 0, []), locked: true, chapterYear: 2019 };
    const { years } = keptOpeners([seite], new Map());
    expect([...years]).toEqual([2019]);
  });

  it('erkennt die Gruppe eines Auftakts an seinem Bild, nicht am Titel', () => {
    // Der Titel ist editierbar: Wer „Reise" in „Sylt 2019" umbenennt, hätte bei
    // einem Textvergleich einen zweiten Auftakt bekommen.
    const seite: Spread = {
      ...fluss('e1', 0, ['p1']),
      templateId: 'spread.group.opener',
      locked: true,
      texts: [{ id: 't', role: 'eventTitle', content: 'Sylt 2019', slotId: 't-title' }],
    };
    const { groups } = keptOpeners([seite], gruppeVon);
    expect([...groups]).toEqual(['reise']);
  });

  it('hält eine gewöhnliche Doppelseite nicht für einen Auftakt', () => {
    const seite: Spread = { ...fluss('e1', 0, ['p1', 'p2']), locked: true };
    const { years, groups } = keptOpeners([seite], gruppeVon);
    expect(years.size).toBe(0);
    expect(groups.size).toBe(0);
  });
});

describe('insertKept', () => {
  it('setzt eine Seite vor die Doppelseite mit ihrem Ankerfoto', () => {
    const flow = [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2']), fluss('s2', 2, ['p3'])];
    const kept = [eigen('e1', 99, { photoId: 'p2', where: 'before' })];

    expect(insertKept(flow, kept).map((s) => s.id)).toEqual(['s0', 'e1', 's1', 's2']);
  });

  it('setzt sie hinter die Doppelseite, wenn der Anker es sagt', () => {
    const flow = [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2'])];
    const kept = [eigen('e1', 0, { photoId: 'p1', where: 'after' })];

    expect(insertKept(flow, kept).map((s) => s.id)).toEqual(['s0', 'e1', 's1']);
  });

  it('folgt dem Anker, auch wenn das Buch kürzer geworden ist', () => {
    // Genau der Fall, für den es den Anker gibt: Die eigene Seite stand vor
    // Doppelseite 5, im neuen Buch beginnt das Ereignis schon bei 1.
    const flow = [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2'])];
    const kept = [eigen('e1', 5, { photoId: 'p2', where: 'before' })];

    expect(insertKept(flow, kept).map((s) => s.id)).toEqual(['s0', 'e1', 's1']);
  });

  it('fällt auf den gespeicherten Index zurück, wenn das Ankerfoto fehlt', () => {
    const flow = [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2'])];
    const kept = [eigen('e1', 1, { photoId: 'weg', where: 'before' })];

    expect(insertKept(flow, kept).map((s) => s.id)).toEqual(['s0', 'e1', 's1']);
  });

  it('klemmt einen Index jenseits des Buchendes auf die letzte Stelle', () => {
    const flow = [fluss('s0', 0, ['p1'])];
    expect(insertKept(flow, [eigen('e1', 42)]).map((s) => s.id)).toEqual(['s0', 'e1']);
  });

  it('behält Vorlage, Textblöcke und das Schloss', () => {
    const ergebnis = insertKept([fluss('s0', 0, ['p1'])], [eigen('e1', 0)]);
    const seite = ergebnis[0]!;
    expect(seite.templateId).toBe('spread.leer');
    expect(seite.blocks?.[0]?.content).toBe('Einschulung');
    expect(seite.locked).toBe(true);
  });

  it('zählt die Indizes über das gemischte Buch durch', () => {
    const flow = [fluss('s0', 0, ['p1']), fluss('s1', 1, ['p2'])];
    const kept = [eigen('e1', 0, { photoId: 'p2', where: 'before' })];

    expect(insertKept(flow, kept).map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('reiht mehrere Seiten an derselben Stelle in ihrer bisherigen Ordnung', () => {
    const flow = [fluss('s0', 0, ['p1'])];
    const kept = [
      eigen('e1', 0, { photoId: 'p1', where: 'before' }),
      eigen('e2', 1, { photoId: 'p1', where: 'before' }),
    ];

    expect(insertKept(flow, kept).map((s) => s.id)).toEqual(['e1', 'e2', 's0']);
  });

  it('nummeriert auch ohne festgehaltene Seiten durch', () => {
    const flow = [fluss('s0', 7, ['p1']), fluss('s1', 9, ['p2'])];
    expect(insertKept(flow, []).map((s) => s.index)).toEqual([0, 1]);
  });
});

describe('insertKept ohne brauchbaren Anker', () => {
  /**
   * Der Fehler, der ein ganzes Buch verdrehte: Zeigt der Anker einer
   * festgehaltenen Seite auf ein Foto, das selbst auf einer festgehaltenen
   * Seite liegt, findet ihn der Fluss nie — dann zählt der gespeicherte Index.
   * Der meint Blätter des ganzen Buches, `flow` enthält die festgehaltenen
   * aber nicht.
   */
  it('rechnet den Buchindex in eine Stelle im Fluss um', () => {
    // Altes Buch: eigen, fluss, eigen, fluss, eigen, fluss (Index 0..5).
    const eigen0 = { ...eigen('e0', 0), anchor: { photoId: 'weg', where: 'before' as const } };
    const eigen2 = { ...eigen('e2', 2), anchor: { photoId: 'weg', where: 'before' as const } };
    const eigen4 = { ...eigen('e4', 4), anchor: { photoId: 'weg', where: 'before' as const } };
    const flow = [fluss('f1', 0, ['p1']), fluss('f3', 1, ['p3']), fluss('f5', 2, ['p5'])];

    const gebaut = insertKept(flow, [eigen0, eigen2, eigen4]);

    // Jede eigene Seite steht wieder vor ihrer Flussseite – und nicht alle drei
    // am Anfang, wie es der rohe Buchindex ergäbe.
    expect(gebaut.map((s) => s.id)).toEqual(['e0', 'f1', 'e2', 'f3', 'e4', 'f5']);
  });
});

describe('ankerNeben', () => {
  const buch = [
    fluss('s0', 0, ['p1', 'p2']),
    fluss('s1', 1, ['p3', 'p4']),
    fluss('s2', 2, ['p5', 'p6']),
  ];

  /**
   * Der Fall, für den es die Funktion gibt: Eine behaltene Seite soll dort
   * stehen bleiben, wo sie im Buch steht – und nicht auf ihrer alten Nummer,
   * die nach einer eingeschobenen Seite auf ein anderes Kapitel zeigt.
   */
  it('zeigt vor das erste Bild der Seite an dieser Stelle', () => {
    expect(ankerNeben(buch, 1)).toEqual({ photoId: 'p3', where: 'before' });
  });

  /**
   * Für eine Seite, die selbst schon dort steht: Sie gehört in `ausgenommen`,
   * dann zeigt der Anker auf ihre Nachbarin.
   */
  it('überspringt die eigene Seite', () => {
    expect(ankerNeben(buch, 1, new Set([1]))).toEqual({ photoId: 'p5', where: 'before' });
  });

  it('hängt am Ende des Buches hinter das letzte Bild der vorigen Seite', () => {
    expect(ankerNeben(buch, 3)).toEqual({ photoId: 'p6', where: 'after' });
  });

  it('überspringt Seiten, die selbst nicht im Fluss laufen', () => {
    // Die folgende Seite wird ebenfalls behalten – ihre Bilder sind vergeben
    // und taugen deshalb nicht als Anker im neuen Fluss.
    expect(ankerNeben(buch, 1, new Set([1]))).toEqual({ photoId: 'p5', where: 'before' });
  });

  it('gibt nichts zurück, wenn keine Nachbarseite ein Bild hat', () => {
    expect(ankerNeben([fluss('s0', 0, [null])], 0)).toBeUndefined();
  });
});
