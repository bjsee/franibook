import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import { type PrintProfile, coverHeightMm, coverWidthMm, spineWidthMm } from '../print/profile.js';
import { containsRect, coverGeometry, overlapsHinge, panelAt, safeArea } from './geometry.js';

const profile = saal as PrintProfile;

/** Seitenzahl des Zielbuchs. 160 Seiten ergeben 35,98 mm Rücken. */
const SEITEN = 160;

/** Was links vor der Rückseite und rechts nach der Vorderseite liegt. */
const RAND = profile.cover.overhang.sideMm + profile.cover.bleed.sideMm;

describe('Cover-Geometrie', () => {
  it('setzt die fünf Felder lückenlos und in dieser Reihenfolge aneinander', () => {
    const geo = coverGeometry(profile, SEITEN);
    const reihe = [
      geo.panels.back,
      geo.panels['hinge-back'],
      geo.panels.spine,
      geo.panels['hinge-front'],
      geo.panels.front,
    ];

    for (let i = 1; i < reihe.length; i++) {
      const links = reihe[i - 1]!;
      const rechts = reihe[i]!;
      expect(rechts.xMm).toBeCloseTo(links.xMm + links.wMm, 9);
    }

    // Links vor der Rückseite und rechts nach der Vorderseite bleibt genau
    // Überstand plus Beschnitt übrig.
    expect(geo.panels.back.xMm).toBeCloseTo(RAND, 9);
    const front = geo.panels.front;
    expect(geo.widthMm - (front.xMm + front.wMm)).toBeCloseTo(RAND, 9);
  });

  it('stimmt in den Gesamtmaßen mit den Profilformeln überein', () => {
    const geo = coverGeometry(profile, SEITEN);
    expect(geo.widthMm).toBe(coverWidthMm(profile, SEITEN));
    expect(geo.heightMm).toBe(coverHeightMm(profile));
    expect(geo.spineMm).toBe(spineWidthMm(profile, SEITEN));
    // 2 × (270 + 1,99) + 35,98 + 2 × 1,66 + 2 × 9,31 = 601,90
    expect(geo.widthMm).toBeCloseTo(601.9, 2);
    // 270 + 2 × 1,99 + 2 × 7,03 = 288,04
    expect(geo.heightMm).toBeCloseTo(288.04, 6);
  });

  it('bleibt nah an der Tabelle des Anbieters', () => {
    // Er gibt für 160 Seiten 7120 × 3402 px bei 300 dpi an, also
    // 602,79 × 288,04 mm. Die Formel darf davon abweichen, weil seine eigenen
    // Zeilen untereinander um bis zu 1,2 mm streuen – aber nicht mehr als sein
    // Beschnitt von 9,31 mm verkraftet.
    const geo = coverGeometry(profile, 160);
    expect(Math.abs(geo.widthMm - 602.79)).toBeLessThan(1.5);
    expect(geo.heightMm).toBeCloseTo(288.04, 1);
  });

  it('legt den Rücken mittig auf den Bogen', () => {
    for (const seiten of [24, 100, 160]) {
      const geo = coverGeometry(profile, seiten);
      const mitte = geo.panels.spine.xMm + geo.panels.spine.wMm / 2;
      expect(mitte).toBeCloseTo(geo.widthMm / 2, 9);
    }
  });

  it('verbreitert mit der Seitenzahl nur den Rücken', () => {
    const schmal = coverGeometry(profile, 26);
    const breit = coverGeometry(profile, 160);

    // Bei 26 Seiten greift die Mindestbreite und rundet um 1,2 hundertstel
    // Millimeter auf – deshalb hier nicht auf sechs Stellen genau.
    const proSeite = profile.cover.spine.pageThicknessMm;
    expect(breit.spineMm - schmal.spineMm).toBeCloseTo((160 - 26) * proSeite, 2);
    expect(breit.widthMm - schmal.widthMm).toBeCloseTo(breit.spineMm - schmal.spineMm, 6);
    // Die Rückseite bleibt, wo sie ist; die Vorderseite wandert nach rechts.
    expect(breit.panels.back).toEqual(schmal.panels.back);
    expect(breit.panels.front.xMm - schmal.panels.front.xMm).toBeCloseTo(
      breit.spineMm - schmal.spineMm,
      6,
    );
    expect(breit.heightMm).toBe(schmal.heightMm);
  });

  it('hält die Mindestrückenbreite auch bei sehr wenigen Seiten ein', () => {
    // Das Minimum ist der Wert des Anbieters bei seiner kleinsten Auflage
    // (26 Seiten, 12,02 mm). Darunter gibt es das Buch nicht, die Formel
    // rechnete aber weiter herunter.
    const geo = coverGeometry(profile, 2);
    expect(geo.spineMm).toBe(profile.cover.spine.minMm);
  });

  it('legt die Falzlinien auf die Kanten von Gelenk und Rücken', () => {
    const geo = coverGeometry(profile, SEITEN);
    const { back, spine } = geo.panels;
    const hinge = profile.cover.hingeMm;

    expect(geo.foldsXMm).toHaveLength(4);
    expect(geo.foldsXMm[0]).toBeCloseTo(back.xMm + back.wMm, 9);
    expect(geo.foldsXMm[1]).toBeCloseTo(spine.xMm, 9);
    expect(geo.foldsXMm[2]).toBeCloseTo(spine.xMm + spine.wMm, 9);
    expect(geo.foldsXMm[3]).toBeCloseTo(spine.xMm + spine.wMm + hinge, 9);

    // Aufsteigend und paarweise symmetrisch zur Bogenmitte.
    const sortiert = [...geo.foldsXMm].sort((a, b) => a - b);
    expect(geo.foldsXMm).toEqual(sortiert);
    expect(geo.widthMm / 2 - geo.foldsXMm[1]!).toBeCloseTo(geo.foldsXMm[2]! - geo.widthMm / 2, 9);
  });

  it('bezieht die sichtbare Fläche auf Bogen ohne Umschlag und Beschnitt', () => {
    const geo = coverGeometry(profile, SEITEN);
    expect(geo.visible.wMm).toBeCloseTo(geo.widthMm - 2 * RAND, 9);
    expect(geo.visible.hMm).toBe(profile.page.trimHeightMm);
    expect(containsRect(geo.visible, geo.panels.spine)).toBe(true);
  });
});

