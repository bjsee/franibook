import { describe, expect, it } from 'vitest';
import type { PolygonBox, Rect, RectBox, TextBox } from './rendered-spread.js';
import { FRAMES, frameBoxes, frameHatFuss, frameInset, isFrameId } from './frame.js';
import { TEXT_STYLES, estimatedTextWidthMm } from './typography.js';

/** Ein Kasten in der Größenordnung, in der die Bilder dieses Buches stehen. */
const KASTEN: Rect = { xMm: 100, yMm: 50, wMm: 90, hMm: 60 };

function rects(frame: Parameters<typeof frameBoxes>[0]['frame'], rect = KASTEN): RectBox[] {
  const { hinter, davor } = frameBoxes({ aussen: rect, frame });
  return [...hinter, ...davor].filter((b): b is RectBox => b.kind === 'rect');
}

describe('Rahmenmaße', () => {
  it('lässt das Bild ohne Rahmen in voller Größe stehen', () => {
    expect(frameInset(KASTEN, 'keiner')).toEqual(KASTEN);
  });

  it('kostet bei Kontur und Klebestreifen keine Bildfläche', () => {
    // Beide liegen auf bzw. über der Bildkante. Ein Inset wäre hier kein
    // vergessener Fall, sondern ein falscher.
    expect(frameInset(KASTEN, 'kontur')).toEqual(KASTEN);
    expect(frameInset(KASTEN, 'klebestreifen')).toEqual(KASTEN);
  });

  it('nimmt das Passepartout ringsum gleich viel weg', () => {
    const innen = frameInset(KASTEN, 'passepartout');
    const links = innen.xMm - KASTEN.xMm;
    const rechts = KASTEN.xMm + KASTEN.wMm - (innen.xMm + innen.wMm);
    const oben = innen.yMm - KASTEN.yMm;
    const unten = KASTEN.yMm + KASTEN.hMm - (innen.yMm + innen.hMm);
    expect(rechts).toBeCloseTo(links, 6);
    expect(oben).toBeCloseTo(links, 6);
    expect(unten).toBeCloseTo(links, 6);
  });

  it('gibt dem Polaroid einen deutlich breiteren Fuß', () => {
    const innen = frameInset(KASTEN, 'polaroid');
    const seite = innen.xMm - KASTEN.xMm;
    const unten = KASTEN.yMm + KASTEN.hMm - (innen.yMm + innen.hMm);
    // 2,6 : 1 wie beim Original – daran ist die Form überhaupt erkennbar.
    expect(unten / seite).toBeCloseTo(2.6, 5);
  });

  it('hält den Rand auch am winzigen Kasten unter einem Viertel der kurzen Kante', () => {
    // Ohne die zweite Klemmung wären 7 mm Rand plus Fuß an einem 20-mm-Bild
    // mehr Karton als Bild.
    const klein: Rect = { xMm: 0, yMm: 0, wMm: 24, hMm: 20 };
    const innen = frameInset(klein, 'polaroid');
    expect(innen.wMm).toBeGreaterThan(klein.wMm / 2);
    expect(innen.hMm).toBeGreaterThan(klein.hMm / 2);
  });

  it('skaliert den Rand mit dem Bild', () => {
    // Ein fester Rand wäre am kleinen Bild ein Passepartout und am großen ein
    // Härchen – deshalb ein Anteil der kurzen Kante.
    const schmal = frameInset({ xMm: 0, yMm: 0, wMm: 50, hMm: 40 }, 'passepartout');
    const breit = frameInset({ xMm: 0, yMm: 0, wMm: 150, hMm: 120 }, 'passepartout');
    expect(breit.xMm).toBeGreaterThan(schmal.xMm);
  });
});

