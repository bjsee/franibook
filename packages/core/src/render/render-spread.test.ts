import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { NaiveDateTime, Photo } from '../model/photo.js';
import type { Spread, TextElement } from '../model/spread.js';
import { requireTemplate } from '../templates/index.js';
import { renderSpread } from './render-spread.js';
import { DEFAULT_TILT_DEG } from './tilt.js';
import { imageBoxes } from './rendered-spread.js';
import { estimatedTextWidthMm } from './typography.js';

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

describe('Fokuspunkt aus Gesichtern', () => {
  /** Dasselbe Hochformat wie `p2`, aber mit einem Gesicht am oberen Rand. */
  const mitGesicht = new Map<string, Photo>([
    ['p2', { ...photo('p2', 1536, 2048), faces: [{ x: 0.45, y: 0.06, w: 0.1, h: 0.08 }] }],
  ]);

  function ausschnittVon(photos: Map<string, Photo>) {
    const gerendert = renderSpread(spreadWith([null, 'p2', null, null]), { ...ctx, photos });
    return imageBoxes(gerendert)[0]!.crop;
  }

  it('verschiebt den Ausschnitt nach oben, statt ihn zu verkleinern', () => {
    const ohne = ausschnittVon(PHOTOS);
    const mit = ausschnittVon(mitGesicht);

    expect(mit.y).toBeLessThan(ohne.y);
    // Die Größe bleibt gleich — daran hängt, dass `bookStats` und `slotCost`
    // weiter ohne Fokuspunkt rechnen dürfen und dieselbe Auflösung bekommen.
    expect(mit.w).toBeCloseTo(ohne.w, 12);
    expect(mit.h).toBeCloseTo(ohne.h, 12);
  });

  it('lässt ein Foto ohne erkannte Gesichter unverändert', () => {
    // Jedes Foto aus einem Projekt von vor der Erkennung: bitgleich wie vorher.
    const gerendert = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    for (const box of imageBoxes(gerendert)) {
      expect(box.crop.y).toBeCloseTo(box.crop.h < 1 ? (1 - box.crop.h) / 2 : 0, 12);
      expect(box.crop.x).toBeCloseTo(box.crop.w < 1 ? (1 - box.crop.w) / 2 : 0, 12);
    }
  });

  it('lässt einen von Hand gesetzten Ausschnitt in Ruhe', () => {
    // `manual` schlägt jede Automatik — auch die Gesichtserkennung. Sonst
    // sprang ein gezogener Ausschnitt beim nächsten Rendern zurück.
    const seite = spreadWith([null, 'p2', null, null]);
    seite.slots[1] = {
      slotId: seite.slots[1]!.slotId,
      photoId: 'p2',
      crop: { x: 0.3, y: 0.6, w: 0.4, h: 0.3, mode: 'manual' },
    };
    const box = imageBoxes(renderSpread(seite, { ...ctx, photos: mitGesicht }))[0]!;
    expect(box.crop.y).toBeGreaterThan(0.5);
  });
});

