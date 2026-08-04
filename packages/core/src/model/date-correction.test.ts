import { describe, expect, it } from 'vitest';
import { applyDateEdit, istDateEdit, validateDateEdit } from './date-correction.js';

/** Drei Fotos, wie sie aus der Kaskade kommen. */
const DREI = [
  { id: 'a', current: '2015-06-01T10:00:00' },
  { id: 'b', current: '2015-06-01T11:30:00' },
  { id: 'c', current: '2015-06-02T09:15:00' },
];

describe('setzen', () => {
  it('setzt ein einzelnes Foto auf den genannten Zeitpunkt', () => {
    const { changes } = applyDateEdit([{ id: 'a', current: null }], {
      kind: 'set',
      value: '2016-03-27T14:00:00',
    });
    expect(changes).toEqual([{ id: 'a', value: '2016-03-27T14:00:00', estimated: false }]);
  });

  it('hält bei mehreren Fotos die Reihenfolge über eine Sekunde Abstand', () => {
    const { changes } = applyDateEdit(DREI, { kind: 'set', value: '2016-03-27T14:00:00' });
    expect(changes.map((c) => c.value)).toEqual([
      '2016-03-27T14:00:00',
      '2016-03-27T14:00:01',
      '2016-03-27T14:00:02',
    ]);
  });

  it('gilt als gewusst und nicht als geschätzt', () => {
    const { changes } = applyDateEdit(DREI, { kind: 'set', value: '2016-03-27T14:00:00' });
    expect(changes.every((c) => !c.estimated)).toBe(true);
  });
});

describe('verschieben', () => {
  it('erhält die Abstände zwischen den Fotos', () => {
    const { changes } = applyDateEdit(DREI, { kind: 'shift', years: 45 });
    expect(changes.map((c) => c.value)).toEqual([
      '2060-06-01T10:00:00',
      '2060-06-01T11:30:00',
      '2060-06-02T09:15:00',
    ]);
  });

  it('richtet einen Kamera-Reset gerade', () => {
    // Der klassische Fall: Knopfzelle leer, alle Aufnahmen liegen 1970 – die
    // Abstände untereinander stimmen aber.
    const reset = [
      { id: 'a', current: '1970-01-01T08:00:00' },
      { id: 'b', current: '1970-01-01T08:05:00' },
    ];
    const { changes } = applyDateEdit(reset, { kind: 'shift', years: 45, months: 5, days: 11 });
    expect(changes.map((c) => c.value)).toEqual(['2015-06-12T08:00:00', '2015-06-12T08:05:00']);
  });

  it('rechnet Jahre kalendarisch und nicht in Millisekunden', () => {
    // Über 45 Jahre liegen elf Schalttage. Eine Rechnung mit 365 Tagen je Jahr
    // würde den Tag um elf verschieben.
    const { changes } = applyDateEdit([{ id: 'a', current: '1970-03-15T12:00:00' }], {
      kind: 'shift',
      years: 45,
    });
    expect(changes[0]!.value).toBe('2015-03-15T12:00:00');
  });

  it('klemmt auf den Monatsletzten, statt in den Folgemonat zu rutschen', () => {
    const { changes } = applyDateEdit([{ id: 'a', current: '2015-01-31T12:00:00' }], {
      kind: 'shift',
      months: 1,
    });
    expect(changes[0]!.value).toBe('2015-02-28T12:00:00');
  });

  it('verschiebt auch rückwärts', () => {
    const { changes } = applyDateEdit([{ id: 'a', current: '2015-06-12T14:00:00' }], {
      kind: 'shift',
      hours: -2,
    });
    expect(changes[0]!.value).toBe('2015-06-12T12:00:00');
  });

  it('überspringt Fotos ohne Datum mit Grund und verschiebt die übrigen', () => {
    const { changes, skipped } = applyDateEdit(
      [
        { id: 'ohne', current: null },
        { id: 'mit', current: '2015-06-01T10:00:00' },
      ],
      { kind: 'shift', days: 1 },
    );
    expect(changes).toEqual([{ id: 'mit', value: '2015-06-02T10:00:00', estimated: false }]);
    expect(skipped).toEqual([{ id: 'ohne', reason: 'Ohne Datum gibt es nichts zu verschieben' }]);
  });

  it('verwirft ein Ergebnis außerhalb eines sinnvollen Zeitraums', () => {
    const { changes, skipped } = applyDateEdit([{ id: 'a', current: '2015-06-12T12:00:00' }], {
      kind: 'shift',
      years: -3000,
    });
    expect(changes).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/außerhalb/);
  });
});

