import { describe, expect, it } from 'vitest';
import type { Spread } from '../model/spread.js';
import { vergleicheAnordnung } from './vergleich.js';

const AUTO = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Eine Doppelseite mit diesen Bildern, in dieser Reihenfolge. */
function seite(index: number, photoIds: (string | null)[], templateId = 'spread.2up.pair'): Spread {
  return {
    id: `s${index}`,
    index,
    templateId,
    slots: photoIds.map((photoId, i) => ({
      slotId: String.fromCharCode(97 + i),
      photoId,
      crop: { ...AUTO },
    })),
  };
}

describe('vergleicheAnordnung', () => {
  it('meldet ein unverändertes Buch als unverändert', () => {
    const buch = [seite(0, ['p1', 'p2']), seite(1, ['p3', 'p4'])];
    const v = vergleicheAnordnung(buch, buch);

    expect(v.gleich).toBe(2);
    expect(v.geaendert).toBe(0);
    expect(v.neu).toBe(0);
    expect(v.entfallen).toBe(0);
    expect(v.seiten.every((s) => s.art === 'gleich')).toBe(true);
  });

  it('unterscheidet eine andere Vorlage von anderen Bildern', () => {
    const alt = [seite(0, ['p1', 'p2']), seite(1, ['p3', 'p4'])];
    const neu = [seite(0, ['p1', 'p2'], 'spread.2up.stack'), seite(1, ['p3', 'p9'])];
    const v = vergleicheAnordnung(alt, neu);

    expect(v.seiten[0]?.art).toBe('vorlage');
    expect(v.seiten[1]?.art).toBe('fotos');
    expect(v.seiten[1]?.zugegangen).toEqual(['p9']);
    expect(v.seiten[1]?.abgegangen).toEqual(['p4']);
    expect(v.geaendert).toBe(2);
  });

  it('erkennt getauschte Plätze als andere Anordnung, nicht als andere Bilder', () => {
    const v = vergleicheAnordnung([seite(0, ['p1', 'p2'])], [seite(0, ['p2', 'p1'])]);

    expect(v.seiten[0]?.art).toBe('vorlage');
    expect(v.seiten[0]?.zugegangen).toEqual([]);
    expect(v.seiten[0]?.abgegangen).toEqual([]);
  });

  /**
   * Der Fall, für den der Vergleich über die Bilder läuft: Eine eingeschobene
   * Doppelseite verschiebt alles dahinter. Nach Nummer verglichen wäre jede
   * Seite geändert; in Wahrheit ist eine neu und der Rest gerutscht.
   */
  it('folgt einer Doppelseite, die im Buch verrutscht', () => {
    const alt = [seite(0, ['p1', 'p2']), seite(1, ['p3', 'p4'])];
    const neu = [seite(0, ['p9']), seite(1, ['p1', 'p2']), seite(2, ['p3', 'p4'])];
    const v = vergleicheAnordnung(alt, neu);

    expect(v.neu).toBe(1);
    expect(v.gleich).toBe(2);
    expect(v.verschoben).toBe(2);
    expect(v.seiten.map((s) => s.altIndex)).toEqual([null, 0, 1]);
  });

  it('meldet eine weggefallene Doppelseite an ihrer alten Stelle', () => {
    const alt = [seite(0, ['p1']), seite(1, ['p2']), seite(2, ['p3'])];
    const neu = [seite(0, ['p1']), seite(1, ['p3'])];
    const v = vergleicheAnordnung(alt, neu);

    expect(v.entfallen).toBe(1);
    const weg = v.seiten.find((s) => s.art === 'entfaellt');
    expect(weg?.altIndex).toBe(1);
    expect(weg?.abgegangen).toEqual(['p2']);
    expect(v.ausDemBuch).toEqual(['p2']);
  });

  it('nennt die Bilder, die neu ins Buch kommen und die herausfallen', () => {
    const v = vergleicheAnordnung([seite(0, ['p1', 'p2'])], [seite(0, ['p1', 'p3'])]);

    expect(v.insBuch).toEqual(['p3']);
    expect(v.ausDemBuch).toEqual(['p2']);
  });

  /**
   * Eine Auftaktseite trägt oft kein Bild, über das sie sich wiederfinden
   * ließe. Ohne den zweiten Durchgang stünde sie als „entfällt" neben einem
   * „neu", das dieselbe Seite ist.
   */
  it('findet eine bildlose Auftaktseite über ihre Vorlage wieder', () => {
    const auftakt = (index: number): Spread => ({
      ...seite(index, [], 'spread.chapter.opener'),
      chapterYear: 2019,
    });
    const alt = [auftakt(0), seite(1, ['p1'])];
    const neu = [seite(0, ['p9']), auftakt(1), seite(2, ['p1'])];
    const v = vergleicheAnordnung(alt, neu);

    expect(v.entfallen).toBe(0);
    expect(v.seiten.find((s) => s.neuIndex === 1)?.altIndex).toBe(0);
  });

  it('meldet festgehaltene Doppelseiten als solche', () => {
    const fest: Spread = { ...seite(0, ['p1']), locked: true };
    const v = vergleicheAnordnung([fest, seite(1, ['p2'])], [fest, seite(1, ['p2'])]);

    expect(v.festgehalten).toBe(1);
    expect(v.seiten[0]?.locked).toBe(true);
  });

  it('kommt mit einem leeren Buch auf beiden Seiten zurecht', () => {
    const v = vergleicheAnordnung([], []);
    expect(v.seiten).toEqual([]);
    expect(v.gleich).toBe(0);
  });
});
