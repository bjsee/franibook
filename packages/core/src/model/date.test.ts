import { describe, expect, it } from 'vitest';
import type { Photo } from './photo.js';
import {
  findBulkSeconds,
  findContradiction,
  needsAttention,
  resolveEffectiveDate,
  sortKey,
} from './date.js';

function photo(partial: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    relPath: 'p1.jpeg',
    fileName: 'p1.jpeg',
    bytes: 800_000,
    width: 2048,
    height: 1536,
    orientation: 1,
    ...partial,
  };
}

const IMPORT = '2026-08-02T12:00:00';

describe('Kaskade', () => {
  it('bevorzugt das manuell gesetzte Datum vor allem anderen', () => {
    const r = resolveEffectiveDate(
      photo({ takenAt: '2015-06-12T14:12:33', fileMtime: '2020-01-01T00:00:00' }),
      { dateOverride: '2014-01-01T10:00:00' },
    );
    expect(r.value).toBe('2014-01-01T10:00:00');
    expect(r.source).toBe('manual');
    expect(r.confidence).toBe('high');
  });

  it('nimmt EXIF, wenn nichts korrigiert wurde', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2015-06-12T14:12:33' }));
    expect(r.source).toBe('exif');
    expect(r.confidence).toBe('high');
    expect(r.issues).toHaveLength(0);
  });

  it('fällt der Reihe nach auf schwächere Quellen zurück', () => {
    expect(resolveEffectiveDate(photo({ secondaryDate: '2015-06-12T14:00:00' })).source).toBe(
      'exifSecondary',
    );
    expect(resolveEffectiveDate(photo({ nameDate: '2015-06-12T00:00:00' })).source).toBe(
      'filename',
    );
    expect(resolveEffectiveDate(photo({ fileMtime: '2015-06-12T14:00:00' })).source).toBe('file');
  });

  it('nimmt beim Dateidatum das frühere von Erstellung und Änderung', () => {
    const r = resolveEffectiveDate(
      photo({ fileMtime: '2020-01-01T00:00:00', fileBirthtime: '2015-06-12T14:00:00' }),
    );
    expect(r.value).toBe('2015-06-12T14:00:00');
  });

  it('meldet ein Foto ganz ohne Datum', () => {
    const r = resolveEffectiveDate(photo());
    expect(r.value).toBeNull();
    expect(r.source).toBe('unknown');
    expect(r.confidence).toBe('none');
    expect(r.issues.map((i) => i.code)).toContain('noDate');
  });
});

describe('Plausibilitätsprüfungen', () => {
  it('erkennt ein Datum in der Zukunft', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2030-01-01T10:00:00' }), undefined, {
      importedAt: IMPORT,
    });
    expect(r.issues.map((i) => i.code)).toContain('futureDate');
    expect(r.confidence).toBe('medium'); // von high herabgestuft
  });

  it('erkennt ein Datum vor dem frühesten plausiblen', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2001-01-01T10:00:00' }), undefined, {
      earliestPlausible: '2008-01-01T00:00:00',
    });
    expect(r.issues.map((i) => i.code)).toContain('beforeProjectStart');
  });

  it('erkennt Kamera-Resets', () => {
    for (const d of ['1970-01-01', '1980-01-01', '2000-01-01', '2002-12-08']) {
      const r = resolveEffectiveDate(photo({ takenAt: `${d}T12:00:00` }));
      expect(
        r.issues.map((i) => i.code),
        d,
      ).toContain('epochDate');
    }
  });

  it('erkennt exakt Mitternacht bei EXIF-Quellen', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2015-06-12T00:00:00' }));
    expect(r.issues.map((i) => i.code)).toContain('midnightExact');
  });

  it('bemängelt Mitternacht nicht bei einem aus dem Dateinamen gelesenen Datum', () => {
    // Ein Dateiname trägt naturgemäß keine Uhrzeit – das ist kein Fehler.
    const r = resolveEffectiveDate(photo({ nameDate: '2015-06-12T00:00:00' }));
    expect(r.issues.map((i) => i.code)).not.toContain('midnightExact');
  });

  it('verwirft ein Dateidatum, das mit dem Import zusammenfällt', () => {
    // Die Datei wurde gerade kopiert; das Dateidatum sagt nichts über die
    // Aufnahme aus und wäre schlimmer als gar kein Datum.
    const r = resolveEffectiveDate(photo({ fileMtime: '2026-08-02T11:58:00' }), undefined, {
      importedAt: IMPORT,
    });
    expect(r.value).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain('fileEqualsImport');
  });

  it('erkennt Massen mit identischem Zeitstempel', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2015-06-12T14:00:00' }), undefined, {
      bulkSeconds: new Set(['2015-06-12T14:00:00']),
    });
    expect(r.issues.map((i) => i.code)).toContain('bulkIdentical');
  });

  it('stuft bei mehreren Befunden mehrfach herab', () => {
    const r = resolveEffectiveDate(photo({ takenAt: '2030-01-01T00:00:00' }), undefined, {
      importedAt: IMPORT,
    });
    // Zukunft + Mitternacht → zwei Stufen von high
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
    expect(r.confidence).toBe('low');
  });

  it('lässt ein manuell gesetztes Datum trotz Befund hoch bewertet', () => {
    // Der Benutzer hat es in Kenntnis der Umstände so gewollt.
    const r = resolveEffectiveDate(
      photo(),
      { dateOverride: '2030-01-01T10:00:00' },
      {
        importedAt: IMPORT,
      },
    );
    expect(r.confidence).toBe('high');
    expect(r.issues.map((i) => i.code)).toContain('futureDate');
  });
});