describe('Gesichter am Rand und im Falz', () => {
  /** Die Warnung dieses Bildes, wenn es eine gibt. */
  function warnung(seite: Spread, photos: Map<string, Photo>) {
    const boxen = imageBoxes(renderSpread(seite, { ...ctx, photos }));
    return boxen[0]?.warnings.find((w) => w.code === 'face-at-edge');
  }

  /** Ein Slot, der die Falzachse überspannt — wie ein Bild über beide Seiten. */
  function ueberDenFalz(): Spread {
    const seite = spreadWith(['p1', null, null, null]);
    seite.slots[0] = {
      slotId: seite.slots[0]!.slotId,
      photoId: 'p1',
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
      rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.3 },
    };
    return seite;
  }

  it('meldet ein Gesicht in der Falzzone', () => {
    // Gesicht in der Bildmitte, Kasten mittig über der Achse: Genau der Fall,
    // in dem im gebundenen Buch ein Teil des Kopfes im Bund verschwindet.
    const photos = new Map([
      ['p1', { ...photo('p1', 2048, 2048), faces: [{ x: 0.45, y: 0.45, w: 0.1, h: 0.1 }] }],
    ]);
    expect(warnung(ueberDenFalz(), photos)).toEqual({
      code: 'face-at-edge',
      wo: 'falz',
      anzahl: 1,
    });
  });

  it('schweigt, wenn das Gesicht neben der Falzzone liegt', () => {
    const photos = new Map([
      ['p1', { ...photo('p1', 2048, 2048), faces: [{ x: 0.02, y: 0.45, w: 0.08, h: 0.08 }] }],
    ]);
    expect(warnung(ueberDenFalz(), photos)).toBeUndefined();
  });

  it('meldet den Beschnitt und nicht den Falz, wenn beides zutrifft', () => {
    // Was über die Endformatkante ragt, ist nach dem Schneiden ganz weg — das
    // wiegt schwerer als ein teilweise im Bund verschwundener Kopf.
    const seite = spreadWith(['p1', null, null, null]);
    seite.slots[0] = {
      slotId: seite.slots[0]!.slotId,
      photoId: 'p1',
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
      // Randabfallend über die linke obere Ecke hinaus.
      rect: { x: -0.02, y: -0.02, w: 0.5, h: 0.4 },
    };
    const photos = new Map([
      ['p1', { ...photo('p1', 2048, 2048), faces: [{ x: 0, y: 0, w: 0.06, h: 0.06 }] }],
    ]);
    expect(warnung(seite, photos)).toMatchObject({ wo: 'beschnitt' });
  });

  it('übergeht ein Gesicht, das der Ausschnitt ohnehin abschneidet', () => {
    // Es ist nicht im Buch, also ist seine Lage auf dem Papier keine Auskunft.
    const seite = ueberDenFalz();
    seite.slots[0] = { ...seite.slots[0]!, crop: { x: 0.5, y: 0, w: 0.5, h: 0.5, mode: 'manual' } };
    const photos = new Map([
      ['p1', { ...photo('p1', 2048, 2048), faces: [{ x: 0.0, y: 0.8, w: 0.08, h: 0.08 }] }],
    ]);
    expect(warnung(seite, photos)).toBeUndefined();
  });

  it('meldet den Beschnitt am vollflächigen Gruppenauftakt', () => {
    // Die einzige Vorlage der Bibliothek mit randabfallendem Slot (geprüft: 1
    // von 112) und damit die einzige Stelle, an der die Automatik diese Warnung
    // überhaupt auslösen kann. Sonst entsteht sie nur an von Hand gezogenen
    // Kästen — deswegen dieser Test mit der echten Vorlage statt einem
    // konstruierten Rechteck.
    const auftakt = requireTemplate('spread.group.opener-full');
    const seite: Spread = {
      id: 's1',
      index: 0,
      templateId: auftakt.id,
      slots: [{ slotId: 'a', photoId: 'p1', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } }],
    };
    const photos = new Map([
      // Gesicht am rechten Bildrand: Der Slot ragt dort über die Endformatkante
      // hinaus, also wird der Kopf beim Schneiden angeschnitten.
      ['p1', { ...photo('p1', 2048, 2048), faces: [{ x: 0.94, y: 0.4, w: 0.06, h: 0.06 }] }],
    ]);
    const boxen = imageBoxes(renderSpread(seite, { ...ctx, template: auftakt, photos }));
    expect(boxen[0]!.warnings).toContainEqual({
      code: 'face-at-edge',
      wo: 'beschnitt',
      anzahl: 1,
    });
  });

  it('schweigt bei einem Salienzobjekt', () => {
    // Ein Aufmerksamkeitsbereich umfasst oft die halbe Fläche und läge damit
    // fast immer irgendwo am Rand — als Warnung wäre er Rauschen.
    const photos = new Map([
      ['p1', { ...photo('p1', 2048, 2048), salience: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }],
    ]);
    expect(warnung(ueberDenFalz(), photos)).toBeUndefined();
  });
});