describe('über einen Zeitraum verteilen', () => {
  it('legt ein einzelnes Foto in die Mitte des Zeitraums', () => {
    const { changes } = applyDateEdit([{ id: 'a', current: null }], {
      kind: 'spread',
      from: '2015-06-01T00:00:00',
      to: '2015-06-03T00:00:00',
    });
    expect(changes[0]!.value).toBe('2015-06-02T00:00:00');
  });

  it('verteilt mehrere Fotos gleichmäßig und in der übergebenen Reihenfolge', () => {
    const vier = ['a', 'b', 'c', 'd'].map((id) => ({ id, current: null }));
    const { changes } = applyDateEdit(vier, {
      kind: 'spread',
      from: '2015-06-01T00:00:00',
      to: '2015-06-05T00:00:00',
    });
    expect(changes.map((c) => c.value)).toEqual([
      '2015-06-01T12:00:00',
      '2015-06-02T12:00:00',
      '2015-06-03T12:00:00',
      '2015-06-04T12:00:00',
    ]);
  });

  it('kennzeichnet die Werte als geschätzt', () => {
    const { changes } = applyDateEdit([{ id: 'a', current: null }], {
      kind: 'spread',
      from: '2015-06-01T00:00:00',
      to: '2015-06-03T00:00:00',
    });
    expect(changes[0]!.estimated).toBe(true);
  });

  it('überschreibt auch ein vorhandenes Datum', () => {
    const { changes, skipped } = applyDateEdit(DREI, {
      kind: 'spread',
      from: '2020-01-01T00:00:00',
      to: '2020-01-04T00:00:00',
    });
    expect(changes).toHaveLength(3);
    expect(skipped).toEqual([]);
  });
});

describe('Prüfung vor dem Anwenden', () => {
  it('lehnt eine leere Auswahl ab', () => {
    expect(validateDateEdit({ kind: 'set', value: '2015-06-01T00:00:00' }, 0)).toBe(
      'Keine Fotos ausgewählt',
    );
  });

  it('lehnt einen unbrauchbaren Zeitpunkt ab', () => {
    expect(validateDateEdit({ kind: 'set', value: '01.06.2015' }, 1)).toBe(
      'Kein brauchbarer Zeitpunkt',
    );
    expect(validateDateEdit({ kind: 'set', value: '2015-13-45T99:00:00' }, 1)).toBe(
      'Kein brauchbarer Zeitpunkt',
    );
  });

  it('lehnt ein Verschieben ohne Betrag ab', () => {
    expect(validateDateEdit({ kind: 'shift' }, 1)).toBe('Kein Betrag angegeben');
    expect(validateDateEdit({ kind: 'shift', days: 0 }, 1)).toBe('Kein Betrag angegeben');
  });

  it('lehnt einen umgekehrten Zeitraum ab', () => {
    const fehler = validateDateEdit(
      { kind: 'spread', from: '2015-06-05T00:00:00', to: '2015-06-01T00:00:00' },
      3,
    );
    expect(fehler).toBe('Das Ende des Zeitraums liegt vor seinem Anfang');
  });

  it('lehnt einen Zeitraum ab, der für die Fotozahl zu kurz ist', () => {
    // Zehn Sekunden für zwanzig Fotos: Zwei bekämen denselben Zeitstempel, und
    // damit wäre die Reihenfolge unbestimmt.
    const fehler = validateDateEdit(
      { kind: 'spread', from: '2015-06-01T00:00:00', to: '2015-06-01T00:00:10' },
      20,
    );
    expect(fehler).toMatch(/zu kurz für 20 Fotos/);
  });

  it('lässt einen Zeitraum mit genau einer Sekunde je Foto zu', () => {
    expect(
      validateDateEdit(
        { kind: 'spread', from: '2015-06-01T00:00:00', to: '2015-06-01T00:00:20' },
        20,
      ),
    ).toBeUndefined();
  });
});

describe('Wächter für den Anweisungstyp', () => {
  it('erkennt die drei Korrekturarten', () => {
    expect(istDateEdit({ kind: 'set', value: '2015-06-01T00:00:00' })).toBe(true);
    expect(istDateEdit({ kind: 'shift', days: 1 })).toBe(true);
    expect(istDateEdit({ kind: 'spread', from: 'x', to: 'y' })).toBe(true);
  });

  it('weist alles andere ab, damit ein Feldfehler kein Serverfehler wird', () => {
    expect(istDateEdit(null)).toBe(false);
    expect(istDateEdit('set')).toBe(false);
    expect(istDateEdit({})).toBe(false);
    expect(istDateEdit({ kind: 'clear' })).toBe(false);
    expect(istDateEdit({ kind: 'nachdenken' })).toBe(false);
  });
});
