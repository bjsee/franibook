import { describe, expect, it } from 'vitest';
import { allTemplates, requireTemplate, templateById, templateMeta } from './index.js';
import { halfPages, halvesOfTemplate, pairId, pairTemplate, splitPairId } from './halves.js';

describe('Halbseiten', () => {
  it('zerlegt jede Vorlage des Flusses an der Falzachse', () => {
    // Die Zusage, auf der alles Weitere steht: Kein Slot liegt über dem Falz,
    // sonst ließe sich die Seite nicht einzeln ändern, ohne ein Bild zu
    // zerschneiden.
    const fluss = allTemplates().filter((t) => {
      const meta = templateMeta(t.id);
      return !meta.chapterOnly && !t.tags?.includes('gruppenauftakt');
    });

    for (const t of fluss) {
      const links = t.slots.filter((s) => s.x + s.w <= 0.5001).length;
      const rechts = t.slots.filter((s) => s.x >= 0.4999).length;
      expect(links + rechts, `${t.id} hat einen Slot über dem Falz`).toBe(t.slots.length);
    }
  });

  it('bietet jede Anordnung nur einmal an', () => {
    const ids = halfPages().map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(halfPages().length).toBeGreaterThan(20);
  });

  it('führt alle Halbseiten in Linksform', () => {
    for (const h of halfPages()) {
      for (const s of h.slots) {
        expect(s.x + s.w, `${h.id} ragt über die Falzachse`).toBeLessThanOrEqual(0.5001);
      }
    }
  });

  it('setzt zwei Hälften zu einer Doppelseite zusammen', () => {
    const eins = halfPages().find((h) => h.slots.length === 1)!;
    const zwei = halfPages().find((h) => h.slots.length === 2)!;
    const t = pairTemplate(pairId(eins.id, zwei.id))!;

    expect(t.slots).toHaveLength(3);
    // Die rechte Hälfte wird gespiegelt, nicht verschoben: Eine Seite hat außen
    // mehr Rand als am Falz.
    const links = t.slots.filter((s) => s.x + s.w <= 0.5001);
    const rechts = t.slots.filter((s) => s.x >= 0.4999);
    expect(links).toHaveLength(1);
    expect(rechts).toHaveLength(2);
  });

  it('vergibt eindeutige Slotkennungen über beide Hälften', () => {
    // Zweimal dieselbe Hälfte: Ohne Präfix hießen alle Slots gleich, und ein
    // Ausschnitt wäre nicht mehr einem Bild zuzuordnen.
    const eine = halfPages().find((h) => h.slots.length === 2)!;
    const t = pairTemplate(pairId(eine.id, eine.id))!;
    const ids = t.slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('löst eine Paarkennung über die Bibliothek auf', () => {
    const eins = halfPages().find((h) => h.slots.length === 1)!;
    const id = pairId(eins.id, eins.id);
    expect(templateById(id)?.slots).toHaveLength(2);
    expect(requireTemplate(id).id).toBe(id);
  });

  it('gibt bei unbekannter Hälfte nichts zurück, statt eine halbe Seite zu bauen', () => {
    expect(templateById('paar:halb:gibtsnicht:L+halb:auchnicht:R')).toBeUndefined();
    expect(splitPairId('spread.4up.grid')).toBeUndefined();
  });

  it('erkennt die Hälften einer gewöhnlichen Doppelseite wieder', () => {
    // Damit die Oberfläche auch ohne vorherige Handarbeit zeigen kann, welche
    // Anordnung links und rechts steht.
    const t = requireTemplate('spread.4up.grid');
    const h = halvesOfTemplate(t);
    expect(h.left).toBeDefined();
    expect(h.right).toBeDefined();
  });

  it('liest die Hälften einer zusammengesetzten Seite aus ihrer Kennung', () => {
    const eins = halfPages().find((h) => h.slots.length === 1)!;
    const zwei = halfPages().find((h) => h.slots.length === 2)!;
    const t = pairTemplate(pairId(eins.id, zwei.id))!;
    expect(halvesOfTemplate(t)).toEqual({ left: eins.id, right: zwei.id });
  });
});
