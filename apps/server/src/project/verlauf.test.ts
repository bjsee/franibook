/**
 * Der Verlauf ohne Projekt.
 *
 * Geprüft wird mit einem Spielzeugstand und einer gestellten Uhr: Das
 * Verschmelzen hängt an der Zeit, und ein Test, der an `Date.now()` hängt, ist
 * kein Test, sondern eine Wette.
 */
import { describe, expect, it } from 'vitest';
import { Verlauf } from './verlauf.js';

/** Ein Stand, der leicht zu vergleichen ist. */
interface Stand {
  wert: string;
}

function aufbau(opts: { tiefe?: number; fenster?: number } = {}) {
  let stand: Stand = { wert: 'a' };
  let uhr = 1000;

  const verlauf = new Verlauf<Stand>({
    lies: () => structuredClone(stand),
    schreib: (s) => {
      stand = s;
    },
    jetzt: () => uhr,
    ...opts,
  });

  return {
    verlauf,
    stand: () => stand.wert,
    setze: (wert: string) => {
      stand = { wert };
    },
    vorrücken: (ms: number) => {
      uhr += ms;
    },
  };
}

describe('Verlauf', () => {
  it('setzt den Stand von vor der Aktion zurück', () => {
    const t = aufbau();
    t.verlauf.punkt('Ausschnitt gesetzt');
    t.setze('b');

    const schritt = t.verlauf.zurueck();

    expect(schritt?.label).toBe('Ausschnitt gesetzt');
    expect(t.stand()).toBe('a');
  });

  it('meldet einen leeren Verlauf, statt etwas zu erfinden', () => {
    const t = aufbau();
    expect(t.verlauf.zurueck()).toBeNull();
    expect(t.verlauf.vor()).toBeNull();
  });

  it('verschmilzt gleichen Schlüssel im Zeitfenster zu einem Schritt', () => {
    const t = aufbau({ fenster: 1500 });
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    t.setze('b');
    t.vorrücken(400);
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' })).toBe(false);
    t.setze('c');

    t.verlauf.zurueck();

    // Ein Ziehen, ein Anschlag: zurück auf den Stand vor der ersten Bewegung.
    expect(t.stand()).toBe('a');
    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(0);
  });

  it('lässt das Fenster mitwandern, damit ein langes Ziehen ein Schritt bleibt', () => {
    const t = aufbau({ fenster: 1500 });
    t.verlauf.punkt('Bild gedreht', { schluessel: 'winkel:0:a' });
    for (let i = 0; i < 10; i++) {
      t.vorrücken(1000);
      expect(t.verlauf.punkt('Bild gedreht', { schluessel: 'winkel:0:a' })).toBe(false);
    }
    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(1);
  });

  it('trennt den Schritt, wenn das Fenster abgelaufen ist', () => {
    const t = aufbau({ fenster: 1500 });
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    t.vorrücken(1501);
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' })).toBe(true);
    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(2);
  });

  it('trennt den Schritt, wenn der Schlüssel wechselt', () => {
    const t = aufbau();
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:b' })).toBe(true);
  });

  it('verschmilzt nie ohne Schlüssel', () => {
    const t = aufbau();
    t.verlauf.punkt('Doppelseite herausgenommen');
    expect(t.verlauf.punkt('Doppelseite herausgenommen')).toBe(true);
  });

  it('wiederholt einen zurückgenommenen Schritt', () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe gelöscht');
    t.setze('b');

    t.verlauf.zurueck();
    expect(t.stand()).toBe('a');

    const schritt = t.verlauf.vor();
    expect(schritt?.label).toBe('Gruppe gelöscht');
    expect(t.stand()).toBe('b');
  });

  it('verwirft das Wiederholen, sobald etwas Neues geschieht', () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe gelöscht');
    t.setze('b');
    t.verlauf.zurueck();

    t.verlauf.punkt('Umschlag geändert');
    expect(t.verlauf.auskunft().vor).toBeNull();
    expect(t.verlauf.vor()).toBeNull();
  });

  it('lässt keine Aktion in einen wiederhergestellten Stand hineinverschmelzen', () => {
    const t = aufbau();
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    t.setze('b');
    t.verlauf.zurueck();
    t.verlauf.vor();

    // Derselbe Schlüssel unmittelbar danach: Der wiederhergestellte Schritt
    // darf nicht verschluckt werden, sonst käme man nicht mehr auf 'a' zurück.
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' })).toBe(true);
    t.setze('c');
    t.verlauf.zurueck();
    expect(t.stand()).toBe('b');
    t.verlauf.zurueck();
    expect(t.stand()).toBe('a');
  });

  it('verwirft einen Punkt, dessen Aktion nichts geändert hat', () => {
    const t = aufbau();
    t.verlauf.punkt('Foto umgehängt');
    t.verlauf.verwerfe();
    expect(t.verlauf.zurueck()).toBeNull();
  });

  it('hält nur die vereinbarte Tiefe', () => {
    const t = aufbau({ tiefe: 3 });
    for (const wert of ['b', 'c', 'd', 'e']) {
      t.verlauf.punkt(`auf ${wert}`);
      t.setze(wert);
    }

    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(3);
    // Der älteste Stand ('a') ist herausgefallen, der drittälteste ist der Boden.
    t.verlauf.zurueck();
    t.verlauf.zurueck();
    t.verlauf.zurueck();
    expect(t.stand()).toBe('b');
    expect(t.verlauf.zurueck()).toBeNull();
  });

  it('vergisst an einer Barriere alles', () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe angelegt');
    t.setze('b');
    t.verlauf.zurueck();

    t.verlauf.barriere();

    const auskunft = t.verlauf.auskunft();
    expect(auskunft.tiefe).toEqual({ zurueck: 0, vor: 0 });
    expect(auskunft.zurueck).toBeNull();
    expect(auskunft.vor).toBeNull();
  });

  it('nennt der Oberfläche die Bezeichnungen für ihre beiden Knöpfe', () => {
    const t = aufbau();
    expect(t.verlauf.auskunft()).toEqual({
      zurueck: null,
      vor: null,
      tiefe: { zurueck: 0, vor: 0 },
    });

    t.verlauf.punkt('Ausschnitt gesetzt');
    expect(t.verlauf.auskunft().zurueck).toBe('Ausschnitt gesetzt');

    t.verlauf.zurueck();
    expect(t.verlauf.auskunft()).toEqual({
      zurueck: null,
      vor: 'Ausschnitt gesetzt',
      tiefe: { zurueck: 0, vor: 1 },
    });
  });
});
