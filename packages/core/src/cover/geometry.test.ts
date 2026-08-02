import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import { type PrintProfile, coverHeightMm, coverWidthMm, spineWidthMm } from '../print/profile.js';
import { containsRect, coverGeometry, overlapsHinge, panelAt, safeArea } from './geometry.js';

const profile = saal as PrintProfile;

/** Seitenzahl des Zielbuchs. 160 Seiten ergeben 24,8 mm Rücken. */
const SEITEN = 160;

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
    // Umschlag plus Beschnitt übrig.
    const rand = profile.cover.wrapMm + profile.cover.bleedMm;
    expect(geo.panels.back.xMm).toBeCloseTo(rand, 9);
    const front = geo.panels.front;
    expect(geo.widthMm - (front.xMm + front.wMm)).toBeCloseTo(rand, 9);
  });

  it('stimmt in den Gesamtmaßen mit den Profilformeln überein', () => {
    const geo = coverGeometry(profile, SEITEN);
    expect(geo.widthMm).toBe(coverWidthMm(profile, SEITEN));
    expect(geo.heightMm).toBe(coverHeightMm(profile));
    expect(geo.spineMm).toBe(spineWidthMm(profile, SEITEN));
    // 2 × (300 + 15) + 24,8 + 2 × 8 + 2 × 3 = 676,8
    expect(geo.widthMm).toBeCloseTo(676.8, 6);
    expect(geo.heightMm).toBe(336);
  });

  it('legt den Rücken mittig auf den Bogen', () => {
    for (const seiten of [24, 100, 160]) {
      const geo = coverGeometry(profile, seiten);
      const mitte = geo.panels.spine.xMm + geo.panels.spine.wMm / 2;
      expect(mitte).toBeCloseTo(geo.widthMm / 2, 9);
    }
  });

  it('verbreitert mit der Seitenzahl nur den Rücken', () => {
    const schmal = coverGeometry(profile, 24);
    const breit = coverGeometry(profile, 160);

    expect(breit.spineMm - schmal.spineMm).toBeCloseTo((160 - 24) * 0.13, 6);
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
    // 24 Seiten ergäben rechnerisch 7,12 mm – über dem Minimum von 6 mm.
    // Erst ein sehr dünnes Buch stößt an die Grenze.
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
    const rand = profile.cover.wrapMm + profile.cover.bleedMm;
    expect(geo.visible.wMm).toBeCloseTo(geo.widthMm - 2 * rand, 9);
    expect(geo.visible.hMm).toBe(profile.page.trimHeightMm);
    expect(containsRect(geo.visible, geo.panels.spine)).toBe(true);
  });
});

describe('Sicherheitsbereiche des Covers', () => {
  it('rückt Vorder- und Rückseite um den Sicherheitsabstand ein', () => {
    const geo = coverGeometry(profile, SEITEN);
    const sicher = safeArea(geo, 'front');
    expect(sicher.xMm).toBe(geo.panels.front.xMm + profile.cover.safetyMm);
    expect(sicher.wMm).toBe(profile.page.trimWidthMm - 2 * profile.cover.safetyMm);
    expect(containsRect(geo.panels.front, sicher)).toBe(true);
  });

  it('nimmt für den Rücken die kleinere Falztoleranz statt des Sicherheitsabstands', () => {
    // Mit 10 mm je Seite bliebe von einem 24,8 mm breiten Rücken nur 4,8 mm –
    // und von einem 6 mm breiten gar nichts.
    const geo = coverGeometry(profile, SEITEN);
    expect(geo.spineToleranceMm).toBe(profile.cover.bleedMm);
    expect(safeArea(geo, 'spine').wMm).toBeCloseTo(geo.spineMm - 2 * profile.cover.bleedMm, 6);
  });

  it('liefert bei zu schmalem Feld keinen negativen Bereich', () => {
    const geo = coverGeometry(profile, 2);
    expect(safeArea(geo, 'hinge-back').wMm).toBe(0);
  });
});

describe('Gelenkzone', () => {
  it('erkennt ein Rechteck, das über die Falzkante ragt', () => {
    const geo = coverGeometry(profile, SEITEN);
    const kante = geo.panels['hinge-front'].xMm;

    expect(overlapsHinge(geo, { xMm: kante - 5, yMm: 100, wMm: 20, hMm: 10 })).toBe(true);
    // Ein Rechteck, das genau an der Falzkante endet, ist noch außerhalb.
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
