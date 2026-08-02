import { describe, expect, it } from 'vitest';
import {
  addToGroup,
  createGroup,
  mergeGroups,
  groupOfPhoto,
  makeGroupId,
  removeGroup,
  sortGroupsChronologically,
  ungroupPhotos,
  updateGroup,
} from './groups.js';
import type { PhotoGroup } from './groups.js';
import {
  type GroupCandidate,
  mergeSuggestions,
  propagatePlaces,
  suggestDayGroups,
  suggestOccasionGroups,
  suggestPlaceGroups,
} from './suggest-groups.js';
import { occasionOfDay } from './occasions.js';

function group(id: string, photoIds: string[], patch: Partial<PhotoGroup> = {}): PhotoGroup {
  return { id, title: id, photoIds, origin: 'manual', active: true, ...patch };
}

describe('makeGroupId', () => {
  it('macht aus dem Titel eine lesbare Kennung', () => {
    expect(makeGroupId('Olympia 2024 in Paris', new Set())).toBe('olympia-2024-in-paris');
  });

  it('behandelt Umlaute', () => {
    expect(makeGroupId('Osterferien Österreich', new Set())).toBe('osterferien-oesterreich');
  });

  it('zählt bei Namensgleichheit hoch', () => {
    expect(makeGroupId('Kreta', new Set(['kreta']))).toBe('kreta-2');
    expect(makeGroupId('Kreta', new Set(['kreta', 'kreta-2']))).toBe('kreta-3');
  });

  it('fängt einen leeren Titel ab', () => {
    expect(makeGroupId('###', new Set())).toBe('gruppe');
  });
});

describe('createGroup', () => {
  it('legt eine Gruppe an', () => {
    const g = createGroup([], 'Kreta', ['a', 'b']);
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('Kreta');
    expect(g[0]!.photoIds).toEqual(['a', 'b']);
    expect(g[0]!.origin).toBe('manual');
  });

  it('nimmt die Fotos aus ihren bisherigen Gruppen heraus', () => {
    // Ein Foto kann nur in einem Abschnitt stehen.
    const vorher = [group('alt', ['a', 'b', 'c'])];
    const nachher = createGroup(vorher, 'Neu', ['b']);
    expect(nachher.find((g) => g.id === 'alt')!.photoIds).toEqual(['a', 'c']);
    expect(nachher.find((g) => g.title === 'Neu')!.photoIds).toEqual(['b']);
  });

  it('entfernt eine Gruppe, die dadurch leer wird', () => {
    const nachher = createGroup([group('alt', ['a'])], 'Neu', ['a']);
    expect(nachher.map((g) => g.title)).toEqual(['Neu']);
  });

  it('behält die übergebene Reihenfolge bei', () => {
    const g = createGroup([], 'X', ['c', 'a', 'b']);
    expect(g[0]!.photoIds).toEqual(['c', 'a', 'b']);
  });
});

describe('updateGroup', () => {
  it('ändert den Titel', () => {
    const g = updateGroup([group('paris', ['a'])], 'paris', {
      title: 'Olympia 2024 in Paris',
    });
    expect(g[0]!.title).toBe('Olympia 2024 in Paris');
  });

  it('setzt ein Hauptbild', () => {
    const g = updateGroup([group('x', ['a', 'b'])], 'x', { coverPhotoId: 'b' });
    expect(g[0]!.coverPhotoId).toBe('b');
  });

  it('schaltet eine Gruppe ab', () => {
    const g = updateGroup([group('zuhause', ['a'])], 'zuhause', { active: false });
    expect(g[0]!.active).toBe(false);
  });

  it('markiert eine bearbeitete Gruppe als manuell', () => {
    // Damit die Automatik sie künftig in Ruhe lässt.
    const g = updateGroup([group('x', ['a'], { origin: 'place' })], 'x', { title: 'Neu' });
    expect(g[0]!.origin).toBe('manual');
  });
});

