import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { NaiveDateTime } from '../model/photo.js';
import type { RectBox, RenderBox, TextBox } from './rendered-spread.js';
import { sideTimelineBoxes } from './side-timeline.js';

const profile = saal as PrintProfile;
const rects = (b: RenderBox[]) => b.filter((x): x is RectBox => x.kind === 'rect');

function achse(at?: string): RenderBox[] {
  return sideTimelineBoxes(
    { fromYear: 2008, toYear: 2026, ...(at ? { at: at as NaiveDateTime } : {}) },
    profile,
  );
}

/** Die Perle: quadratisch, mit vollem Eckenradius. */
const perle = (b: RenderBox[]) => rects(b).find((r) => r.rxMm !== undefined && r.wMm === r.hMm);

describe('Randachse', () => {
  it('läuft senkrecht im äußeren Sicherheitsrand der linken Seite', () => {
    const boxen = rects(achse('2015-07-01T12:00:00'));
    const senkrecht = boxen.find((r) => r.hMm > 100)!;
    expect(senkrecht.xMm).toBeLessThan(profile.page.bleedMm + profile.page.safetyMm);
    expect(senkrecht.wMm).toBeLessThan(1);
  });

  it('setzt den Marker anteilig in die Buchspanne', () => {
    // Mitte der Achse ist die Mitte des Buches: 2008 bis 2026 sind 19 Jahre,
    // die Hälfte liegt Mitte 2017.
    const oben = perle(achse('2008-01-01T00:00:00'))!;
    const mitte = perle(achse('2017-07-01T00:00:00'))!;
    const unten = perle(achse('2026-12-31T00:00:00'))!;

    expect(mitte.yMm).toBeGreaterThan(oben.yMm + 80);
    expect(unten.yMm).toBeGreaterThan(mitte.yMm + 80);
  });

  it('zeichnet den zurückgelegten Teil kräftig', () => {
    const boxen = rects(achse('2017-07-01T00:00:00'));
    const striche = boxen.filter((r) => r.hMm > 50);
    // Zwei senkrechte Striche: die ganze Achse und der Fortschritt darauf.
    expect(striche).toHaveLength(2);
    expect(striche[1]!.hMm).toBeLessThan(striche[0]!.hMm);
  });

  it('trägt keine Beschriftung – sie zeigt eine Stelle, sie erklärt nichts', () => {
    expect(achse('2015-07-01T12:00:00').some((b) => b.kind === 'text')).toBe(false);
  });

  it('setzt einen Tick je Jahrgang', () => {
    const ticks = rects(achse()).filter((r) => r.wMm > 1 && r.hMm < 1);
    expect(ticks).toHaveLength(20); // 19 Jahrgänge, 20 Grenzen
  });

  it('lässt den Marker weg, wenn die Doppelseite kein Datum hat', () => {
    expect(perle(achse())).toBeUndefined();
    expect(rects(achse()).length).toBeGreaterThan(10);
  });

  it('bleibt leer, wenn die Buchspanne unsinnig ist', () => {
    expect(sideTimelineBoxes({ fromYear: 2026, toYear: 2008 }, profile)).toEqual([]);
  });

  it('klemmt ein Datum außerhalb der Spanne auf die Achse', () => {
    // Ein falsch datiertes Foto darf den Marker nicht aus der Seite schieben.
    const frueh = perle(achse('1999-01-01T00:00:00'))!;
    const spaet = perle(achse('2099-01-01T00:00:00'))!;
    const alle = rects(achse('2015-01-01T00:00:00'));
    const achseSelbst = alle.find((r) => r.hMm > 100)!;
    expect(frueh.yMm).toBeGreaterThanOrEqual(achseSelbst.yMm - frueh.hMm);
    expect(spaet.yMm).toBeLessThanOrEqual(achseSelbst.yMm + achseSelbst.hMm);
  });
});

