/**
 * Der Verlauf ohne Projekt.
 *
 * Geprüft wird mit einem Spielzeugstand und einer gestellten Uhr: Das
 * Verschmelzen hängt an der Zeit, und ein Test, der an `Date.now()` hängt, ist
 * kein Test, sondern eine Wette.
 */
import { describe, expect, it } from 'vitest';
import { type Dateizug, Verlauf } from './verlauf.js';

/** Ein Stand, der leicht zu vergleichen ist. */
interface Stand {
  wert: string;
}

function aufbau(opts: { tiefe?: number; fenster?: number } = {}) {
  let stand: Stand = { wert: 'a' };
  let uhr = 1000;
  const zuege: { zug: Dateizug; richtung: string }[] = [];
  let dateiFehler: string | null = null;

  const verlauf = new Verlauf<Stand>({
    lies: () => structuredClone(stand),
    schreib: (s) => {
      stand = s;
    },
    verschiebe: async (zug, richtung) => {
      if (dateiFehler) throw new Error(dateiFehler);
      zuege.push({ zug, richtung });
    },
    jetzt: () => uhr,
    ...opts,
  });

  return {
    verlauf,
    zuege,
    stand: () => stand.wert,
    setze: (wert: string) => {
      stand = { wert };
    },
    vorrücken: (ms: number) => {
      uhr += ms;
    },
    dateiScheitertMit: (satz: string | null) => {
      dateiFehler = satz;
    },
  };
}

describe('Verlauf', () => {
  it('setzt den Stand von vor der Aktion zurück', async () => {
    const t = aufbau();
    t.verlauf.punkt('Ausschnitt gesetzt');
    t.setze('b');

    const schritt = await t.verlauf.zurueck();

    expect(schritt?.label).toBe('Ausschnitt gesetzt');
    expect(t.stand()).toBe('a');
  });

  it('meldet einen leeren Verlauf, statt etwas zu erfinden', async () => {
    const t = aufbau();
    expect(await t.verlauf.zurueck()).toBeNull();
    expect(await t.verlauf.vor()).toBeNull();
  });

  it('verschmilzt gleichen Schlüssel im Zeitfenster zu einem Schritt', async () => {
    const t = aufbau({ fenster: 1500 });
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    t.setze('b');
    t.vorrücken(400);
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' })).toBe(false);
    t.setze('c');

    await t.verlauf.zurueck();

    // Ein Ziehen, ein Anschlag: zurück auf den Stand vor der ersten Bewegung.
    expect(t.stand()).toBe('a');
    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(0);
  });

  it('lässt das Fenster mitwandern, damit ein langes Ziehen ein Schritt bleibt', async () => {
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

  it('wiederholt einen zurückgenommenen Schritt', async () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe gelöscht');
    t.setze('b');

    await t.verlauf.zurueck();
    expect(t.stand()).toBe('a');

    const schritt = await t.verlauf.vor();
    expect(schritt?.label).toBe('Gruppe gelöscht');
    expect(t.stand()).toBe('b');
  });

  it('verwirft das Wiederholen, sobald etwas Neues geschieht', async () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe gelöscht');
    t.setze('b');
    await t.verlauf.zurueck();

    t.verlauf.punkt('Umschlag geändert');
    expect(t.verlauf.auskunft().vor).toBeNull();
    expect(await t.verlauf.vor()).toBeNull();
  });

  it('lässt keine Aktion in einen wiederhergestellten Stand hineinverschmelzen', async () => {
    const t = aufbau();
    t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' });
    t.setze('b');
    await t.verlauf.zurueck();
    await t.verlauf.vor();

    // Derselbe Schlüssel unmittelbar danach: Der wiederhergestellte Schritt
    // darf nicht verschluckt werden, sonst käme man nicht mehr auf 'a' zurück.
    expect(t.verlauf.punkt('Ausschnitt gesetzt', { schluessel: 'ausschnitt:0:a' })).toBe(true);
    t.setze('c');
    await t.verlauf.zurueck();
    expect(t.stand()).toBe('b');
    await t.verlauf.zurueck();
    expect(t.stand()).toBe('a');
  });

  it('verwirft einen Punkt, dessen Aktion nichts geändert hat', async () => {
    const t = aufbau();
    t.verlauf.punkt('Foto umgehängt');
    t.verlauf.verwerfe();
    expect(await t.verlauf.zurueck()).toBeNull();
  });

  it('hält nur die vereinbarte Tiefe', async () => {
    const t = aufbau({ tiefe: 3 });
    for (const wert of ['b', 'c', 'd', 'e']) {
      t.verlauf.punkt(`auf ${wert}`);
      t.setze(wert);
    }

    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(3);
    // Der älteste Stand ('a') ist herausgefallen, der drittälteste ist der Boden.
    await t.verlauf.zurueck();
    await t.verlauf.zurueck();
    await t.verlauf.zurueck();
    expect(t.stand()).toBe('b');
    expect(await t.verlauf.zurueck()).toBeNull();
  });

  it('vergisst an einer Barriere alles', async () => {
    const t = aufbau();
    t.verlauf.punkt('Gruppe angelegt');
    t.setze('b');
    await t.verlauf.zurueck();

    t.verlauf.barriere();

    const auskunft = t.verlauf.auskunft();
    expect(auskunft.tiefe).toEqual({ zurueck: 0, vor: 0 });
    expect(auskunft.zurueck).toBeNull();
    expect(auskunft.vor).toBeNull();
  });

  it('legt die Datei eines aussortierten Fotos zurück und wieder weg', async () => {
    const t = aufbau();
    t.verlauf.punkt('Foto aussortiert');
    t.verlauf.merkeDateizug({ von: '/quelle/bild.jpg', nach: '/quelle/.geloescht/bild.jpg' });
    t.setze('b');

    await t.verlauf.zurueck();
    expect(t.zuege).toEqual([
      {
        zug: { von: '/quelle/bild.jpg', nach: '/quelle/.geloescht/bild.jpg' },
        richtung: 'zurueck',
      },
    ]);

    await t.verlauf.vor();
    expect(t.zuege[1]?.richtung).toBe('vor');
  });

  it('lässt alles stehen, wenn sich die Datei nicht bewegen lässt', async () => {
    const t = aufbau();
    t.verlauf.punkt('Foto aussortiert');
    t.verlauf.merkeDateizug({ von: '/quelle/bild.jpg', nach: '/quelle/.geloescht/bild.jpg' });
    t.setze('b');
    t.dateiScheitertMit('Quelle nicht erreichbar');

    await expect(t.verlauf.zurueck()).rejects.toThrow('Quelle nicht erreichbar');
    // Kein halber Zustand: Der Stand gilt weiter, und der Schritt liegt noch da.
    expect(t.stand()).toBe('b');
    expect(t.verlauf.auskunft().tiefe.zurueck).toBe(1);
  });

  it('nennt der Oberfläche die Bezeichnungen für ihre beiden Knöpfe', async () => {
    const t = aufbau();
    expect(t.verlauf.auskunft()).toEqual({
      zurueck: null,
      vor: null,
      tiefe: { zurueck: 0, vor: 0 },
    });

    t.verlauf.punkt('Ausschnitt gesetzt');
    expect(t.verlauf.auskunft().zurueck).toBe('Ausschnitt gesetzt');

    await t.verlauf.zurueck();
    expect(t.verlauf.auskunft()).toEqual({
      zurueck: null,
      vor: 'Ausschnitt gesetzt',
      tiefe: { zurueck: 0, vor: 1 },
    });
  });
});
