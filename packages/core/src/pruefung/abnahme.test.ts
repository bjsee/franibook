import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import { spreadHeightMm, spreadWidthMm, type PrintProfile } from '../print/profile.js';
import type { NaiveDateTime, Photo } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import { requireTemplate } from '../templates/index.js';
import { renderSpread } from '../render/render-spread.js';
import { PAGE_NUMBER_SLOT_PREFIX } from '../render/page-number.js';
import { sideTimelineBoxes } from '../render/side-timeline.js';
import type { RenderBox, RenderedSpread } from '../render/rendered-spread.js';
import { pruefeBuch, seitenbefunde, type Befundart } from './abnahme.js';

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
    takenAt: '2019-07-01T12:00:00' as NaiveDateTime,
  };
}

const PHOTOS = new Map<string, Photo>([
  ['p1', photo('p1', 2048, 1536)],
  ['p2', photo('p2', 1536, 2048)],
  ['p3', photo('p3', 2048, 1152)],
  ['p4', photo('p4', 2048, 2048)],
  // Der bekannte Fall aus dem echten Bestand: 348 px lange Kante, passt in
  // keinen Slot mit 240 dpi.
  ['klein', photo('klein', 348, 261)],
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

function gerendert(photoIds: (string | null)[]): RenderedSpread {
  return renderSpread(spreadWith(photoIds), { profile, template, photos: PHOTOS });
}

/** Die Arten aller Funde, in der Reihenfolge des Berichts. */
function arten(bericht: { befunde: { art: Befundart }[] }): Befundart[] {
  return bericht.befunde.map((b) => b.art);
}

/**
 * Ein Textkasten an einer frei gewählten Stelle des Blattes.
 *
 * Von Hand gesetzt und nicht über eine Vorlage: Geprüft wird die Lage, und die
 * Vorlagen setzen ihre Texte gerade nicht an die Kante.
 */
function textbox(xMm: number, yMm: number, content = 'Sommer 2019', slotId = 'block-1'): RenderBox {
  return {
    kind: 'text',
    xMm,
    yMm,
    wMm: 40,
    hMm: 6,
    slotId,
    content,
    fontSizePt: 12,
    weight: 'regular',
    align: 'left',
    color: '#000',
  };
}

/** Eine Doppelseite ohne Inhalt, um einzelne Boxen darauf zu legen. */
function leeresBlatt(boxes: RenderBox[]): RenderedSpread {
  return {
    spreadId: 's1',
    widthMm: spreadWidthMm(profile),
    heightMm: spreadHeightMm(profile),
    bleedMm: profile.page.bleedMm,
    gutterXMm: profile.page.bleedMm + profile.page.trimWidthMm,
    background: '#fff',
    boxes,
    guides: [],
  };
}

describe('Abnahmebericht', () => {
  it('findet an einer regelrechten Doppelseite keinen schweren Fund', () => {
    // Vier Bilder mit 2048 px langer Kante in einem Vierer-Raster: Das ist der
    // Regelfall des echten Bestands.
    const bericht = pruefeBuch({ spreads: [gerendert(['p1', 'p2', 'p3', 'p4'])], profile });

    // Die Seitenzahl, weil zwei Seiten weniger sind als das Profil bindet — an
    // einer einzelnen Doppelseite ist das kein Mangel des Layouts. Und die
    // Zielauflösung, weil 2048 px auf 270 mm Seitenbreite die 300 dpi nicht
    // erreichen; am gewählten Format ist das der Normalfall und deshalb eine
    // Summenzeile.
    expect(arten(bericht)).toEqual(['seitenzahl', 'unter-ziel-dpi']);
    expect(bericht.bilanz.schwer).toBe(1);
    expect(bericht.umfang).toEqual({ doppelseiten: 1, seiten: 2, bilder: 4 });
  });

  it('bündelt die Zielauflösung zu einer Zeile, nicht zu einer je Bild', () => {
    const zehn = Array.from({ length: 10 }, () => gerendert(['p1', 'p2', 'p3', 'p4']));
    const bericht = pruefeBuch({ spreads: zehn, profile });

    const ziel = bericht.befunde.filter((b) => b.art === 'unter-ziel-dpi');
    expect(ziel).toHaveLength(1);
    expect(ziel[0]!.ort).toEqual({ kind: 'buch' });
    // Die Zahl steht im Satz: Ohne sie wäre die Bündelung ein Verschweigen.
    expect(ziel[0]!.text).toMatch(/^\d+ Bilder unter der Zielauflösung von 300 dpi/);
  });

  it('nennt ein Bild unter der Mindestauflösung mit Seite und Platz', () => {
    const bericht = pruefeBuch({
      spreads: [gerendert(['klein', 'p2', 'p3', 'p4'])],
      profile,
    });

    const fund = bericht.befunde.find((b) => b.art === 'unter-mindest-dpi');
    expect(fund).toBeDefined();
    expect(fund!.ort).toEqual({ kind: 'spread', index: 0, slotId: template.slots[0]!.id });
    expect(fund!.text).toContain(`Mindestauflösung von ${profile.resolution.minDpi} dpi`);
    expect(bericht.bilanz.schwer).toBeGreaterThan(0);
  });

  it('zählt leere Plätze, solange die Seite überhaupt ein Bild trägt', () => {
    const bericht = pruefeBuch({ spreads: [gerendert(['p1', null, null, null])], profile });

    expect(arten(bericht).filter((a) => a === 'platz-leer')).toHaveLength(3);
    expect(arten(bericht)).not.toContain('seite-ohne-bild');
  });

  it('meldet eine Doppelseite ohne Bild als eine Zeile, nicht als vier', () => {
    const bericht = pruefeBuch({ spreads: [gerendert([null, null, null, null])], profile });

    // Vier leere Plätze wären vier Funde für einen Umstand. Die Seitenzeile
    // sagt ihn besser.
    expect(arten(bericht)).toContain('seite-ohne-bild');
    expect(arten(bericht)).not.toContain('platz-leer');
    expect(bericht.umfang.bilder).toBe(0);
  });

  it('nennt eine Seite mit Hintergrundbild nicht leer', () => {
    // Ein Hintergrundbild über die ganze Doppelseite ist eine Gestaltung und
    // kein vergessenes Blatt — gezählt wird es trotzdem nicht als Motiv.
    const hintergrund: RenderBox = {
      kind: 'image',
      xMm: 0,
      yMm: 0,
      wMm: spreadWidthMm(profile),
      hMm: spreadHeightMm(profile),
      slotId: 'background',
      photoId: 'p1',
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' },
      effectiveDpi: 400,
      warnings: [],
    };
    const bericht = pruefeBuch({ spreads: [leeresBlatt([hintergrund])], profile });

    expect(arten(bericht)).not.toContain('seite-ohne-bild');
    expect(bericht.umfang.bilder).toBe(0);
  });

  it('findet Text, der zu nah an der Schnittkante steht', () => {
    const knapp = profile.page.bleedMm + profile.page.safetyMm - 1;
    const bericht = pruefeBuch({ spreads: [leeresBlatt([textbox(knapp, 40)])], profile });

    expect(arten(bericht)).toContain('im-rand');
    expect(bericht.befunde.find((b) => b.art === 'im-rand')!.text).toContain('Sommer 2019');
  });

  it('lässt Text im Sicherheitsbereich in Ruhe', () => {
    const drin = profile.page.bleedMm + profile.page.safetyMm + 1;
    const bericht = pruefeBuch({ spreads: [leeresBlatt([textbox(drin, drin)])], profile });

    expect(arten(bericht)).not.toContain('im-rand');
    expect(arten(bericht)).not.toContain('im-falz');
  });

  it('findet Text, der in die Falzzone reicht', () => {
    const mitte = profile.page.bleedMm + profile.page.trimWidthMm;
    // Der Kasten ist 40 mm breit; er endet damit mitten im Falzband.
    const bericht = pruefeBuch({
      spreads: [leeresBlatt([textbox(mitte - profile.page.gutterSafeMm - 20, 40)])],
      profile,
    });

    expect(arten(bericht)).toContain('im-falz');
  });

  it('nennt den gemessenen Abstand, nicht nur die Schwelle', () => {
    // 1,5 mm hinter der Endformatkante: derselbe Fall wie die Randachse des
    // Zeitstrahls am echten Buch.
    const bericht = pruefeBuch({
      spreads: [leeresBlatt([textbox(profile.page.bleedMm + 1.5, 40)])],
      profile,
    });

    expect(bericht.befunde.find((b) => b.art === 'im-rand')!.text).toContain('1.5 mm');
  });

  it('bündelt, was die Engine auf jeder Seite gleich zeichnet', () => {
    // Die Randachse des Zeitstrahls stand am echten Buch mit 240 Zeilen im
    // Bericht — dreimal achtzig Mal dieselbe Rechnung.
    const knapp = profile.page.bleedMm + 1;
    const drei = [0, 1, 2].map(() =>
      leeresBlatt([textbox(knapp, 40, '2008', 'side-timeline-from')]),
    );
    const bericht = pruefeBuch({ spreads: drei, profile });

    const rand = bericht.befunde.filter((b) => b.art === 'im-rand');
    expect(rand).toHaveLength(1);
    // Sprungziel ist die erste betroffene Seite, die Zahl steht im Satz.
    expect(rand[0]!.ort).toEqual({ kind: 'spread', index: 0, slotId: 'side-timeline-from' });
    expect(rand[0]!.text).toContain('ebenso auf 2 weiteren Doppelseiten');
  });

  it('bündelt auch die Seitenzahl über das ganze Buch', () => {
    // Sie steht auf jeder Doppelseite nach derselben Rechnung. Rutschte sie
    // je zu weit nach außen, wären es sonst 160 gleichlautende Zeilen — genau
    // der Fall, für den die Bündelung gebaut ist.
    const knapp = profile.page.bleedMm + 1;
    const drei = [0, 1, 2].map(() =>
      leeresBlatt([textbox(knapp, 40, '7', `${PAGE_NUMBER_SLOT_PREFIX}-left`)]),
    );
    const bericht = pruefeBuch({ spreads: drei, profile });

    const rand = bericht.befunde.filter((b) => b.art === 'im-rand');
    expect(rand).toHaveLength(1);
    expect(rand[0]!.schluessel).toBe(`im-rand#text:${PAGE_NUMBER_SLOT_PREFIX}-left`);
  });

  it('bündelt nicht, was auf jeder Seite von Hand steht', () => {
    // Ein Vorlagentext trägt auf jeder Doppelseite dieselbe Kennung (`t-year`
    // auf jedem Jahresauftakt), steht aber nur dort zu weit außen, wo ihn
    // jemand hingezogen hat. Gebündelt erledigte eine Abnahme auch die
    // neunzehn anderen Auftakte mit.
    const knapp = profile.page.bleedMm + 1;
    const drei = [0, 1, 2].map(() => leeresBlatt([textbox(knapp, 40, '2018', 't-year')]));
    const bericht = pruefeBuch({ spreads: drei, profile });

    const rand = bericht.befunde.filter((b) => b.art === 'im-rand');
    expect(rand).toHaveLength(3);
    expect(rand.map((b) => b.schluessel)).toEqual([
      'im-rand#text:t-year@seite:0',
      'im-rand#text:t-year@seite:1',
      'im-rand#text:t-year@seite:2',
    ]);
  });

  it('übergeht einen leeren Textkasten', () => {
    // Ein Vorlagentext ohne Inhalt steht im RSM mit leerer Zeichenkette. Er
    // wird nicht gedruckt, also ist seine Lage keine Aussage.
    const knapp = profile.page.bleedMm + profile.page.safetyMm - 1;
    const bericht = pruefeBuch({ spreads: [leeresBlatt([textbox(knapp, 40, '  ')])], profile });

    expect(arten(bericht)).not.toContain('im-rand');
  });

  it('macht aus der Randachse des Zeitstrahls keinen Fund mehr', () => {
    // Der Fall, der diesen Bericht gerechtfertigt hat und den er ausgelöst hat:
    // Die Randachse setzte ihre Jahreszahlen 1,8 mm vor die Schnittkante.
    // Geprüft wird gegen die **echten** Boxen der Achse und nicht gegen von
    // Hand gebaute — sonst prüfte der Test seine eigene Annahme.
    const achse = sideTimelineBoxes(
      {
        fromYear: 2008,
        toYear: 2026,
        at: '2017-06-15T12:00:00' as NaiveDateTime,
        variant: 'bar',
      },
      profile,
    );
    expect(achse.length).toBeGreaterThan(0);

    const bericht = pruefeBuch({ spreads: [leeresBlatt(achse)], profile });
    expect(arten(bericht)).not.toContain('im-rand');
  });

  it('prüft die Seitenzahl gegen das Profil und nennt die nächste zulässige', () => {
    const { min, step } = profile.pageCount;
    const passend = Array.from({ length: min / 2 }, () => gerendert(['p1', 'p2', 'p3', 'p4']));

    expect(arten(pruefeBuch({ spreads: passend, profile }))).not.toContain('seitenzahl');

    const eineZuViel = [...passend, gerendert(['p1', 'p2', 'p3', 'p4'])];
    const bericht = pruefeBuch({ spreads: eineZuViel, profile });
    const fund = bericht.befunde.find((b) => b.art === 'seitenzahl');
    // Nur wenn der Schritt größer als zwei ist, ist eine Doppelseite mehr
    // überhaupt ein Verstoß — sonst hat das Profil nichts dagegen.
    if (step > 2) {
      expect(fund).toBeDefined();
      expect(fund!.ort).toEqual({ kind: 'buch' });
      expect(fund!.text).toContain(`${min + step}`);
    } else {
      expect(fund).toBeUndefined();
    }
  });

  it('meldet ein veraltetes Buch, ohne es neu zu bauen', () => {
    const bericht = pruefeBuch({
      spreads: [gerendert(['p1', 'p2', 'p3', 'p4'])],
      profile,
      groupsPending: true,
      structurePending: true,
    });

    expect(arten(bericht)).toContain('gruppen-veraltet');
    expect(arten(bericht)).toContain('gliederung-veraltet');
  });

  it('nimmt die Befunde des Umschlags auf, mit dessen Wortlaut', () => {
    const bericht = pruefeBuch({
      spreads: [gerendert(['p1', 'p2', 'p3', 'p4'])],
      profile,
      cover: {
        coverId: 'cover',
        widthMm: 600,
        heightMm: 300,
        bleedMm: 3,
        geometry: {} as never,
        background: '#fff',
        boxes: [],
        guides: [],
        warnings: [
          { code: 'in-hinge', slotId: 'cover-title' },
          { code: 'profile-unverified', source: 'Annahme' },
        ],
      },
    });

    const falz = bericht.befunde.find((b) => b.art === 'im-falz');
    expect(falz!.ort).toEqual({ kind: 'umschlag' });
    // Derselbe Satz wie im Umschlagreiter — `coverWarningText` ist die Quelle.
    expect(falz!.text).toContain('Gelenkzone');
    expect(arten(bericht)).toContain('profil-ungeprueft');
  });

  it('hängt einen Bildfund an das Foto und einen Textfund an den Textplatz', () => {
    const knapp = profile.page.bleedMm + 1;
    const bericht = pruefeBuch({
      spreads: [gerendert(['klein', 'p2', 'p3', 'p4']), leeresBlatt([textbox(knapp, 40)])],
      profile,
    });

    // Am Foto und nicht am Platz: Eine Neuanordnung trägt das Bild auf eine
    // andere Seite, die Aussage über das Bild bleibt dieselbe.
    expect(bericht.befunde.find((b) => b.art === 'unter-mindest-dpi')!.schluessel).toBe(
      'unter-mindest-dpi#foto:klein',
    );
    // Mit der Seite im Schlüssel, weil ein von Hand gesetzter Kasten auf jeder
    // Doppelseite eine eigene Entscheidung ist.
    expect(bericht.befunde.find((b) => b.art === 'im-rand')!.schluessel).toBe(
      'im-rand#text:block-1@seite:1',
    );
  });

  it('nimmt abgenickte Funde aus der Bilanz, ohne sie zu verschweigen', () => {
    const spreads = [gerendert(['klein', 'p2', 'p3', 'p4'])];
    const offen = pruefeBuch({ spreads, profile });
    const schluessel = offen.befunde.find((b) => b.art === 'unter-mindest-dpi')!.schluessel;

    const nachher = pruefeBuch({ spreads, profile, abgenommen: new Set([schluessel]) });

    const fund = nachher.befunde.find((b) => b.schluessel === schluessel);
    // Der Fund steht weiter in der Liste — wer „auch abgenommene zeigen" wählt,
    // will ihn sehen — zählt aber nicht mehr als offen.
    expect(fund?.abgenommen).toBe(true);
    expect(nachher.bilanz.abgenommen).toBe(1);
    expect(nachher.bilanz.schwer).toBe(offen.bilanz.schwer - 1);
  });

  it('erledigt mit einer Abnahme alle Doppelseiten derselben Engine-Beschriftung', () => {
    // Der Fall der Randachse: dieselbe Rechnung auf achtzig Seiten, ein
    // Schlüssel, ein Klick.
    const knapp = profile.page.bleedMm + 1;
    const spreads = [0, 1, 2].map(() =>
      leeresBlatt([textbox(knapp, 40, '2008', 'side-timeline-from')]),
    );
    const bericht = pruefeBuch({
      spreads,
      profile,
      abgenommen: new Set(['im-rand#text:side-timeline-from']),
    });

    expect(bericht.befunde.filter((b) => b.art === 'im-rand')).toHaveLength(1);
    expect(bericht.befunde.find((b) => b.art === 'im-rand')!.abgenommen).toBe(true);
  });

  it('meldet für eine einzelne Doppelseite dasselbe wie für das Buch', () => {
    // Die Bühne blendet `seitenbefunde` am Bild ein. Wären es zwei Rechnungen,
    // behaupteten Liste und Papier verschiedene Dinge.
    const spread = gerendert(['klein', 'p2', 'p3', 'p4']);
    const ausDemBuch = pruefeBuch({ spreads: [spread], profile }).befunde.filter(
      (b) => b.ort.kind === 'spread',
    );

    expect(seitenbefunde(spread, 0, profile)).toEqual(ausDemBuch);
  });

  it('ordnet die Funde nach Gewicht und innerhalb einer Art nach Buchreihenfolge', () => {
    const bericht = pruefeBuch({
      spreads: [
        gerendert(['p1', null, 'p3', 'p4']),
        gerendert(['klein', 'p2', 'p3', 'p4']),
        gerendert(['p1', null, 'p3', 'p4']),
      ],
      profile,
    });

    // Das schwere Ergebnis steht vor den leichten …
    expect(bericht.befunde[0]!.art).toBe('unter-mindest-dpi');
    // … und die beiden leeren Plätze stehen in der Reihenfolge des Buchs.
    const leer = bericht.befunde.filter((b) => b.art === 'platz-leer');
    expect(leer.map((b) => (b.ort.kind === 'spread' ? b.ort.index : -1))).toEqual([0, 2]);
  });
});
