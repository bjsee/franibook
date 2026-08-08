import { describe, expect, it } from 'vitest';
import {
  type Bildabstand,
  type DoppelKandidat,
  bestaetigeDoppel,
  doppelSchluessel,
  findeDoppelKandidaten,
  zuMessendePaare,
} from './doppel.js';

/** Kürzel: Uhrzeit an einem festen Tag. */
function k(id: string, uhrzeit: string): DoppelKandidat {
  return { id, date: `2017-05-24T${uhrzeit}` };
}

describe('Doppel aus der Zeit vorschlagen', () => {
  it('fasst zwei Aufnahmen weniger Sekunden auseinander zusammen', () => {
    const doppel = findeDoppelKandidaten([k('a', '18:37:27'), k('b', '18:37:41')]);

    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b']);
    expect(doppel[0]!.from).toBe('2017-05-24T18:37:27');
    expect(doppel[0]!.to).toBe('2017-05-24T18:37:41');
  });

  it('lässt ein einzelnes Foto in Ruhe', () => {
    expect(findeDoppelKandidaten([k('a', '10:00:00')])).toEqual([]);
  });

  it('trennt, was weiter auseinanderliegt als das Fenster', () => {
    const doppel = findeDoppelKandidaten([k('a', '10:00:00'), k('b', '10:05:00')]);
    expect(doppel).toEqual([]);
  });

  it('misst die Lücke zum letzten Foto, nicht zum ersten', () => {
    // Vier Aufnahmen in Abständen von 90 s: ein Griff, auch wenn zwischen der
    // ersten und der letzten viereinhalb Minuten liegen.
    const doppel = findeDoppelKandidaten(
      [k('a', '10:00:00'), k('b', '10:01:30'), k('c', '10:03:00'), k('d', '10:04:30')],
      { fensterSekunden: 120 },
    );

    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sortiert die Eingabe selbst', () => {
    const doppel = findeDoppelKandidaten([k('b', '18:37:41'), k('a', '18:37:27')]);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b']);
  });

  it('achtet auf das eingestellte Fenster', () => {
    const eingabe = [k('a', '10:00:00'), k('b', '10:00:45')];
    expect(findeDoppelKandidaten(eingabe, { fensterSekunden: 30 })).toEqual([]);
    expect(findeDoppelKandidaten(eingabe, { fensterSekunden: 60 })).toHaveLength(1);
  });
});

describe('Doppel mit gemessenen Abständen bestätigen', () => {
  const kandidat = findeDoppelKandidaten([
    k('a', '10:00:00'),
    k('b', '10:00:20'),
    k('c', '10:00:40'),
  ]);

  it('hält zusammen, was sich ähnlich sieht', () => {
    const abstaende: Bildabstand[] = [
      { a: 'a', b: 'b', distanz: 0.5 },
      { a: 'a', b: 'c', distanz: 0.6 },
      { a: 'b', b: 'c', distanz: 0.55 },
    ];

    const doppel = bestaetigeDoppel(kandidat, abstaende);
    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b', 'c']);
  });

  it('lässt fallen, was nur zeitlich zusammenfiel', () => {
    // Zwei Kameras auf demselben Fest: gleiche Minute, verschiedene Motive.
    const abstaende: Bildabstand[] = [
      { a: 'a', b: 'b', distanz: 1.08 },
      { a: 'a', b: 'c', distanz: 1.12 },
      { a: 'b', b: 'c', distanz: 1.15 },
    ];

    expect(bestaetigeDoppel(kandidat, abstaende)).toEqual([]);
  });

  it('spaltet einen Kandidaten, wenn nur ein Teil zusammengehört', () => {
    const abstaende: Bildabstand[] = [
      { a: 'a', b: 'b', distanz: 0.4 },
      { a: 'a', b: 'c', distanz: 1.2 },
      { a: 'b', b: 'c', distanz: 1.1 },
    ];

    const doppel = bestaetigeDoppel(kandidat, abstaende);
    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b']);
  });

  it('hält einen langsamen Schwenk über die Nachbarschaft zusammen', () => {
    // a und c sehen sich fremd, hängen aber beide an b. Ein Abstand zum ersten
    // Bild hätte c verloren.
    const abstaende: Bildabstand[] = [
      { a: 'a', b: 'b', distanz: 0.7 },
      { a: 'b', b: 'c', distanz: 0.7 },
      { a: 'a', b: 'c', distanz: 1.3 },
    ];

    const doppel = bestaetigeDoppel(kandidat, abstaende);
    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b', 'c']);
  });

  it('behält die Aufnahmereihenfolge bei', () => {
    const abstaende: Bildabstand[] = [
      { a: 'c', b: 'a', distanz: 0.3 },
      { a: 'c', b: 'b', distanz: 0.3 },
      { a: 'a', b: 'b', distanz: 0.3 },
    ];

    expect(bestaetigeDoppel(kandidat, abstaende)[0]!.photoIds).toEqual(['a', 'b', 'c']);
  });

  it('lässt ein Foto ohne Messung heraus, statt es ungeprüft zu behalten', () => {
    const abstaende: Bildabstand[] = [{ a: 'a', b: 'b', distanz: 0.5 }];

    const doppel = bestaetigeDoppel(kandidat, abstaende);
    expect(doppel).toHaveLength(1);
    expect(doppel[0]!.photoIds).toEqual(['a', 'b']);
  });

  it('achtet auf die eingestellte Schwelle', () => {
    const abstaende: Bildabstand[] = [{ a: 'a', b: 'b', distanz: 0.8 }];

    expect(bestaetigeDoppel(kandidat, abstaende, { hoechstabstand: 0.7 })).toEqual([]);
    expect(bestaetigeDoppel(kandidat, abstaende, { hoechstabstand: 0.9 })).toHaveLength(1);
  });
});