describe('Rahmenboxen', () => {
  it('erzeugt ohne Rahmen keine einzige Box', () => {
    expect(frameBoxes({ aussen: KASTEN, frame: 'keiner' })).toEqual({ hinter: [], davor: [] });
  });

  it('legt Karton und Schatten hinter das Bild, Kontur und Streifen davor', () => {
    expect(frameBoxes({ aussen: KASTEN, frame: 'polaroid' }).davor).toHaveLength(0);
    expect(frameBoxes({ aussen: KASTEN, frame: 'polaroid' }).hinter).toHaveLength(2);
    expect(frameBoxes({ aussen: KASTEN, frame: 'kontur' }).hinter).toHaveLength(0);
    expect(frameBoxes({ aussen: KASTEN, frame: 'kontur' }).davor).toHaveLength(1);
  });

  it('deckt den Karton über den ganzen Außenkasten', () => {
    const karton = rects('polaroid').at(-1)!;
    expect(karton).toMatchObject({ xMm: 100, yMm: 50, wMm: 90, hMm: 60 });
  });

  it('versetzt den Schatten nach rechts unten und macht ihn durchscheinend', () => {
    const [schatten] = rects('polaroid');
    expect(schatten!.xMm).toBeGreaterThan(KASTEN.xMm);
    expect(schatten!.yMm).toBeGreaterThan(KASTEN.yMm);
    expect(schatten!.opacity).toBeLessThan(1);
  });

  it('füllt die Kontur nicht, sonst verdeckte sie das Bild', () => {
    const [kontur] = rects('kontur');
    expect(kontur!.fill).toBe('none');
    expect(kontur!.stroke).toBeTruthy();
    expect(kontur!.strokeWidthMm).toBeGreaterThan(0);
  });

  it('gibt nur dem Passepartout eine Kontur, nicht dem Polaroid', () => {
    // Ein Sofortbild hat keine Umrandung, es hat einen Schatten.
    expect(rects('passepartout').at(-1)!.stroke).toBeTruthy();
    expect(rects('polaroid').at(-1)!.stroke).toBeUndefined();
  });

  it('dreht alle Boxen um die Mitte des Außenkastens, nicht um ihre eigene', () => {
    // Der Karton des Polaroids hat unten mehr Rand: Führe jede Box ihren
    // eigenen Drehpunkt, rutschte das Bild darin, je stärker es geneigt ist.
    const mitte = { xMm: 145, yMm: 80 };
    for (const box of rects('polaroid', KASTEN)) {
      expect(box.rotateAboutMm).toBeUndefined();
    }
    const { hinter } = frameBoxes({ aussen: KASTEN, frame: 'polaroid', rotateDeg: 3 });
    for (const box of hinter) {
      expect(box).toMatchObject({ rotateDeg: 3, rotateAboutMm: mitte });
    }
  });
});

describe('Klebestreifen', () => {
  function streifen(rotateDeg = 0): PolygonBox[] {
    return frameBoxes({ aussen: KASTEN, frame: 'klebestreifen', rotateDeg }).davor.filter(
      (b): b is PolygonBox => b.kind === 'polygon',
    );
  }

  it('legt je einen Streifen über zwei gegenüberliegende Ecken', () => {
    const beide = streifen();
    expect(beide).toHaveLength(2);
    for (const s of beide) expect(s.pointsMm).toHaveLength(4);
  });

  it('ist durchscheinend – sonst liest er sich als aufgeklebtes Papier', () => {
    expect(streifen()[0]!.opacity).toBeLessThan(1);
  });

  it('liegt mittig auf der Ecke, ragt also über das Bild hinaus', () => {
    const [obenLinks] = streifen();
    const xs = obenLinks!.pointsMm.map((p) => p.xMm);
    const ys = obenLinks!.pointsMm.map((p) => p.yMm);
    expect(Math.min(...xs)).toBeLessThan(KASTEN.xMm);
    expect(Math.min(...ys)).toBeLessThan(KASTEN.yMm);
  });

  it('trägt die Drehung in den Punkten und nicht als Transformation', () => {
    // Ein Polygon führt seine Koordinaten absolut; zwei Wege, dieselbe Lage
    // auszudrücken, laufen irgendwann auseinander.
    const gerade = streifen()[0]!;
    const schief = streifen(10)[0]!;
    expect(schief).not.toHaveProperty('rotateDeg');
    expect(schief.pointsMm[0]!.xMm).not.toBeCloseTo(gerade.pointsMm[0]!.xMm, 3);
  });

  it('behält die Kantenlängen beim Drehen', () => {
    const laenge = (b: PolygonBox, i: number, j: number) =>
      Math.hypot(b.pointsMm[i]!.xMm - b.pointsMm[j]!.xMm, b.pointsMm[i]!.yMm - b.pointsMm[j]!.yMm);
    expect(laenge(streifen(37)[0]!, 0, 1)).toBeCloseTo(laenge(streifen()[0]!, 0, 1), 6);
  });
});

