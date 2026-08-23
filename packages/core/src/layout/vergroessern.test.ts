import { describe, expect, it } from 'vitest';
import type { Spread } from '../model/spread.js';
import type { Template } from '../model/template.js';
import { defaultProfile } from '../print/profiles/index.js';
import { vergroesserung, vergroessereSeite } from './vergroessern.js';

const profil = defaultProfile();

/**
 * Vier Kästen links im oberen Drittel, zwei rechts über die ganze Höhe.
 *
 * Links ist damit die Seite mit dem leeren Rand — der Fall, um den es geht.
 */
const VORLAGE: Template = {
  id: 'probe.6',
  name: 'Probe',
  pageSpan: 2,
  slots: [
    { id: 'a', x: 0.05, y: 0.08, w: 0.14, h: 0.2, prominence: 2 },
    { id: 'b', x: 0.21, y: 0.08, w: 0.14, h: 0.2, prominence: 1 },
    { id: 'c', x: 0.05, y: 0.32, w: 0.14, h: 0.2, prominence: 1 },
    { id: 'd', x: 0.21, y: 0.32, w: 0.14, h: 0.2, prominence: 1 },
    { id: 'e', x: 0.55, y: 0.05, w: 0.4, h: 0.42, prominence: 3 },
    { id: 'f', x: 0.55, y: 0.53, w: 0.4, h: 0.42, prominence: 2 },
  ],
};

function seite(rest: Partial<Spread> = {}): Spread {
  return {
    id: 's0',
    index: 0,
    templateId: VORLAGE.id,
    slots: VORLAGE.slots.map((s, i) => ({
      slotId: s.id,
      photoId: `p${i + 1}`,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
    })),
    ...rest,
  };
}

/** Die Hülle der Kästen einer Buchseite, aus dem Ergebnis gelesen. */
function huelle(spread: Spread, ids: readonly string[]) {
  const rects = spread.slots.filter((s) => ids.includes(s.slotId)).map((s) => s.rect!);
  return {
    x: Math.min(...rects.map((r) => r.x)),
    y: Math.min(...rects.map((r) => r.y)),
    rechts: Math.max(...rects.map((r) => r.x + r.w)),
    unten: Math.max(...rects.map((r) => r.y + r.h)),
  };
}

const LINKS = ['a', 'b', 'c', 'd'];

