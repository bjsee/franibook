import { describe, expect, it } from 'vitest';
import {
  chapterHalfById,
  chapterHalfOfTemplate,
  chapterHalves,
  chapterPairId,
  CHAPTER_HALF_PREFIX,
} from './chapter-halves.js';
import { halfPages } from './halves.js';
import { allTemplates, requireTemplate, templateById, templateMeta } from './index.js';

/** Die Jahresseiten der Bibliothek, ohne die veralteten. */
function auftakte() {
  return allTemplates().filter(
    (t) => templateMeta(t.id).chapterOnly && !t.tags?.includes('veraltet'),
  );
}

describe('Die Textseite einer Jahresseite', () => {
  it('leitet sich aus jeder Auftaktvorlage ab', () => {
    const halves = chapterHalves();
    expect(halves.length).toBeGreaterThan(0);
    for (const h of halves) {
      expect(h.id.startsWith(CHAPTER_HALF_PREFIX)).toBe(true);
      expect(h.textSlots.length).toBeGreaterThan(0);
    }
  });

  it('steht in Linksform, gleich ob die Vorlage das Jahr links oder rechts trägt', () => {
    // Die Bibliothek spiegelt jede unsymmetrische Vorlage, und dabei wandern die
    // Textplätze mit. In Linksform fallen beide Fassungen zu einer Textseite
    // zusammen — auf welcher Buchseite sie steht, sagt die Kennung der
    // Doppelseite.
    for (const h of chapterHalves()) {
      for (const s of [...h.slots, ...h.textSlots]) expect(s.x + s.w).toBeLessThanOrEqual(0.5001);
      expect(h.textSlots.some((t) => t.role === 'year')).toBe(true);
    }
  });

  it('wird für jede Auftaktvorlage gefunden – auch vor dem ersten Griff', () => {
    // Die Oberfläche zeigt damit, was links gerade steht, ohne dass jemals
    // seitenweise gewählt wurde.
    for (const t of auftakte()) {
      expect(chapterHalfOfTemplate(t), `keine Textseite für ${t.id}`).toBeDefined();
    }
  });
});

describe('Eine zusammengesetzte Jahresseite', () => {
  const links = chapterHalves()[0]!;
  const rechts = halfPages().find((h) => h.slots.length === 4)!;
  const id = chapterPairId(links.id, rechts.id);

  it('behält die Kennungen ihrer Textplätze', () => {
    // Daran hängen die Texte der Doppelseite (`TextElement.slotId`). Ein
    // Umbenennen wie bei den Bildplätzen nähme ihr die Jahreszahl, ohne dass
    // etwas meldet: Ein Text ohne Platz wird schlicht nicht gezeichnet.
    const t = requireTemplate(id);
    expect((t.textSlots ?? []).map((s) => s.id)).toEqual(links.textSlots.map((s) => s.id));
  });

  it('führt die Bildplätze beider Hälften unterscheidbar', () => {
    const t = requireTemplate(id);
    expect(t.slots).toHaveLength(links.slots.length + rechts.slots.length);
    expect(t.slots.filter((s) => s.id.startsWith('l-'))).toHaveLength(links.slots.length);
    expect(t.slots.filter((s) => s.id.startsWith('r-'))).toHaveLength(rechts.slots.length);
    // Die rechte Hälfte wird gespiegelt, nicht verschoben – wie bei `pairTemplate`.
    for (const s of t.slots.filter((x) => x.id.startsWith('r-'))) {
      expect(s.x).toBeGreaterThanOrEqual(0.4999);
    }
  });

  it('bleibt eine Jahresseite', () => {
    // Sonst bekäme sie Seitenzahlen, stünde in der Vorlagenwahl des Flusses und
    // nähme Bilder an wie eine gewöhnliche Doppelseite.
    expect(templateMeta(id).chapterOnly).toBe(true);
  });

  it('meldet sich als unauflösbar, wenn eine Hälfte fehlt', () => {
    expect(templateById(chapterPairId('jahrseite:gibt.es.nicht', rechts.id))).toBeUndefined();
    expect(templateById(chapterPairId(links.id, 'halb:gibt.es.nicht'))).toBeUndefined();
  });

  it('findet ihre Textseite zurück, samt Buchseite', () => {
    expect(chapterHalfOfTemplate(requireTemplate(id))).toEqual({ id: links.id, seite: 'left' });
    expect(chapterHalfById(links.id)?.from).toBeDefined();
  });

  it('trägt die Textplätze auch, wenn die Textseite rechts steht', () => {
    const gespiegelt = requireTemplate(chapterPairId(rechts.id, links.id));
    expect((gespiegelt.textSlots ?? []).map((s) => s.id)).toEqual(links.textSlots.map((s) => s.id));
    // Gespiegelt und nicht verschoben: Der Text steht jetzt auf der rechten Seite.
    for (const s of gespiegelt.textSlots ?? []) expect(s.x).toBeGreaterThanOrEqual(0.4999);
    expect(chapterHalfOfTemplate(gespiegelt)).toEqual({ id: links.id, seite: 'right' });
  });
});
