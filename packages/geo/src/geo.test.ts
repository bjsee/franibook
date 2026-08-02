import { describe, expect, it } from 'vitest';
import { PLACES_COUNT, lookupPlace, placeKey } from './index.js';

/** Koordinaten, die im echten Bestand vorkommen oder ihn gut abbilden. */
const ORTE = {
  bremerhaven: [53.5396, 8.5809],
  dorum: [53.6799, 8.5556],
  helgoland: [54.1825, 7.8858],
  wien: [48.2082, 16.3738],
  wienLandstrasse: [48.1951, 16.3947],
  paris: [48.8566, 2.3522],
  parisPassy: [48.8578, 2.2799],
  londonShadwell: [51.5115, -0.056],
  kretaIraklio: [35.3387, 25.1442],
  kretaSuedkueste: [34.9403, 24.7166],
  daenemarkOksbol: [55.6169, 8.1444],
  tirolLechaschau: [47.4915, 10.7092],
  amsterdam: [52.3676, 4.9041],
} as const;

function label(ort: readonly [number, number]): string | undefined {
  return lookupPlace(ort[0], ort[1])?.label;
}

describe('Datenbank', () => {
  it('ist geladen', () => {
    expect(PLACES_COUNT).toBeGreaterThan(50_000);
  });
});

describe('Inland: Städte', () => {
  it('benennt deutsche Orte mit dem Ortsnamen', () => {
    expect(label(ORTE.bremerhaven)).toBe('Bremerhaven');
    expect(label(ORTE.dorum)).toBe('Dorum');
  });

  it('erkennt auch kleine Orte', () => {
    // Dorum hat gut 1.400 Einwohner – im Feinraster enthalten.
    const p = lookupPlace(...ORTE.dorum);
    expect(p?.kind).toBe('city');
    expect(p!.distanceKm).toBeLessThan(5);
  });

  it('nennt Helgoland beim Namen', () => {
    expect(label(ORTE.helgoland)).toBe('Helgoland');
  });
});

describe('Großstädte gewinnen gegen Stadtteile', () => {
  it('nennt Paris, nicht den Stadtteil', () => {
    // Ohne Einzugsradius kam hier „Paris 16 Passy" heraus.
    expect(label(ORTE.paris)).toBe('Paris');
    expect(label(ORTE.parisPassy)).toBe('Paris');
  });

  it('nennt London, nicht Shadwell', () => {
    expect(label(ORTE.londonShadwell)).toBe('London');
  });

  it('nennt Wien, nicht den Bezirk', () => {
    expect(label(ORTE.wien)).toBe('Wien');
    expect(label(ORTE.wienLandstrasse)).toBe('Wien');
  });

  it('nennt Amsterdam', () => {
    expect(label(ORTE.amsterdam)).toBe('Amsterdam');
  });
});

describe('Inseln', () => {
  it('nennt Kreta statt der nächsten Stadt', () => {
    expect(label(ORTE.kretaIraklio)).toBe('Kreta');
    expect(lookupPlace(...ORTE.kretaIraklio)?.kind).toBe('island');
  });

  it('nennt Kreta auch fernab jeder größeren Stadt', () => {
    expect(label(ORTE.kretaSuedkueste)).toBe('Kreta');
  });
});

describe('Ausland ohne Großstadt: Land', () => {
  it('nennt Dänemark statt eines Dorfs in Jütland', () => {
    expect(label(ORTE.daenemarkOksbol)).toBe('Dänemark');
    expect(lookupPlace(...ORTE.daenemarkOksbol)?.kind).toBe('country');
  });

  it('nennt Österreich für einen Ort in Tirol', () => {
    expect(label(ORTE.tirolLechaschau)).toBe('Österreich');
  });

  it('übersetzt Ländernamen ins Deutsche', () => {
    // Nicht „Netherlands", nicht „NL".
    const nl = lookupPlace(52.0, 5.6); // ländliches Utrecht
    expect(nl?.label).toBe('Niederlande');
  });
});

describe('Randfälle', () => {
  it('kommt mit dem offenen Ozean zurecht', () => {
    const p = lookupPlace(0, -140);
    expect(p).toBeDefined();
    expect(p!.distanceKm).toBeGreaterThan(1000);
  });

  it('weist unsinnige Koordinaten ab', () => {
    expect(lookupPlace(NaN, 0)).toBeUndefined();
    expect(lookupPlace(0, Infinity)).toBeUndefined();
  });

  it('liefert eine stabile Kennung', () => {
    const a = lookupPlace(...ORTE.kretaIraklio)!;
    const b = lookupPlace(...ORTE.kretaSuedkueste)!;
    expect(placeKey(a)).toBe(placeKey(b));
    expect(placeKey(a)).toBe('island:Kreta');
  });

  it('trennt gleichnamige Orte unterschiedlicher Art nicht zusammen', () => {
    expect(placeKey(lookupPlace(...ORTE.paris)!)).toBe('city:Paris');
    expect(placeKey(lookupPlace(...ORTE.daenemarkOksbol)!)).toBe('country:Dänemark');
  });
});
