import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import { buildStructure } from '../structure/segment.js';
import { requireTemplate, supportedSlotCounts, templateById } from '../templates/index.js';
import { distributeBudget, groupChapter } from './grouping.js';
import { assign, slotCost, slotGeometry } from './scoring.js';
import { generateBook } from './generate.js';

const profile = saal as PrintProfile;

function photo(id: string, w = 2048, h = 1536): Photo {
  return {
    id,
    relPath: `${id}.jpeg`,
    fileName: `${id}.jpeg`,
    bytes: 800_000,
    width: w,
    height: h,
    orientation: 1,
  };
}

/**
 * Baut einen realistischen Bestand.
 *
 * Wichtig: Die laufende Nummer der Kennung entspricht der chronologischen
 * Reihenfolge. Nur so lässt sich später prüfen, ob die Engine die Chronologie
 * einhält.
 */
function buildBestand(perYear: Record<number, number>, monatsSpanne = 12) {
  const photos = new Map<string, Photo>();
  const dated: { id: string; date: string }[] = [];
  let n = 0;

  for (const year of Object.keys(perYear)
    .map(Number)
    .sort((a, b) => a - b)) {
    const count = perYear[year]!;
    for (let i = 0; i < count; i++) {
      const id = `p${String(n++).padStart(4, '0')}`;
      // Gleichmäßig über die Monatsspanne verteilen, damit die Reihenfolge
      // der Kennungen der Zeitachse folgt
      const fortschritt = count > 1 ? i / (count - 1) : 0;
      const month = Math.min(monatsSpanne, 1 + Math.floor(fortschritt * monatsSpanne));
      const day = 1 + ((i * 3) % 27);
      const hour = 8 + (i % 12);
      const hoch = i % 2 === 1;
      photos.set(id, hoch ? photo(id, 1536, 2048) : photo(id, 2048, 1536));
      dated.push({
        id,
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`,
      });
    }
  }
  // Chronologisch sortieren – die Kennungen bleiben dabei aufsteigend, weil
  // Monat und Jahr mit i wachsen; nur der Tag springt innerhalb eines Monats.
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { photos, dated };
}

describe('assign — Ungarische Methode', () => {
  it('findet die optimale Zuordnung, nicht die gierige', () => {
    // Gierig würde Foto 0 den Slot 0 nehmen (Kosten 1) und Foto 1 bliebe
    // Slot 1 (Kosten 10) – Summe 11. Optimal ist über Kreuz: 2 + 3 = 5.
    const cost = [
      [1, 2],
      [3, 10],
    ];
    const result = assign(cost);
    const summe = result.reduce((s, slot, i) => s + cost[i]![slot]!, 0);
    expect(summe).toBe(5);
  });

  it('ordnet jedem Foto genau einen Slot zu', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const result = assign(cost);
    expect(new Set(result).size).toBe(3);
    expect(result.every((s) => s >= 0 && s < 3)).toBe(true);
  });

  it('kommt mit mehr Slots als Fotos zurecht', () => {
    const result = assign([[1, 5, 3]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(0);
  });

  it('liefert für eine leere Matrix nichts', () => {
    expect(assign([])).toEqual([]);
  });
});

describe('slotCost', () => {
  const template = requireTemplate('spread.4up.grid');
  const slot = template.slots[0]!;
  const geometry = slotGeometry(slot, profile);
  const ctx = { profile, weightOf: () => 'normal' as const };

  it('gibt einem gut passenden Foto niedrige Kosten', () => {
    const c = slotCost(photo('a', 2048, 2048), slot, geometry, ctx);
    expect(c.cropLoss).toBeCloseTo(0, 6);
    expect(c.dpiPenalty).toBe(0);
    expect(c.total).toBeLessThan(0.1);
  });

  it('bestraft starken Beschnitt', () => {
    const quadratisch = slotCost(photo('a', 2048, 2048), slot, geometry, ctx);
    const panorama = slotCost(photo('b', 2048, 800), slot, geometry, ctx);
    expect(panorama.cropLoss).toBeGreaterThan(quadratisch.cropLoss);
  });

  it('verbietet eine Unterschreitung der Mindestauflösung praktisch', () => {
    const c = slotCost(photo('winzig', 300, 300), slot, geometry, ctx);
    expect(c.dpi).toBeLessThan(profile.resolution.minDpi);
    expect(c.dpiPenalty).toBeGreaterThan(5);
  });

  it('bestraft die falsche Ausrichtung', () => {
    const querSlot = requireTemplate('spread.2up.pair').slots[0]!;
    const querGeo = slotGeometry(querSlot, profile);
    const quer = slotCost(photo('a', 2048, 1536), querSlot, querGeo, ctx);
    const hoch = slotCost(photo('b', 1536, 2048), querSlot, querGeo, ctx);
    expect(hoch.orientationClash).toBeGreaterThan(quer.orientationClash);
  });

  it('bevorzugt ein Hauptbild im prominenten Slot', () => {
    const heroSlot = requireTemplate('spread.4up.hero-left').slots[0]!; // prominence 3
    const kleinSlot = requireTemplate('spread.4up.hero-left').slots[1]!; // prominence 1
    const heroCtx = { profile, weightOf: () => 'hero' as const };

    const imGroßen = slotCost(photo('a'), heroSlot, slotGeometry(heroSlot, profile), heroCtx);
    const imKleinen = slotCost(photo('a'), kleinSlot, slotGeometry(kleinSlot, profile), heroCtx);
    expect(imGroßen.weightMismatch).toBeLessThan(imKleinen.weightMismatch);
  });
});

describe('distributeBudget', () => {
  it('verteilt die Doppelseiten auf die Jahre', () => {
    const { dated } = buildBestand({ 2015: 20, 2016: 60 });
    const s = buildStructure(dated);
    const budgets = distributeBudget(s.chapters, { targetPages: 40 });
    expect(budgets).toHaveLength(2);
    expect(budgets[1]!.spreads).toBeGreaterThan(budgets[0]!.spreads);
  });

  it('dämpft das Verhältnis zwischen starken und schwachen Jahren', () => {
    // Echtes Verhältnis 2024:2012 ist 111:10, also gut 11:1
    const { dated } = buildBestand({ 2012: 10, 2024: 111 });
    const s = buildStructure(dated);
    const budgets = distributeBudget(s.chapters, { targetPages: 100, exponent: 0.85 });
    const verhältnis = budgets[1]!.spreads / budgets[0]!.spreads;
    expect(verhältnis).toBeLessThan(11);
    expect(verhältnis).toBeGreaterThan(3);
  });

  it('gibt jedem Jahr mindestens eine Doppelseite', () => {
    const { dated } = buildBestand({ 2012: 2, 2024: 400 });
    const s = buildStructure(dated);
    const budgets = distributeBudget(s.chapters, { targetPages: 60 });
    expect(budgets.every((b) => b.spreads >= 1)).toBe(true);
  });

  it('trifft die Zielseitenzahl', () => {
    const { dated } = buildBestand({ 2014: 40, 2015: 60, 2016: 80 });
    const s = buildStructure(dated);
    const budgets = distributeBudget(s.chapters, { targetPages: 80, chapterSpreads: 0 });
    const summe = budgets.reduce((n, b) => n + b.spreads, 0);
    expect(summe).toBe(40); // 80 Seiten = 40 Doppelseiten
  });

  it('kommt mit einem leeren Bestand zurecht', () => {
    expect(distributeBudget([], { targetPages: 100 })).toEqual([]);
  });
});

describe('groupChapter', () => {
  const slotCounts = supportedSlotCounts();

  it('verteilt alle Fotos ohne Verlust und in Reihenfolge', () => {
    const { dated } = buildBestand({ 2015: 30 });
    const s = buildStructure(dated);
    const chapter = s.chapters[0]!;
    const groups = groupChapter(chapter, { slotCounts, targetSpreads: 4 });
    const verteilt = groups.flatMap((g) => g.photoIds);
    expect(verteilt).toEqual(chapter.segments.flatMap((seg) => seg.photoIds));
  });

  it('bildet nur Gruppen, für die es Templates gibt', () => {
    const { dated } = buildBestand({ 2015: 47 });
    const s = buildStructure(dated);
    const groups = groupChapter(s.chapters[0]!, { slotCounts, targetSpreads: 6 });
    for (const g of groups) {
      expect(slotCounts, `Gruppengröße ${g.photoIds.length}`).toContain(g.photoIds.length);
    }
  });

  it('trifft das Seitenbudget', () => {
    const { dated } = buildBestand({ 2015: 24 });
    const s = buildStructure(dated);
    const groups = groupChapter(s.chapters[0]!, { slotCounts, targetSpreads: 4 });
    // 24 Fotos auf angestrebt 4 Doppelseiten → im Mittel 6 je Seite
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups.length).toBeLessThanOrEqual(5);
  });

  it('gruppiert über Monatsgrenzen hinweg, wenn das Budget es verlangt', () => {
    // 12 Fotos über 12 Monate auf 2 Doppelseiten: jede Doppelseite muss
    // mehrere Monate zeigen. Hielte die Gruppierung an Monatsgrenzen, kämen
    // zwölf Doppelseiten heraus.
    const { dated } = buildBestand({ 2015: 12 });
    const s = buildStructure(dated);
    expect(s.chapters[0]!.segments.length).toBeGreaterThan(2);
    const groups = groupChapter(s.chapters[0]!, { slotCounts, targetSpreads: 2 });
    expect(groups.length).toBeLessThanOrEqual(3);
  });

  it('markiert die erste Gruppe je Segment', () => {
    const { dated } = buildBestand({ 2015: 12 });
    const s = buildStructure(dated);
    const groups = groupChapter(s.chapters[0]!, { slotCounts, targetSpreads: 2 });
    expect(groups[0]!.startsSegment).toBe(true);
  });

  it('kommt mit einem einzelnen Foto zurecht', () => {
    const { dated } = buildBestand({ 2015: 1 });
    const s = buildStructure(dated);
    const groups = groupChapter(s.chapters[0]!, { slotCounts, targetSpreads: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.photoIds).toHaveLength(1);
  });
});

describe('generateBook', () => {
  /** Verteilung wie im echten Bestand. */
  const ECHT = {
    2008: 35,
    2009: 45,
    2010: 53,
    2011: 20,
    2012: 10,
    2013: 14,
    2014: 23,
    2015: 12,
    2016: 62,
    2017: 59,
    2018: 48,
    2019: 19,
    2020: 66,
    2021: 21,
    2022: 66,
    2023: 73,
    2024: 111,
    2025: 56,
    2026: 38,
  };

  function generate(overrides: Partial<Parameters<typeof generateBook>[0]> = {}) {
    const { photos, dated } = buildBestand(ECHT);
    const structure = buildStructure(dated);
    return generateBook({
      structure,
      photos,
      profile,
      targetPages: 200,
      ...overrides,
    });
  }

  it('platziert alle Fotos', () => {
    const result = generate({ targetPages: 200 });
    expect(result.report.unplaced).toEqual([]);
    expect(result.report.placedCount).toBe(result.report.photoCount);
  });

  it('trifft die Zielseitenzahl ungefähr', () => {
    const result = generate({ targetPages: 200 });
    // Die Gruppierung kann nicht beliebig genau treffen, weil nur bestimmte
    // Gruppengrößen zur Verfügung stehen.
    expect(result.report.pageCount).toBeGreaterThan(160);
    expect(result.report.pageCount).toBeLessThan(260);
  });

  it('meldet, wenn die Zielseitenzahl gar nicht erreichbar ist', () => {
    // 831 Fotos auf 100 Seiten wären über 20 je Doppelseite – die Bibliothek
    // gibt das nicht her, und die Engine soll das sagen statt stumm ein
    // doppelt so dickes Buch zu bauen.
    const result = generate({ targetPages: 100 });
    expect(result.report.feasibility.achievable).toBe(false);
    expect(result.report.feasibility.hint).toContain('Mindestens');
    expect(result.report.feasibility.minimumPages).toBeGreaterThan(100);
  });

  it('bestätigt die Machbarkeit bei ausreichender Seitenzahl', () => {
    const result = generate({ targetPages: 220 });
    expect(result.report.feasibility.achievable).toBe(true);
    expect(result.report.feasibility.hint).toBeUndefined();
  });

  it('meldet die tatsächliche Fotodichte', () => {
    const result = generate({ targetPages: 200 });
    expect(result.report.photosPerSpread).toBeGreaterThan(4);
    expect(result.report.photosPerSpread).toBeLessThanOrEqual(
      result.report.feasibility.maxPerSpread,
    );
  });

  it('hält überall die Mindestauflösung ein', () => {
    // Die eigentliche Zusage an den Druck.
    const result = generate({ targetPages: 200 });
    expect(result.report.worstDpi).toBeGreaterThanOrEqual(profile.resolution.minDpi);
  });

  it('gibt jedem Jahr einen Kapitelauftakt', () => {
    const result = generate({ targetPages: 200 });
    expect(result.report.chapterOpeners).toBe(19);
  });

  it('lässt sich ohne Kapitelauftakte erzeugen', () => {
    const result = generate({ chapterOpeners: false });
    expect(result.report.chapterOpeners).toBe(0);
  });

  it('ist deterministisch', () => {
    const a = generate({ seed: 42 });
    const b = generate({ seed: 42 });
    expect(a.spreads).toEqual(b.spreads);
  });

  it('erzeugt mit anderem Seed ein anderes Buch', () => {
    const a = generate({ seed: 1 });
    const b = generate({ seed: 999 });
    // Die Fotoreihenfolge bleibt, aber die Templatewahl darf sich ändern
    expect(a.spreads.map((s) => s.templateId)).not.toEqual(b.spreads.map((s) => s.templateId));
  });

  it('behält die Chronologie bei', () => {
    const result = generate({ chapterOpeners: false });
    const reihenfolge = result.spreads
      .flatMap((s) => s.slots.map((sl) => sl.photoId))
      .filter((id): id is string => id !== null);
    const nummern = reihenfolge.map((id) => Number(id.slice(1)));
    // Innerhalb einer Doppelseite darf die Zuordnung tauschen, aber der
    // Gesamtverlauf muss aufsteigend bleiben.
    const mittelwerte = result.spreads.map((s) => {
      const ids = s.slots.map((sl) => sl.photoId).filter((id): id is string => id !== null);
      return ids.reduce((sum, id) => sum + Number(id.slice(1)), 0) / Math.max(1, ids.length);
    });
    for (let i = 1; i < mittelwerte.length; i++) {
      expect(mittelwerte[i], `Doppelseite ${i} bricht die Chronologie`).toBeGreaterThan(
        mittelwerte[i - 1]!,
      );
    }
    expect(nummern.length).toBeGreaterThan(0);
  });

  it('wiederholt dasselbe Template nicht unmittelbar', () => {
    const result = generate({ chapterOpeners: false });
    let wiederholungen = 0;
    for (let i = 1; i < result.spreads.length; i++) {
      if (result.spreads[i]!.templateId === result.spreads[i - 1]!.templateId) wiederholungen++;
    }
    // Bei gleicher Gruppengröße in Folge ist eine Wiederholung manchmal
    // unvermeidlich, sie darf aber nicht die Regel sein.
    expect(wiederholungen / result.spreads.length).toBeLessThan(0.25);
  });

  it('nutzt eine Vielfalt an Templates', () => {
    const result = generate({ targetPages: 200 });
    const verwendet = new Set(result.spreads.map((s) => s.templateId));
    expect(verwendet.size).toBeGreaterThanOrEqual(6);
  });

  it('füllt jeden Slot der gewählten Templates', () => {
    const result = generate({ chapterOpeners: false });
    for (const spread of result.spreads) {
      const template = templateById(spread.templateId)!;
      expect(spread.slots).toHaveLength(template.slots.length);
      const belegt = spread.slots.filter((s) => s.photoId !== null).length;
      expect(belegt, `${spread.id} hat leere Slots`).toBe(template.slots.length);
    }
  });

  it('beschriftet Kapitelauftakte mit der Jahreszahl', () => {
    const result = generate({ targetPages: 200 });
    const auftakt = result.spreads.find((s) => s.texts?.some((t) => t.role === 'year'));
    expect(auftakt).toBeDefined();
    expect(auftakt!.texts![0]!.content).toBe('2008');
  });

  it('kommt mit einem leeren Bestand zurecht', () => {
    const result = generateBook({
      structure: buildStructure([]),
      photos: new Map(),
      profile,
      targetPages: 160,
    });
    expect(result.spreads).toEqual([]);
    expect(result.report.pageCount).toBe(0);
  });

  it('kommt mit einem einzigen Foto zurecht', () => {
    const photos = new Map([['p0', photo('p0')]]);
    const result = generateBook({
      structure: buildStructure([{ id: 'p0', date: '2015-01-01T10:00:00' }]),
      photos,
      profile,
      targetPages: 160,
      chapterOpeners: false,
    });
    expect(result.report.placedCount).toBe(1);
  });
});