describe('Fotos verschieben', () => {
  it('hängt Fotos an eine bestehende Gruppe an', () => {
    const g = addToGroup([group('a', ['1']), group('b', ['2'])], 'a', ['2', '3']);
    expect(g.find((x) => x.id === 'a')!.photoIds).toEqual(['1', '2', '3']);
    expect(g.find((x) => x.id === 'b')!.photoIds).toEqual([]);
  });

  it('nimmt keine Dubletten auf', () => {
    const g = addToGroup([group('a', ['1', '2'])], 'a', ['2', '3']);
    expect(g[0]!.photoIds).toEqual(['1', '2', '3']);
  });

  it('löst die Gruppenzugehörigkeit einzelner Fotos', () => {
    const g = ungroupPhotos([group('a', ['1', '2', '3'])], ['2']);
    expect(g[0]!.photoIds).toEqual(['1', '3']);
  });

  it('nimmt das Hauptbild mit, wenn es herausgenommen wird', () => {
    // Sonst zeigte die Auftaktseite auf ein Foto, das nicht mehr zur Gruppe
    // gehört – seit Fotos einzeln aussortiert werden, sogar auf eines, das es
    // nicht mehr gibt.
    const g = ungroupPhotos([group('a', ['1', '2'], { coverPhotoId: '1' })], ['1']);
    expect(g[0]!.coverPhotoId).toBeUndefined();
    expect(g[0]!.photoIds).toEqual(['2']);
  });

  it('lässt ein Hauptbild stehen, das bleibt', () => {
    const g = ungroupPhotos([group('a', ['1', '2'], { coverPhotoId: '1' })], ['2']);
    expect(g[0]!.coverPhotoId).toBe('1');
  });

  it('löscht eine Gruppe, ohne die Fotos zu verlieren', () => {
    const g = removeGroup([group('a', ['1']), group('b', ['2'])], 'a');
    expect(g.map((x) => x.id)).toEqual(['b']);
  });
});

