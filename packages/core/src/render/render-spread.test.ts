import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { NaiveDateTime, Photo } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { requireTemplate } from '../templates/index.js';
import { renderSpread } from './render-spread.js';
import { imageBoxes } from './rendered-spread.js';

const profile = saal as PrintProfile;
const template = requireTemplate('spread.4up.grid');

function photo(id: string, width: number, height: number): Photo {
  return {
    id,
    relPath: `${id}.jpeg`,
    fileName: `${id}.jpeg`,
    bytes: 800_000,
    width,
    height,
    orientation: 1,
  };
}

/** Vier typische Bilder des echten Bestands: 2048 px lange Kante, gemischt. */
const PHOTOS = new Map<string, Photo>([
  ['p1', photo('p1', 2048, 1536)], // quer 4:3
  ['p2', photo('p2', 1536, 2048)], // hoch 3:4
  ['p3', photo('p3', 2048, 1152)], // quer 16:9
  ['p4', photo('p4', 2048, 2048)], // quadratisch
]);

function spreadWith(photoIds: (string | null)[]): Spread {
  return {
    id: 's1',
    index: 0,
    templateId: template.id,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
  };
}

const ctx = { profile, template, photos: PHOTOS };

describe('Doppelseitengeometrie', () => {
  it('hat die Maße des Druckprofils einschließlich Beschnitt', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(rsm.widthMm).toBe(606);
    expect(rsm.heightMm).toBe(306);
    expect(rsm.bleedMm).toBe(3);
  });

  it('legt die Falzachse in die Mitte des Endformats', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(rsm.gutterXMm).toBe(303); // 3 mm Beschnitt + 300 mm Seitenbreite
  });

  it('erzeugt Hilfslinien für Beschnitt, Endformat, Sicherheit und Falz', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    const kinds = rsm.guides.map((g) => g.kind);
    expect(kinds).toContain('bleed');
    expect(kinds).toContain('trim');
    expect(kinds).toContain('safety');
    expect(kinds).toContain('gutter');
  });
});

describe('Slotgeometrie des 4er-Rasters', () => {
  it('setzt die Slots auf die geplanten 120 mm im Quadrat', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    for (const box of imageBoxes(rsm)) {
      expect(box.wMm).toBeCloseTo(120, 1);
      expect(box.hMm).toBeCloseTo(120, 1);
    }
  });

  it('hält alle Slots innerhalb des Endformats', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    for (const box of imageBoxes(rsm)) {
      expect(box.xMm).toBeGreaterThanOrEqual(3);
      expect(box.yMm).toBeGreaterThanOrEqual(3);
      expect(box.xMm + box.wMm).toBeLessThanOrEqual(603);
      expect(box.yMm + box.hMm).toBeLessThanOrEqual(303);
    }
  });

  it('lässt die Falzzone frei', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    const gutterSafe = profile.page.gutterSafeMm;
    for (const box of imageBoxes(rsm)) {
      const kollidiert =
        box.xMm < rsm.gutterXMm + gutterSafe && box.xMm + box.wMm > rsm.gutterXMm - gutterSafe;
      expect(kollidiert).toBe(false);
    }
  });

  it('verteilt zwei Slots auf jede Seite', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    const links = imageBoxes(rsm).filter((b) => b.xMm + b.wMm <= rsm.gutterXMm);
    const rechts = imageBoxes(rsm).filter((b) => b.xMm >= rsm.gutterXMm);
    expect(links).toHaveLength(2);
    expect(rechts).toHaveLength(2);
  });
});

describe('Auflösung', () => {
  it('hält für den gesamten Bestand die Mindestauflösung ein', () => {
    // Das ist die eigentliche Zusage des Templates: 120 mm ist so gewählt,
    // dass auch der ungünstigste verbreitete Fall (16:9) durchkommt.
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    for (const box of imageBoxes(rsm)) {
      expect(box.effectiveDpi).toBeGreaterThanOrEqual(profile.resolution.minDpi);
      expect(box.warnings.map((w) => w.code)).not.toContain('below-min-dpi');
    }
  });

  it('hält für 4:3, 3:4 und quadratisch sogar die Zielauflösung', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', null, 'p4']), ctx);
    for (const box of imageBoxes(rsm)) {
      expect(box.effectiveDpi).toBeGreaterThanOrEqual(profile.resolution.targetDpi);
      expect(box.warnings).toHaveLength(0);
    }
  });

  it('rechnet die Auflösung über die sichtbaren Pixel, nicht die Bildgröße', () => {
    // Ein 16:9-Bild verliert im quadratischen Slot seitlich viel Fläche.
    // Maßgeblich sind die verbleibenden Pixel – deshalb ist dieses Bild trotz
    // 2048 px Breite der knappste Fall im ganzen Bestand.
    const rsm = renderSpread(spreadWith(['p3', null, null, null]), ctx);
    const box = imageBoxes(rsm)[0]!;
    const sichtbarePx = 1152; // die kurze Kante, nicht die lange
    expect(box.effectiveDpi).toBeCloseTo(sichtbarePx / (120 / 25.4), 0);
    expect(box.effectiveDpi).toBeGreaterThanOrEqual(profile.resolution.minDpi);
  });

  it('warnt unterhalb der Mindestauflösung', () => {
    const winzig = new Map(PHOTOS);
    winzig.set('klein', photo('klein', 400, 400));
    const rsm = renderSpread(spreadWith(['klein', null, null, null]), {
      ...ctx,
      photos: winzig,
    });
    const box = imageBoxes(rsm)[0]!;
    expect(box.effectiveDpi).toBeLessThan(profile.resolution.minDpi);
    expect(box.warnings.map((w) => w.code)).toContain('below-min-dpi');
  });

  it('warnt zwischen Mindest- und Zielauflösung getrennt', () => {
    // 1300 px in 124 mm ergibt rund 266 dpi: über 240, unter 300
    const mittel = new Map(PHOTOS);
    mittel.set('mittel', photo('mittel', 1300, 1300));
    const rsm = renderSpread(spreadWith(['mittel', null, null, null]), {
      ...ctx,
      photos: mittel,
    });
    const codes = imageBoxes(rsm)[0]!.warnings.map((w) => w.code);
    expect(codes).toContain('below-target-dpi');
    expect(codes).not.toContain('below-min-dpi');
  });
});

