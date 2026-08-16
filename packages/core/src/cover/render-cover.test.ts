import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import { type PrintProfile, spineWidthMm } from '../print/profile.js';
import type { Photo } from '../model/photo.js';
import { coverGeometry, overlapsHinge, safeArea } from './geometry.js';
import { MAX_SPINE_TEXT_HEIGHT_MM, renderCover } from './render-cover.js';
import { coverWarningText, type CoverBox, type RenderedCover } from './rendered-cover.js';

const profile = saal as PrintProfile;
const SEITEN = 160;

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

/** Ein typisches Bild des Bestands und ein für das Cover viel zu kleines. */
const PHOTOS = new Map<string, Photo>([
  ['gross', photo('gross', 4032, 3024)],
  ['klein', photo('klein', 800, 600)],
]);

const ctx = { profile, pageCount: SEITEN, photos: PHOTOS };

function box(cover: RenderedCover, slotId: string): CoverBox | undefined {
  return cover.boxes.find((b) => 'slotId' in b && b.slotId === slotId);
}

const VOLL = {
  frontPhotoId: 'gross',
  title: 'Frani',
  subtitle: '2008 – 2026',
  spineText: 'Frani · 2008 – 2026',
  backText: 'Achtzehn Jahre in 830 Bildern',
};

describe('Cover rendern', () => {
  it('übernimmt Maße und Rückenbreite aus der Geometrie', () => {
    const cover = renderCover(VOLL, ctx);
    const geo = coverGeometry(profile, SEITEN);
    expect(cover.widthMm).toBe(geo.widthMm);
    expect(cover.heightMm).toBe(geo.heightMm);
    expect(cover.geometry.spineMm).toBeCloseTo(spineWidthMm(profile, SEITEN), 9);
  });

  it('lässt das Titelbild über die Gelenkzone bis zur Blattkante laufen', () => {
    const cover = renderCover(VOLL, ctx);
    const bild = box(cover, 'front-photo');
    const geo = cover.geometry;

    expect(bild?.kind).toBe('image');
    // Beginnt an der Rückenkante, endet an der Blattkante: keine Falztoleranz
    // kann einen weißen Streifen zeigen.
    expect(bild?.xMm).toBe(geo.panels['hinge-front'].xMm);
    expect((bild?.xMm ?? 0) + (bild?.wMm ?? 0)).toBeCloseTo(geo.widthMm, 9);
    expect(bild?.yMm).toBe(0);
    expect(bild?.hMm).toBe(geo.heightMm);
  });

  it('zeigt die Vorderseite als leeren Platz, solange kein Titelbild gewählt ist', () => {
    const cover = renderCover({ title: 'Frani' }, ctx);
    expect(box(cover, 'front-photo')?.kind).toBe('empty');
    // Ohne Bild braucht der Titel keinen deckenden Balken.
    expect(cover.boxes.filter((b) => b.kind === 'rect')).toHaveLength(1); // nur der Rücken
  });

  it('deckt den Rücken über die ganze Bogenhöhe und mit Falztoleranz ab', () => {
    const cover = renderCover(VOLL, ctx);
    const geo = cover.geometry;
    const ruecken = cover.boxes.find(
      (b) => b.kind === 'rect' && b.hMm === geo.heightMm && b.wMm < 80,
    );
    expect(ruecken).toBeDefined();
    expect(ruecken?.xMm).toBeCloseTo(geo.panels.spine.xMm - geo.spineToleranceMm, 9);
    expect(ruecken?.wMm).toBeCloseTo(geo.spineMm + 2 * geo.spineToleranceMm, 9);
  });

  it('setzt Titel und Untertitel in den Sicherheitsbereich der Vorderseite', () => {
    const cover = renderCover(VOLL, ctx);
    const geo = cover.geometry;
    const sicher = safeArea(geo, 'front');

    for (const slotId of ['front-title', 'front-subtitle']) {
      const t = box(cover, slotId);
      expect(t?.kind).toBe('text');
      expect(t?.xMm).toBe(sicher.xMm);
      expect(t?.wMm).toBe(sicher.wMm);
      expect(t?.yMm).toBeGreaterThanOrEqual(sicher.yMm);
      expect((t?.yMm ?? 0) + (t?.hMm ?? 0)).toBeLessThanOrEqual(sicher.yMm + sicher.hMm + 1e-9);
    }

    // Der Untertitel steht unter dem Titel und ist kleiner.
    const titel = box(cover, 'front-title');
    const unter = box(cover, 'front-subtitle');
    expect(unter!.yMm).toBeGreaterThan(titel!.yMm + titel!.hMm - 1e-9);
    expect(unter!.hMm).toBeLessThan(titel!.hMm);
  });

  it('dreht den Rückentext um seinen Mittelpunkt auf den Rücken', () => {
    const cover = renderCover(VOLL, ctx);
    const geo = cover.geometry;
    const t = box(cover, 'spine-text');
    expect(t?.kind).toBe('text');
    expect(t && 'rotateDeg' in t ? t.rotateDeg : undefined).toBe(90);

    // Ungedreht liegt die Box waagerecht und mittig; gedreht muss ihre Mitte
    // auf der Mitte des Rückens liegen.
    const mitteX = (t?.xMm ?? 0) + (t?.wMm ?? 0) / 2;
    const mitteY = (t?.yMm ?? 0) + (t?.hMm ?? 0) / 2;
    expect(mitteX).toBeCloseTo(geo.panels.spine.xMm + geo.spineMm / 2, 9);
    expect(mitteY).toBeCloseTo(geo.heightMm / 2, 9);
    // Zeilenhöhe ist auf den Deckel begrenzt, nicht die volle Rückenbreite.
    expect(t?.hMm).toBe(MAX_SPINE_TEXT_HEIGHT_MM);
  });

  it('lässt den Rückentext bei zu schmalem Rücken weg und meldet es', () => {
    // 2 Seiten ergeben die Mindestrückenbreite von 6 mm; abzüglich Toleranz
    // bleiben 0 mm für Text.
    const cover = renderCover(VOLL, { ...ctx, pageCount: 2 });
    expect(box(cover, 'spine-text')).toBeUndefined();
    const befund = cover.warnings.find((w) => w.code === 'spine-too-narrow-for-text');
    expect(befund).toBeDefined();
    expect(coverWarningText(befund!)).toContain('zu schmal');
  });

  it('hält jeden Text aus der Gelenkzone heraus', () => {
    const cover = renderCover(VOLL, ctx);
    for (const b of cover.boxes) {
      if (b.kind !== 'text') continue;
      const gedreht = 'rotateDeg' in b && b.rotateDeg === 90;
      const bounds = gedreht
        ? {
            xMm: b.xMm + b.wMm / 2 - b.hMm / 2,
            yMm: b.yMm + b.hMm / 2 - b.wMm / 2,
            wMm: b.hMm,
            hMm: b.wMm,
          }
        : b;
      expect(overlapsHinge(cover.geometry, bounds)).toBe(false);
    }
    expect(cover.warnings.some((w) => w.code === 'in-hinge')).toBe(false);
    expect(cover.warnings.some((w) => w.code === 'outside-safety')).toBe(false);
  });

  it('warnt, wenn das Titelbild für die Coverfläche zu klein ist', () => {
    const cover = renderCover({ ...VOLL, frontPhotoId: 'klein' }, ctx);
    const befund = cover.warnings.find((w) => w.code === 'below-min-dpi');
    expect(befund).toBeDefined();
    // 800 px auf gut 330 mm sind rund 61 dpi.
    expect(befund && 'dpi' in befund ? Math.round(befund.dpi) : 0).toBeLessThan(100);
  });

  it('meldet ein Titelbild, das nicht im Bestand ist, ohne das Rendern abzubrechen', () => {
    const cover = renderCover({ ...VOLL, frontPhotoId: 'weg' }, ctx);
    expect(box(cover, 'front-photo')?.kind).toBe('image');
    expect(cover.warnings.some((w) => w.code === 'photo-missing')).toBe(true);
  });

  it('weist auf ein unverifiziertes Druckprofil hin', () => {
    // Die mitgelieferten Profile sind gegen die Angaben des Anbieters geprüft,
    // also schweigt der Hinweis. Er greift für ein von Hand ergänztes Format.
    const cover = renderCover(VOLL, ctx);
    expect(cover.warnings.some((w) => w.code === 'profile-unverified')).toBe(false);

    const ungeprueft: PrintProfile = {
      ...profile,
      provenance: { ...profile.provenance, verifiedAt: null },
    };
    const mit = renderCover(VOLL, { ...ctx, profile: ungeprueft });
    const befund = mit.warnings.find((w) => w.code === 'profile-unverified');
    expect(befund).toBeDefined();
    expect(coverWarningText(befund!)).toContain('unverifizierten');
  });

  it('ist deterministisch', () => {
    expect(renderCover(VOLL, ctx)).toEqual(renderCover(VOLL, ctx));
  });

  it('rendert ohne eine einzige Gestaltungsangabe genau wie vorher', () => {
    // Die Zusage hinter `CoverTextStyle`: Jedes Feld ist optional, und ein
    // leeres `texts` darf am Ergebnis nichts ändern. Sonst verschöbe die
    // Gestaltbarkeit jedes bestehende Buch um ein paar Zehntelmillimeter.
    expect(renderCover({ ...VOLL, texts: {} }, ctx)).toEqual(renderCover(VOLL, ctx));
  });

  it('liefert Hilfslinien für Beschnitt, Umschlag, Gelenk, Rücken und Falz', () => {
    const cover = renderCover(VOLL, ctx);
    const arten = new Set(cover.guides.map((g) => g.kind));
    expect([...arten].sort()).toEqual(['bleed', 'fold', 'hinge', 'safety', 'spine', 'wrap']);
    expect(cover.guides.filter((g) => g.kind === 'fold')).toHaveLength(4);
    expect(cover.guides.filter((g) => g.kind === 'hinge')).toHaveLength(2);
  });
});

