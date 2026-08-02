import { describe, expect, it } from 'vitest';
import type { Photo } from '../model/photo.js';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import { requireTemplate } from '../templates/index.js';
import { exportLayout, parseLayout } from './document.js';
import { rebuildSpreads } from './rebuild.js';
import type { Spread } from '../model/spread.js';

const profile = saal as PrintProfile;

function photo(id: string, fileName: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    relPath: fileName,
    fileName,
    bytes: 800_000,
    width: 2048,
    height: 1536,
    orientation: 1,
    takenAt: '2015-06-12T14:23:00',
    ...extra,
  };
}

const PHOTOS = new Map<string, Photo>([
  ['h1', photo('h1', 'IMG_0001.jpeg')],
  [
    'h2',
    photo('h2', 'IMG_0002.jpeg', { gps: { lat: 53.0793, lon: 8.8017 }, camera: 'Canon IXUS 70' }),
  ],
  ['h3', photo('h3', 'IMG_0003.jpeg', { width: 1536, height: 2048 })],
  ['h4', photo('h4', 'IMG_0004.jpeg')],
  ['h5', photo('h5', 'winzig.jpeg', { width: 348, height: 261 })],
]);

const settings = { targetPages: 200, chapterOpeners: true };

function spreadOf(templateId: string, photoIds: (string | null)[]): Spread {
  const template = requireTemplate(templateId);
  return {
    id: 's0',
    index: 0,
    templateId,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
  };
}

describe('exportLayout', () => {
  const doc = exportLayout({
    spreads: [spreadOf('spread.4up.grid', ['h1', 'h2', 'h3', 'h4'])],
    photos: PHOTOS,
    profile,
    settings,
    unplaced: ['h5'],
  });

  it('referenziert Fotos über den Dateinamen, nicht über den Hash', () => {
    // Der Dateiname ist beim Bearbeiten das einzig Brauchbare.
    expect(doc.spreads[0]!.photos.map((p) => p.file)).toEqual([
      'IMG_0001.jpeg',
      'IMG_0002.jpeg',
      'IMG_0003.jpeg',
      'IMG_0004.jpeg',
    ]);
  });

  it('legt Aufnahmedatum und Pixelmaße bei', () => {
    const p = doc.spreads[0]!.photos[0]!;
    expect(p.date).toBe('2015-06-12 14:23');
    expect(p.px).toBe('2048×1536');
  });

  it('macht aus GPS-Koordinaten einen Kartenlink', () => {
    const p = doc.spreads[0]!.photos[1]!;
    expect(p.gps).toBe('53.07930, 8.80170');
    expect(p.map).toContain('openstreetmap.org');
    expect(p.camera).toBe('Canon IXUS 70');
  });

  it('nennt die Auflösung je Bild an seiner Position', () => {
    expect(doc.spreads[0]!.photos[0]!.dpi).toBeGreaterThan(240);
  });

  it('führt nicht platzierte Fotos getrennt auf', () => {
    expect(doc.unplaced.map((p) => p.file)).toEqual(['winzig.jpeg']);
  });

  it('enthält Bedienhinweise im Dokument selbst', () => {
    expect(doc._hinweise.join(' ')).toContain('ausschneiden');
    expect(doc._hinweise.join(' ')).toContain('auto');
  });

  it('fasst den Umfang zusammen', () => {
    expect(doc.summary.spreads).toBe(1);
    expect(doc.summary.pages).toBe(2);
    expect(doc.summary.photos).toBe(4);
  });

  it('warnt bei Bildern unter der Mindestauflösung', () => {
    const mit = exportLayout({
      spreads: [spreadOf('spread.4up.grid', ['h5', 'h1', 'h2', 'h3'])],
      photos: PHOTOS,
      profile,
      settings,
    });
    expect(mit.spreads[0]!.photos[0]!.warn).toContain('dpi');
  });
});

