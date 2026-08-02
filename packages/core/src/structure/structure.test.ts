import { describe, expect, it } from 'vitest';
import { type DatedPhoto, allSegments, buildStructure, monthLabel } from './segment.js';
import { DEFAULT_DETECTORS, easterSunday, suggestTitles } from './detectors.js';

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

describe('easterSunday', () => {
  it('trifft bekannte Ostersonntage', () => {
    // Nachprüfbare Werte
    expect(easterSunday(2008)).toEqual({ month: 3, day: 23 });
    expect(easterSunday(2015)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
  });
});

describe('Titelvorschläge', () => {
  const ctx = { birthDate: '2008-04-18', name: 'Franziska' };

  function titleFor(dates: string[]) {
    const s = buildStructure(dates.map((d, i) => p(`p${i}`, d)));
    return suggestTitles(allSegments(s), ctx)[0];
  }

  it('erkennt einen Geburtstag und berechnet das Alter', () => {
    const seg = titleFor(['2016-04-18T12:00:00', '2016-04-18T13:00:00', '2016-04-18T14:00:00']);
    expect(seg?.title).toBe('8. Geburtstag');
    expect(seg?.titleSource).toBe('calendar:birthday');
  });

  it('erkennt eine Feier am Wochenende neben dem Stichtag', () => {
    const seg = titleFor(['2016-04-16T12:00:00', '2016-04-16T13:00:00']);
    expect(seg?.title).toBe('8. Geburtstag');
  });

  it('erkennt Weihnachten', () => {
    const seg = titleFor(['2015-12-24T18:00:00', '2015-12-25T12:00:00']);
    expect(seg?.title).toBe('Weihnachten 2015');
  });

  it('erkennt Silvester', () => {
    const seg = titleFor(['2015-12-31T22:00:00', '2015-12-31T23:00:00']);
    expect(seg?.title).toBe('Silvester 2015');
  });

  it('erkennt Ostern', () => {
    // Ostersonntag 2015 war der 5. April
    const seg = titleFor(['2015-04-05T11:00:00', '2015-04-06T11:00:00']);
    expect(seg?.title).toBe('Ostern 2015');
  });

  it('markiert einen auffällig dichten Tag ohne Kalenderbezug', () => {
    const seg = titleFor([
      '2015-07-11T10:00:00',
      '2015-07-11T10:30:00',
      '2015-07-11T11:00:00',
      '2015-07-11T11:30:00',
      '2015-07-11T12:00:00',
      '2015-07-11T12:30:00',
    ]);
    expect(seg?.titleSource).toBe('density:busy-day');
    expect(seg?.title).toContain('Juli');
  });

  it('bevorzugt bei Konkurrenz den sichereren Vorschlag', () => {
    // Weihnachten (0,85) schlägt den dichten Tag (0,4)
    const seg = titleFor([
      '2015-12-24T10:00:00',
      '2015-12-24T10:30:00',
      '2015-12-24T11:00:00',
      '2015-12-24T11:30:00',
      '2015-12-24T12:00:00',
      '2015-12-24T12:30:00',
    ]);
    expect(seg?.titleSource).toBe('calendar:christmas');
  });

  it('schlägt für einen unauffälligen Monat nichts vor', () => {
    const seg = titleFor(['2015-09-08T10:00:00', '2015-09-19T14:00:00']);
    expect(seg?.title).toBeUndefined();
  });

  it('kommt ohne Geburtsdatum aus', () => {
    const s = buildStructure([p('a', '2016-04-18T12:00:00')]);
    const segs = suggestTitles(allSegments(s), {}, DEFAULT_DETECTORS);
    expect(segs[0]!.title).toBeUndefined();
  });

  it('verändert die übergebenen Segmente nicht', () => {
    const s = buildStructure([p('a', '2015-12-24T18:00:00')]);
    const original = allSegments(s);
    const kopie = JSON.parse(JSON.stringify(original));
    suggestTitles(original, ctx);
    expect(original).toEqual(kopie);
  });
});

describe('monthLabel', () => {
  it('beschriftet auf Deutsch', () => {
    const s = buildStructure([p('a', '2015-03-01T10:00:00')]);
    expect(monthLabel(s.chapters[0]!.segments[0]!)).toBe('März 2015');
  });
});
