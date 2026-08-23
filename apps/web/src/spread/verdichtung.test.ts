import { describe, expect, it } from 'vitest';
import type { Vergroesserungsauskunft } from '../api.js';
import { lohntEinpassen, lohntProportional } from './verdichtung.js';

/** Eine Auskunft, wie der Server sie liefert. `max` ist stets das Minimum. */
function auskunft(maxX: number, maxY: number): Vergroesserungsauskunft {
  return { max: Math.min(maxX, maxY), maxX, maxY, plaetze: 4, ausschnitte: 0 };
}

describe('lohntProportional', () => {
  it('sagt Ja, sobald beide Richtungen Luft haben', () => {
    expect(lohntProportional(auskunft(1.2, 1.6))).toBe(true);
  });

  it('sagt Nein an einer Seite, die ihren Satzspiegel füllt', () => {
    expect(lohntProportional(auskunft(1, 1))).toBe(false);
    // Ein halbes Prozent ist keine Vergrößerung, sondern Rundung.
    expect(lohntProportional(auskunft(1.004, 1.004))).toBe(false);
  });

  it('sagt Nein, wenn die Auskunft ein Satz ist – dort geht gar nichts', () => {
    expect(lohntProportional('Auf dieser Buchseite liegt kein Bild')).toBe(false);
    expect(lohntProportional(undefined)).toBe(false);
  });
});

describe('lohntEinpassen', () => {
  it('sagt Ja, wenn die Höhe deutlich weiter reicht als die Form erlaubt', () => {
    expect(lohntEinpassen(auskunft(1.07, 1.58))).toBe(true);
  });

  it('sagt Ja auch dann, wenn die **Breite** die weite Richtung ist', () => {
    // Der Fehler, für den diese Datei entstanden ist: `max` ist das Minimum aus
    // beiden, also war ein Vergleich gegen `maxY` immer unwahr, sobald die Höhe
    // die knappe Richtung war. An einem hochkanten Bild, das die Satzhöhe schon
    // füllt, blieb der Knopf aus – obwohl der Kasten 4,7-mal breiter werden
    // könnte.
    expect(lohntEinpassen(auskunft(4.69, 1))).toBe(true);
  });

  it('sagt Nein, wenn beide Richtungen gleich weit reichen', () => {
    // Dann fällt das Einpassen mit dem proportionalen Wachsen zusammen, und ein
    // zweiter Knopf für dieselbe Wirkung wäre eine Frage zu viel.
    expect(lohntEinpassen(auskunft(1.4, 1.4))).toBe(false);
    expect(lohntEinpassen(auskunft(1.4, 1.41))).toBe(false);
  });

  it('sagt Nein bei einer Absage oder noch fehlender Auskunft', () => {
    expect(lohntEinpassen('Ein Bild dieses Blattes liegt über dem Falz')).toBe(false);
    expect(lohntEinpassen(undefined)).toBe(false);
  });
});
