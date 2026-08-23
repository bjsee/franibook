import { describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { defaultProfile } from '../print/profiles/index.js';
import { chapterTemplates, requireTemplate } from '../templates/index.js';
import { packbar, verschmelzeDoppelseiten } from './verschmelzen.js';

function foto(id: string): Photo {
  return {
    id,
    sourceId: 'q',
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 1_000_000,
    width: 4000,
    height: 3000,
    takenAt: '2025-07-01T12:00:00',
  } as Photo;
}

const alle = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'pa', 'pb', 'pc'];
const reflow = {
  photos: new Map<PhotoId, Photo>(alle.map((id) => [id, foto(id)])),
  profile: defaultProfile(),
};

function seiteMit(index: number, ids: readonly string[], rest: Partial<Spread> = {}): Spread {
  return {
    id: `s${index}`,
    index,
    templateId: 'spread.2up.side',
    slots: ids.map((id, i) => ({
      slotId: `slot${i}`,
      photoId: id,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
    })),
    ...rest,
  };
}

/** Drei Doppelseiten: vier, zwei und ein Bild. */
function buch(): Spread[] {
  return [seiteMit(0, ['p1', 'p2', 'p3', 'p4']), seiteMit(1, ['p5', 'p6']), seiteMit(2, ['p7'])];
}

