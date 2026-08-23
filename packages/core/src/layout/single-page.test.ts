import { describe, expect, it } from 'vitest';
import type { Photo, PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { defaultProfile } from '../print/profiles/index.js';
import { HALF_BLANK_ID, HALF_ONE_ID, halvesOfTemplate } from '../templates/halves.js';
import { requireTemplate, templateMeta } from '../templates/index.js';
import { chapterHalves } from '../templates/chapter-halves.js';
import {
  insertKeptHalves,
  insertSinglePage,
  removeSinglePage,
  setChapterHalf,
  setHalfPage,
  zerlegbar,
} from './single-page.js';

const AUTO = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const };

/** Ein Blatt aus der Bibliothek, jeder Platz belegt. */
function blatt(id: string, templateId: string, ab: number): Spread {
  const template = requireTemplate(templateId);
  return {
    id,
    index: 0,
    templateId,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: `p${ab + i}`,
      crop: { ...AUTO },
    })),
  };
}

/** Ein Jahresauftakt – nicht zerlegbar, weil sein Text an Textplätzen hängt. */
function auftakt(id: string): Spread {
  return {
    id,
    index: 0,
    templateId: 'spread.chapter.quiet',
    slots: [],
    texts: [{ id: `${id}-y`, role: 'year', content: '2019', slotId: 't-year' }],
  };
}

/** Alle Fotos eines Buches in Buchreihenfolge. */
function fotos(spreads: readonly Spread[]): PhotoId[] {
  return spreads.flatMap((s) =>
    s.slots.map((sl) => sl.photoId).filter((id): id is PhotoId => id !== null),
  );
}

describe('zerlegbar', () => {
  it('erkennt eine gewöhnliche Doppelseite als zerlegbar', () => {
    expect(zerlegbar(blatt('s0', 'spread.4up.grid', 0))).toBe(true);
  });

  it('trennt ein Blatt mit seitenweisem Hintergrundbild und lässt das Bild bei seiner Seite', () => {
    const mitBild: Spread = {
      ...blatt('s0', 'spread.4up.grid', 0),
      backgroundPhotoId: 'pBG',
      backgroundPhotoSide: 'left',
    };
    // Ein Bild auf einer Buchseite kreuzt den Falz nicht – es hält das Blatt
    // nicht zusammen.
    expect(zerlegbar(mitBild)).toBe(true);

    // Und es überlebt Zerlegen und Paaren: Wandert die linke Hälfte beim
    // Umpaaren nach rechts, wandert das Bild mit.
    const r = insertSinglePage([mitBild, blatt('s1', 'spread.4up.grid', 4)], {
      atPage: 0,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
    });
    const traeger = r.spreads.find((sp) => sp.backgroundPhotoId === 'pBG');
    expect(traeger).toBeDefined();
    expect(traeger!.backgroundPhotoSide).toBe('right');
  });

  it('lässt Auftakte, justierte Zeilen und Hintergrundbilder ganz', () => {
    expect(zerlegbar(auftakt('a0'))).toBe(false);
    expect(zerlegbar({ ...blatt('s0', 'spread.4up.grid', 0), templateId: 'justiert.12' })).toBe(
      false,
    );
    expect(zerlegbar({ ...blatt('s0', 'spread.4up.grid', 0), backgroundPhotoId: 'p99' })).toBe(
      false,
    );
  });
});