describe('Ausschnitt', () => {
  it('berechnet auto-cover für die tatsächlichen Slotmaße', () => {
    const rsm = renderSpread(spreadWith(['p1', null, null, null]), ctx);
    const box = imageBoxes(rsm)[0]!;
    // Quadratischer Slot, 4:3-Bild → seitlich beschnitten, volle Höhe
    expect(box.crop.h).toBeCloseTo(1, 6);
    expect(box.crop.w).toBeCloseTo(3 / 4, 6);
  });

  it('lässt einen manuell gesetzten Ausschnitt unangetastet', () => {
    const manuell: Spread = {
      ...spreadWith(['p1', null, null, null]),
      slots: [
        {
          slotId: 'a',
          photoId: 'p1',
          crop: { x: 0.1, y: 0.1, w: 0.4, h: 0.4, mode: 'manual' },
        },
      ],
    };
    const box = imageBoxes(renderSpread(manuell, ctx))[0]!;
    expect(box.crop).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.4, mode: 'manual' });
  });
});

describe('Randfälle', () => {
  it('stellt leere Slots als solche dar', () => {
    const rsm = renderSpread(spreadWith([null, null, null, null]), ctx);
    expect(imageBoxes(rsm)).toHaveLength(0);
    expect(rsm.boxes.filter((b) => b.kind === 'empty')).toHaveLength(4);
  });

  it('rendert weiter, wenn eine Bilddatei fehlt', () => {
    const rsm = renderSpread(spreadWith(['gibtesnicht', 'p2', null, null]), ctx);
    const boxen = imageBoxes(rsm);
    expect(boxen).toHaveLength(2);
    expect(boxen[0]!.warnings.map((w) => w.code)).toContain('photo-missing');
    // Das intakte Foto wird trotzdem normal gerendert
    expect(boxen[1]!.warnings).toHaveLength(0);
  });

  it('ist deterministisch', () => {
    const a = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    const b = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------- Zeitstrahl

function dateOfFactory(werte: Record<string, [string, 'high' | 'medium' | 'low' | 'none']>) {
  return (id: string) => {
    const eintrag = werte[id];
    if (!eintrag) return undefined;
    return {
      value: eintrag[0] as NaiveDateTime,
      source: 'exif' as const,
      confidence: eintrag[1],
      issues: [],
    };
  };
}

const DATEN = dateOfFactory({
  p1: ['2017-06-10T10:00:00', 'high'],
  p2: ['2017-06-20T10:00:00', 'high'],
  p3: ['2017-07-01T10:00:00', 'medium'],
  // Ein Dateidatum vom Kopiervorgang – es würde die Spanne über Jahre aufziehen.
  p4: ['2021-01-01T10:00:00', 'low'],
});

function spreadOfTemplate(templateId: string, photoIds: (string | null)[]): Spread {
  const t = requireTemplate(templateId);
  return {
    id: 's1',
    index: 0,
    templateId,
    slots: t.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
  };
}

const timelineCtx = { ...ctx, timeline: { dateOf: DATEN } };

describe('Zeitstrahl auf der Doppelseite', () => {
  it('bleibt weg, solange ihn niemand anfordert', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(rsm.boxes.some((b) => b.kind === 'polygon' || b.kind === 'rect')).toBe(false);
  });

  it('erscheint im Fußraum, wenn der Kontext ihn mitbringt', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), timelineCtx);
    const achse = rsm.boxes.filter((b) => b.kind === 'rect' && b.hMm === 0.3);
    expect(achse).toHaveLength(3);
    expect(rsm.boxes.filter((b) => b.kind === 'polygon')).toHaveLength(1);
  });

  it('weicht der Entscheidung der einzelnen Doppelseite', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), timeline: false };
    const rsm = renderSpread(spread, timelineCtx);
    expect(rsm.boxes.some((b) => b.kind === 'polygon')).toBe(false);
  });

  it('entfällt, wo ein Bild in den Fußraum reicht', () => {
    // Der randabfallende Gruppenauftakt ist heute die einzige solche Vorlage.
    const template = requireTemplate('spread.group.opener-full');
    const rsm = renderSpread(spreadOfTemplate(template.id, ['p1']), {
      ...timelineCtx,
      template,
    });
    expect(rsm.boxes.some((b) => b.kind === 'polygon')).toBe(false);
  });

  it('lässt Daten geringer Konfidenz aus der Spanne heraus', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), timelineCtx);
    const balken = rsm.boxes.find((b) => b.kind === 'rect' && b.hMm === 1.2);
    // 10. Juni bis 1. Juli, nicht bis 2021: gut drei Wochen, also unter 30 mm.
    if (balken?.kind !== 'rect') throw new Error('kein Spannbalken');
    expect(balken.wMm).toBeLessThan(30);
  });

  it('nimmt den Titel der Gruppe mit den meisten Fotos', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), {
      ...timelineCtx,
      timeline: {
        dateOf: DATEN,
        groupOf: (id: string) =>
          id === 'p3' ? { id: 'g2', title: 'Ausflug' } : { id: 'g1', title: 'Deichbrand 2017' },
      },
    });
    const label = rsm.boxes.find((b) => b.kind === 'text' && b.slotId === 'timeline-label');
    expect(label?.kind === 'text' && label.content).toBe('Deichbrand 2017');
  });

  it('verzichtet auf das Label, wenn die Vorlage den Titel schon als Überschrift trägt', () => {
    const titled = requireTemplate('spread.5up.offset.titled');
    const spread = {
      ...spreadOfTemplate(titled.id, ['p1', 'p2', 'p3', 'p4', null]),
      texts: [
        {
          id: 't1',
          role: 'eventTitle' as const,
          content: 'Deichbrand 2017',
          slotId: titled.textSlots![0]!.id,
        },
      ],
    };
    const rsm = renderSpread(spread, {
      ...timelineCtx,
      template: titled,
      timeline: { dateOf: DATEN, groupOf: () => ({ id: 'g1', title: 'Deichbrand 2017' }) },
    });
    const labels = rsm.boxes.filter((b) => b.kind === 'text' && b.slotId === 'timeline-label');
    expect(labels).toHaveLength(0);
  });
});