describe('verschmelzeDoppelseiten', () => {
  it('macht aus zwei Doppelseiten eine und lässt das Buch schrumpfen', () => {
    const r = verschmelzeDoppelseiten(buch(), 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    expect(r.spreads).toHaveLength(2);
    expect(r.bilder).toBe(6);
    expect(r.index).toBe(0);
    const bilder = r.spreads[0]!.slots.map((s) => s.photoId).filter(Boolean);
    expect(bilder).toHaveLength(6);
    expect(bilder).toEqual(expect.arrayContaining(['p1', 'p5', 'p6']));
  });

  it('verliert kein Bild – jedes der beiden Seiten steht danach im Buch', () => {
    const vorher = buch();
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    const drin = new Set(r.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) expect(drin.has(id)).toBe(true);
  });

  it('wählt eine Vorlage für die neue Bilderzahl', () => {
    const r = verschmelzeDoppelseiten(buch(), 0, reflow);
    if (typeof r === 'string') throw new Error(r);
    expect(r.spreads[0]!.templateId).not.toBe('spread.2up.side');
  });

  it('behält Kennung, Anker und Jahresfarbe der ersten Seite', () => {
    const vorher = buch();
    vorher[0] = seiteMit(0, ['p1', 'p2'], {
      background: '#eee',
      anchor: { photoId: 'p1', where: 'before' },
      timeline: false,
    });
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    expect(r.spreads[0]!.id).toBe('s0');
    expect(r.spreads[0]!.background).toBe('#eee');
    expect(r.spreads[0]!.anchor).toEqual({ photoId: 'p1', where: 'before' });
    expect(r.spreads[0]!.timeline).toBe(false);
  });

  it('nimmt die frei gesetzten Textblöcke beider Seiten mit', () => {
    // Ihre Lage ist auf die Doppelseite normiert und bleibt damit gültig – sie
    // zu löschen wäre der stille Verlust, den dieser Griff nicht machen soll.
    const vorher = buch();
    const satz = { weight: 'regular', fontSizePt: 11, align: 'left' } as const;
    vorher[0]!.blocks = [
      { id: 'b1', content: 'Bremerhaven', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, ...satz },
    ];
    vorher[1]!.blocks = [
      { id: 'b2', content: 'Garrel', rect: { x: 0.6, y: 0.1, w: 0.2, h: 0.05 }, ...satz },
    ];
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    expect(r.spreads[0]!.blocks?.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('hängt einen Vorlagentitel auf den Textplatz der neuen Vorlage um', () => {
    // Ein `TextElement` zeigt über `slotId` in seine Vorlage. Nach dem Packen ist
    // sie eine andere: Bliebe die alte Kennung stehen, wäre der Titel
    // gespeichert und unsichtbar.
    const vorher = buch();
    vorher[0]!.texts = [
      { id: 't1', role: 'eventTitle', content: 'Bremerhaven', slotId: 'gibt-es-nicht' },
    ];
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    const vorlage = requireTemplate(r.spreads[0]!.templateId);
    const platz = r.spreads[0]!.texts?.[0]?.slotId;
    expect(r.spreads[0]!.texts?.[0]?.content).toBe('Bremerhaven');
    expect(vorlage.textSlots?.some((t) => t.id === platz)).toBe(true);
  });

  it('meldet einen Titel, für den kein zweiter Textplatz da ist', () => {
    const vorher = buch();
    vorher[0]!.texts = [{ id: 't1', role: 'eventTitle', content: 'Erst', slotId: 'a' }];
    vorher[1]!.texts = [{ id: 't2', role: 'eventTitle', content: 'Zweit', slotId: 'a' }];
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    const titel = (r.spreads[0]!.texts ?? []).map((t) => t.content);
    const plaetze = requireTemplate(r.spreads[0]!.templateId).textSlots ?? [];
    // Was Platz fand, steht da; was nicht, ist gezählt. Zusammen ergibt es zwei.
    expect(titel.length + (r.texteVerworfen ?? 0)).toBe(2);
    expect(titel[0]).toBe('Erst');
    expect(titel.length).toBeLessThanOrEqual(plaetze.length);
  });

  it('übernimmt das Hintergrundbild der zweiten, wenn die erste keines hat', () => {
    const vorher = buch();
    vorher[1]!.backgroundPhotoId = 'pb';
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    expect(r.spreads[0]!.backgroundPhotoId).toBe('pb');
    expect(r.hintergrundVerworfen).toBeUndefined();
  });

  it('meldet das Hintergrundbild, das dabei aus dem Buch fällt', () => {
    // Zwei Hintergründe kann eine Seite nicht tragen. Verschwiegen würde daraus
    // ein Bild, das ohne Zutun im Fotopool landet.
    const vorher = buch();
    vorher[0]!.backgroundPhotoId = 'pa';
    vorher[1]!.backgroundPhotoId = 'pb';
    const r = verschmelzeDoppelseiten(vorher, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    expect(r.spreads[0]!.backgroundPhotoId).toBe('pa');
    expect(r.hintergrundVerworfen).toBe('pb');
  });

  it('lehnt eine festgehaltene Seite ab, in beide Richtungen', () => {
    const mitSchloss = buch();
    mitSchloss[1]!.locked = true;
    expect(verschmelzeDoppelseiten(mitSchloss, 0, reflow)).toContain('festgehalten');

    const erste = buch();
    erste[0]!.locked = true;
    expect(verschmelzeDoppelseiten(erste, 0, reflow)).toContain('festgehalten');
  });

  it('lehnt eine halb festgehaltene Seite ab', () => {
    const halb = buch();
    halb[1]!.lockedSide = 'left';
    expect(verschmelzeDoppelseiten(halb, 0, reflow)).toContain('Buchseite fest');
  });

  it('lehnt einen Auftakt als zweite Seite ab', () => {
    // Er trägt die Jahreszahl. Ihn einzuschmelzen nähme dem Jahrgang seinen
    // Auftakt, und zwar unbemerkt.
    const mitAuftakt = buch();
    mitAuftakt[1] = seiteMit(1, ['p5', 'p6'], { chapterYear: 2025 });
    expect(verschmelzeDoppelseiten(mitAuftakt, 0, reflow)).toContain('Auftaktseite');
  });

  it('lässt einen Auftakt als erste Seite Bilder aufnehmen', () => {
    const vorlage = chapterTemplates().find((t) => t.slots.length === 6);
    if (!vorlage) throw new Error('keine Auftaktvorlage mit sechs Plätzen');

    const mitAuftakt = buch();
    mitAuftakt[0] = seiteMit(0, ['p1', 'p2', 'p3', 'p4'], {
      templateId: vorlage.id,
      chapterYear: 2025,
    });
    const r = verschmelzeDoppelseiten(mitAuftakt, 0, reflow);
    if (typeof r === 'string') throw new Error(r);

    // Er bleibt ein Auftakt: dieselbe Familie, die Jahreszahl steht weiter da.
    expect(r.spreads[0]!.chapterYear).toBe(2025);
    expect(chapterTemplates().some((t) => t.id === r.spreads[0]!.templateId)).toBe(true);
  });

  it('sagt Nein, wenn es hinter der Seite keine zweite gibt', () => {
    expect(verschmelzeDoppelseiten(buch(), 2, reflow)).toContain('keine zweite');
    expect(verschmelzeDoppelseiten(buch(), 7, reflow)).toContain('gibt es nicht');
  });

  it('lehnt ab, wenn die Bilderzahl keine Vorlage trägt', () => {
    // Die größte Doppelseite der Bibliothek trägt 24 Bilder. Darüber ist eine
    // Absage mit Zahl die ehrliche Antwort – die Alternative wäre ein Buch mit
    // verschwundenen Bildern.
    const viele = Array.from({ length: 26 }, (_, i) => `q${i}`);
    for (const id of viele) reflow.photos.set(id, foto(id));
    const r = verschmelzeDoppelseiten(
      [seiteMit(0, viele.slice(0, 13)), seiteMit(1, viele.slice(13))],
      0,
      reflow,
    );
    expect(typeof r).toBe('string');
    expect(r).toContain('26');
  });

  it('lehnt ab, wenn ein Bild nicht mehr zum Bestand gehört', () => {
    const mitLeiche = buch();
    mitLeiche[1] = seiteMit(1, ['weg']);
    expect(verschmelzeDoppelseiten(mitLeiche, 0, reflow)).toContain('Bestand');
  });

  it('verändert die Eingabe nicht', () => {
    const vorher = buch();
    const abdruck = JSON.stringify(vorher);
    verschmelzeDoppelseiten(vorher, 0, reflow);
    expect(JSON.stringify(vorher)).toBe(abdruck);
  });
});

describe('packbar – die Auskunft davor', () => {
  it('nennt die Bilderzahl, ohne das Buch anzufassen', () => {
    const vorher = buch();
    const a = packbar(vorher, 0, reflow);
    if (typeof a === 'string') throw new Error(a);

    expect(a.bilder).toBe(6);
    expect(vorher).toHaveLength(3);
  });

  it('gibt denselben Satz zurück, an dem der Griff scheitert', () => {
    const mitSchloss = buch();
    mitSchloss[1]!.locked = true;
    expect(packbar(mitSchloss, 0, reflow)).toBe(verschmelzeDoppelseiten(mitSchloss, 0, reflow));
  });
});