describe('insertSinglePage', () => {
  const buch = () => [
    blatt('s0', 'spread.2up.pair', 0),
    blatt('s1', 'spread.2up.pair', 2),
    blatt('s2', 'spread.2up.pair', 4),
  ];

  it('verliert bei der Umpaarung kein Foto und behält die Reihenfolge', () => {
    // Der Kern: Eine eingeschobene Seite verschiebt die Blattgrenzen, nicht die
    // Fotoverteilung. Kein Slot der Flussvorlagen liegt über dem Falz, deshalb
    // ist die Zerlegung verlustfrei.
    const vorher = fotos(buch());
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.ok).toBe(true);
    expect(fotos(r.spreads)).toEqual(vorher);
  });

  it('setzt die neue Seite an die verlangte Buchseite', () => {
    // Buchseite 3 (nullbasiert) ist die rechte Seite des zweiten Blattes.
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    const eigen = r.spreads.find((s) => s.id === 'eigen-1');
    expect(eigen).toBeDefined();
    expect(r.spreads.indexOf(eigen!)).toBe(1);
    // Links das erste Bild des zweiten Blattes, rechts die eigene, leere Seite.
    const halves = halvesOfTemplate(requireTemplate(eigen!.templateId));
    expect(halves.right).toBe(HALF_BLANK_ID);
    expect(eigen!.slots.filter((s) => s.photoId).length).toBe(1);
  });

  it('macht das Buch um ein Blatt länger, wenn die Seiten nicht mehr aufgehen', () => {
    // Sechs Buchseiten plus eine ergeben sieben – das letzte Blatt bleibt
    // halb leer, und die Seitenzahl bleibt gerade.
    const r = insertSinglePage(buch(), { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    expect(r.spreads).toHaveLength(4);
    expect(r.bericht?.leerseiten).toBe(1);
  });

  it('hält die neue Buchseite fest – und nur sie', () => {
    const r = insertSinglePage(buch(), { atPage: 2, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    const blatt = r.spreads.find((s) => s.id === 'eigen-1');
    // Vorher stand hier `locked: true`: Die eingefügte Seite fror auch ihre
    // Nachbarin ein, die die Automatik gestellt hatte. Das halbe Schloss ist so
    // eng wie die Handarbeit, die es schützt.
    expect(blatt?.lockedSide).toBe('left');
    expect(blatt?.locked).toBeUndefined();
  });

  it('nimmt Textblöcke der neuen Seite mit', () => {
    const r = insertSinglePage(buch(), {
      atPage: 2,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
      blocks: [
        {
          id: 't1',
          content: 'Einschulung',
          rect: { x: 0.08, y: 0.4, w: 0.3, h: 0.1 },
          weight: 'semibold',
          fontSizePt: 28,
          align: 'left',
        },
      ],
    });
    expect(r.spreads.find((s) => s.id === 'eigen-1')?.blocks?.[0]?.content).toBe('Einschulung');
  });

  it('legt einen Bildplatz an, wenn die Halbseite einen hat', () => {
    const r = insertSinglePage(buch(), { atPage: 2, halfId: HALF_ONE_ID, id: 'eigen-1' });
    const eigen = r.spreads.find((s) => s.id === 'eigen-1')!;
    // Ein leerer Platz, den man selbst füllt – kein automatisch zugeteiltes Bild.
    expect(eigen.slots.filter((s) => s.photoId === null)).toHaveLength(1);
  });

  it('stellt die Parität vor einem unzerlegbaren Blatt wieder her', () => {
    // Genau der Punkt, der den Eingriff lokal hält: Vor dem Auftakt schiebt
    // eine leere Halbseite auf, dahinter ist das Buch unverändert.
    const mitAuftakt = [
      blatt('s0', 'spread.2up.pair', 0),
      auftakt('a1'),
      blatt('s2', 'spread.2up.pair', 2),
    ];
    const r = insertSinglePage(mitAuftakt, {
      atPage: 1,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
    });

    expect(r.ok).toBe(true);
    // Der Auftakt bleibt ganz und trägt seinen Text weiter.
    const gefunden = r.spreads.find((s) => s.templateId === 'spread.chapter.quiet');
    expect(gefunden?.texts?.[0]?.content).toBe('2019');
    expect(r.bericht?.leerseiten).toBeGreaterThan(0);
    expect(fotos(r.spreads)).toEqual(fotos(mitAuftakt));
  });

  it('trägt Ausschnitt, Neigung und freie Position durch die Umpaarung', () => {
    const quelle = buch();
    quelle[1]!.slots[0] = {
      slotId: quelle[1]!.slots[0]!.slotId,
      photoId: 'p2',
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' },
      rotateDeg: 1.7,
      rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    };

    const r = insertSinglePage(quelle, { atPage: 1, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    const wieder = r.spreads.flatMap((s) => s.slots).find((s) => s.photoId === 'p2');

    expect(wieder?.crop.mode).toBe('manual');
    expect(wieder?.rotateDeg).toBe(1.7);
    // Die Seite hat gewechselt, also ist die freie Position gespiegelt – der
    // Außenrand bleibt außen, wie bei jeder Halbseite.
    expect(wieder?.rect).toEqual({ x: 1 - 0.1 - 0.3, y: 0.1, w: 0.3, h: 0.3 });
  });

  it('weist eine unbekannte Halbseite ab, statt ein halbes Blatt zu bauen', () => {
    const r = insertSinglePage(buch(), { atPage: 0, halfId: 'halb:gibt-es-nicht', id: 'e' });
    expect(r.ok).toBe(false);
    expect(r.spreads).toHaveLength(3);
  });

  it('zählt die Indizes über das neue Buch durch', () => {
    const r = insertSinglePage(buch(), { atPage: 3, halfId: HALF_BLANK_ID, id: 'eigen-1' });
    expect(r.spreads.map((s) => s.index)).toEqual(r.spreads.map((_, i) => i));
  });
});

describe('Eine Seite einfügen macht keine Doppelseite', () => {
  /** Ein Ein-Bild-Blatt: Bild rechts, linke Buchseite bleibt leer. */
  const einBild = (id: string, photoId: string): Spread => ({
    id,
    index: 0,
    templateId: 'spread.1up.hero-left.mirrored',
    slots: requireTemplate('spread.1up.hero-left.mirrored').slots.map((slot) => ({
      slotId: slot.id,
      photoId,
      crop: { ...AUTO },
    })),
  });

  it('verbraucht eine schon leere Halbseite, statt das Buch zu verlängern', () => {
    // Der Fall, der auffiel: Jede Ein-Bild-Vorlage hat eine leere Buchseite.
    // Eine neue Seite soll die verbrauchen – sonst wächst das Buch um zwei
    // Seiten, obwohl nur eine eingefügt wurde.
    const buch = [einBild('s0', 'p0'), einBild('s1', 'p1'), einBild('s2', 'p2')];
    const r = insertSinglePage(buch, { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.ok).toBe(true);
    expect(r.spreads).toHaveLength(3);
    expect(r.bericht?.leerseiteVerbraucht).toBe(true);
    expect(r.bericht?.leerseiten).toBe(0);
    expect(fotos(r.spreads)).toEqual(['p0', 'p1', 'p2']);
  });

  it('verbraucht keine Halbseite, auf der ein frei gesetzter Kasten liegt', () => {
    // Eine Buchseite ohne Platz aus der Vorlage kann trotzdem ein Bild tragen:
    // ein eingeworfenes, oder die Gegenseite eines seitenweisen
    // Anordnungswechsels. Gesucht wurde die leere Seite aber über ihre Kennung
    // (`halb:leer`) statt über ihren Inhalt – und dann fiel sie samt Bild aus
    // dem Buch.
    const mitEinwurf = einBild('s1', 'p1');
    mitEinwurf.slots.push({
      slotId: 'frei.1',
      photoId: 'p9',
      crop: { ...AUTO },
      // Auf der Buchseite, die keinen Platz aus der Vorlage hat: Bei
      // `hero-left.mirrored` steht das Bild rechts, links ist `halb:leer`.
      rect: { x: 0.15, y: 0.1, w: 0.2, h: 0.2 },
    });
    // Das erste Blatt trägt beidseitig ein Bild, damit die Suche nach einer
    // leeren Halbseite genau auf die mit dem Kasten trifft.
    const buch = [blatt('s0', 'spread.2up.pair', 0), mitEinwurf, einBild('s2', 'p2')];

    const r = insertSinglePage(buch, { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.ok).toBe(true);
    expect(fotos(r.spreads)).toContain('p9');
  });

  it('lässt dabei kein Blatt ganz ohne Bild zurück', () => {
    const buch = [einBild('s0', 'p0'), einBild('s1', 'p1')];
    const r = insertSinglePage(buch, { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.bericht?.leereBlaetter).toBe(0);
    // Die eigene Seite teilt ein Blatt mit einem Bild, statt allein zu stehen.
    const eigen = r.spreads.find((s) => s.id === 'eigen-1')!;
    expect(eigen.slots.filter((s) => s.photoId).length).toBe(1);
  });

  it('nimmt die Ruhefläche hinter einem Auftakt nicht weg', () => {
    // Dort hilft sie der Parität nicht – der Ausgleich passiert davor –, und
    // eine leere Seite neben einem Bild ist oft Absicht.
    const buch = [einBild('s0', 'p0'), auftakt('a1'), einBild('s2', 'p1')];
    const r = insertSinglePage(buch, { atPage: 2, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.bericht?.leerseiteVerbraucht).toBe(false);
    expect(r.spreads).toHaveLength(4);
  });

  it('verlängert das Buch, wenn keine leere Halbseite frei ist', () => {
    // Bei dicht belegten Doppelseiten ist es unvermeidlich: Ein Blatt trägt
    // zwei Seiten, und die zusätzliche muss irgendwo herkommen.
    const buch = [blatt('s0', 'spread.2up.pair', 0), blatt('s1', 'spread.2up.pair', 2)];
    const r = insertSinglePage(buch, { atPage: 0, halfId: HALF_BLANK_ID, id: 'eigen-1' });

    expect(r.spreads).toHaveLength(3);
    expect(r.bericht?.leerseiteVerbraucht).toBe(false);
    expect(r.bericht?.leerseiten).toBe(1);
  });
});

describe('removeSinglePage', () => {
  const buch = () => [
    blatt('s0', 'spread.2up.pair', 0),
    blatt('s1', 'spread.2up.pair', 2),
    blatt('s2', 'spread.2up.pair', 4),
  ];

  it('nimmt eine einzelne Buchseite heraus und lässt alles aufrücken', () => {
    // Sechs Buchseiten minus eine ergeben fünf – das letzte Blatt bleibt halb
    // leer, und das Buch bleibt gleich lang.
    const r = removeSinglePage(buch(), 2);

    expect(r.ok).toBe(true);
    expect(r.photoCount).toBe(1);
    // Die Bilder der entfernten Seite fehlen, alle anderen stehen in Reihenfolge.
    expect(fotos(r.spreads)).toEqual(['p0', 'p1', 'p3', 'p4', 'p5']);
  });

  it('meldet, wie viele Bilder in den Pool gehen', () => {
    const r = removeSinglePage([blatt('s0', 'spread.4up.grid', 0)], 0);
    expect(r.ok).toBe(true);
    // Die linke Hälfte des Vierergitters trägt zwei Bilder.
    expect(r.photoCount).toBe(2);
  });

  it('macht das Buch kürzer, wenn die Rechnung aufgeht', () => {
    // Zwei Blätter mit je einer leeren Hälfte: Nimmt man eine Bildseite heraus,
    // passen die übrigen drei Seiten auf zwei Blätter – eines fällt weg.
    const einBild = (id: string, photoId: string): Spread => ({
      id,
      index: 0,
      templateId: 'spread.1up.hero-left',
      slots: requireTemplate('spread.1up.hero-left').slots.map((slot) => ({
        slotId: slot.id,
        photoId,
        crop: { ...AUTO },
      })),
    });

    const r = removeSinglePage([einBild('s0', 'p0'), einBild('s1', 'p1')], 0);
    expect(r.ok).toBe(true);
    expect(r.spreads).toHaveLength(1);
    expect(fotos(r.spreads)).toEqual(['p1']);
  });

  it('lehnt eine Seite ab, die sich nicht einzeln nehmen lässt', () => {
    // Ein Auftakt trägt seinen Text über beide Hälften. Heimlich das ganze Blatt
    // zu nehmen wäre die schlechtere Antwort als eine Erklärung.
    const r = removeSinglePage([blatt('s0', 'spread.2up.pair', 0), auftakt('a1')], 2);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('nicht in einzelne Seiten trennen');
    expect(r.spreads).toHaveLength(2);
  });

  it('weist eine Buchseite ab, die es nicht gibt', () => {
    expect(removeSinglePage(buch(), 99).ok).toBe(false);
    expect(removeSinglePage(buch(), -1).ok).toBe(false);
  });

  it('lässt festgehaltene Blätter unangetastet', () => {
    const eigen: Spread = {
      id: 'eigen-1',
      index: 1,
      templateId: 'spread.leer',
      slots: [],
      locked: true,
      blocks: [
        {
          id: 't1',
          content: 'Einschulung',
          rect: { x: 0.1, y: 0.4, w: 0.3, h: 0.1 },
          weight: 'semibold',
          fontSizePt: 28,
          align: 'left',
        },
      ],
    };
    const r = removeSinglePage([blatt('s0', 'spread.2up.pair', 0), eigen], 0);

    expect(r.ok).toBe(true);
    expect(r.spreads.find((s) => s.id === 'eigen-1')?.blocks?.[0]?.content).toBe('Einschulung');
  });
});

describe('Eine eingefügte Seite wieder löschen', () => {
  const buch = () => [
    blatt('s0', 'spread.2up.pair', 0),
    blatt('s1', 'spread.2up.pair', 2),
    blatt('s2', 'spread.2up.pair', 4),
  ];

  it('nimmt die eigene Seite wieder heraus, obwohl das Blatt festgehalten ist', () => {
    // Der Fall, der auffiel: Das Schloss schützt die Handarbeit vor der
    // Umpaarung, nicht vor dem Benutzer.
    const eingefuegt = insertSinglePage(buch(), {
      atPage: 2,
      halfId: HALF_BLANK_ID,
      id: 'eigen-1',
      blocks: [
        {
          id: 't1',
          content: 'Einschulung',
          rect: { x: 0.08, y: 0.4, w: 0.3, h: 0.1 },
          weight: 'semibold',
          fontSizePt: 28,
          align: 'left',
        },
      ],
    });
    expect(eingefuegt.ok).toBe(true);

    const wieder = removeSinglePage(eingefuegt.spreads, 2);

    expect(wieder.ok).toBe(true);
    // Die eigene Seite samt Textblock ist weg, alle Bilder sind wieder da.
    expect(wieder.spreads.some((s) => s.blocks?.length)).toBe(false);
    expect(fotos(wieder.spreads)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(wieder.spreads).toHaveLength(3);
  });

  it('führt Einfügen und Löschen zum Ausgangsbuch zurück', () => {
    const vorher = buch();
    const hin = insertSinglePage(vorher, { atPage: 3, halfId: HALF_ONE_ID, id: 'eigen-1' });
    const zurueck = removeSinglePage(hin.spreads, 3);

    expect(zurueck.ok).toBe(true);
    expect(zurueck.spreads).toHaveLength(vorher.length);
    expect(fotos(zurueck.spreads)).toEqual(fotos(vorher));
  });
});

describe('Wirkungslose Löschversuche', () => {
  it('meldet eine leere Seite, die die Blattaufteilung erzwingt', () => {
    // Der Fall am echten Buch: Doppelseite 6 trägt links vier Bilder, rechts
    // nichts, und dahinter stehen justierte Zeilen, die sich nicht trennen
    // lassen. Die leere Seite fällt weg – und die Parität setzt sie sofort
    // wieder ein. Vorher meldete der Griff Erfolg und ließ das Buch, wie es war.
    const einBild = (id: string, photoId: string): Spread => ({
      id,
      index: 0,
      templateId: 'spread.1up.hero-left',
      slots: requireTemplate('spread.1up.hero-left').slots.map((slot) => ({
        slotId: slot.id,
        photoId,
        crop: { ...AUTO },
      })),
    });

    const buch = [einBild('s0', 'p0'), auftakt('a1')];
    // Buchseite 1 ist die leere rechte Hälfte von s0.
    const r = removeSinglePage(buch, 1);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('nicht einzeln entfernen');
    expect(r.spreads).toHaveLength(2);
  });

  it('lässt eine leere Seite weg, wo Inhalt nachrücken kann', () => {
    // Dieselbe Seite, aber mit zerlegbarem Nachbarn statt Auftakt: Jetzt rückt
    // ein Bild nach und die Leerseite verschwindet wirklich.
    const einBild = (id: string, photoId: string): Spread => ({
      id,
      index: 0,
      templateId: 'spread.1up.hero-left',
      slots: requireTemplate('spread.1up.hero-left').slots.map((slot) => ({
        slotId: slot.id,
        photoId,
        crop: { ...AUTO },
      })),
    });

    const r = removeSinglePage([einBild('s0', 'p0'), einBild('s1', 'p1')], 1);

    expect(r.ok).toBe(true);
    expect(r.spreads).toHaveLength(1);
    expect(fotos(r.spreads)).toEqual(['p0', 'p1']);
  });
});

describe('setHalfPage', () => {
  const profile = defaultProfile();

  /** Ein Foto im Querformat; die Maße reichen für jeden Platz dieser Vorlagen. */
  const foto = (id: string): Photo =>
    ({ id, relPath: id, fileName: id, bytes: 1_000_000, width: 4000, height: 3000 }) as Photo;

  /** Ein Viererraster mit Handarbeit an jedem Bild. */
  function raster(): Spread {
    const s = blatt('s0', 'spread.4up.grid', 0);
    s.slots = s.slots.map((slot, i) => ({
      ...slot,
      crop: { x: 0.1 * i, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' as const },
      rotateDeg: 3 + i,
      frame: 'polaroid' as const,
      caption: `Bild ${i}`,
      // Die Herkunft der Unterschrift gehört dazu: Ohne sie gälte jede gefüllte
      // Zeile nach dem ersten Einschub als Handarbeit.
      captionAuto: true as const,
      layer: i,
    }));
    return s;
  }

  /** Die Zuweisungen einer Buchhälfte, an ihrer Geometrie erkannt. */
  function haelfte(spread: Spread, which: 'left' | 'right') {
    const geo = new Map(requireTemplate(spread.templateId).slots.map((s) => [s.id, s]));
    return spread.slots
      .filter((s) => {
        const platz = s.rect ?? geo.get(s.slotId);
        if (!platz) return false;
        const rechts = platz.x + platz.w / 2 >= 0.5;
        return which === 'left' ? !rechts : rechts;
      })
      .map((s) => ({ ...s, platz: geo.get(s.slotId)! }));
  }

  it('lässt die Gegenseite Bild für Bild stehen', () => {
    // Der Bug: Vorher lief der Griff über die zusammengesetzte Paarkennung und
    // damit über `layoutSpread` – die Zuordnung wurde für beide Seiten neu
    // gerechnet, und links lagen hinterher andere Bilder in anderen Plätzen.
    const vorher = raster();
    const links = haelfte(vorher, 'left');

    const r = setHalfPage(vorher, {
      side: 'right',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    const nachher = haelfte(r.spread!, 'left');
    expect(nachher.map((s) => s.photoId)).toEqual(links.map((s) => s.photoId));
    // Und zwar in denselben Plätzen: Die Slotkennung wechselt beim Umpaaren
    // (`a` wird zu `l-a`), die Geometrie darf es nicht.
    expect(nachher.map((s) => s.platz.x)).toEqual(links.map((s) => s.platz.x));
    expect(nachher.map((s) => s.platz.w)).toEqual(links.map((s) => s.platz.w));
  });

  it('behält Ausschnitt, Neigung, Rahmen, Unterschrift und Ebene der Gegenseite', () => {
    // Handarbeit an einem Bild links ist keine Aussage über die rechte Seite.
    const vorher = raster();
    const links = haelfte(vorher, 'left');

    const r = setHalfPage(vorher, {
      side: 'right',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    // Ohne die Kennungen: Beim Umpaaren wird `a` zu `l-a`, und das ist der
    // Zweck der Sache. Verglichen wird, was am Bild hängt.
    const ohneKennung = (s: { slotId: string; platz: { id: string } }) => {
      const { slotId: _weg, platz, ...rest } = s;
      const { id: _auch, ...geometrie } = platz;
      return { ...rest, platz: geometrie };
    };
    expect(haelfte(r.spread!, 'left').map(ohneKennung)).toEqual(links.map(ohneKennung));
  });

  it('ordnet die gewählte Seite neu an und meldet, was keinen Platz fand', () => {
    // Zwei Bilder rechts, eine Halbseite mit einem Platz: Das zweite Bild geht
    // in den Pool, und das gehört gemeldet.
    const r = setHalfPage(raster(), {
      side: 'right',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    expect(haelfte(r.spread!, 'right')).toHaveLength(1);
    expect(r.leftover).toHaveLength(1);
    // Was übrig bleibt, kam von der gewählten Seite – links wird nichts genommen.
    expect(['p2', 'p3']).toContain(r.leftover[0]);
  });

  it('behält Kennung, Schloss und Anker der Doppelseite', () => {
    // `paare` baut ein neues Blatt und vergibt ihm eine neue Kennung. Hier wird
    // ein bestehendes umgestellt: `keep` und `anchor` zeigen weiter auf dasselbe.
    const vorher: Spread = {
      ...raster(),
      id: 'eigen-1',
      index: 4,
      locked: true,
      anchor: { photoId: 'p9', where: 'before' },
    };

    const r = setHalfPage(vorher, {
      side: 'left',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.spread!.id).toBe('eigen-1');
    expect(r.spread!.index).toBe(4);
    expect(r.spread!.locked).toBe(true);
    expect(r.spread!.anchor).toEqual({ photoId: 'p9', where: 'before' });
  });

  it('lehnt ab, was als ganze Doppelseite gedacht ist', () => {
    // Ein Auftakt hängt an Textplätzen, ein Hintergrundbild reicht über beide
    // Seiten: Der Aufrufer muss dann die ganze Doppelseite anordnen, und das
    // soll er entscheiden statt es geraten zu bekommen.
    const nein = (spread: Spread) =>
      setHalfPage(spread, { side: 'right', halfId: HALF_ONE_ID, photos: [], profile });

    expect(nein(auftakt('a0')).ok).toBe(false);
    expect(nein({ ...raster(), backgroundPhotoId: 'p99' }).ok).toBe(false);
  });

  it('ordnet eine Seite auch dann an, wenn nur die andere ein Hintergrundbild trägt', () => {
    // Ein Bild auf einer Buchseite macht das Blatt nicht zur Einheit – dieselbe
    // Grenze wie in `teilbar`, sonst könnte man eine Seite festhalten, aber
    // nicht anordnen.
    const r = setHalfPage(
      { ...raster(), backgroundPhotoId: 'p99', backgroundPhotoSide: 'left' },
      { side: 'right', halfId: HALF_ONE_ID, photos: [], profile },
    );

    expect(r.ok).toBe(true);
    // Und das Bild bleibt, wo es lag.
    expect(r.spread!.backgroundPhotoId).toBe('p99');
    expect(r.spread!.backgroundPhotoSide).toBe('left');
  });

  /** Justierte Zeilen: vier Rechtecke, zwei je Buchseite, keines über dem Falz. */
  function justiert(): Spread {
    const rects = [
      { x: 0.04, y: 0.2, w: 0.2, h: 0.3 },
      { x: 0.26, y: 0.2, w: 0.2, h: 0.3 },
      { x: 0.54, y: 0.2, w: 0.2, h: 0.3 },
      { x: 0.76, y: 0.2, w: 0.2, h: 0.3 },
    ];
    return {
      id: 's0',
      index: 0,
      templateId: 'justiert.4',
      slots: rects.map((rect, i) => ({
        slotId: `j${i}`,
        photoId: `p${i}`,
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5, mode: 'manual' as const },
        rect,
        rotateDeg: 2 + i,
        frame: 'polaroid' as const,
        caption: `Bild ${i}`,
        layer: i,
      })),
    };
  }

  it('trennt auch justierte Zeilen und lässt die Gegenseite Kasten für Kasten stehen', () => {
    // Der Bug: Justierte Zeilen haben keine Halbseitenkennung, also scheiterte
    // die Trennung – und der Server ordnete daraufhin die ganze Doppelseite neu
    // an. Wer links wählte, fand rechts andere Bilder. Ihre Rechtecke liegen
    // aber sehr wohl je auf einer Buchseite.
    const vorher = justiert();
    const rechtsVorher = vorher.slots.slice(2);

    const r = setHalfPage(vorher, {
      side: 'left',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    // Wörtlich übernommen: Kennung, Rechteck, Ausschnitt, Winkel, Rahmen,
    // Unterschrift und Ebene – nichts davon geht die linke Seite an.
    const rechtsNachher = r.spread!.slots.filter((s) => (s.rect?.x ?? 0) >= 0.5);
    expect(rechtsNachher).toEqual(rechtsVorher);
    // Links steht die gewählte Halbseite: ein Platz, das zweite Bild in den Pool.
    expect(r.spread!.templateId).toBe(`paar:${HALF_ONE_ID}+${HALF_BLANK_ID}`);
    expect(r.spread!.slots.filter((s) => s.slotId.startsWith('l-'))).toHaveLength(1);
    expect(r.leftover).toHaveLength(1);
    expect(['p0', 'p1']).toContain(r.leftover[0]);
  });

  it('lehnt ab, wenn ein Kasten über dem Falz liegt', () => {
    // Er gehört keiner der beiden Buchseiten ganz; ihn der näheren zuzuschlagen
    // hieße, die Gegenseite doch anzufassen.
    const ueberFalz = justiert();
    ueberFalz.slots[1] = { ...ueberFalz.slots[1]!, rect: { x: 0.4, y: 0.2, w: 0.25, h: 0.3 } };

    const r = setHalfPage(ueberFalz, {
      side: 'left',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/über dem Falz/);
  });

  it('lässt einen frei gesetzten Kasten der Gegenseite stehen', () => {
    // Ein eingeworfenes Bild steht in keiner Vorlage. Beim Zerlegen fiel es
    // vorher stumm heraus – und war nach dem Griff verschwunden.
    const mitEinwurf = raster();
    mitEinwurf.slots.push({
      slotId: 'frei.1',
      photoId: 'p9',
      crop: { ...AUTO },
      rect: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 },
    });

    const r = setHalfPage(mitEinwurf, {
      side: 'left',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3', 'p9'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    // Nicht auf die letzte Stelle: Die rechte Seite wird zum Zerlegen in die
    // Linksform gespiegelt und danach zurück, und das kostet ein Bit.
    const kasten = r.spread!.slots.find((s) => s.photoId === 'p9')?.rect;
    expect(kasten?.x).toBeCloseTo(0.6, 10);
    expect(kasten?.y).toBe(0.1);
    expect(kasten?.w).toBe(0.2);
  });
});

describe('setChapterHalf', () => {
  const profile = defaultProfile();

  const foto = (id: string): Photo =>
    ({ id, relPath: id, fileName: id, bytes: 1_000_000, width: 4000, height: 3000 }) as Photo;

  /** Eine Jahresseite aus der Bibliothek: links das Jahr, rechts vier Bilder. */
  function jahresseite(): Spread {
    const s = blatt('s0', 'spread.chapter.4up', 0);
    s.chapterYear = 2008;
    s.texts = [
      { id: 's0-y', role: 'year', content: '2008', slotId: 't-year' },
      { id: 's0-e', role: 'freeText', content: 'Geburt', slotId: 't-events' },
    ];
    return s;
  }

  /** Welche Textplätze die Vorlage dieser Doppelseite anbietet. */
  function textplaetze(spread: Spread) {
    return (requireTemplate(spread.templateId).textSlots ?? []).map((t) => t.id);
  }

  it('ordnet die Bildseite neu an und behält Jahreszahl und Ereigniszeilen', () => {
    // Der Grund, aus dem eine Jahresseite bisher unteilbar war: Die Halbseiten
    // des Flusses tragen keinen Textplatz, und ein Text ohne Platz wird nicht
    // gezeichnet — stillschweigend.
    const vorher = jahresseite();

    const r = setChapterHalf(vorher, {
      side: 'right',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    expect(textplaetze(r.spread!)).toEqual(textplaetze(vorher));
    // Und die Texte hängen weiter an ihren Plätzen.
    for (const text of r.spread!.texts ?? []) {
      expect(textplaetze(r.spread!)).toContain(text.slotId);
    }
    // Rechts steht jetzt die gewählte Halbseite, drei Bilder gingen in den Pool.
    expect(r.spread!.slots.filter((s) => s.slotId.startsWith('r-'))).toHaveLength(1);
    expect(r.leftover).toHaveLength(3);
  });

  it('bleibt eine Jahresseite', () => {
    // Sonst bekäme sie nach dem ersten Griff Seitenzahlen und stünde in der
    // Vorlagenwahl des Flusses.
    const r = setChapterHalf(jahresseite(), {
      side: 'right',
      halfId: HALF_ONE_ID,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(templateMeta(r.spread!.templateId).chapterOnly).toBe(true);
  });

  it('wechselt die Fassung der Textseite und lässt die Bildseite stehen', () => {
    const vorher = jahresseite();
    const rechtsVorher = vorher.slots.map((s) => s.photoId);
    const andere = chapterHalves().find((h) => h.slots.length > 0);
    expect(andere, 'keine Textseite mit Bildplatz in der Bibliothek').toBeDefined();

    const r = setChapterHalf(vorher, {
      side: 'left',
      halfId: andere!.id,
      photos: ['p0', 'p1', 'p2', 'p3'].map(foto),
      profile,
    });

    expect(r.ok).toBe(true);
    expect(textplaetze(r.spread!)).toEqual(expect.arrayContaining(['t-year']));
    // Die vier Bilder rechts stehen unverändert – nur ihre Kennung wechselt.
    const rechts = r
      .spread!.slots.filter((s) => s.photoId && rechtsVorher.includes(s.photoId))
      .map((s) => s.photoId);
    expect(rechts).toHaveLength(4);
  });

  it('lehnt eine Flusshälfte auf der Textseite ab', () => {
    // Genau der Griff, der die Jahreszahl nähme. Er wird in der Oberfläche gar
    // nicht angeboten; abgelehnt wird er trotzdem, mit einem Satz.
    const r = setChapterHalf(jahresseite(), {
      side: 'left',
      halfId: HALF_ONE_ID,
      photos: ['p0'].map(foto),
      profile,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Jahreszahl/);
  });

  it('lehnt eine Jahresseiten-Fassung auf der Bildseite ab', () => {
    const links = chapterHalves()[0]!;
    const r = setChapterHalf(jahresseite(), {
      side: 'right',
      halfId: links.id,
      photos: ['p0'].map(foto),
      profile,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anderen Seite/);
  });
});

describe('insertKeptHalves', () => {
  /** Ein Fluss aus drei Vierer-Blättern, Bilder p0 bis p11. */
  const fluss = (): Spread[] => [
    { ...blatt('f0', 'spread.4up.grid', 0), index: 0 },
    { ...blatt('f1', 'spread.4up.grid', 4), index: 1 },
    { ...blatt('f2', 'spread.4up.grid', 8), index: 2 },
  ];

  /** Ein Blatt, dessen linke Buchseite festgehalten ist. */
  const halbGehalten = (
    index: number,
    anchor?: { photoId: string; where: 'before' | 'after' },
  ) => ({
    ...blatt('h0', 'spread.4up.grid', 100),
    index,
    lockedSide: 'left' as const,
    ...(anchor ? { anchor } : {}),
  });

  it('setzt die bewahrte Buchseite an ihren Anker und paart sie neu', () => {
    const r = insertKeptHalves(fluss(), [halbGehalten(1, { photoId: 'p4', where: 'before' })]);

    expect(r.ok).toBe(true);
    // Die Bilder der bewahrten linken Hälfte (p100, p101 im Vierer-Raster)
    // stehen jetzt vor p4 im Buch.
    const reihe = fotos(r.spreads);
    expect(reihe.indexOf('p100')).toBeLessThan(reihe.indexOf('p4'));
    // Und die Bilder des Flusses sind vollzählig geblieben.
    for (const id of ['p0', 'p4', 'p8', 'p11']) expect(reihe).toContain(id);
  });

  it('bringt nur die festgehaltene Hälfte mit, nicht die Gegenseite', () => {
    const r = insertKeptHalves(fluss(), [halbGehalten(1, { photoId: 'p4', where: 'before' })]);
    const reihe = fotos(r.spreads);
    // p102 und p103 liegen auf der rechten Hälfte – sie gehören dem Fluss und
    // sind hier nicht dabei.
    expect(reihe).toContain('p100');
    expect(reihe).not.toContain('p102');
  });

  it('behält das Schloss an der Buchseite, auch wenn sie die Blattseite wechselt', () => {
    const r = insertKeptHalves(fluss(), [halbGehalten(1, { photoId: 'p4', where: 'before' })]);
    const mitSchloss = r.spreads.filter((sp) => sp.lockedSide !== undefined);
    expect(mitSchloss).toHaveLength(1);
    // Auf welcher Seite sie landet, entscheidet die Parität – festgehalten
    // bleibt sie in jedem Fall.
    expect(['left', 'right']).toContain(mitSchloss[0]!.lockedSide);
  });

  it('nimmt ohne Anker den alten Platz als Notnagel', () => {
    const r = insertKeptHalves(fluss(), [halbGehalten(2)]);
    expect(r.ok).toBe(true);
    const reihe = fotos(r.spreads);
    expect(reihe.indexOf('p100')).toBeGreaterThan(reihe.indexOf('p0'));
  });

  it('setzt auch die zweite Seite an ihren Anker und nicht eine Seite zu früh', () => {
    // Jede Einfügung verschiebt alles dahinter um eine Buchseite. Wird die
    // Position einmal vorab gerechnet, landet die zweite Seite zu früh.
    const erste = { ...halbGehalten(0, { photoId: 'p0', where: 'before' }), id: 'h1' };
    const zweite = {
      ...blatt('h2', 'spread.4up.grid', 200),
      index: 2,
      lockedSide: 'left' as const,
      anchor: { photoId: 'p8', where: 'before' as const },
    };

    const r = insertKeptHalves(fluss(), [erste, zweite]);
    const reihe = fotos(r.spreads);
    // Die zweite bewahrte Seite steht vor p8 – und hinter p4, das im Fluss
    // davor liegt.
    expect(reihe.indexOf('p200')).toBeLessThan(reihe.indexOf('p8'));
    expect(reihe.indexOf('p200')).toBeGreaterThan(reihe.indexOf('p4'));
  });

  it('rettet den Anker über das Zerlegen und Paaren', () => {
    const r = insertKeptHalves(fluss(), [halbGehalten(1, { photoId: 'p4', where: 'before' })]);
    const bewahrt = r.spreads.find((sp) => sp.lockedSide !== undefined);
    // Ohne den Anker fiele die Seite beim nächsten Neuaufbau auf ihre alte
    // Blattnummer zurück – eine Stelle im Buch von gestern.
    expect(bewahrt?.anchor).toEqual({ photoId: 'p4', where: 'before' });
  });

  it('überspringt ein unzerlegbares Blatt und setzt die übrigen trotzdem', () => {
    const kaputt = { ...auftakt('a1'), index: 1, lockedSide: 'left' as const };
    const r = insertKeptHalves(fluss(), [
      kaputt,
      halbGehalten(2, { photoId: 'p8', where: 'before' }),
    ]);

    expect(r.ok).toBe(true);
    expect(r.uebersprungen).toEqual(['a1']);
    // Die zerlegbare Seite steht trotzdem im Buch.
    expect(fotos(r.spreads)).toContain('p100');
  });

  it('lässt den Fluss unangetastet, wenn nichts festgehalten ist', () => {
    const r = insertKeptHalves(fluss(), []);
    expect(r.ok).toBe(true);
    expect(fotos(r.spreads)).toEqual(fotos(fluss()));
  });
});