describe('vergroessereSeite', () => {
  it('setzt jeden Kasten der Buchseite um denselben Faktor', () => {
    const r = vergroessereSeite(seite(), VORLAGE, 'left', 1.2, profil);
    if (typeof r === 'string') throw new Error(r);

    expect(r.faktorX).toBeCloseTo(1.2, 6);
    expect(r.faktorY).toBeCloseTo(1.2, 6);
    for (const id of LINKS) {
      const vorher = VORLAGE.slots.find((s) => s.id === id)!;
      const nachher = r.spread.slots.find((s) => s.slotId === id)!.rect!;
      expect(nachher.w).toBeCloseTo(vorher.w * 1.2, 6);
      expect(nachher.h).toBeCloseTo(vorher.h * 1.2, 6);
    }
  });

  it('lässt jeden Ausschnitt gelten – das Seitenverhältnis bleibt', () => {
    // Der eigentliche Grund für die proportionale Rechnung: Ein Ausschnitt ist
    // auf die Form seines Platzes zugeschnitten. Bliebe sie nicht, müsste jeder
    // Ausschnitt der Seite nachgerechnet werden.
    const r = vergroessereSeite(seite(), VORLAGE, 'left', 1.35, profil);
    if (typeof r === 'string') throw new Error(r);

    for (const id of LINKS) {
      const vorher = VORLAGE.slots.find((s) => s.id === id)!;
      const nachher = r.spread.slots.find((s) => s.slotId === id)!.rect!;
      expect(nachher.w / nachher.h).toBeCloseTo(vorher.w / vorher.h, 6);
    }
    // Und die Ausschnitte selbst rührt niemand an.
    expect(r.spread.slots.map((s) => s.crop)).toEqual(seite().slots.map((s) => s.crop));
  });

  it('rührt die andere Buchseite nicht an', () => {
    const vorher = seite();
    const r = vergroessereSeite(vorher, VORLAGE, 'left', 1.2, profil);
    if (typeof r === 'string') throw new Error(r);

    for (const id of ['e', 'f']) {
      expect(r.spread.slots.find((s) => s.slotId === id)).toEqual(
        vorher.slots.find((s) => s.slotId === id),
      );
    }
  });

  it('füllt bei „max" den erlaubten Bereich aus und bleibt darin', () => {
    const r = vergroessereSeite(seite(), VORLAGE, 'left', 'max', profil);
    if (typeof r === 'string') throw new Error(r);

    const { page } = profil;
    const randX = page.safetyMm / (2 * page.trimWidthMm);
    const randY = page.safetyMm / page.trimHeightMm;
    const falzX = page.gutterSafeMm / (2 * page.trimWidthMm);
    const h = huelle(r.spread, LINKS);

    expect(r.faktorX).toBeGreaterThan(1.5);
    expect(h.x).toBeGreaterThanOrEqual(randX - 1e-9);
    expect(h.y).toBeGreaterThanOrEqual(randY - 1e-9);
    expect(h.rechts).toBeLessThanOrEqual(0.5 - falzX + 1e-9);
    expect(h.unten).toBeLessThanOrEqual(1 - randY + 1e-9);
    // Eine Kante berührt die Grenze – sonst wäre es nicht das Maximum.
    const platt =
      Math.abs(h.rechts - (0.5 - falzX)) < 1e-6 || Math.abs(h.unten - (1 - randY)) < 1e-6;
    expect(platt).toBe(true);
  });

  it('klemmt einen zu großen Faktor auf das Mögliche und sagt, was es wurde', () => {
    // „So groß wie es geht" ist die Absicht hinter jedem Wert über dem Maximum –
    // eine Absage wäre die schlechtere Antwort.
    const max = vergroessereSeite(seite(), VORLAGE, 'left', 'max', profil);
    const viel = vergroessereSeite(seite(), VORLAGE, 'left', 99, profil);
    if (typeof max === 'string' || typeof viel === 'string') throw new Error('unerwartet');

    expect(viel.faktorX).toBeCloseTo(max.faktorX, 9);
    expect(viel.spread.slots).toEqual(max.spread.slots);
  });

  it('lässt die Bildgruppe stehen, wo sie ist, solange Luft bleibt', () => {
    // Bei einem Faktor unter dem Maximum soll die Gruppe wachsen und nicht in
    // die Seitenmitte springen: Die Bilder liegen oben, also bleiben sie oben.
    const r = vergroessereSeite(seite(), VORLAGE, 'left', 1.1, profil);
    if (typeof r === 'string') throw new Error(r);

    const h = huelle(r.spread, LINKS);
    const mitteVorher = (0.08 + 0.52) / 2;
    expect((h.y + h.unten) / 2).toBeCloseTo(mitteVorher, 6);
  });

  it('gibt einem leeren Platz der Vorlage sein Rechteck mit', () => {
    // Ohne Zuordnung stünde seine neue Lage nirgends, und der Kasten fiele beim
    // nächsten Rendern mitten in die gewachsenen Nachbarn zurück.
    const ohneB = seite();
    ohneB.slots = ohneB.slots.filter((s) => s.slotId !== 'b');
    const r = vergroessereSeite(ohneB, VORLAGE, 'left', 1.2, profil);
    if (typeof r === 'string') throw new Error(r);

    const b = r.spread.slots.find((s) => s.slotId === 'b')!;
    expect(b.photoId).toBeNull();
    expect(b.rect?.w).toBeCloseTo(0.14 * 1.2, 6);
  });

  it('nimmt einen weggenommenen Platz nicht mit', () => {
    const r = vergroessereSeite(seite({ hiddenSlots: ['b'] }), VORLAGE, 'left', 1.2, profil);
    if (typeof r === 'string') throw new Error(r);
    // `b` ist noch belegt, also gilt der Vermerk nicht – ein Bild schlägt ihn.
    expect(r.spread.slots.find((s) => s.slotId === 'b')!.rect).toBeDefined();

    const leer = seite({ hiddenSlots: ['b'] });
    leer.slots = leer.slots.map((s) => (s.slotId === 'b' ? { ...s, photoId: null } : s));
    const r2 = vergroessereSeite(leer, VORLAGE, 'left', 1.2, profil);
    if (typeof r2 === 'string') throw new Error(r2);
    expect(r2.spread.slots.find((s) => s.slotId === 'b')!.rect).toBeUndefined();
  });

  it('nimmt auch frei gesetzte Kästen mit', () => {
    const mitFrei = seite();
    mitFrei.slots.push({
      slotId: 'frei.1',
      photoId: 'p9',
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
      rect: { x: 0.1, y: 0.6, w: 0.2, h: 0.2 },
    });
    const r = vergroessereSeite(mitFrei, VORLAGE, 'left', 1.1, profil);
    if (typeof r === 'string') throw new Error(r);

    const frei = r.spread.slots.find((s) => s.slotId === 'frei.1')!.rect!;
    expect(frei.w).toBeCloseTo(0.22, 6);
  });

  it('lässt einen leeren Textplatz der Vorlage gelten', () => {
    // 102 der 117 Vorlagen führen einen Textplatz, meist einen leeren
    // `eventTitle`. Eine Regel am Platz statt am gesetzten Text hätte den Griff
    // auf fast jeder Seite des Buches verweigert – mit einem Satz über einen
    // Freiraum, in dem nichts steht.
    const mitPlatz: Template = {
      ...VORLAGE,
      textSlots: [
        {
          id: 't-title',
          role: 'eventTitle',
          x: 0.05,
          y: 0.6,
          w: 0.3,
          h: 0.08,
          style: 'eventTitle',
          optional: true,
        },
      ],
    };
    expect(typeof vergroessereSeite(seite(), mitPlatz, 'left', 1.2, profil)).not.toBe('string');

    // Steht dort ein Titel, ist der Freiraum Gestaltung – und die Absage nennt ihn.
    const beschriftet = seite({
      texts: [{ id: 't1', role: 'eventTitle', content: 'Bremerhaven', slotId: 't-title' }],
    });
    const nein = vergroessereSeite(beschriftet, mitPlatz, 'left', 1.2, profil);
    expect(nein).toContain('Bremerhaven');

    // Ein leerer Wortlaut ist kein Text: Er wird nicht gezeichnet.
    const leer = seite({
      texts: [{ id: 't1', role: 'eventTitle', content: '', slotId: 't-title' }],
    });
    expect(typeof vergroessereSeite(leer, mitPlatz, 'left', 1.2, profil)).not.toBe('string');
  });

  it('lehnt eine Buchseite mit gesetztem Text der Vorlage ab', () => {
    // Ein Auftakt trägt seine Jahreszahl in einem Freiraum, den kein Bild
    // berührt – ihn zuzuwachsen nähme der Seite, was sie zum Auftakt macht.
    const auftakt: Template = {
      ...VORLAGE,
      textSlots: [
        {
          id: 't-year',
          role: 'year',
          x: 0.05,
          y: 0.6,
          w: 0.3,
          h: 0.1,
          style: 'year',
          optional: false,
        },
      ],
    };
    const mitJahr = seite({
      texts: [{ id: 'j', role: 'year', content: '2019', slotId: 't-year' }],
    });
    const r = vergroessereSeite(mitJahr, auftakt, 'left', 1.2, profil);
    expect(r).toContain('Text der Vorlage');
    // Die Gegenseite bleibt erlaubt: Dort steht kein Text.
    expect(typeof vergroessereSeite(mitJahr, auftakt, 'right', 1.2, profil)).not.toBe('string');
  });

  it('lehnt ab, wenn ein Bild über dem Falz liegt', () => {
    const ueberFalz: Template = {
      ...VORLAGE,
      slots: [...VORLAGE.slots, { id: 'g', x: 0.4, y: 0.6, w: 0.2, h: 0.2, prominence: 3 }],
    };
    const r = vergroessereSeite(seite(), ueberFalz, 'left', 1.2, profil);
    expect(r).toContain('über dem Falz');
  });

  it('lehnt eine Buchseite ohne Bild ab', () => {
    const nurRechts: Template = { ...VORLAGE, slots: VORLAGE.slots.filter((s) => s.x > 0.5) };
    expect(vergroessereSeite(seite(), nurRechts, 'left', 1.2, profil)).toContain('kein Bild');
  });

  it('lehnt einen unbrauchbaren Faktor ab', () => {
    expect(vergroessereSeite(seite(), VORLAGE, 'left', 0, profil)).toContain('keine Zahl');
    expect(vergroessereSeite(seite(), VORLAGE, 'left', Number.NaN, profil)).toContain('keine Zahl');
  });

  it('schrumpft eine randabfallende Seite nicht auf den Satzspiegel', () => {
    // Der erlaubte Bereich umfasst, was schon da ist: Ein randabfallendes Bild
    // ist gewollt, und ein Griff „größer" darf es nicht nach innen ziehen.
    const randab: Template = {
      ...VORLAGE,
      slots: [
        { id: 'a', x: -0.01, y: -0.01, w: 0.48, h: 0.5, prominence: 3 },
        ...VORLAGE.slots.filter((s) => s.x > 0.5),
      ],
    };
    const r = vergroessereSeite(seite(), randab, 'left', 'max', profil);
    if (typeof r === 'string') throw new Error(r);

    expect(r.faktorX).toBeGreaterThanOrEqual(1);
    const a = r.spread.slots.find((s) => s.slotId === 'a')!.rect!;
    expect(a.w).toBeGreaterThanOrEqual(0.48);
  });

  it('ist wiederholbar – zweimal 1,1 ist 1,21', () => {
    const einmal = vergroessereSeite(seite(), VORLAGE, 'left', 1.1, profil);
    if (typeof einmal === 'string') throw new Error(einmal);
    const zweimal = vergroessereSeite(einmal.spread, VORLAGE, 'left', 1.1, profil);
    if (typeof zweimal === 'string') throw new Error(zweimal);

    const a = zweimal.spread.slots.find((s) => s.slotId === 'a')!.rect!;
    expect(a.w).toBeCloseTo(0.14 * 1.21, 6);
  });
});

