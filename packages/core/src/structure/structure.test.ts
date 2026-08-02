import { describe, expect, it } from 'vitest';
import { type DatedPhoto, allSegments, buildStructure, monthLabel } from './segment.js';

function p(id: string, date: string): DatedPhoto {
  return { id, date };
}

describe('buildStructure', () => {
  it('bildet Jahre als Kapitel', () => {
    const s = buildStructure([
      p('a', '2008-05-01T10:00:00'),
      p('b', '2009-05-01T10:00:00'),
      p('c', '2009-06-01T10:00:00'),
    ]);
    expect(s.chapters.map((c) => c.year)).toEqual([2008, 2009]);
    expect(s.chapters[1]!.photoCount).toBe(2);
  });

  it('bildet Monate als Segmente', () => {
    const s = buildStructure([
      p('a', '2015-03-01T10:00:00'),
      p('b', '2015-03-20T10:00:00'),
      p('c', '2015-04-01T10:00:00'),
    ]);
    const segs = s.chapters[0]!.segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]!.month).toBe(3);
    expect(segs[0]!.photoIds).toEqual(['a', 'b']);
    expect(segs[1]!.month).toBe(4);
  });

  it('sortiert unabhängig von der Eingabereihenfolge chronologisch', () => {
    const s = buildStructure([
      p('c', '2015-04-01T10:00:00'),
      p('a', '2015-03-01T10:00:00'),
      p('b', '2015-03-20T10:00:00'),
    ]);
    expect(allSegments(s).flatMap((x) => x.photoIds)).toEqual(['a', 'b', 'c']);
  });

  it('hält undatierte Fotos getrennt statt sie einzusortieren', () => {
    // Sie brauchen eine Entscheidung, keine stillschweigende Platzierung.
    const s = buildStructure([p('a', '2015-03-01T10:00:00')], ['x', 'y']);
    expect(s.undated).toEqual(['x', 'y']);
    expect(s.photoCount).toBe(3);
    expect(allSegments(s).flatMap((seg) => seg.photoIds)).not.toContain('x');
  });

  it('kommt mit einem leeren Bestand zurecht', () => {
    const s = buildStructure([]);
    expect(s.chapters).toHaveLength(0);
    expect(s.photoCount).toBe(0);
  });
});

describe('Serien innerhalb eines Segments', () => {
  it('fasst zeitlich enge Aufnahmen zusammen', () => {
    const s = buildStructure([
      p('a', '2015-03-01T10:00:00'),
      p('b', '2015-03-01T10:05:00'),
      p('c', '2015-03-01T10:10:00'),
    ]);
    expect(s.chapters[0]!.segments[0]!.series).toHaveLength(1);
  });

  it('trennt bei einer Lücke von mehreren Stunden', () => {
    const s = buildStructure([p('a', '2015-03-01T09:00:00'), p('b', '2015-03-01T18:00:00')]);
    expect(s.chapters[0]!.segments[0]!.series).toHaveLength(2);
  });

  it('trennt immer beim Tageswechsel', () => {
    // Auch wenn nur zwei Stunden dazwischen liegen
    const s = buildStructure([p('a', '2015-03-01T23:00:00'), p('b', '2015-03-02T01:00:00')]);
    expect(s.chapters[0]!.segments[0]!.series).toHaveLength(2);
  });

  it('respektiert die konfigurierte Lücke', () => {
    const eng = buildStructure([p('a', '2015-03-01T09:00:00'), p('b', '2015-03-01T11:00:00')], [], {
      serieGapHours: 1,
    });
    expect(eng.chapters[0]!.segments[0]!.series).toHaveLength(2);

    const weit = buildStructure(
      [p('a', '2015-03-01T09:00:00'), p('b', '2015-03-01T11:00:00')],
      [],
      { serieGapHours: 6 },
    );
    expect(weit.chapters[0]!.segments[0]!.series).toHaveLength(1);
  });
});

describe('monthLabel', () => {
  it('beschriftet auf Deutsch', () => {
    const s = buildStructure([p('a', '2015-03-01T10:00:00')]);
    expect(monthLabel(s.chapters[0]!.segments[0]!)).toBe('März 2015');
  });
});
