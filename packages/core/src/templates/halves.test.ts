import { describe, expect, it } from 'vitest';
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop } from '../model/crop.js';
import {
  allTemplates,
  libraryHalves,
  requireTemplate,
  templateById,
  templateMeta,
} from './index.js';
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

  it('bietet für jede Bilderzahl von 1 bis 14 mindestens drei Anordnungen', () => {
    // Die Zerlegung der Vorlagen allein reichte nicht: Für sieben und acht
    // Bilder gab sie je genau eine Anordnung her, für dreizehn keine einzige.
    // Wer eine solche Seite von Hand anordnen wollte, hatte damit keine Wahl,
    // sondern eine Bestätigung – deshalb führt die Bibliothek unter `halves`
    // eigens entworfene Hälften. Vierzehn ist die Obergrenze, weil keine
    // Vorlage mehr Bilder auf eine Buchseite legt.
    for (let n = 1; n <= 14; n++) {
      const passend = halfPages().filter((h) => h.slots.length === n);
      expect(passend.length, `nur ${passend.length} Anordnungen für ${n} Bilder`).toBeGreaterThan(
        2,
      );
    }
  });

  it('hält auch die entworfenen Halbseiten in der Nutzfläche und über der Mindestauflösung', () => {
    // Sie stehen als Millimeter in `library.json` und laufen nicht durch die
    // Prüfungen von `library.test.ts`, weil sie keine Doppelseite sind. Was für
    // einen Slot einer Vorlage gilt, gilt für sie genauso.
    const SPREAD_W = 600;
    const PAGE_H = 300;
    for (const h of libraryHalves()) {
      for (const s of h.slots) {
        expect(s.x * SPREAD_W, `${h.id}/${s.id} links`).toBeGreaterThanOrEqual(8);
        expect(s.y * PAGE_H, `${h.id}/${s.id} oben`).toBeGreaterThanOrEqual(8);
        // In Linksform: rechts endet die Nutzfläche vor der Falzzone.
        expect((s.x + s.w) * SPREAD_W, `${h.id}/${s.id} Falz`).toBeLessThanOrEqual(293);
        // Der Zeitstrahl belegt die 14 mm unter 278.
        expect((s.y + s.h) * PAGE_H, `${h.id}/${s.id} Fußraum`).toBeLessThanOrEqual(278.001);

        // Mindestauflösung mit dem schlechtesten Format, das dieser Platz
        // erwarten darf – gerechnet wie in `library.test.ts`.
        const wMm = s.w * SPREAD_W;
        const hMm = s.h * PAGE_H;
        const formate = [
          { w: 2048, h: 1536 },
          { w: 2048, h: 1152 },
          { w: 1536, h: 2048 },
          { w: 1152, h: 2048 },
        ].filter((f) => {
          const quer = f.w > f.h;
          if (s.prefers === 'landscape') return quer;
          if (s.prefers === 'portrait') return !quer;
          return true;
        });
        for (const f of formate) {
          const crop = coverCrop(f.w / f.h, wMm / hMm);
          expect(
            effectiveDpi(crop.w * f.w, wMm),
            `${h.id}/${s.id} mit ${f.w}×${f.h}`,
          ).toBeGreaterThanOrEqual(240);
        }
      }
    }
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