describe('parseLayout', () => {
  it('liest ein unverändertes Dokument zurück', () => {
    const doc = exportLayout({
      spreads: [spreadOf('spread.4up.grid', ['h1', 'h2', 'h3', 'h4'])],
      photos: PHOTOS,
      profile,
      settings,
    });
    const parsed = parseLayout(doc, PHOTOS);
    expect(parsed.ok).toBe(true);
    expect(parsed.spreads[0]!.photoIds).toEqual(['h1', 'h2', 'h3', 'h4']);
    expect(parsed.spreads[0]!.templateId).toBe('spread.4up.grid');
  });

  it('nimmt auch eine reine Liste von Dateinamen an', () => {
    const parsed = parseLayout(
      { spreads: [{ n: 1, photos: ['IMG_0001.jpeg', 'IMG_0002.jpeg'] }] },
      PHOTOS,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.spreads[0]!.photoIds).toEqual(['h1', 'h2']);
  });

  it('verwirft eine Vorlage, die nicht mehr zur Bilderzahl passt', () => {
    // Genau der Fall beim Umhängen: aus vier Bildern werden drei.
    const parsed = parseLayout(
      {
        spreads: [
          {
            n: 1,
            template: 'spread.4up.grid',
            photos: ['IMG_0001.jpeg', 'IMG_0002.jpeg', 'IMG_0003.jpeg'],
          },
        ],
      },
      PHOTOS,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.spreads[0]!.templateId).toBeUndefined();
    expect(parsed.issues.some((i) => i.message.includes('Plätze'))).toBe(true);
  });

  it('akzeptiert "auto" als Vorlage', () => {
    const parsed = parseLayout(
      { spreads: [{ n: 1, template: 'auto', photos: ['IMG_0001.jpeg'] }] },
      PHOTOS,
    );
    expect(parsed.spreads[0]!.templateId).toBeUndefined();
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('meldet einen unbekannten Dateinamen als Fehler', () => {
    const parsed = parseLayout(
      { spreads: [{ n: 1, photos: ['gibtesnicht.jpeg', 'IMG_0001.jpeg'] }] },
      PHOTOS,
    );
    expect(parsed.ok).toBe(false);
    expect(
      parsed.issues.some((i) => i.severity === 'error' && i.message.includes('gibtesnicht')),
    ).toBe(true);
  });

  it('übernimmt trotz eines Fehlers, was sich auflösen lässt', () => {
    const parsed = parseLayout(
      { spreads: [{ n: 1, photos: ['gibtesnicht.jpeg', 'IMG_0001.jpeg'] }] },
      PHOTOS,
    );
    expect(parsed.spreads[0]!.photoIds).toEqual(['h1']);
  });

  it('meldet ein doppelt verwendetes Foto als Warnung, nicht als Fehler', () => {
    // Dasselbe Bild zweimal zu zeigen ist erlaubt, aber selten Absicht.
    const parsed = parseLayout(
      {
        spreads: [
          { n: 1, photos: ['IMG_0001.jpeg'] },
          { n: 2, photos: ['IMG_0001.jpeg'] },
        ],
      },
      PHOTOS,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.issues.some((i) => i.severity === 'warning' && i.message.includes('1, 2'))).toBe(
      true,
    );
  });

  it('meldet fehlende Fotos, ohne zu blockieren', () => {
    const parsed = parseLayout({ spreads: [{ n: 1, photos: ['IMG_0001.jpeg'] }] }, PHOTOS);
    expect(parsed.ok).toBe(true);
    expect(parsed.issues.some((i) => i.message.includes('4 Fotos'))).toBe(true);
  });

  it('entfernt leere Doppelseiten', () => {
    const parsed = parseLayout(
      {
        spreads: [
          { n: 1, photos: [] },
          { n: 2, photos: ['IMG_0001.jpeg'] },
        ],
      },
      PHOTOS,
    );
    expect(parsed.spreads).toHaveLength(1);
    expect(parsed.issues.some((i) => i.message.includes('ohne Bilder'))).toBe(true);
  });

  it('weist strukturell kaputte Dokumente ab', () => {
    expect(parseLayout(null, PHOTOS).ok).toBe(false);
    expect(parseLayout({ spreads: 'nein' }, PHOTOS).ok).toBe(false);
    expect(parseLayout({}, PHOTOS).ok).toBe(false);
  });
});

describe('rebuildSpreads', () => {
  it('wählt für eine geänderte Bilderzahl eine passende Vorlage', () => {
    const result = rebuildSpreads({
      spreads: [{ photoIds: ['h1', 'h2', 'h3'] }],
      photos: PHOTOS,
      profile,
    });
    expect(result.spreads).toHaveLength(1);
    expect(requireTemplate(result.spreads[0]!.templateId).slots).toHaveLength(3);
  });

  it('behält eine festgelegte Vorlage bei', () => {
    const result = rebuildSpreads({
      spreads: [{ photoIds: ['h1', 'h2', 'h3', 'h4'], templateId: 'spread.4up.portraits' }],
      photos: PHOTOS,
      profile,
    });
    expect(result.spreads[0]!.templateId).toBe('spread.4up.portraits');
  });

  it('belegt jeden Slot der gewählten Vorlage', () => {
    const result = rebuildSpreads({
      spreads: [{ photoIds: ['h1', 'h2', 'h3', 'h4'] }],
      photos: PHOTOS,
      profile,
    });
    const belegt = result.spreads[0]!.slots.filter((s) => s.photoId !== null);
    expect(belegt).toHaveLength(4);
  });

  it('berechnet die Ausschnitte für die neue Vorlage', () => {
    const result = rebuildSpreads({
      spreads: [{ photoIds: ['h1'] }],
      photos: PHOTOS,
      profile,
    });
    const crop = result.spreads[0]!.slots.find((s) => s.photoId === 'h1')!.crop;
    expect(crop.mode).toBe('auto-cover');
    expect(crop.w).toBeGreaterThan(0);
  });

  it('deckt jede Bilderzahl von eins bis vierundzwanzig ab', () => {
    // Beim Umhängen entstehen laufend ungerade Zahlen. Eine Lücke in der
    // Bibliothek würde die Bearbeitung an dieser Stelle blockieren.
    const viele = new Map(PHOTOS);
    for (let i = 6; i <= 40; i++) viele.set(`x${i}`, photo(`x${i}`, `X_${i}.jpeg`));
    const ids = [...viele.keys()];

    for (let n = 1; n <= 24; n++) {
      const result = rebuildSpreads({
        spreads: [{ photoIds: ids.slice(0, n) }],
        photos: viele,
        profile,
      });
      expect(result.problems, `keine Vorlage für ${n} Bilder`).toEqual([]);
      expect(result.spreads, `${n} Bilder`).toHaveLength(1);
    }
  });

  it('meldet eine Bilderzahl jenseits der Bibliothek', () => {
    const viele = new Map(PHOTOS);
    for (let i = 6; i <= 40; i++) viele.set(`x${i}`, photo(`x${i}`, `X_${i}.jpeg`));
    const result = rebuildSpreads({
      spreads: [{ photoIds: [...viele.keys()].slice(0, 30) }],
      photos: viele,
      profile,
    });
    expect(result.spreads).toHaveLength(0);
    expect(result.problems[0]!.photoCount).toBe(30);
    expect(result.problems[0]!.message).toContain('keine Vorlage');
  });

  it('überträgt den Text auf den Textplatz der Vorlage', () => {
    const result = rebuildSpreads({
      spreads: [{ photoIds: ['h1'], templateId: 'spread.chapter.year', text: '2015' }],
      photos: PHOTOS,
      profile,
    });
    expect(result.spreads[0]!.texts?.[0]!.content).toBe('2015');
  });
});

describe('Rundlauf', () => {
  it('übersteht Export, Bearbeitung und Wiederaufbau', () => {
    const original = [
      spreadOf('spread.4up.grid', ['h1', 'h2', 'h3', 'h4']),
      { ...spreadOf('spread.4up.grid', ['h5', null, null, null]), id: 's1', index: 1 },
    ];
    const doc = exportLayout({ spreads: original, photos: PHOTOS, profile, settings });

    // Bearbeitung von Hand: ein Bild von Doppelseite 1 auf 2 verschieben
    const bearbeitet = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const umgehaengt = bearbeitet.spreads[0]!.photos.pop()!;
    bearbeitet.spreads[1]!.photos.push(umgehaengt);

    const parsed = parseLayout(bearbeitet, PHOTOS);
    expect(parsed.ok).toBe(true);
    expect(parsed.spreads[0]!.photoIds).toHaveLength(3);
    expect(parsed.spreads[1]!.photoIds).toHaveLength(2);

    const rebuilt = rebuildSpreads({ spreads: parsed.spreads, photos: PHOTOS, profile });
    expect(rebuilt.problems).toEqual([]);
    expect(requireTemplate(rebuilt.spreads[0]!.templateId).slots).toHaveLength(3);
    expect(requireTemplate(rebuilt.spreads[1]!.templateId).slots).toHaveLength(2);

    // Kein Bild verloren
    const alle = rebuilt.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)).filter(Boolean);
    expect(new Set(alle).size).toBe(5);
  });
});