describe('Doppelseitengeometrie', () => {
  it('hat die Maße des Druckprofils einschließlich Beschnitt', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(rsm.widthMm).toBe(546); // 2 × 270 + 2 × 3
    expect(rsm.heightMm).toBe(276);
    expect(rsm.bleedMm).toBe(3);
  });

  it('legt die Falzachse in die Mitte des Endformats', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(rsm.gutterXMm).toBe(273); // 3 mm Beschnitt + 270 mm Seitenbreite
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

describe('Ebenen im Rendered Spread Model', () => {
  it('zeichnet die Bilder in der Reihenfolge der Vorlage, solange keine Ebene gesetzt ist', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(imageBoxes(rsm).map((b) => b.slotId)).toEqual(template.slots.map((s) => s.id));
  });

  it('zeichnet ein Bild mit höherer Ebene später und damit darüber', () => {
    // Die Reihenfolge der Boxen *ist* die Zeichenreihenfolge – kein Renderer
    // sortiert nach. Wäre es anders, könnten Vorschau und PDF verschiedene
    // Bilder oben zeigen.
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    const gestapelt = {
      ...spread,
      slots: spread.slots.map((s) => (s.slotId === 'a' ? { ...s, layer: 3 } : s)),
    };
    const rsm = renderSpread(gestapelt, ctx);
    expect(imageBoxes(rsm).map((b) => b.slotId)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('lässt Texte und Zeitstrahl über den Bildern, unabhängig von der Ebene', () => {
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    const rsm = renderSpread(
      {
        ...spread,
        slots: spread.slots.map((s) => ({ ...s, layer: 99 })),
        blocks: [
          {
            id: 'b1',
            content: 'Nachsatz',
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
            weight: 'regular' as const,
            fontSizePt: 12,
            align: 'left' as const,
          },
        ],
      },
      timelineCtx,
    );
    const letzteBild = rsm.boxes.map((b) => b.kind).lastIndexOf('image');
    const text = rsm.boxes.findIndex((b) => b.kind === 'text');
    expect(text).toBeGreaterThan(letzteBild);
  });
});

/**
 * Die Slots der Bibliothek sind auf ihre 600 × 300 mm große Referenzseite
 * geschrieben und werden beim Laden normiert. Im Standardformat (540 × 270)
 * ergeben die dort geplanten 120 mm also 108.
 */
const SLOT_MM = 120 * (profile.page.trimHeightMm / 300);

describe('Slotgeometrie des 4er-Rasters', () => {
  it('setzt die Slots auf die geplanten 120 mm im Quadrat der Referenz', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    for (const box of imageBoxes(rsm)) {
      expect(box.wMm).toBeCloseTo(SLOT_MM, 1);
      expect(box.hMm).toBeCloseTo(SLOT_MM, 1);
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
    expect(box.effectiveDpi).toBeCloseTo(sichtbarePx / (SLOT_MM / 25.4), 0);
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
    // 1150 px in 108 mm ergibt rund 270 dpi: über 240, unter 300
    const mittel = new Map(PHOTOS);
    mittel.set('mittel', photo('mittel', 1150, 1150));
    const rsm = renderSpread(spreadWith(['mittel', null, null, null]), {
      ...ctx,
      photos: mittel,
    });
    const codes = imageBoxes(rsm)[0]!.warnings.map((w) => w.code);
    expect(codes).toContain('below-target-dpi');
    expect(codes).not.toContain('below-min-dpi');
  });
});

describe('Bild und Platz stehen quer zueinander', () => {
  // Sechs hochkante Plätze (3:4). Ein Querformat darin sieht zwangsläufig nur
  // einen Streifen – dieselbe Lage wie nach einer Ausrichtungskorrektur, nur
  // andersherum.
  const hochkant = requireTemplate('spread.6up.portraits');
  const hochCtx = { profile, template: hochkant, photos: PHOTOS };

  function seiteMit(id: string): Spread {
    return {
      id: 's1',
      index: 0,
      templateId: hochkant.id,
      slots: hochkant.slots.map((slot, i) => ({
        slotId: slot.id,
        photoId: i === 0 ? id : null,
        crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
      })),
    };
  }

  it('meldet ein Querformat in einem Hochformatplatz', () => {
    const box = imageBoxes(renderSpread(seiteMit('p3'), hochCtx))[0]!;
    const warnung = box.warnings.find((w) => w.code === 'orientation-mismatch');
    expect(warnung).toBeDefined();
  });

  it('nennt dabei, wie viel vom Bild übrig bleibt', () => {
    // 16:9 in einem hochkanten Platz: Die volle Höhe bleibt, von der Breite
    // nur der Anteil, der die Form des Platzes trifft.
    const box = imageBoxes(renderSpread(seiteMit('p3'), hochCtx))[0]!;
    const warnung = box.warnings.find((w) => w.code === 'orientation-mismatch');
    expect(warnung).toMatchObject({ code: 'orientation-mismatch' });
    if (warnung?.code === 'orientation-mismatch') {
      expect(warnung.sichtbar).toBeCloseTo(box.wMm / box.hMm / (2048 / 1152), 3);
      // Gut ein Drittel des Bildes ist weg – das ist die Zahl, die dem
      // Benutzer erklärt, warum der Zoom am Anschlag sitzt.
      expect(warnung.sichtbar).toBeLessThan(0.5);
    }
  });

  it('schweigt, wenn Bild und Platz dieselbe Lage haben', () => {
    const box = imageBoxes(renderSpread(seiteMit('p2'), hochCtx))[0]!;
    expect(box.warnings.map((w) => w.code)).not.toContain('orientation-mismatch');
  });

  it('schweigt bei einem quadratischen Bild', () => {
    // Quadratisch passt überall halbwegs; eine Warnung wäre hier nur Lärm.
    const box = imageBoxes(renderSpread(seiteMit('p4'), hochCtx))[0]!;
    expect(box.warnings.map((w) => w.code)).not.toContain('orientation-mismatch');
  });

  it('schweigt bei quadratischen Plätzen', () => {
    const box = imageBoxes(renderSpread(spreadWith(['p3', null, null, null]), ctx))[0]!;
    expect(box.warnings.map((w) => w.code)).not.toContain('orientation-mismatch');
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

  it('gibt einen manuellen Ausschnitt, der zum Slot passt, unverändert weiter', () => {
    // Der Slot ist quadratisch, das Bild 4:3 – ein Ausschnitt im Verhältnis 3:4
    // der Bildkanten wird darin also unverzerrt gedruckt und bleibt, wie er ist.
    const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4, mode: 'manual' as const };
    const manuell: Spread = {
      ...spreadWith(['p1', null, null, null]),
      slots: [{ slotId: 'a', photoId: 'p1', crop }],
    };
    const box = imageBoxes(renderSpread(manuell, ctx))[0]!;
    expect(box.crop).toEqual(crop);
  });

  it('dreht einen manuellen Ausschnitt in die Form des Slots, statt das Bild zu stauchen', () => {
    // Beide Renderer bilden den Ausschnitt auf den Kasten ab. Ein quadratischer
    // Ausschnitt aus einem 4:3-Bild in einem quadratischen Slot wäre um ein
    // Drittel in die Breite gezogen – vorher passierte genau das, sobald eine
    // Doppelseite mit manuellem Ausschnitt eine andere Vorlage bekam.
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
    // 4:3-Bild, quadratischer Slot → der Ausschnitt muss 3:4 der Bildkanten
    // messen. Die Fläche bleibt, und der Modus bleibt Handarbeit.
    expect((box.crop.w / box.crop.h) * (4 / 3)).toBeCloseTo(box.wMm / box.hMm, 6);
    expect(box.crop.w * box.crop.h).toBeCloseTo(0.16, 6);
    expect(box.crop.mode).toBe('manual');
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
    // Die Perle am Median: quadratisch, mit vollem Eckenradius.
    const perlen = rsm.boxes.filter(
      (b) => b.kind === 'rect' && b.rxMm !== undefined && b.wMm === b.hMm,
    );
    expect(perlen).toHaveLength(1);
  });

  it('weicht der Entscheidung der einzelnen Doppelseite', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), timeline: false };
    const rsm = renderSpread(spread, timelineCtx);
    expect(rsm.boxes.some((b) => b.kind === 'rect' && b.hMm === 0.3)).toBe(false);
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
    // In Versalien: Das Label ist die einzige Stelle im Innenteil, die etwas
    // benennt, und trägt deshalb die kräftigste Stimme.
    expect(label?.kind === 'text' && label.content).toBe('DEICHBRAND 2017');
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

  it('reicht die Fassung an die Achse durch, die gerade gezeichnet wird', () => {
    // Zwei Felder, eines je Achse: Ein Wechsel des Ortes darf die Wahl an der
    // anderen Achse nicht verlieren, deshalb bekommt der Kontext beide.
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    const fuss = renderSpread(spread, {
      ...timelineCtx,
      timeline: { dateOf: DATEN, footVariant: 'ruler', sideVariant: 'column' },
    });
    // Die Monatsleiter hängt Zähne von 0,35 mm Breite an eine Grundlinie – das
    // Kalenderband von classic hat keine.
    expect(fuss.boxes.filter((b) => b.kind === 'rect' && b.wMm === 0.35)).toHaveLength(19);

    const rand = renderSpread(spread, {
      ...timelineCtx,
      timeline: {
        dateOf: DATEN,
        style: 'side',
        bookYears: { from: 2008, to: 2026 },
        footVariant: 'ruler',
        sideVariant: 'column',
      },
    });
    // Die Jahresspalte zeichnet keine Linie, nur Zahlen und einen Punkt.
    expect(rand.boxes.filter((b) => b.kind === 'text')).toHaveLength(19);
    expect(rand.boxes.filter((b) => b.kind === 'rect')).toHaveLength(1);
  });

  it('zeigt den Fortschritt auch auf einer Jahresseite – am Beginn ihres Jahrgangs', () => {
    // Vorher entfiel auf einer Auftaktseite das Datum ganz, damit sie keinen
    // Marker trägt. Am Rand speist dasselbe Datum aber auch den zurückgelegten
    // Abschnitt, und der Balken blieb auf jeder Jahresseite leer.
    const auftakt = {
      ...spreadOfTemplate('spread.chapter.4up', ['p1', 'p2', 'p3', 'p4']),
      chapterYear: 2017,
    };
    const rand = {
      ...timelineCtx,
      template: requireTemplate('spread.chapter.4up'),
      timeline: { dateOf: DATEN, style: 'side' as const, bookYears: { from: 2008, to: 2026 } },
    };
    const rsm = renderSpread(auftakt, rand);

    // Die Perle sitzt am Jahreswechsel: neun von neunzehn Jahrgängen des Buchs
    // liegen vor 2017. Gemessen an der Achse selbst und nicht an ihren
    // Randmaßen – die sind eine Entscheidung von `side-timeline.ts`.
    const perle = rsm.boxes.find(
      (b) => b.kind === 'rect' && b.rxMm !== undefined && b.wMm === b.hMm,
    );
    const achse = rsm.boxes
      .filter((b) => b.kind === 'rect' && b.rxMm === undefined)
      .sort((a, b) => (b.kind === 'rect' ? b.hMm : 0) - (a.kind === 'rect' ? a.hMm : 0))[0];
    if (perle?.kind !== 'rect' || achse?.kind !== 'rect') throw new Error('keine Achse mit Perle');
    expect(perle.yMm + perle.hMm / 2).toBeCloseTo(achse.yMm + (9 / 19) * achse.hMm, 1);

    // Und der zurückgelegte Abschnitt reicht genau dorthin.
    const gefuellt = rsm.boxes.filter(
      (b) => b.kind === 'rect' && b.rxMm === undefined && b.fill === perle.fill,
    );
    expect(gefuellt.length).toBeGreaterThan(0);

    // Ohne Jahrgang bleibt es beim Median der Bilder – 2017 statt gar nichts.
    const ohneJahr = renderSpread(
      spreadOfTemplate('spread.chapter.4up', ['p1', 'p2', 'p3', 'p4']),
      rand,
    );
    expect(
      ohneJahr.boxes.some((b) => b.kind === 'rect' && b.rxMm !== undefined && b.wMm === b.hMm),
    ).toBe(true);
  });

  it('nimmt eine gewählte Akzentfarbe, sonst die aus dem Hintergrund abgeleitete', () => {
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    const perle = (rsm: ReturnType<typeof renderSpread>) =>
      rsm.boxes.find((b) => b.kind === 'rect' && b.rxMm !== undefined && b.wMm === b.hMm);

    const gewaehlt = perle(
      renderSpread(spread, { ...timelineCtx, timeline: { dateOf: DATEN, accentColor: '#0f6f7a' } }),
    );
    const abgeleitet = perle(renderSpread(spread, timelineCtx));
    if (gewaehlt?.kind !== 'rect' || abgeleitet?.kind !== 'rect') throw new Error('keine Perle');

    expect(gewaehlt.fill).toBe('#0f6f7a');
    // Ohne Angabe bleibt es bei `accentOn` – der Marker gehört dann zur Seite,
    // statt auf ihr zu liegen.
    expect(abgeleitet.fill).not.toBe('#0f6f7a');
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
    // Alle Zeilen tragen dieselbe Schriftgröße.
    const groessen = new Set(zeilen.map((b) => (b.kind === 'text' ? b.fontSizePt : 0)));
    expect(groessen.size).toBe(1);

    // Der Abstand folgt der im Template angegebenen Zeilenzahl, nicht der Zahl
    // der gesetzten Zeilen: Drei Ereignisse stehen so groß da wie fünf.
    const slotHoeheMm = eventSlot.h * profile.page.trimHeightMm;
    expect(abstand).toBeCloseTo(slotHoeheMm / eventSlot.lines!, 6);
    expect(eventSlot.lines).toBe(5);
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

describe('Von Hand gesetzte Vorlagentexte', () => {
  const chapter = requireTemplate('spread.chapter.year');
  const jahrSlot = chapter.textSlots!.find((t) => t.role === 'year')!;

  /** Die Jahreszahl dieser Doppelseite, mit oder ohne Handarbeit daran. */
  function jahrBox(handarbeit: Partial<TextElement> = {}) {
    const spread: Spread = {
      ...spreadOfTemplate(chapter.id, ['p1']),
      texts: [
        { id: 't1', role: 'year' as const, content: '2017', slotId: jahrSlot.id, ...handarbeit },
      ],
    };
    const rsm = renderSpread(spread, { ...ctx, template: chapter });
    const box = rsm.boxes.find((b) => b.kind === 'text' && b.slotId === jahrSlot.id);
    if (box?.kind !== 'text') throw new Error('keine Jahreszahl im RSM');
    return box;
  }

  it('nimmt das eigene Rechteck vor dem Platz der Vorlage', () => {
    const ausVorlage = jahrBox();
    const bewegt = jahrBox({ rect: { x: 0.55, y: 0.1, w: 0.3, h: 0.09 } });

    const trimSpreadW = 2 * profile.page.trimWidthMm;
    expect(bewegt.xMm).toBeCloseTo(profile.page.bleedMm + 0.55 * trimSpreadW, 6);
    expect(bewegt.yMm).toBeCloseTo(profile.page.bleedMm + 0.1 * profile.page.trimHeightMm, 6);
    expect(bewegt.wMm).toBeCloseTo(0.3 * trimSpreadW, 6);
    expect(bewegt.xMm).not.toBeCloseTo(ausVorlage.xMm, 3);
  });

  it('rechnet die Schriftgröße aus der Kastenhöhe – ein höherer Kasten ist größere Schrift', () => {
    // Der Grund, warum ein bewegter Vorlagentext keine Punktgröße braucht: Sie
    // steht in `TEXT_STYLES` als Versalhöhe im Kasten und hängt damit schon am
    // Rechteck. Doppelte Höhe, doppelte Schrift.
    const einfach = jahrBox({ rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 } });
    const doppelt = jahrBox({ rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } });
    expect(doppelt.fontSizePt).toBeCloseTo(2 * einfach.fontSizePt, 6);
  });

  it('dreht alle Zeilen um die Mitte des Kastens, nicht jede um ihre eigene', () => {
    const eventSlot = chapter.textSlots!.find((t) => t.id === 't-events')!;
    const spread: Spread = {
      ...spreadOfTemplate(chapter.id, ['p1']),
      texts: [
        {
          id: 't2',
          role: 'freeText' as const,
          content: 'Erste Zeile\nZweite Zeile',
          slotId: eventSlot.id,
          rotateDeg: 12,
        },
      ],
    };
    const rsm = renderSpread(spread, { ...ctx, template: chapter });
    const zeilen = rsm.boxes.filter((b) => b.kind === 'text' && b.slotId.startsWith('t-events'));
    expect(zeilen).toHaveLength(2);

    const punkte = zeilen.map((b) => (b.kind === 'text' ? b.rotateAboutMm : undefined));
    expect(punkte[0]).toEqual(punkte[1]);
    expect(zeilen.every((b) => b.kind === 'text' && b.rotateDeg === 12)).toBe(true);

    // Der Drehpunkt ist die Mitte des Platzes für fünf Zeilen und nicht die der
    // zwei gesetzten: Sonst wanderte der Text, sobald eine Zeile dazukommt.
    const mitteY =
      profile.page.bleedMm + (eventSlot.y + eventSlot.h / 2) * profile.page.trimHeightMm;
    expect(punkte[0]?.yMm).toBeCloseTo(mitteY, 6);
  });

  it('lässt einen Text ohne Drehung ungedreht – 0 und nicht gesetzt sind dasselbe', () => {
    expect(jahrBox().rotateDeg).toBeUndefined();
    expect(jahrBox({ rotateDeg: 0 }).rotateDeg).toBeUndefined();
  });

  it('verkleinert die Schrift, wenn der Wortlaut nicht in die Breite passt', () => {
    // Dieselbe Regel wie im Fuß des Polaroids: kleiner setzen, nicht umbrechen
    // und erst recht nicht überlaufen lassen. Erreichbar wurde das erst mit dem
    // editierbaren Wortlaut – „2017" passte immer.
    const kurz = jahrBox();
    const lang = jahrBox({ content: '2017 – das Jahr mit dem langen Sommer und der Reise' });

    expect(lang.fontSizePt).toBeLessThan(kurz.fontSizePt);
    // Und zwar so weit, dass der Satz in den Kasten passt.
    expect(estimatedTextWidthMm(lang.content, lang.fontSizePt)).toBeLessThanOrEqual(
      lang.wMm + 0.001,
    );
  });

  it('nimmt für alle Zeilen eine Größe, gemessen an der längsten', () => {
    const eventSlot = chapter.textSlots!.find((t) => t.id === 't-events')!;
    const spread: Spread = {
      ...spreadOfTemplate(chapter.id, ['p1']),
      texts: [
        {
          id: 't2',
          role: 'freeText' as const,
          content: 'kurz\nund eine deutlich längere Zeile, die über den Kasten hinausreicht',
          slotId: eventSlot.id,
        },
      ],
    };
    const rsm = renderSpread(spread, { ...ctx, template: chapter });
    const zeilen = rsm.boxes.filter((b) => b.kind === 'text' && b.slotId.startsWith('t-events'));

    // Zwei Zeilen desselben Textes in zwei Größen wären kein Satz, sondern ein
    // Versehen – die längste gibt das Maß für beide.
    const groessen = new Set(zeilen.map((b) => (b.kind === 'text' ? b.fontSizePt : 0)));
    expect(groessen.size).toBe(1);

    const lang = zeilen.find((b) => b.kind === 'text' && b.content.startsWith('und eine'));
    if (lang?.kind !== 'text') throw new Error('lange Zeile fehlt');
    expect(estimatedTextWidthMm(lang.content, lang.fontSizePt)).toBeLessThanOrEqual(
      lang.wMm + 0.001,
    );
  });
});

describe('Seitenhintergrund', () => {
  it('nimmt die Farbe der Doppelseite vor der globalen Vorgabe', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), background: '#eae5db' };
    const rsm = renderSpread(spread, { ...ctx, background: '#faf7f2' });
    expect(rsm.background).toBe('#eae5db');
  });

  it('legt ein Hintergrundbild randabfallend über die ganze Fläche', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), backgroundPhotoId: 'p1' };
    const rsm = renderSpread(spread, ctx);
    const hintergrund = rsm.boxes[0];
    if (hintergrund?.kind !== 'image') throw new Error('kein Hintergrundbild');
    expect(hintergrund.slotId).toBe('background');
    expect(hintergrund.xMm).toBe(0);
    expect(hintergrund.yMm).toBe(0);
    expect(hintergrund.wMm).toBe(rsm.widthMm);
    expect(hintergrund.hMm).toBe(rsm.heightMm);
    // Es liegt vor allem anderen, damit die Fotos darüber stehen.
    expect(rsm.boxes.filter((b) => b.kind === 'image').indexOf(hintergrund)).toBe(0);
  });

  it('meldet ein zu grobes Hintergrundbild, setzt es aber trotzdem', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), backgroundPhotoId: 'p1' };
    const rsm = renderSpread(spread, ctx);
    const hintergrund = rsm.boxes[0];
    if (hintergrund?.kind !== 'image') throw new Error('kein Hintergrundbild');
    // p1 hat 2048 px – der Median des Bestands, und damit zu wenig.
    expect(hintergrund.warnings.map((w) => w.code)).toContain('background-low-dpi');
  });

  it('macht Text auf dunklem Hintergrund hell', () => {
    const titled = requireTemplate('spread.5up.offset.titled');
    const spread = {
      ...spreadOfTemplate(titled.id, ['p1', 'p2', 'p3', 'p4', null]),
      background: '#1c1917',
      texts: [
        {
          id: 't1',
          role: 'eventTitle' as const,
          content: 'Deichbrand',
          slotId: titled.textSlots![0]!.id,
        },
      ],
    };
    const rsm = renderSpread(spread, { ...ctx, template: titled });
    const text = rsm.boxes.find((b) => b.kind === 'text');
    if (text?.kind !== 'text') throw new Error('kein Text');
    expect(text.color).not.toBe('#000000');
    expect(text.color.toLowerCase()).toMatch(/^#f/);
  });
});