describe('vergroesserung – die Auskunft davor', () => {
  it('sagt den möglichen Faktor und die Zahl der Plätze, ohne etwas zu ändern', () => {
    const vorher = seite();
    const a = vergroesserung(vorher, VORLAGE, 'left', profil);
    if (typeof a === 'string') throw new Error(a);

    const getan = vergroessereSeite(seite(), VORLAGE, 'left', 'max', profil);
    if (typeof getan === 'string') throw new Error(getan);

    expect(a.max).toBeCloseTo(getan.faktorX, 9);
    expect(a.plaetze).toBe(4);
    expect(vorher).toEqual(seite());
  });

  it('meldet für eine volle Seite einen Faktor nahe 1', () => {
    const voll: Template = {
      ...VORLAGE,
      slots: [
        { id: 'a', x: 0.02, y: 0.02, w: 0.46, h: 0.96, prominence: 3 },
        ...VORLAGE.slots.filter((s) => s.x > 0.5),
      ],
    };
    const a = vergroesserung(seite(), voll, 'left', profil);
    if (typeof a === 'string') throw new Error(a);
    expect(a.max).toBeCloseTo(1, 2);
  });
});

describe('vergroessereSeite mit „einpassen"', () => {
  it('streckt Höhe und Breite getrennt, bis die Gruppe ihren Bereich füllt', () => {
    // Der wirksame Griff gegen den leeren Rand: Proportional begrenzt die
    // knappste Richtung, hier die Breite – die Höhe hätte doppelt so viel Luft.
    const proportional = vergroessereSeite(seite(), VORLAGE, 'left', 'max', profil);
    const eingepasst = vergroessereSeite(seite(), VORLAGE, 'left', 'einpassen', profil);
    if (typeof proportional === 'string' || typeof eingepasst === 'string') {
      throw new Error('unerwartet');
    }

    expect(eingepasst.faktorX).toBeCloseTo(proportional.faktorX, 9);
    expect(eingepasst.faktorY).toBeGreaterThan(eingepasst.faktorX);

    const { page } = profil;
    const randY = page.safetyMm / page.trimHeightMm;
    const falzX = page.gutterSafeMm / (2 * page.trimWidthMm);
    const h = huelle(eingepasst.spread, LINKS);
    expect(h.rechts).toBeCloseTo(0.5 - falzX, 6);
    expect(h.unten).toBeCloseTo(1 - randY, 6);
    expect(h.y).toBeCloseTo(randY, 6);
  });

  it('stellt die von Hand gesetzten Ausschnitte auf automatisch zurück und zählt sie', () => {
    // Ein manueller Ausschnitt ist auf die Form seines Platzes zugeschnitten,
    // und die ändert sich hier. Verschwiegen werden darf das nicht: Es ist
    // verworfene Handarbeit.
    const mitHand = seite();
    mitHand.slots[0]! = {
      ...mitHand.slots[0]!,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, mode: 'manual' },
    };
    const r = vergroessereSeite(mitHand, VORLAGE, 'left', 'einpassen', profil);
    if (typeof r === 'string') throw new Error(r);

    expect(r.ausschnitte).toBe(1);
    expect(r.spread.slots[0]!.crop.mode).toBe('auto-cover');
    // Die Gegenseite behält ihren – sie wird gar nicht angefasst.
    expect(r.spread.slots.find((s) => s.slotId === 'e')!.crop.mode).toBe('auto-cover');
  });

  it('lässt bei gleichem Maß in beiden Richtungen jeden Ausschnitt stehen', () => {
    // Eine Seite, deren Luft in beiden Richtungen gleich ist: Dann fällt
    // „einpassen" mit „proportional" zusammen, und es gibt nichts zu verwerfen.
    const quadratisch: Template = {
      ...VORLAGE,
      slots: [
        { id: 'a', x: 0.1, y: 0.2, w: 0.3, h: 0.6, prominence: 3 },
        ...VORLAGE.slots.filter((s) => s.x > 0.5),
      ],
    };
    const mitHand = seite();
    mitHand.slots[0]! = {
      ...mitHand.slots[0]!,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, mode: 'manual' },
    };
    const passt = vergroesserung(mitHand, quadratisch, 'left', profil);
    if (typeof passt === 'string') throw new Error(passt);
    const r = vergroessereSeite(mitHand, quadratisch, 'left', 'einpassen', profil);
    if (typeof r === 'string') throw new Error(r);

    // maxX und maxY unterscheiden sich hier kaum – der Ausschnitt bleibt, wenn
    // die Form gleich bleibt.
    if (Math.abs(passt.maxX - passt.maxY) < 1e-9) {
      expect(r.ausschnitte).toBe(0);
      expect(r.spread.slots[0]!.crop.mode).toBe('manual');
    }
  });

  it('meldet in der Auskunft, was ein Einpassen kosten würde', () => {
    const mitHand = seite();
    mitHand.slots[0]! = {
      ...mitHand.slots[0]!,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, mode: 'manual' },
    };
    const a = vergroesserung(mitHand, VORLAGE, 'left', profil);
    if (typeof a === 'string') throw new Error(a);

    expect(a.max).toBeCloseTo(Math.min(a.maxX, a.maxY), 9);
    expect(a.maxY).toBeGreaterThan(a.maxX);
    expect(a.ausschnitte).toBe(1);
  });
});

