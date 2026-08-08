/**
 * Justierte Zeilen: die Zusagen, die die Rechnung einhalten muss.
 *
 * Formtreue ist der Zweck der Sache – deshalb steht sie hier zuerst. Der Rest
 * sind die Grenzen des Satzspiegels; sie zu prüfen ist billiger als eine
 * gedruckte Seite mit einem Bild im Falz.
 */
import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import { defaultProfile } from '../print/profiles/index.js';
import { requireTemplate, templatesWithoutTitle } from '../templates/index.js';
import { isJustified, justifiedTemplateId } from '../templates/justified.js';
import { justifiedRects, justifyBounds } from './justify.js';
import { layoutSpread } from './rebuild.js';

const profile = defaultProfile();
const { marginMm, gutterMm } = justifyBounds(profile);
const spreadW = 2 * profile.page.trimWidthMm;
const pageH = profile.page.trimHeightMm;

function foto(id: string, w: number, h: number): Photo {
  return {
    id,
    relPath: id,
    fileName: id,
    bytes: 1_000_000,
    width: w,
    height: h,
    orientation: 1,
  } as Photo;
}

const quer = (i: number) => foto(`q${i}`, 4000, 3000);
const hoch = (i: number) => foto(`h${i}`, 3000, 4000);

function mm(r: { x: number; y: number; w: number; h: number }) {
  return {
    xMm: r.x * spreadW,
    yMm: r.y * pageH,
    wMm: r.w * spreadW,
    hMm: r.h * pageH,
  };
}

/** Die Mischungen, an denen sich die Rechnung bewähren muss. */
const faelle: [string, Photo[]][] = [
  ['fünf quer', Array.from({ length: 5 }, (_, i) => quer(i))],
  ['sechs hoch', Array.from({ length: 6 }, (_, i) => hoch(i))],
  [
    'dreizehn gemischt',
    [
      ...Array.from({ length: 5 }, (_, i) => quer(i)),
      ...Array.from({ length: 8 }, (_, i) => hoch(i)),
    ],
  ],
  ['sechzehn abwechselnd', Array.from({ length: 16 }, (_, i) => (i % 2 ? quer(i) : hoch(i)))],
  ['eins quer', [quer(0)]],
];