describe('die Begründung des Vorschlags', () => {
  const kandidat = findeDoppelKandidaten([
    k('a', '10:00:00'),
    k('b', '10:00:20'),
    k('c', '10:00:40'),
  ]);

  it('nennt den größten Abstand der Gruppe', () => {
    // Der größte benennt die schwächste Stelle: Bis hierher hat jedes Paar
    // gehalten.
    const doppel = bestaetigeDoppel(kandidat, [
      { a: 'a', b: 'b', distanz: 0.4 },
      { a: 'a', b: 'c', distanz: 0.62 },
      { a: 'b', b: 'c', distanz: 0.5 },
    ]);

    expect(doppel[0]!.aehnlichkeit).toBeCloseTo(0.62, 6);
  });

  it('zählt nur, was in der bestätigten Gruppe übrig blieb', () => {
    // c fällt heraus; sein schlechter Abstand darf die Begründung von a und b
    // nicht verschlechtern.
    const doppel = bestaetigeDoppel(kandidat, [
      { a: 'a', b: 'b', distanz: 0.3 },
      { a: 'a', b: 'c', distanz: 1.3 },
      { a: 'b', b: 'c', distanz: 1.2 },
    ]);

    expect(doppel[0]!.photoIds).toEqual(['a', 'b']);
    expect(doppel[0]!.aehnlichkeit).toBeCloseTo(0.3, 6);
  });
});

describe('der Schlüssel eines Doppels', () => {
  it('hängt nicht an der Reihenfolge der Fotos', () => {
    // Eine Datumskorrektur stellt die Aufnahmereihenfolge um — ein „beide
    // behalten" darf davon nicht vergessen werden.
    expect(doppelSchluessel(['b', 'a'])).toBe(doppelSchluessel(['a', 'b']));
  });

  it('unterscheidet Doppel mit anderer Zusammensetzung', () => {
    // Aus dreien zwei zu behalten ist eine andere Entscheidung als aus dreien
    // drei — das Doppel kommt zu Recht wieder.
    expect(doppelSchluessel(['a', 'b'])).not.toBe(doppelSchluessel(['a', 'b', 'c']));
  });
});

describe('zu messende Paare', () => {
  it('nennt jedes Paar innerhalb eines Kandidaten genau einmal', () => {
    const kandidat = findeDoppelKandidaten([
      k('a', '10:00:00'),
      k('b', '10:00:20'),
      k('c', '10:00:40'),
    ]);

    expect(zuMessendePaare(kandidat)).toEqual([
      { a: 'a', b: 'b' },
      { a: 'a', b: 'c' },
      { a: 'b', b: 'c' },
    ]);
  });

  it('vergleicht nichts über Kandidatengrenzen hinweg', () => {
    const kandidaten = findeDoppelKandidaten([
      k('a', '10:00:00'),
      k('b', '10:00:20'),
      k('c', '14:00:00'),
      k('d', '14:00:20'),
    ]);

    expect(kandidaten).toHaveLength(2);
    expect(zuMessendePaare(kandidaten)).toEqual([
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
    ]);
  });
});
