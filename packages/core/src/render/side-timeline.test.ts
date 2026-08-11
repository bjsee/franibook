import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { NaiveDateTime } from '../model/photo.js';
import type { RectBox, RenderBox, TextBox } from './rendered-spread.js';
import { allProfiles, profileById } from '../print/profiles/index.js';
import { libraryOuterMarginMm } from '../templates/index.js';
import {
  SIDE_AXIS_BAND_MM,
  sideAxisPasst,
  sideTimelineBoxes,
  sideTimelinePreviewWindowMm,
} from './side-timeline.js';

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
  it('läuft senkrecht hinter der Sicherheitslinie der linken Seite', () => {
    // Sie lag einmal *im* Sicherheitsrand — die Jahreszahlen standen damit
    // 1,8 mm vor der Schnittkante und wären bei üblicher Schneidtoleranz
    // angeschnitten worden. Jetzt beginnt das Band an der Sicherheitslinie.
    const boxen = rects(achse('2015-07-01T12:00:00'));
    const senkrecht = boxen.find((r) => r.hMm > 100)!;
    expect(senkrecht.xMm).toBeGreaterThanOrEqual(profile.page.bleedMm + profile.page.safetyMm);
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

  it('hält jede Fassung in ihrem Band hinter der Sicherheitslinie', () => {
    // Der Test, der das Druckrisiko festhält: Nichts von der Achse darf
    // zwischen Papierkante und Sicherheitslinie liegen — dort schneidet das
    // Werk. Und nichts darf über das Band hinausragen, sonst stünde sie auf
    // den Bildern.
    const { bleedMm, safetyMm } = profile.page;
    const bandAussen = bleedMm + safetyMm;
    for (const variant of ['classic', 'ladder', 'bar', 'column']) {
      for (const box of fassung(variant)) {
        if (box.kind === 'polygon') continue;
        expect(box.xMm, variant).toBeGreaterThanOrEqual(bandAussen);
        expect(box.xMm + box.wMm, variant).toBeLessThanOrEqual(bandAussen + SIDE_AXIS_BAND_MM);
      }
    }
  });

  it('zeichnet nichts, wo das Band keinen Platz hat', () => {
    // Am kleinsten Format lässt die Bibliothek 10,6 mm frei, gebraucht werden
    // 10 mm Sicherheitsrand plus 5,8 mm Band. Eine Achse, die auf den Bildern
    // läge, wäre die schlechtere Antwort als keine — die Oberfläche bietet die
    // Randachse dort deshalb gar nicht erst an.
    const klein = profileById('saal-15x15')!;
    expect(sideAxisPasst(klein)).toBe(false);
    expect(sideTimelineBoxes({ fromYear: 2008, toYear: 2026 }, klein)).toEqual([]);

    expect(sideAxisPasst(profile)).toBe(true);
    expect(libraryOuterMarginMm(profile)).toBeCloseTo(19.8, 1);
  });

  it('legt das Vorschaufenster über die Achse, in jedem Format', () => {
    // Der Fehler, den dieser Test festhält: Der Ausschnitt der Miniatur stand
    // als vier feste Millimeterwerte in der Oberfläche, gerechnet gegen ein
    // 30 × 30er Format, das es unter den Profilen nicht gibt. Nach dem Umzug des
    // Bandes vom Sicherheitsrand ins Papier zeigte er neben die Achse, und der
    // Wähler bot vier leere Kästen an statt vier Zeichnungen.
    const at = '2017-05-21T16:40:00' as NaiveDateTime;
    for (const p of allProfiles()) {
      const boxen = sideTimelineBoxes({ fromYear: 2008, toYear: 2026, at, variant: 'ladder' }, p);
      // An den fünf kleinen Formaten gibt es die Achse nicht — dort ist auch
      // nichts vorzuführen, und die Oberfläche bietet sie nicht an.
      if (!sideAxisPasst(p)) {
        expect(boxen, p.id).toEqual([]);
        continue;
      }
      const f = sideTimelinePreviewWindowMm(p, { fromYear: 2008, toYear: 2026, at });
      // Die Achse zeichnet keine Polygone; der Typ erlaubt sie, und nur Rechtecke
      // und Texte haben einen Kasten, gegen den sich ein Fenster prüfen lässt.
      const kaesten = boxen.filter((b): b is RectBox | TextBox => b.kind !== 'polygon');
      const sichtbar = kaesten.filter(
        (b) => b.xMm + b.wMm > f.x0 && b.xMm < f.x1 && b.yMm + b.hMm > f.y0 && b.yMm < f.y1,
      );
      expect(sichtbar.length, p.id).toBeGreaterThan(5);
      // Das Band passt in die Breite des Fensters, waagerecht wird nichts
      // abgeschnitten: Die Miniatur zeigt die Achse ganz, nur einen Abschnitt
      // ihrer Länge.
      for (const b of kaesten) {
        expect(b.xMm, p.id).toBeGreaterThanOrEqual(f.x0);
        expect(b.xMm + b.wMm, p.id).toBeLessThanOrEqual(f.x1);
      }
      // Und der Marker liegt darin — er ist der Grund für den Ausschnitt.
      const p2 = perle(boxen)!;
      expect(p2.yMm, p.id).toBeGreaterThanOrEqual(f.y0);
      expect(p2.yMm + p2.hMm, p.id).toBeLessThanOrEqual(f.y1);
    }
  });

  it('hält das Vorschaufenster in der Achse, auch am Anfang des Buches', () => {
    // Ohne Klemmung liefe das Fenster über den Achsenanfang hinaus in die Ecke
    // der Seite, und die Miniatur zeigte oben Papier.
    const anfang = sideTimelinePreviewWindowMm(profile, {
      fromYear: 2008,
      toYear: 2026,
      at: '2008-01-01T00:00:00' as NaiveDateTime,
    });
    const senkrecht = rects(achse('2015-07-01T12:00:00')).find((r) => r.hMm > 100)!;
    expect(anfang.y0).toBeGreaterThanOrEqual(senkrecht.yMm);
    expect(anfang.y1).toBeLessThanOrEqual(senkrecht.yMm + senkrecht.hMm);
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