describe('Umschlag gestalten', () => {
  it('setzt Schrift und Punktgröße je Text', () => {
    const cover = renderCover(
      {
        ...VOLL,
        texts: {
          title: { family: 'display', sizePt: 48 },
          subtitle: { family: 'hand' },
          spine: { family: 'serif' },
          backText: { family: 'hand', sizePt: 9 },
        },
      },
      ctx,
    );

    const titel = box(cover, 'front-title');
    expect(titel && 'family' in titel ? titel.family : undefined).toBe('display');
    // Die Punktgröße kommt an, ohne dass ein Adapter sie nachrechnen müsste:
    // Der Kasten ist aus ihr abgeleitet, die Größe steht in der Box.
    expect(titel && 'fontSizePt' in titel ? titel.fontSizePt : 0).toBeCloseTo(48, 6);
    expect(box(cover, 'front-subtitle')).toMatchObject({ family: 'hand' });
    expect(box(cover, 'spine-text')).toMatchObject({ family: 'serif' });
    expect(box(cover, 'back-text')).toMatchObject({ family: 'hand', fontSizePt: 9 });
  });

  it('lässt einen größeren Titel den Untertitel nach unten nicht verschieben', () => {
    // Beide hängen an der Unterkante des Sicherheitsbereichs: Der Untertitel
    // steht dort, der Titel wächst nach oben. Ein Titel, der seinen Untertitel
    // vom Blatt schöbe, wäre die naheliegende und falsche Rechnung.
    const klein = renderCover(VOLL, ctx);
    const gross = renderCover({ ...VOLL, texts: { title: { sizePt: 60 } } }, ctx);

    expect(box(gross, 'front-subtitle')?.yMm).toBeCloseTo(box(klein, 'front-subtitle')!.yMm, 9);
    expect(box(gross, 'front-title')!.yMm).toBeLessThan(box(klein, 'front-title')!.yMm);
  });

  it('meldet einen Titelsatz, der aus dem Sicherheitsbereich wächst', () => {
    // Zusammen 242 mm Kastenhöhe auf 260 mm Sicherheitsfläche, plus Zwischenraum
    // — genau der Fall, für den die Größe keine eigene Grenze braucht: Was zu
    // groß ist, sagt die Fläche und nicht eine geratene Höchstzahl.
    const cover = renderCover(
      { ...VOLL, texts: { title: { sizePt: 240 }, subtitle: { sizePt: 240 } } },
      ctx,
    );
    const befund = cover.warnings.find(
      (w) => w.code === 'outside-safety' && w.slotId === 'front-title',
    );
    expect(befund).toBeDefined();
  });

  it('legt Titel und Untertitel auf zwei Balken, die aneinanderstoßen', () => {
    const cover = renderCover(
      { ...VOLL, texts: { title: { band: '#112233' }, subtitle: { band: '#445566' } } },
      ctx,
    );
    const balken = cover.boxes.filter(
      (b) => b.kind === 'rect' && (b.fill === '#112233' || b.fill === '#445566'),
    );
    expect(balken).toHaveLength(2);
    const [oben, unten] = balken;
    // Keine Fuge: Bei gleicher Farbe muss wieder eine durchgehende Fläche
    // herauskommen, sonst sähe der Vorgabefall nach einem Fehler aus.
    expect(unten!.yMm).toBeCloseTo(oben!.yMm + oben!.hMm, 9);
    expect(unten!.yMm + unten!.hMm).toBeCloseTo(cover.heightMm, 9);
  });

  it('ergibt bei gleicher Balkenfarbe dieselbe Fläche wie ein Balken', () => {
    const zwei = renderCover(
      { ...VOLL, texts: { title: { band: '#1a1a1a' }, subtitle: { band: '#1a1a1a' } } },
      ctx,
    );
    const einer = renderCover(VOLL, ctx);
    const flaeche = (c: RenderedCover) =>
      c.boxes
        .filter((b) => b.kind === 'rect' && b.fill === '#1a1a1a' && b.xMm > c.geometry.spineMm)
        .reduce((summe, b) => summe + b.hMm, 0);
    expect(flaeche(zwei)).toBeCloseTo(flaeche(einer), 9);
  });

  it('zeichnet einen Balken auch ohne Bild, wenn eine Farbe gewählt wurde', () => {
    // Ohne Bild und ohne Wahl bleibt der Text auf blankem Grund — das ist die
    // Vorgabe. Wer eine Farbe wählt, will sie sehen.
    const ohne = renderCover({ title: 'Frani' }, ctx);
    expect(ohne.boxes.filter((b) => b.kind === 'rect')).toHaveLength(1); // nur der Rücken

    const mit = renderCover({ title: 'Frani', texts: { title: { band: '#123456' } } }, ctx);
    expect(mit.boxes.filter((b) => b.kind === 'rect' && b.fill === '#123456')).toHaveLength(1);
  });

  it('färbt Rücken und Rückseitenbalken je für sich', () => {
    const cover = renderCover(
      {
        ...VOLL,
        backPhotoId: 'gross',
        texts: { spine: { band: '#aa0000' }, backText: { band: '#00aa00' } },
      },
      ctx,
    );
    const geo = cover.geometry;
    const ruecken = cover.boxes.find(
      (b) => b.kind === 'rect' && b.hMm === geo.heightMm && b.wMm < 80,
    );
    expect(ruecken && 'fill' in ruecken ? ruecken.fill : undefined).toBe('#aa0000');
    expect(cover.boxes.some((b) => b.kind === 'rect' && b.fill === '#00aa00')).toBe(true);
  });

  it('legt die Deckelfarben als zwei Flächen unter die Bilder', () => {
    const cover = renderCover(
      { ...VOLL, frontBackground: '#eeeeee', backBackground: '#333333' },
      ctx,
    );
    const geo = cover.geometry;

    const vorn = cover.boxes.findIndex((b) => b.kind === 'rect' && b.fill === '#eeeeee');
    const hinten = cover.boxes.findIndex((b) => b.kind === 'rect' && b.fill === '#333333');
    const bild = cover.boxes.findIndex((b) => 'slotId' in b && b.slotId === 'front-photo');
    expect(vorn).toBeGreaterThanOrEqual(0);
    // Vor dem Bild in der Zeichenreihenfolge: Ein randabfallendes Titelbild
    // deckt die Farbe zu, sichtbar bleibt sie, wo keines liegt.
    expect(vorn).toBeLessThan(bild);

    const hinterFlaeche = cover.boxes[hinten]!;
    expect(hinterFlaeche.xMm).toBe(0);
    expect(hinterFlaeche.wMm).toBeCloseTo(geo.panels.spine.xMm, 9);
    expect(hinterFlaeche.hMm).toBeCloseTo(geo.heightMm, 9);
  });

  it('klemmt einen zu großen Rückentitel und sagt es', () => {
    const cover = renderCover({ ...VOLL, texts: { spine: { sizePt: 120 } } }, ctx);
    const geo = cover.geometry;
    const t = box(cover, 'spine-text');
    expect(t!.hMm).toBeLessThanOrEqual(geo.spineMm - 2 * geo.spineToleranceMm + 1e-9);
    const befund = cover.warnings.find((w) => w.code === 'spine-text-clipped');
    expect(befund).toBeDefined();
    expect(coverWarningText(befund!)).toContain('Rückenbreite');
  });

  it('schweigt über die Rückenbreite, solange keine Größe gesetzt ist', () => {
    // `MAX_SPINE_TEXT_HEIGHT_MM` ist ein Deckel und keine Anforderung: Dass ein
    // schmaler Rücken ihn nicht ausschöpft, ist der Normalfall.
    const cover = renderCover(VOLL, { ...ctx, pageCount: 40 });
    expect(cover.warnings.some((w) => w.code === 'spine-text-clipped')).toBe(false);
  });
});