describe('Sicherheitsbereiche des Covers', () => {
  it('rückt Vorder- und Rückseite um den Sicherheitsabstand ein', () => {
    const geo = coverGeometry(profile, SEITEN);
    const sicher = safeArea(geo, 'front');
    // Außen der Sicherheitsabstand, zur Rückenseite hin der Falzbereich:
    // 17 mm Falz abzüglich des 1,66 mm breiten Gelenkfelds.
    const falz = profile.cover.hingeSafeMm - profile.cover.hingeMm;
    expect(sicher.xMm).toBeCloseTo(geo.panels.front.xMm + falz, 6);
    expect(sicher.wMm).toBeCloseTo(profile.page.trimWidthMm - falz - profile.cover.safetyMm, 6);
    expect(containsRect(geo.panels.front, sicher)).toBe(true);
  });

  it('nimmt für den Rücken die kleinere Falztoleranz statt des Sicherheitsabstands', () => {
    // Mit 10 mm je Seite bliebe von einem 35,98 mm breiten Rücken nur 15,98 mm –
    // und von einem 12 mm breiten gar nichts.
    const geo = coverGeometry(profile, SEITEN);
    expect(geo.spineToleranceMm).toBe(profile.cover.bleed.sideMm);
    expect(safeArea(geo, 'spine').wMm).toBeCloseTo(geo.spineMm - 2 * profile.cover.bleed.sideMm, 6);
  });

  it('liefert bei zu schmalem Feld keinen negativen Bereich', () => {
    const geo = coverGeometry(profile, 2);
    expect(safeArea(geo, 'hinge-back').wMm).toBe(0);
  });
});

describe('Falzbereich', () => {
  it('erkennt ein Rechteck, das in den Falz ragt', () => {
    const geo = coverGeometry(profile, SEITEN);
    const kante = geo.panels['hinge-front'].xMm;

    expect(overlapsHinge(geo, { xMm: kante + 1, yMm: 100, wMm: 20, hMm: 10 })).toBe(true);
    // Der Falzbereich reicht weiter als das Gelenkfeld: Ein Rechteck, das erst
    // hinter dem Gelenk beginnt, liegt trotzdem noch darin.
    expect(overlapsHinge(geo, { xMm: kante + geo.hingeMm + 1, yMm: 100, wMm: 5, hMm: 10 })).toBe(
      true,
    );
    // Ein Rechteck, das genau an der Rückenkante endet, ist noch außerhalb.
    expect(overlapsHinge(geo, { xMm: kante - 20, yMm: 100, wMm: 20, hMm: 10 })).toBe(false);
    expect(overlapsHinge(geo, safeArea(geo, 'front'))).toBe(false);
    expect(overlapsHinge(geo, safeArea(geo, 'back'))).toBe(false);
  });

  it('ordnet eine x-Koordinate ihrem Feld zu', () => {
    const geo = coverGeometry(profile, SEITEN);
    expect(panelAt(geo, geo.panels.back.xMm + 1)).toBe('back');
    expect(panelAt(geo, geo.panels.spine.xMm + 1)).toBe('spine');
    expect(panelAt(geo, geo.panels.front.xMm + 1)).toBe('front');
    expect(panelAt(geo, geo.widthMm / 2)).toBe('spine');
    // Im Beschnitt und im Umschlag liegt kein Feld.
    expect(panelAt(geo, 1)).toBeUndefined();
    expect(panelAt(geo, geo.widthMm - 1)).toBeUndefined();
  });
});
