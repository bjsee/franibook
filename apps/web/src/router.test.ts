/**
 * Adresse und Ansicht müssen einander umkehrbar zugeordnet sein.
 *
 * Geprüft wird der Rundlauf, denn nur er hält die beiden Richtungen zusammen:
 * Wer einen Pfad ergänzt und die Gegenrichtung vergisst, hat einen Link, der ins
 * Leere führt — und das merkt man beim Verschicken, nicht beim Klicken.
 */
import { describe, expect, it } from 'vitest';
import { pfadVon, querySauber, type Route, routeVon, titelVon } from './router.js';

const ALLE: Route[] = [
  { view: 'projekt' },
  { view: 'overview' },
  { view: 'spread', index: 0 },
  { view: 'spread', index: 41 },
  { view: 'groups' },
  { view: 'groups', groupId: 'grp-7' },
  { view: 'years' },
  { view: 'fotodaten' },
  { view: 'sources' },
  { view: 'edit' },
  { view: 'edit', json: true },
  { view: 'cover' },
  { view: 'pruefung' },
  { view: 'pruefung', teil: 'doppel' },
  { view: 'spread', index: 17, slotId: 'r2c' },
];

describe('pfadVon', () => {
  it('zählt die Doppelseite ab 1', () => {
    expect(pfadVon({ view: 'spread', index: 0 })).toBe('/doppelseite/1');
    expect(pfadVon({ view: 'spread', index: 79 })).toBe('/doppelseite/80');
  });

  it('nennt die Ansichten deutsch', () => {
    expect(pfadVon({ view: 'overview' })).toBe('/');
    expect(pfadVon({ view: 'projekt' })).toBe('/projekt');
    expect(pfadVon({ view: 'sources' })).toBe('/bildquellen');
    expect(pfadVon({ view: 'edit' })).toBe('/aufteilung');
    expect(pfadVon({ view: 'cover' })).toBe('/umschlag');
  });

  it('hängt den Platz einer Doppelseite als Unterpfad an', () => {
    // Der Sprung aus der Abnahme zeigt auf ein Bild, nicht nur auf ein Blatt.
    expect(pfadVon({ view: 'spread', index: 17, slotId: 'r2c' })).toBe('/doppelseite/18/platz/r2c');
    expect(routeVon('/doppelseite/18/platz/r2c')).toEqual({
      view: 'spread',
      index: 17,
      slotId: 'r2c',
    });
    // Ohne Platz bleibt die Adresse die kurze — sonst hätte jede Seite zwei.
    expect(pfadVon({ view: 'spread', index: 17 })).toBe('/doppelseite/18');
  });

  it('hängt den Texteditor der Aufteilung als Unterpfad an', () => {
    // Derselbe Gegenstand, eine andere Art, ihn anzufassen – deshalb
    // `/aufteilung/json` und keine eigene Ansicht.
    expect(pfadVon({ view: 'edit', json: true })).toBe('/aufteilung/json');
    expect(routeVon('/aufteilung/json')).toEqual({ view: 'edit', json: true });
    expect(routeVon('/aufteilung/irgendwas')).toEqual({ view: 'edit' });
  });

  it('kodiert eine Gruppenkennung', () => {
    expect(pfadVon({ view: 'groups', groupId: 'ort:Bad Zwischenahn' })).toBe(
      '/gruppen/ort%3ABad%20Zwischenahn',
    );
  });
});

describe('routeVon', () => {
  it('führt jede Adresse zu ihrer Ansicht zurück', () => {
    for (const route of ALLE) {
      expect(routeVon(pfadVon(route))).toEqual(route);
    }
  });

  it('nimmt die alten Query-Adressen an', () => {
    // 0-basiert wie früher `?spread=0`, und der Sonderweg zum Umschlag.
    expect(routeVon('/', '?spread=0')).toEqual({ view: 'spread', index: 0 });
    expect(routeVon('/', '?bare&spread=3&width=1200')).toEqual({ view: 'spread', index: 3 });
    expect(routeVon('/', '?cover')).toEqual({ view: 'cover' });
  });

  it('führt einen unbekannten Pfad zur Übersicht', () => {
    expect(routeVon('/gibtsnicht')).toEqual({ view: 'overview' });
    expect(routeVon('/doppelseite/keine')).toEqual({ view: 'spread', index: 0 });
    // Seitenzahlen gibt es erst ab 1 – eine 0 ist keine halbe Seite davor.
    expect(routeVon('/doppelseite/0')).toEqual({ view: 'spread', index: 0 });
  });

  it('übersieht einen abschließenden Schrägstrich', () => {
    expect(routeVon('/gruppen/')).toEqual({ view: 'groups' });
    expect(routeVon('/doppelseite/12/')).toEqual({ view: 'spread', index: 11 });
  });
});

describe('querySauber', () => {
  it('nimmt die alten Navigationsparameter heraus', () => {
    expect(querySauber('?spread=3&ui=b')).toBe('?ui=b');
    expect(querySauber('?cover')).toBe('');
  });

  it('lässt einen Parameter ohne Wert, wie er ist', () => {
    // `?bare` darf nicht zu `?bare=` werden: Mit dieser Adresse ruft der
    // Parity-Test die Vorschau auf, und sie ist in `docs/` festgehalten.
    expect(querySauber('?bare&spread=0&width=1200&original=1')).toBe('?bare&width=1200&original=1');
  });
});

describe('titelVon', () => {
  it('nennt die Seitenzahl, damit die Verlaufsliste Auskunft gibt', () => {
    expect(titelVon({ view: 'spread', index: 11 })).toBe('Franibook — Doppelseite 12');
    expect(titelVon({ view: 'groups' })).toBe('Franibook — Gruppen');
  });
});