describe('Mehrzeilige Texte', () => {
  it('zerlegt Zeilen in eigene Boxen mit gleichem Abstand', () => {
    // Den Zeilenabstand darf kein Renderer selbst wählen: CSS line-height und
    // pdfkit lineGap würden auseinanderlaufen, und der Parity-Test müsste es
    // ausbaden. Deshalb steckt er in der Geometrie.
    const chapter = requireTemplate('spread.chapter.year');
    const eventSlot = chapter.textSlots!.find((t) => t.id === 't-events')!;
    const spread: Spread = {
      ...spreadOfTemplate(chapter.id, ['p1']),
      texts: [
        { id: 't1', role: 'year' as const, content: '2017', slotId: 't-year' },
        {
          id: 't2',
          role: 'freeText' as const,
          content: 'Erste Zeile\nZweite Zeile\nDritte Zeile',
          slotId: eventSlot.id,
        },
      ],
    };

    const rsm = renderSpread(spread, { ...ctx, template: chapter });
    const zeilen = rsm.boxes.filter((b) => b.kind === 'text' && b.slotId.startsWith('t-events'));
    expect(zeilen).toHaveLength(3);

    const y = zeilen.map((b) => (b.kind === 'text' ? b.yMm : 0));
    const abstand = y[1]! - y[0]!;
    expect(y[2]! - y[1]!).toBeCloseTo(abstand, 9);
    // Alle Zeilen tragen dieselbe Schriftgröße und passen in den Slot.
    const groessen = new Set(zeilen.map((b) => (b.kind === 'text' ? b.fontSizePt : 0)));
    expect(groessen.size).toBe(1);
    expect(abstand * 3).toBeCloseTo((eventSlot.h * profile.page.trimHeightMm) as number, 6);
  });

  it('behält für einzeilige Texte die Slothöhe', () => {
    const chapter = requireTemplate('spread.chapter.year');
    const spread: Spread = {
      ...spreadOfTemplate(chapter.id, ['p1']),
      texts: [{ id: 't1', role: 'year' as const, content: '2017', slotId: 't-year' }],
    };
    const rsm = renderSpread(spread, { ...ctx, template: chapter });
    const jahr = rsm.boxes.find((b) => b.kind === 'text' && b.slotId === 't-year');
    expect(jahr?.kind === 'text' && jahr.content).toBe('2017');
  });
});