describe('justifiedRects', () => {
  it.each(faelle)('%s: jedes Bild behält seine Ausrichtung', (_name, bilder) => {
    const rects = justifiedRects({ photos: bilder, profile });
    expect(rects).toHaveLength(bilder.length);

    for (const [i, r] of rects.entries()) {
      const { wMm, hMm } = mm(r);
      const soll = bilder[i]!.width / bilder[i]!.height;
      // Der Zoom darf die Form stauchen, aber nur bis MAX_ZOOM – und niemals so
      // weit, dass ein Querformat hochkant steht. Genau das ist der Fehler, um
      // dessentwillen die Rechnung überhaupt existiert.
      expect(wMm / hMm, `Bild ${i}`).toBeGreaterThanOrEqual(soll / 1.26);
      expect(wMm / hMm, `Bild ${i}`).toBeLessThanOrEqual(soll / 0.79);
      expect(Math.sign(wMm / hMm - 1), `Ausrichtung von Bild ${i}`).toBe(Math.sign(soll - 1));
    }
  });

  it.each(faelle)('%s: jede Zeile füllt die Satzbreite', (_name, bilder) => {
    // Der Sinn justierter Zeilen: keine ausgefranste rechte Kante. Bilder mit
    // gleichem Rechteck-Oberkant bilden eine Zeile.
    const rects = justifiedRects({ photos: bilder, profile });
    const zeilen = new Map<string, { x: number; w: number }[]>();
    for (const r of rects) {
      const { xMm, yMm, wMm } = mm(r);
      const key = `${Math.round(yMm)}|${xMm < profile.page.trimWidthMm ? 'l' : 'r'}`;
      zeilen.set(key, [...(zeilen.get(key) ?? []), { x: xMm, w: wMm }]);
    }
    for (const [key, teile] of zeilen) {
      const links = Math.min(...teile.map((t) => t.x));
      const rechts = Math.max(...teile.map((t) => t.x + t.w));
      expect(rechts - links, `Zeile ${key}`).toBeCloseTo(justifyBounds(profile).innerWidthMm, 1);
    }
  });

  it.each(faelle)('%s: kein Bild verlässt den Satzspiegel', (_name, bilder) => {
    for (const [i, r] of justifiedRects({ photos: bilder, profile }).entries()) {
      const { xMm, yMm, wMm, hMm } = mm(r);
      expect(xMm, `Bild ${i} links`).toBeGreaterThanOrEqual(marginMm - 0.01);
      expect(xMm + wMm, `Bild ${i} rechts`).toBeLessThanOrEqual(spreadW - marginMm + 0.01);
      expect(yMm, `Bild ${i} oben`).toBeGreaterThanOrEqual(marginMm - 0.01);
      expect(yMm + hMm, `Bild ${i} unten`).toBeLessThanOrEqual(pageH - marginMm + 0.01);
    }
  });

  it.each(faelle)('%s: kein Bild liegt im Falz', (_name, bilder) => {
    const falz = profile.page.trimWidthMm;
    for (const [i, r] of justifiedRects({ photos: bilder, profile }).entries()) {
      const { xMm, wMm } = mm(r);
      const linkeSeite = xMm + wMm <= falz - gutterMm + 0.01;
      const rechteSeite = xMm >= falz + gutterMm - 0.01;
      expect(linkeSeite || rechteSeite, `Bild ${i} bei ${xMm.toFixed(1)} mm`).toBe(true);
    }
  });

  it('teilt die Bilder in Leserichtung auf die beiden Seiten', () => {
    // Sonst stünde die Chronologie auf dem Kopf: Die Slots der Trägervorlage
    // liegen in derselben Ordnung, links vor rechts.
    const rects = justifiedRects({
      photos: [quer(0), quer(1), quer(2), quer(3), quer(4)],
      profile,
    });
    const falz = profile.page.trimWidthMm;
    const seiten = rects.map((r) => (mm(r).xMm < falz ? 'links' : 'rechts'));
    expect(seiten).toEqual(['links', 'links', 'links', 'rechts', 'rechts']);
  });

  it('bleibt über der Mindestkante oder gibt auf', () => {
    // 28 mm: Darunter ist es ein Farbfleck. Die Rechnung darf dann nichts
    // liefern – dann bleibt es bei einer Vorlage.
    const viele = Array.from({ length: 16 }, (_, i) => hoch(i));
    const rects = justifiedRects({ photos: viele, profile });
    if (rects.length > 0) {
      const kanten = rects.map((r) => Math.min(mm(r).wMm, mm(r).hMm));
      expect(Math.min(...kanten)).toBeGreaterThanOrEqual(28);
    }
  });

  it('gibt bei keinem Bild nichts zurück', () => {
    expect(justifiedRects({ photos: [], profile })).toEqual([]);
  });

  it('skaliert den Satzspiegel mit dem Format', () => {
    // Die Ränder sind an der Bibliothek gemessen (22 mm auf 300 mm Seite); ein
    // kleineres Buch soll dieselben Verhältnisse bekommen, nicht dieselben
    // Millimeter.
    const gross = justifyBounds(profile);
    const klein = justifyBounds({
      ...profile,
      page: { ...profile.page, trimWidthMm: 210, trimHeightMm: 210 },
    });
    // Der Bezug ist die 300 mm hohe Referenzseite der Bibliothek, nicht das
    // gerade gewählte Format: 270 mm ergeben 19,8 mm Rand.
    expect(gross.marginMm).toBeCloseTo(22 * (profile.page.trimHeightMm / 300), 5);
    expect(klein.marginMm).toBeCloseTo(22 * (210 / 300), 5);
  });
});

/**
 * Die Entscheidung zwischen Bibliothek und Rechnung.
 *
 * Sie ist der eigentliche Eingriff ins Buch: Wer hier zu großzügig ist, ersetzt
 * jede gestaltete Doppelseite durch ein Gitter, wer zu zurückhaltend ist, ändert
 * nichts.
 */