describe('Rahmenkennungen', () => {
  it('erkennt die bekannten Rahmen und weist alles andere ab', () => {
    for (const f of FRAMES) expect(isFrameId(f.id)).toBe(true);
    expect(isFrameId('goldrahmen')).toBe(false);
    expect(isFrameId(undefined)).toBe(false);
  });
});

describe('Bildunterschrift', () => {
  function text(frame: Parameters<typeof frameBoxes>[0]['frame'], caption: string, rect = KASTEN) {
    const { hinter, davor } = frameBoxes({ aussen: rect, frame, caption, slotId: 'a' });
    return [...hinter, ...davor].find((b): b is TextBox => b.kind === 'text');
  }

  it('steht im Fuß des Polaroids', () => {
    const box = text('polaroid', 'Sylt, Juli 2015')!;
    const innen = frameInset(KASTEN, 'polaroid');
    expect(box.yMm).toBeCloseTo(innen.yMm + innen.hMm, 6);
    expect(box.yMm + box.hMm).toBeCloseTo(KASTEN.yMm + KASTEN.hMm, 6);
    expect(box.content).toBe('Sylt, Juli 2015');
    expect(box.align).toBe('center');
  });

  /**
   * Nur das Polaroid hat einen Fuß. Bei jedem anderen Rahmen bleibt der Text
   * gespeichert, erscheint aber nicht – die Alternative wäre, ihn irgendwo
   * unter das Bild auf den Seitenhintergrund zu setzen, und das ist kein Rahmen
   * mehr, sondern ein freier Textblock.
   */
  it('erscheint nur bei einem Rahmen mit Fuß', () => {
    expect(frameHatFuss('polaroid')).toBe(true);
    for (const frame of ['keiner', 'passepartout', 'kontur', 'klebestreifen'] as const) {
      expect(frameHatFuss(frame)).toBe(false);
      expect(text(frame, 'Sylt')).toBeUndefined();
    }
  });

  it('schreibt in Handschrift und nicht in der Buchschrift', () => {
    // Auf ein Sofortbild schreibt man mit dem Filzstift.
    expect(text('polaroid', 'Sylt')!.family).toBe('hand');
  });

  it('lässt leere und nur aus Leerzeichen bestehende Texte weg', () => {
    expect(text('polaroid', '')).toBeUndefined();
    expect(text('polaroid', '   ')).toBeUndefined();
  });

  it('nimmt die Farbe aus dem Stil, nicht aus dem Seitenhintergrund', () => {
    // Der Text steht auf dem hellen Karton. Auf einer Doppelseite in Anthrazit
    // stünde sonst weiße Schrift auf weißem Grund.
    expect(text('polaroid', 'Sylt')!.color).toBe(TEXT_STYLES.caption.color);
  });

  it('verkleinert die Schrift, statt einen langen Satz abzuschneiden', () => {
    const kurz = text('polaroid', 'Sylt')!;
    const lang = text('polaroid', 'Zwei Wochen an der Nordsee mit Oma und Opa, Juli 2015')!;
    expect(lang.content).toContain('Nordsee');
    expect(lang.fontSizePt).toBeLessThan(kurz.fontSizePt);
    // Und sie bleibt im Kasten: geschätzte Breite höchstens die Kastenbreite.
    expect(estimatedTextWidthMm(lang.content, lang.fontSizePt)).toBeLessThanOrEqual(
      lang.wMm + 1e-6,
    );
  });

  it('dreht mit dem Rahmen um denselben Punkt', () => {
    const { davor } = frameBoxes({
      aussen: KASTEN,
      frame: 'polaroid',
      caption: 'Sylt',
      rotateDeg: 3,
    });
    const box = davor.find((b): b is TextBox => b.kind === 'text')!;
    expect(box).toMatchObject({ rotateDeg: 3, rotateAboutMm: { xMm: 145, yMm: 80 } });
  });

  it('gibt jeder Unterschrift eine eigene Kennung', () => {
    // Zwei Polaroids auf einer Doppelseite hätten sonst zweimal dieselbe – in
    // der Vorschau ein doppelter React-Key.
    const a = text('polaroid', 'Sylt')!;
    const b = frameBoxes({ aussen: KASTEN, frame: 'polaroid', caption: 'Kreta', slotId: 'b' })
      .davor[0] as TextBox;
    expect(a.slotId).not.toBe(b.slotId);
  });
});