describe('mergeGroups', () => {
  it('führt zwei Gruppen zusammen und löst die Quelle auf', () => {
    // Die Automatik zerlegt einen Aufenthalt manchmal in zwei – etwa
    // „Helgoland Mai 2025" und „Helgoland Juli 2025".
    const g = mergeGroups([group('mai', ['1', '2']), group('juli', ['3'])], 'juli', 'mai');
    expect(g.map((x) => x.id)).toEqual(['mai']);
    expect(g[0]!.photoIds).toEqual(['1', '2', '3']);
  });

  it('nimmt keine Dubletten auf', () => {
    const g = mergeGroups([group('a', ['1', '2']), group('b', ['2', '3'])], 'b', 'a');
    expect(g[0]!.photoIds).toEqual(['1', '2', '3']);
  });

  it('behält das Hauptbild der Zielgruppe', () => {
    const g = mergeGroups(
      [group('a', ['1'], { coverPhotoId: '1' }), group('b', ['2'], { coverPhotoId: '2' })],
      'b',
      'a',
    );
    expect(g[0]!.coverPhotoId).toBe('1');
  });

  it('übernimmt das Hauptbild der Quelle, wenn das Ziel keines hat', () => {
    const g = mergeGroups([group('a', ['1']), group('b', ['2'], { coverPhotoId: '2' })], 'b', 'a');
    expect(g[0]!.coverPhotoId).toBe('2');
  });

  it('markiert das Ergebnis als manuell', () => {
    const g = mergeGroups(
      [group('a', ['1'], { origin: 'place' }), group('b', ['2'], { origin: 'place' })],
      'b',
      'a',
    );
    expect(g[0]!.origin).toBe('manual');
  });

  it('lässt unbeteiligte Gruppen unberührt', () => {
    const g = mergeGroups([group('a', ['1']), group('b', ['2']), group('c', ['3'])], 'b', 'a');
    expect(g.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('tut nichts, wenn Quelle und Ziel dieselbe Gruppe sind', () => {
    const vorher = [group('a', ['1'])];
    expect(mergeGroups(vorher, 'a', 'a')).toEqual(vorher);
  });

  it('tut nichts bei unbekannter Kennung', () => {
    const vorher = [group('a', ['1'])];
    expect(mergeGroups(vorher, 'gibtesnicht', 'a')).toEqual(vorher);
    expect(mergeGroups(vorher, 'a', 'gibtesnicht')).toEqual(vorher);
  });
});

describe('groupOfPhoto', () => {
  it('ordnet jedes Foto seiner Gruppe zu', () => {
    const map = groupOfPhoto([group('a', ['1', '2']), group('b', ['3'])]);
    expect(map.get('1')).toBe('a');
    expect(map.get('3')).toBe('b');
    expect(map.get('9')).toBeUndefined();
  });
});

describe('sortGroupsChronologically', () => {
  it('sortiert nach dem frühesten Foto', () => {
    const daten: Record<string, string> = {
      a: '2020-05-01T10:00:00',
      b: '2018-03-01T10:00:00',
      c: '2022-01-01T10:00:00',
    };
    const sortiert = sortGroupsChronologically(
      [group('g1', ['a']), group('g2', ['b']), group('g3', ['c'])],
      (id) => daten[id],
    );
    expect(sortiert.map((g) => g.id)).toEqual(['g2', 'g1', 'g3']);
  });
});

// ------------------------------------------------------------- Vorschläge

function kandidat(id: string, date: string, ort?: string): GroupCandidate {
  return {
    photoId: id,
    date,
    ...(ort ? { place: { key: `city:${ort}`, label: ort } } : {}),
  };
}

describe('propagatePlaces', () => {
  it('füllt die Lücke zwischen zwei Aufnahmen desselben Ortes', () => {
    // Nur jedes vierte Foto trägt GPS – ohne diesen Schritt zerfiele jede Reise.
    const k = propagatePlaces([
      kandidat('a', '2024-07-01T10:00:00', 'Paris'),
      kandidat('b', '2024-07-01T12:00:00'),
      kandidat('c', '2024-07-01T14:00:00', 'Paris'),
    ]);
    expect(k[1]!.place?.label).toBe('Paris');
  });

  it('übernimmt den Ort vom zeitlich nahen Nachbarn', () => {
    const k = propagatePlaces([
      kandidat('a', '2024-07-01T10:00:00', 'Kreta'),
      kandidat('b', '2024-07-01T11:00:00'),
    ]);
    expect(k[1]!.place?.label).toBe('Kreta');
  });

  it('überträgt nicht über große zeitliche Abstände', () => {
    const k = propagatePlaces([
      kandidat('a', '2024-07-01T10:00:00', 'Kreta'),
      kandidat('b', '2024-08-15T10:00:00'),
    ]);
    expect(k[1]!.place).toBeUndefined();
  });

  it('überträgt nicht zwischen zwei verschiedenen Orten', () => {
    const k = propagatePlaces(
      [
        kandidat('a', '2024-07-01T10:00:00', 'Paris'),
        kandidat('b', '2024-07-05T10:00:00'),
        kandidat('c', '2024-07-09T10:00:00', 'Wien'),
      ],
      2, // enges Zeitfenster
    );
    expect(k[1]!.place).toBeUndefined();
  });
});

describe('suggestPlaceGroups', () => {
  function reise(ort: string, tage: string[], prefix: string): GroupCandidate[] {
    return tage.map((t, i) => kandidat(`${prefix}${i}`, `${t}T12:00:00`, ort));
  }

  it('macht aus einem Aufenthalt eine Gruppe', () => {
    const g = suggestPlaceGroups(
      reise('Kreta', ['2024-07-01', '2024-07-02', '2024-07-03', '2024-07-04'], 'k'),
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('Kreta');
    expect(g[0]!.active).toBe(true);
    expect(g[0]!.origin).toBe('place');
  });

  it('übergeht zu kleine Ansammlungen', () => {
    const g = suggestPlaceGroups(reise('Kreta', ['2024-07-01', '2024-07-02'], 'k'), {
      minPhotos: 3,
    });
    expect(g).toHaveLength(0);
  });

  it('trennt zwei Aufenthalte am selben Ort und nennt das Jahr', () => {
    const g = suggestPlaceGroups([
      ...reise('Paris', ['2018-05-01', '2018-05-02', '2018-05-03'], 'a'),
      ...reise('Paris', ['2024-07-26', '2024-07-27', '2024-07-28'], 'b'),
    ]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.title)).toEqual(['Paris 2018', 'Paris 2024']);
  });

  it('schaltet den Alltagsort ab, statt ihn zu verschweigen', () => {
    // Der Wohnort taucht über Jahre in fast jedem Monat auf.
    const zuhause: GroupCandidate[] = [];
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 3; d++) {
        zuhause.push(
          kandidat(
            `z${m}-${d}`,
            `2024-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00`,
            'Bremerhaven',
          ),
        );
      }
    }
    const g = suggestPlaceGroups(zuhause);
    expect(g).toHaveLength(1);
    expect(g[0]!.active).toBe(false);
    expect(g[0]!.reason).toContain('Alltag');
  });

  it('lässt eine Reise aktiv, auch wenn sie viele Fotos hat', () => {
    const g = suggestPlaceGroups(
      reise(
        'Kreta',
        Array.from({ length: 40 }, (_, i) => `2024-07-${String((i % 28) + 1).padStart(2, '0')}`),
        'k',
      ),
    );
    expect(g[0]!.active).toBe(true);
  });

  it('sortiert die Gruppen chronologisch', () => {
    const g = suggestPlaceGroups([
      ...reise('Wien', ['2024-09-01', '2024-09-02', '2024-09-03'], 'w'),
      ...reise('Paris', ['2024-07-01', '2024-07-02', '2024-07-03'], 'p'),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Paris', 'Wien']);
  });
});

describe('mergeSuggestions', () => {
  it('lässt von Hand angelegte Gruppen unangetastet', () => {
    const bestehend = [group('meine', ['a', 'b'], { title: 'Olympia 2024 in Paris' })];
    const vorschlag = [group('paris', ['a', 'b', 'c'], { origin: 'place' })];
    const zusammen = mergeSuggestions(bestehend, vorschlag);

    expect(zusammen.find((g) => g.id === 'meine')!.photoIds).toEqual(['a', 'b']);
    // Die schon vergebenen Fotos verschwinden aus dem Vorschlag
    expect(zusammen.find((g) => g.id === 'paris')!.photoIds).toEqual(['c']);
  });

  it('übernimmt frühere Umbenennungen und Abschaltungen', () => {
    const bestehend = [
      group('bremerhaven', ['a'], { origin: 'place', title: 'Zu Hause', active: false }),
    ];
    const vorschlag = [group('bremerhaven', ['a', 'b'], { origin: 'place', title: 'Bremerhaven' })];
    const zusammen = mergeSuggestions(bestehend, vorschlag);

    expect(zusammen[0]!.title).toBe('Zu Hause');
    expect(zusammen[0]!.active).toBe(false);
    expect(zusammen[0]!.photoIds).toEqual(['a', 'b']);
  });

  it('verwirft Vorschläge, deren Fotos alle vergeben sind', () => {
    const zusammen = mergeSuggestions(
      [group('meine', ['a'])],
      [group('auto', ['a'], { origin: 'place' })],
    );
    expect(zusammen.map((g) => g.id)).toEqual(['meine']);
  });

  it('gibt bei Überschneidung dem früheren Vorschlag den Vorrang', () => {
    // Die Reihenfolge der Liste ist die Rangfolge der Quellen: Anlass vor Ort.
    const zusammen = mergeSuggestions(
      [],
      [
        group('weihnachten-2019', ['a', 'b'], { origin: 'calendar' }),
        group('bremerhaven', ['a', 'b', 'c'], { origin: 'place' }),
      ],
    );
    expect(zusammen.find((g) => g.id === 'weihnachten-2019')!.photoIds).toEqual(['a', 'b']);
    expect(zusammen.find((g) => g.id === 'bremerhaven')!.photoIds).toEqual(['c']);
  });

  it('vergibt eine zweite Kennung neu', () => {
    const zusammen = mergeSuggestions(
      [],
      [
        group('ostern-2015', ['a'], { origin: 'calendar', title: 'Ostern 2015' }),
        group('ostern-2015', ['b'], { origin: 'place', title: 'Ostern 2015' }),
      ],
    );
    expect(new Set(zusammen.map((g) => g.id)).size).toBe(2);
  });
});

describe('suggestOccasionGroups', () => {
  function anTag(tag: string, n: number, prefix = 'p'): GroupCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      photoId: `${prefix}-${tag}-${i}`,
      date: `${tag}T${String(9 + i).padStart(2, '0')}:00:00`,
    }));
  }

  const ctx = { birthDate: '1999-04-18' };

  it('macht aus einem Kalenderanlass eine Gruppe', () => {
    const g = suggestOccasionGroups(anTag('2019-12-24', 3));
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('Weihnachten 2019');
    expect(g[0]!.origin).toBe('calendar');
    expect(g[0]!.active).toBe(true);
  });

  it('fasst die Tage eines Anlasses zusammen', () => {
    // Heiligabend bis zweiter Feiertag ist ein Weihnachten, nicht drei.
    const g = suggestOccasionGroups([
      ...anTag('2019-12-24', 2),
      ...anTag('2019-12-25', 2),
      ...anTag('2019-12-26', 2),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.photoIds).toHaveLength(6);
    expect(g[0]!.reason).toContain('3 Tagen');
  });

  it('holt die Feier am Wochenende neben dem Geburtstag dazu', () => {
    const g = suggestOccasionGroups([...anTag('2020-04-18', 2), ...anTag('2020-04-20', 2)], {
      detection: ctx,
    });
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('21. Geburtstag');
    expect(g[0]!.photoIds).toHaveLength(4);
  });

  it('nennt das erste Lebensjahr Geburt', () => {
    const g = suggestOccasionGroups(anTag('1999-04-18', 2), { detection: ctx });
    expect(g[0]!.title).toBe('Geburt');
  });

  it('übergeht einen Anlass mit einem einzigen Foto', () => {
    expect(suggestOccasionGroups(anTag('2019-12-24', 1))).toHaveLength(0);
  });

  it('lässt gewöhnliche Tage in Ruhe', () => {
    expect(suggestOccasionGroups(anTag('2019-09-08', 5))).toHaveLength(0);
  });

  it('übergeht bereits vergebene Fotos', () => {
    const fotos = anTag('2019-12-24', 3);
    const g = suggestOccasionGroups(fotos, {
      taken: new Set(fotos.slice(0, 2).map((f) => f.photoId)),
    });
    expect(g).toHaveLength(0);
  });

  it('liefert die Anlässe in zeitlicher Reihenfolge', () => {
    const g = suggestOccasionGroups([...anTag('2019-12-24', 2), ...anTag('2019-04-21', 2)]);
    // Ostersonntag 2019 war der 21. April
    expect(g.map((x) => x.title)).toEqual(['Ostern 2019', 'Weihnachten 2019']);
  });
});