describe('Neigung der Bilder', () => {
  const geneigt = { ...ctx, tilt: { maxDeg: DEFAULT_TILT_DEG, seed: 1 } };

  it('steht ohne Kontext gerade', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx);
    expect(imageBoxes(rsm).every((b) => b.rotateDeg === undefined)).toBe(true);
  });

  it('neigt jedes Bild, sobald der Aufrufer es zulässt', () => {
    const rsm = renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), geneigt);
    const winkel = imageBoxes(rsm).map((b) => b.rotateDeg);
    expect(winkel).toHaveLength(4);
    expect(winkel.every((w) => w !== undefined && w !== 0)).toBe(true);
    // Vier gleiche Winkel wären kein Zufall, sondern ein Fehler im Schlüssel.
    expect(new Set(winkel).size).toBeGreaterThan(1);
  });

  it('gibt derselben Doppelseite zweimal dieselben Winkel', () => {
    const a = imageBoxes(renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), geneigt));
    const b = imageBoxes(renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), geneigt));
    expect(a.map((x) => x.rotateDeg)).toEqual(b.map((x) => x.rotateDeg));
  });

  it('lässt eine von Hand gesetzte Neigung vorgehen', () => {
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    spread.slots[0]!.rotateDeg = 2.5;
    const box = imageBoxes(renderSpread(spread, geneigt))[0];
    expect(box?.rotateDeg).toBe(2.5);
  });

  /**
   * Der eigentliche Zweck des Felds: Eine gesetzte 0 ist etwas anderes als
   * gar kein Wert – sie stellt das Bild gegen die Automatik gerade.
   */
  it('stellt ein Bild mit rotateDeg 0 ausdrücklich gerade', () => {
    const spread = spreadWith(['p1', 'p2', 'p3', 'p4']);
    spread.slots[0]!.rotateDeg = 0;
    const boxen = imageBoxes(renderSpread(spread, geneigt));
    expect(boxen[0]?.rotateDeg).toBeUndefined();
    expect(boxen[1]?.rotateDeg).not.toBe(0);
  });

  /**
   * Ein gedrehtes randabfallendes Bild zeigt weiße Zwickel an der
   * Papierkante – ein Druckfehler, kein Effekt.
   */
  it('lässt randabfallende Bilder gerade, auch von Hand', () => {
    const voll = requireTemplate('spread.group.opener-full');
    const spread = spreadOfTemplate(voll.id, ['p1']);
    spread.slots[0]!.rotateDeg = 3;
    const rsm = renderSpread(spread, { ...geneigt, template: voll });
    expect(imageBoxes(rsm)[0]?.rotateDeg).toBeUndefined();
  });

  it('lässt ein Hintergrundbild gerade', () => {
    const spread = { ...spreadWith(['p1', 'p2', 'p3', 'p4']), backgroundPhotoId: 'p1' };
    const rsm = renderSpread(spread, geneigt);
    expect(rsm.boxes[0]?.kind === 'image' && rsm.boxes[0].rotateDeg).toBeFalsy();
  });

  it('rührt den Bildausschnitt nicht an – gedreht wird der Kasten', () => {
    const ohne = imageBoxes(renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), ctx));
    const mit = imageBoxes(renderSpread(spreadWith(['p1', 'p2', 'p3', 'p4']), geneigt));
    expect(mit.map((b) => b.crop)).toEqual(ohne.map((b) => b.crop));
    expect(mit.map((b) => [b.xMm, b.yMm, b.wMm, b.hMm])).toEqual(
      ohne.map((b) => [b.xMm, b.yMm, b.wMm, b.hMm]),
    );
  });
});