describe('Randachse: Fassungen', () => {
  const AT = '2017-07-01T12:00:00';

  /** `null` heißt „Doppelseite ohne belastbares Datum" – nicht `undefined`, das wäre die Vorgabe. */
  function fassung(variant: string, at: string | null = AT): RenderBox[] {
    return sideTimelineBoxes(
      {
        fromYear: 2008,
        toYear: 2026,
        variant: variant as 'classic',
        ...(at ? { at: at as NaiveDateTime } : {}),
      },
      profile,
    );
  }

  const texte = (b: RenderBox[]) => b.filter((x): x is TextBox => x.kind === 'text');

  it('lässt classic ohne Angabe unverändert', () => {
    expect(achse(AT)).toEqual(fassung('classic'));
  });

  it('teilt die Jahresleiter in 19 Segmente mit 0,7 mm Lücke', () => {
    const boxen = rects(fassung('ladder'));
    const segmente = boxen.filter((r) => r.wMm === 1.3 && r.hMm > 10);
    expect(segmente).toHaveLength(19);

    // Die Achse ist die Seitenhöhe abzüglich zweimal 26 mm Rand, im
    // Standardformat also 218 mm: (218 − 18 · 0,7) / 19 = 10,81.
    const achsenLaenge = profile.page.trimHeightMm - 2 * 26;
    const [erst, zweit] = segmente;
    expect(erst!.hMm).toBeCloseTo((achsenLaenge - 18 * 0.7) / 19, 3);
    expect(zweit!.yMm - (erst!.yMm + erst!.hMm)).toBeCloseTo(0.7, 6);
    // Vergangen und kommend unterscheiden sich, sonst wäre die Teilung stumm.
    expect(segmente[0]!.fill).not.toBe(segmente[18]!.fill);
  });

  it('beschriftet die Jahresleiter nur alle fünf Jahre', () => {
    // 2010, 2015, 2020, 2025 – neunzehn Zahlen auf 248 mm wären eine Tabelle
    // am Papierrand.
    expect(texte(fassung('ladder')).map((t) => t.content)).toEqual(['10', '15', '20', '25']);
  });

  it('füllt den Fortschrittsbalken bis zum Marker und kerbt die Jahresgrenzen', () => {
    const boxen = rects(fassung('bar'));
    const balken = boxen.filter((r) => r.wMm === 1.8 && r.hMm > 50);
    const kerben = boxen.filter((r) => r.hMm === 0.25);

    expect(balken).toHaveLength(2); // Grund und Füllung
    expect(balken[1]!.hMm).toBeLessThan(balken[0]!.hMm);
    // Achtzehn innere Grenzen: An den Enden schnitte eine Kerbe die Kappe ab.
    expect(kerben).toHaveLength(18);
    // Mitte 2017 ist die Mitte des Buches – die halbe Länge, auf den Tag genau.
    expect(balken[1]!.hMm).toBeCloseTo(balken[0]!.hMm / 2, 0);
  });

  it('stellt an den Fortschrittsbalken die vollen Jahreszahlen und den laufenden Jahrgang', () => {
    // Vierstellig nur oben und unten, wo die Achse 26 mm Luft hat.
    expect(texte(fassung('bar')).map((t) => t.content)).toEqual(['2008', '2026', '17']);
  });

  it('vergibt auch in einem Buch über ein einziges Jahr eindeutige Kennungen', () => {
    // Erste und letzte Jahreszahl tragen dann denselben Text. Zwei Boxen mit
    // derselben Kennung verwirft die Vorschau als doppelten React-Key.
    const einJahr = sideTimelineBoxes(
      { fromYear: 2017, toYear: 2017, at: AT as NaiveDateTime, variant: 'bar' },
      profile,
    );
    const kennungen = texte(einJahr).map((t) => t.slotId);
    expect(new Set(kennungen).size).toBe(kennungen.length);
  });

  it('lässt die Jahresspalte ohne jede Linie stehen', () => {
    const boxen = fassung('column');
    expect(texte(boxen)).toHaveLength(19);
    // Ein einziges Rechteck: der Punkt am Median.
    expect(rects(boxen)).toHaveLength(1);
    expect(rects(boxen)[0]!.wMm).toBe(1.1);
    // Der laufende Jahrgang halbfett, die übrigen nicht.
    const halbfett = texte(boxen).filter((t) => t.weight === 'semibold');
    expect(halbfett.map((t) => t.content)).toEqual(['17']);
  });

  it('hält jede Fassung im Band zwischen Beschnittkante und Sicherheitsrand', () => {
    const { bleedMm, safetyMm } = profile.page;
    for (const variant of ['classic', 'ladder', 'bar', 'column']) {
      for (const box of fassung(variant)) {
        if (box.kind === 'polygon') continue;
        expect(box.xMm, variant).toBeGreaterThanOrEqual(bleedMm);
        expect(box.xMm + box.wMm, variant).toBeLessThanOrEqual(bleedMm + safetyMm);
      }
    }
  });

  it('lässt in jeder Fassung den Marker weg, wenn die Seite kein Datum hat', () => {
    for (const variant of ['classic', 'ladder', 'bar', 'column']) {
      const ohne = fassung(variant, null);
      // Kein Akzent auf der Achse – aber sie steht, damit die Reihe nicht reißt.
      expect(ohne.length, variant).toBeGreaterThan(0);
      expect(
        rects(ohne).some((r) => r.rxMm !== undefined && r.wMm === r.hMm),
        variant,
      ).toBe(false);
    }
  });
});