describe('suggestDayGroups', () => {
  function amTag(tag: string, n: number, prefix = 'p'): GroupCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      photoId: `${prefix}${i}`,
      date: `${tag}T${String(9 + i).padStart(2, '0')}:00:00`,
    }));
  }

  it('macht aus einem Tag mit drei Fotos eine Gruppe', () => {
    const g = suggestDayGroups(amTag('2016-06-18', 3));
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('18. Juni 2016');
    expect(g[0]!.photoIds).toHaveLength(3);
  });

  it('übergeht Tage mit nur zwei Fotos', () => {
    // Zwei Bilder sind noch kein Ereignis.
    expect(suggestDayGroups(amTag('2016-06-18', 2))).toHaveLength(0);
  });

  it('respektiert eine abweichende Mindestzahl', () => {
    expect(suggestDayGroups(amTag('2016-06-18', 4), { minPhotos: 5 })).toHaveLength(0);
    expect(suggestDayGroups(amTag('2016-06-18', 5), { minPhotos: 5 })).toHaveLength(1);
  });

  it('lässt bereits vergebene Fotos außen vor', () => {
    // Die Ortserkennung läuft zuerst; wo sie schon gruppiert hat, ist der Ort
    // die bessere Auskunft.
    const fotos = amTag('2016-06-18', 4);
    const g = suggestDayGroups(fotos, { taken: new Set(['p0', 'p1']) });
    expect(g).toHaveLength(0); // nur noch zwei übrig
  });

  it('benennt einen Geburtstag statt des Datums', () => {
    const g = suggestDayGroups(amTag('2020-04-18', 3), {
      detection: { birthDate: '1999-04-18' },
    });
    expect(g[0]!.title).toBe('21. Geburtstag');
  });

  it('erkennt Weihnachten', () => {
    expect(suggestDayGroups(amTag('2019-12-24', 3))[0]!.title).toBe('Weihnachten 2019');
  });

  it('erkennt Silvester und Neujahr', () => {
    expect(suggestDayGroups(amTag('2019-12-31', 3))[0]!.title).toBe('Silvester 2019');
    expect(suggestDayGroups(amTag('2020-01-01', 3))[0]!.title).toBe('Neujahr 2020');
  });

  it('erkennt Ostern', () => {
    // Ostersonntag 2015 war der 5. April
    expect(suggestDayGroups(amTag('2015-04-05', 3))[0]!.title).toBe('Ostern 2015');
  });

  it('sortiert die Fotos innerhalb des Tages chronologisch', () => {
    const g = suggestDayGroups([
      { photoId: 'spaet', date: '2016-06-18T18:00:00' },
      { photoId: 'frueh', date: '2016-06-18T08:00:00' },
      { photoId: 'mittag', date: '2016-06-18T12:00:00' },
    ]);
    expect(g[0]!.photoIds).toEqual(['frueh', 'mittag', 'spaet']);
  });

  it('liefert die Tage in zeitlicher Reihenfolge', () => {
    const g = suggestDayGroups([...amTag('2016-08-01', 3, 'b'), ...amTag('2016-06-18', 3, 'a')]);
    expect(g.map((x) => x.title)).toEqual(['18. Juni 2016', '1. August 2016']);
  });
});

describe('occasionOfDay', () => {
  const ctx = { birthDate: '1999-04-18' };

  it('rechnet das Alter aus', () => {
    expect(occasionOfDay('2026-04-18T12:00:00', ctx)).toBe('27. Geburtstag');
  });

  it('gilt auch für die Feier am Wochenende daneben', () => {
    expect(occasionOfDay('2026-04-20T12:00:00', ctx)).toBe('27. Geburtstag');
  });

  it('nennt den Geburtstag nicht ohne Geburtsdatum', () => {
    expect(occasionOfDay('2026-04-18T12:00:00')).toBeUndefined();
  });

  it('liefert für einen gewöhnlichen Tag nichts', () => {
    expect(occasionOfDay('2016-09-08T12:00:00', ctx)).toBeUndefined();
  });
});
