import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { NaiveDateTime } from '../model/photo.js';
import type { RectBox, RenderBox } from './rendered-spread.js';
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