describe('layoutSpread mit justierten Zeilen', () => {
  const gemischt = [
    ...Array.from({ length: 6 }, (_, i) => quer(i)),
    ...Array.from({ length: 6 }, (_, i) => hoch(i)),
  ];

  it('rechnet selbst, wenn keine Vorlage die Mischung trägt', () => {
    const gelegt = layoutSpread({ photos: gemischt, profile });
    expect(isJustified(gelegt?.templateId)).toBe(true);
    expect(gelegt?.slots.every((sl) => sl.rect !== undefined)).toBe(true);
    expect(gelegt?.leftover).toEqual([]);
  });

  it('lässt der Bibliothek kleine Seiten', () => {
    // Vier Bilder sind eine Gestaltungsfrage, kein Rechenproblem.
    const gelegt = layoutSpread({ photos: [quer(0), hoch(1), quer(2), hoch(3)], profile });
    expect(isJustified(gelegt?.templateId)).toBe(false);
    expect(gelegt?.slots.every((sl) => sl.rect === undefined)).toBe(true);
  });

  it('rührt eine gezielt angeforderte Vorlage nicht an', () => {
    // Jahresauftakte und die Handauswahl kommen mit eigener Liste; dort ist die
    // Anordnung die Absicht.
    const kandidaten = templatesWithoutTitle(gemischt.length);
    const gelegt = layoutSpread({ photos: gemischt, profile, candidates: kandidaten });
    expect(isJustified(gelegt?.templateId)).toBe(false);
  });

  it('justiert auf Verlangen, auch wenn eine Vorlage gewinnen würde', () => {
    const gelegt = layoutSpread({
      photos: gemischt,
      profile,
      templateId: justifiedTemplateId(gemischt.length),
    });
    expect(isJustified(gelegt?.templateId)).toBe(true);
  });

  it('richtet die Kennung nach der tatsächlichen Bilderzahl', () => {
    // Nach dem Umhängen eines Fotos stimmt die gespeicherte Kennung nicht mehr.
    // Sie soll die Seite dann nicht mit einem leeren Platz zurücklassen.
    const weniger = gemischt.slice(0, 11);
    const gelegt = layoutSpread({ photos: weniger, profile, templateId: 'justiert.12' });
    expect(gelegt?.templateId).toBe('justiert.11');
    expect(gelegt?.slots.filter((sl) => sl.photoId !== null)).toHaveLength(11);
  });

  it('weicht der Bibliothek, wenn ein Bild als Hauptbild ausgezeichnet ist', () => {
    // Justierte Plätze sind alle gleich gewichtet. Eine Auszeichnung bliebe hier
    // wirkungslos, und zwar unsichtbar – am echten Buch auf einem Drittel der
    // Doppelseiten. Also gestaltet dort die Bibliothek, die eine Hierarchie hat.
    const gelegt = layoutSpread({
      photos: gemischt,
      profile,
      weightOf: (id) => (id === 'q0' ? 'hero' : 'normal'),
    });
    expect(isJustified(gelegt?.templateId)).toBe(false);

    // Und das Hauptbild steht im prominentesten Platz dieser Vorlage.
    const vorlage = requireTemplate(gelegt!.templateId);
    const anker = vorlage.slots.reduce((a, b) => (b.prominence > a.prominence ? b : a));
    expect(gelegt?.slots.find((sl) => sl.slotId === anker.id)?.photoId).toBe('q0');
  });

  it('weicht der Bibliothek auch für ein Beifoto', () => {
    // Dieselbe Aussage von der anderen Seite: „Dieses Bild soll die Seite nicht
    // tragen." Nur `hero` zu prüfen hieße, die Zusage der Oberfläche („rückt in
    // einen kleinen Platz") für die Hälfte der Fälle zu brechen.
    const gelegt = layoutSpread({
      photos: gemischt,
      profile,
      weightOf: (id) => (id === 'q0' ? 'filler' : 'normal'),
    });
    expect(isJustified(gelegt?.templateId)).toBe(false);

    const vorlage = requireTemplate(gelegt!.templateId);
    const anker = vorlage.slots.reduce((a, b) => (b.prominence > a.prominence ? b : a));
    expect(gelegt?.slots.find((sl) => sl.slotId === anker.id)?.photoId).not.toBe('q0');
  });

  it('lässt eine von Hand gewählte justierte Vorlage trotz Hauptbild stehen', () => {
    // Die Handauswahl schlägt die Automatik – wie überall sonst auch.
    const gelegt = layoutSpread({
      photos: gemischt,
      profile,
      templateId: justifiedTemplateId(gemischt.length),
      weightOf: (id) => (id === 'q0' ? 'hero' : 'normal'),
    });
    expect(isJustified(gelegt?.templateId)).toBe(true);
  });

  it('fällt auf die Bibliothek zurück, wenn justierte Kennung nicht aufgeht', () => {
    // Zwei Bilder sind unter der Mindestzahl; die Kennung darf nicht dazu führen,
    // dass die Seite ihr Rückfallgitter bekommt.
    const gelegt = layoutSpread({ photos: [quer(0), quer(1)], profile, templateId: 'justiert.2' });
    expect(isJustified(gelegt?.templateId)).toBe(false);
    expect(gelegt?.slots).toHaveLength(2);
  });
});