describe('Rahmen um die Bilder', () => {
  const gerahmt = { ...ctx, frame: 'polaroid' as const };
  const alle = ['p1', 'p2', 'p3', 'p4'];

  it('lässt die Bilder ohne Vorgabe rahmenlos', () => {
    const rsm = renderSpread(spreadWith(alle), ctx);
    expect(rsm.boxes.some((b) => b.kind === 'rect')).toBe(false);
    expect(imageBoxes(rsm).every((b) => b.frame === undefined)).toBe(true);
  });

  it('gibt jedem Bild den Rahmen des Buches', () => {
    const rsm = renderSpread(spreadWith(alle), gerahmt);
    expect(imageBoxes(rsm).map((b) => b.frame)).toEqual(Array(4).fill('polaroid'));
    // Karton und Schatten je Bild.
    expect(rsm.boxes.filter((b) => b.kind === 'rect')).toHaveLength(8);
  });

  /**
   * Der Grund, warum der Rahmen vor der Ausschnittsrechnung stehen muss.
   *
   * Und zwar in beide Richtungen: Der Polaroidkarton nimmt unten mehr weg als
   * an den Seiten, der Kasten wird dadurch breiter im Verhältnis, und
   * `coverCrop` beschneidet ein Querformat weniger stark. Die Auflösung steigt
   * hier also, obwohl das Bild kleiner wird. Genau deshalb darf die Zahl nicht
   * aus dem Platz der Vorlage kommen – sie gilt für den Kasten, in dem das Bild
   * wirklich steht.
   */
  it('rechnet die Auflösung auf den Kasten, in dem das Bild wirklich steht', () => {
    const ohne = imageBoxes(renderSpread(spreadWith(alle), ctx))[0]!;
    const mit = imageBoxes(renderSpread(spreadWith(alle), gerahmt))[0]!;
    expect(mit.wMm).toBeLessThan(ohne.wMm);
    expect(mit.hMm).toBeLessThan(ohne.hMm);

    // p1 ist 2048 px breit; sichtbar ist davon der Ausschnitt, auf ganze Pixel
    // gerundet – die Engine rechnet mit den Pixeln, die sie wirklich extrahiert.
    const sichtbarPx = Math.round(2048 * mit.crop.w);
    expect(mit.effectiveDpi).toBeCloseTo(sichtbarPx / (mit.wMm / 25.4), 6);
    // Auf das Außenmaß gerechnet käme eine andere Zahl heraus – die falsche.
    expect(mit.effectiveDpi).not.toBeCloseTo(sichtbarPx / (ohne.wMm / 25.4), 3);
  });

  it('rechnet den Ausschnitt auf das Seitenverhältnis des kleineren Kastens', () => {
    const mit = imageBoxes(renderSpread(spreadWith(alle), gerahmt))[0]!;
    const px = { w: 2048 * mit.crop.w, h: 1536 * mit.crop.h };
    expect(px.w / px.h).toBeCloseTo(mit.wMm / mit.hMm, 5);
  });

  it('lässt den Rahmen eines einzelnen Bildes vorgehen', () => {
    const spread = spreadWith(alle);
    spread.slots[0]!.frame = 'kontur';
    const boxen = imageBoxes(renderSpread(spread, gerahmt));
    expect(boxen[0]).toMatchObject({ frame: 'kontur', manualFrame: true });
    expect(boxen[1]).toMatchObject({ frame: 'polaroid' });
    expect(boxen[1]).not.toHaveProperty('manualFrame');
  });

  /** Wie die gesetzte 0 bei der Neigung: „ausdrücklich ohne" ist eine Aussage. */
  it('nimmt ein Bild mit frame keiner aus der Buchvorgabe heraus', () => {
    const spread = spreadWith(alle);
    spread.slots[0]!.frame = 'keiner';
    const boxen = imageBoxes(renderSpread(spread, gerahmt));
    expect(boxen[0]?.frame).toBeUndefined();
    expect(boxen[0]?.manualFrame).toBe(true);
    expect(boxen[1]?.frame).toBe('polaroid');
  });

  it('lässt randabfallende Bilder ungerahmt, auch von Hand gesetzte', () => {
    const voll = requireTemplate('spread.group.opener-full');
    const spread: Spread = {
      id: 's1',
      index: 0,
      templateId: voll.id,
      slots: voll.slots.map((slot) => ({
        slotId: slot.id,
        photoId: 'p1',
        crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
        frame: 'polaroid' as const,
      })),
    };
    const rsm = renderSpread(spread, { ...gerahmt, template: voll });
    expect(rsm.boxes.some((b) => b.kind === 'rect')).toBe(false);
    expect(imageBoxes(rsm)[0]?.frame).toBeUndefined();
  });

  it('dreht Bild und Karton um denselben Punkt', () => {
    const geneigtGerahmt = { ...gerahmt, tilt: { maxDeg: DEFAULT_TILT_DEG, seed: 1 } };
    const rsm = renderSpread(spreadWith(alle), geneigtGerahmt);
    const bild = imageBoxes(rsm)[0]!;
    const karton = rsm.boxes.filter((b) => b.kind === 'rect')[1]!;
    // Beim Polaroid liegt die Mitte des Kartons unter der des Bildes – deshalb
    // trägt das Bild den Punkt ausdrücklich.
    expect(bild.rotateAboutMm).toEqual(karton.rotateAboutMm);
    expect(bild.rotateDeg).toBe(karton.rotateDeg);
  });

  it('gibt dem Bild denselben Winkel, ob es einen Rahmen trägt oder nicht', () => {
    const seed = { tilt: { maxDeg: DEFAULT_TILT_DEG, seed: 1 } };
    const ohne = imageBoxes(renderSpread(spreadWith(alle), { ...ctx, ...seed }));
    const mit = imageBoxes(renderSpread(spreadWith(alle), { ...gerahmt, ...seed }));
    expect(mit.map((b) => b.rotateDeg)).toEqual(ohne.map((b) => b.rotateDeg));
  });

  it('lässt das Hintergrundbild ungerahmt', () => {
    const spread = { ...spreadWith(alle), backgroundPhotoId: 'p1' };
    const rsm = renderSpread(spread, gerahmt);
    expect(rsm.boxes[0]).toMatchObject({ kind: 'image', slotId: 'background' });
  });
});