describe('Freiraum für den Zeitstrahl', () => {
  it('lässt den Fußraum frei, wenn der Zeitstrahl dort steht', () => {
    // 14 mm am Fuß (`TIMELINE_FOOT_HEIGHT_MM`): Ohne diese Angabe wuchs das
    // erste eingepasste Bild darunter, und der Strahl lag auf dem Motiv.
    const ohne = vergroessereSeite(seite(), VORLAGE, 'left', 'einpassen', profil);
    const mit = vergroessereSeite(seite(), VORLAGE, 'left', 'einpassen', profil, {
      unten: 14 / profil.page.trimHeightMm,
    });
    if (typeof ohne === 'string' || typeof mit === 'string') throw new Error('unerwartet');

    expect(mit.faktorY).toBeLessThan(ohne.faktorY);
    const h = huelle(mit.spread, LINKS);
    const grenze =
      1 - profil.page.safetyMm / profil.page.trimHeightMm - 14 / profil.page.trimHeightMm;
    expect(h.unten).toBeLessThanOrEqual(grenze + 1e-9);
  });

  it('lässt die Außenkante frei, wenn der Zeitstrahl dort steht', () => {
    const mit = vergroessereSeite(seite(), VORLAGE, 'left', 'einpassen', profil, {
      aussen: 6 / (2 * profil.page.trimWidthMm),
    });
    if (typeof mit === 'string') throw new Error(mit);

    const h = huelle(mit.spread, LINKS);
    const grenze = (profil.page.safetyMm + 6) / (2 * profil.page.trimWidthMm);
    expect(h.x).toBeGreaterThanOrEqual(grenze - 1e-9);
  });

  it('meldet den kleineren Faktor auch in der Auskunft', () => {
    // Auskunft und Griff müssen dieselbe Zahl nennen, sonst zeigt der Knopf
    // etwas anderes, als der Druck bewirkt.
    const frei = { unten: 14 / profil.page.trimHeightMm };
    const a = vergroesserung(seite(), VORLAGE, 'left', profil, frei);
    const getan = vergroessereSeite(seite(), VORLAGE, 'left', 'einpassen', profil, frei);
    if (typeof a === 'string' || typeof getan === 'string') throw new Error('unerwartet');
    expect(a.maxY).toBeCloseTo(getan.faktorY, 9);
  });
});