describe('findBulkSeconds', () => {
  it('findet nur Zeitpunkte oberhalb der Schwelle', () => {
    const photos = [
      ...Array.from({ length: 20 }, (_, i) =>
        photo({ id: `a${i}`, takenAt: '2015-01-01T10:00:00' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        photo({ id: `b${i}`, takenAt: '2015-01-02T10:00:00' }),
      ),
    ];
    const bulk = findBulkSeconds(photos);
    expect(bulk.has('2015-01-01T10:00:00')).toBe(true);
    expect(bulk.has('2015-01-02T10:00:00')).toBe(false);
  });

  it('liefert bei einem gesunden Bestand nichts', () => {
    const photos = Array.from({ length: 50 }, (_, i) =>
      photo({ id: `p${i}`, takenAt: `2015-01-01T10:${String(i % 60).padStart(2, '0')}:00` }),
    );
    expect(findBulkSeconds(photos).size).toBe(0);
  });
});

describe('findContradiction', () => {
  it('meldet weit auseinanderliegende Aufnahme- und GPS-Zeit', () => {
    const issue = findContradiction(
      photo({ takenAt: '2015-06-12T14:00:00', gpsDate: '2015-06-20T14:00:00' }),
    );
    expect(issue?.code).toBe('contradictory');
  });

  it('meldet nichts bei geringem Abstand', () => {
    expect(
      findContradiction(photo({ takenAt: '2015-06-12T14:00:00', gpsDate: '2015-06-12T12:00:00' })),
    ).toBeUndefined();
  });

  it('meldet nichts, wenn eine der beiden Angaben fehlt', () => {
    expect(findContradiction(photo({ takenAt: '2015-06-12T14:00:00' }))).toBeUndefined();
  });
});

describe('sortKey', () => {
  it('sortiert chronologisch', () => {
    const a = sortKey(resolveEffectiveDate(photo({ takenAt: '2015-01-01T10:00:00' })));
    const b = sortKey(resolveEffectiveDate(photo({ takenAt: '2015-01-02T10:00:00' })));
    expect(a < b).toBe(true);
  });

  it('stellt Fotos ohne Datum ans Ende', () => {
    const mit = sortKey(resolveEffectiveDate(photo({ takenAt: '2026-12-31T23:59:59' })));
    const ohne = sortKey(resolveEffectiveDate(photo()));
    expect(mit < ohne).toBe(true);
  });

  it('trennt gleiche Zeitpunkte über orderNudge', () => {
    const e = resolveEffectiveDate(photo({ takenAt: '2015-01-01T10:00:00' }));
    expect(sortKey(e, { orderNudge: 1 }) > sortKey(e, { orderNudge: 0 })).toBe(true);
  });
});

describe('needsAttention', () => {
  it('markiert schwache und fehlende Datumsangaben', () => {
    expect(needsAttention(resolveEffectiveDate(photo()))).toBe(true);
    expect(needsAttention(resolveEffectiveDate(photo({ fileMtime: '2015-01-01T10:00:00' })))).toBe(
      true,
    );
    expect(needsAttention(resolveEffectiveDate(photo({ takenAt: '2015-01-01T10:00:00' })))).toBe(
      false,
    );
  });
});
