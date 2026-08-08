import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import hoch from '../print/profiles/saal-15x21.json' with { type: 'json' };
import breit from '../print/profiles/saal-42x28.json' with { type: 'json' };
import { spreadHeightMm, spreadWidthMm, type PrintProfile } from '../print/profile.js';
import type { TextBox } from '../render/rendered-spread.js';
import { abzugsblatt, befundzeile, linkeSeitenzahl, type Abzugsflaeche } from './abzug.js';

/**
 * Die Maße einer Doppelseite, wie `renderSpread` sie in das RSM schreibt.
 *
 * Der Test geht denselben Weg wie der Server: Er rechnet die Fläche einmal aus
 * dem Profil und gibt sie weiter – `abzugsblatt` selbst kennt kein Profil mehr.
 */
function flaeche(p: PrintProfile): Abzugsflaeche {
  return { widthMm: spreadWidthMm(p), heightMm: spreadHeightMm(p), bleedMm: p.page.bleedMm };
}

const profile = flaeche(saal as PrintProfile);

/**
 * Die beiden Extreme der Profilliste: 42×28 ergibt die breiteste Doppelseite
 * (3:1), 15×21 die gedrungenste (1,43:1) – und nur bei der zweiten begrenzt die
 * Höhe des Blattes den Maßstab.
 */
const FORMATE = [profile, flaeche(breit as PrintProfile), flaeche(hoch as PrintProfile)];

function texte(boxen: readonly { kind: string }[]): TextBox[] {
  return boxen.filter((b): b is TextBox => b.kind === 'text');
}

describe('abzugsblatt', () => {
  it('gibt DIN A4 quer aus, unabhängig vom Buchformat', () => {
    for (const p of FORMATE) {
      const blatt = abzugsblatt(p, { linkeSeite: 1 });
      expect(blatt.breiteMm).toBe(297);
      expect(blatt.hoeheMm).toBe(210);
    }
  });

  it('passt die Doppelseite mit Rand ein und behält ihr Seitenverhältnis', () => {
    const blatt = abzugsblatt(profile, { linkeSeite: 1 });

    // Endformat 270 × 270, Doppelseite also 540 × 270, auf 273 mm Platz.
    expect(blatt.massstab).toBeCloseTo(273 / 540, 6);
    expect(blatt.inhalt.wMm / blatt.inhalt.hMm).toBeCloseTo(2, 6);

    // Waagerecht mittig, senkrecht am oberen Rand – der freie Streifen gehört
    // nach unten, dort wird notiert.
    expect(blatt.inhalt.xMm).toBeCloseTo((297 - blatt.inhalt.wMm) / 2, 6);
    expect(blatt.inhalt.yMm).toBe(12);
  });

  it('bleibt in jedem Format innerhalb des Blattes', () => {
    for (const p of FORMATE) {
      const blatt = abzugsblatt(p, { linkeSeite: 1, befundzeile: 'x' });
      const unterkante = Math.max(...texte(blatt.boxen).map((b) => b.yMm + b.hMm));

      expect(blatt.massstab).toBeLessThan(1);
      expect(blatt.inhalt.xMm).toBeGreaterThanOrEqual(0);
      expect(blatt.inhalt.xMm + blatt.inhalt.wMm).toBeLessThanOrEqual(blatt.breiteMm);
      expect(unterkante).toBeLessThanOrEqual(blatt.hoeheMm);
    }
  });

  it('rechnet mit der übergebenen Fläche und nicht mit einem angenommenen Format', () => {
    // Eine Fläche, die zu keinem Profil der Bibliothek gehört. Sie muss trotzdem
    // sauber eingepasst werden — das ist der ganze Grund, weshalb die Funktion
    // die Maße nimmt und nicht das Druckprofil: Nur so ist ausgeschlossen, dass
    // Maßstab und Zuschnitt aus zwei verschiedenen Quellen stammen.
    const eigen = abzugsblatt({ widthMm: 406, heightMm: 206, bleedMm: 3 }, { linkeSeite: 1 });

    expect(eigen.massstab).toBeCloseTo(273 / 400, 6);
    expect(eigen.inhalt.wMm).toBeCloseTo(273, 6);
    expect(eigen.inhalt.hMm / eigen.inhalt.wMm).toBeCloseTo(200 / 400, 6);
  });

  it('setzt die Bildauflösung auf 150 dpi des Blattes, nicht des Buches', () => {
    const blatt = abzugsblatt(profile, { linkeSeite: 1 });

    // Ein Kasten von 100 mm im Buch ist auf dem Blatt 48,75 mm breit; die
    // Pixelzahl richtet sich nach dem, was man in der Hand hält.
    expect(blatt.bildDpi).toBeCloseTo(150 * blatt.massstab, 6);
    expect(100 * (blatt.bildDpi / 25.4)).toBeCloseTo(blatt.massstab * 100 * (150 / 25.4), 6);
  });

  it('setzt beide Seitenzahlen außen unter ihre Seite', () => {
    const blatt = abzugsblatt(profile, { linkeSeite: 44 });
    const links = texte(blatt.boxen)[0]!;
    const rechts = texte(blatt.boxen)[1]!;

    expect(links.content).toBe('44');
    expect(links.align).toBe('left');
    expect(links.xMm).toBeCloseTo(blatt.inhalt.xMm, 6);

    expect(rechts.content).toBe('45');
    expect(rechts.align).toBe('right');
    expect(rechts.xMm + rechts.wMm).toBeCloseTo(blatt.inhalt.xMm + blatt.inhalt.wMm, 6);

    // Unter dem Buch, nicht darin.
    expect(links.yMm).toBeGreaterThanOrEqual(blatt.inhalt.yMm + blatt.inhalt.hMm);
  });

  it('lässt die Befundzeile weg, wenn es nichts zu melden gibt', () => {
    expect(texte(abzugsblatt(profile, { linkeSeite: 1 }).boxen)).toHaveLength(2);
    expect(
      texte(abzugsblatt(profile, { linkeSeite: 1, befundzeile: 'Platz ohne Bild' }).boxen),
    ).toHaveLength(3);
  });
});

describe('linkeSeitenzahl', () => {
  it('beginnt bei 1 und zählt in Zweierschritten', () => {
    expect(linkeSeitenzahl(0)).toBe(1);
    expect(linkeSeitenzahl(1)).toBe(3);
    expect(linkeSeitenzahl(21)).toBe(43);
  });
});

describe('befundzeile', () => {
  it('bündelt gleiche Funde mit Zahl statt sie zu wiederholen', () => {
    expect(befundzeile(['Unter der Mindestauflösung', 'Unter der Mindestauflösung'])).toBe(
      'Unter der Mindestauflösung (2)',
    );
  });

  it('reiht verschiedene Funde auf', () => {
    expect(befundzeile(['Platz ohne Bild', 'Bild und Platz stehen quer'])).toBe(
      'Platz ohne Bild · Bild und Platz stehen quer',
    );
  });

  it('schweigt, wenn nichts offen ist', () => {
    expect(befundzeile([])).toBeUndefined();
  });
});
