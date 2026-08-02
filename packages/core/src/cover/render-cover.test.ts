import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
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
    expect(cover.geometry.spineMm).toBeCloseTo(24.8, 6);
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
      (b) => b.kind === 'rect' && b.hMm === geo.heightMm && b.wMm < 50,
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

  it('weist auf das unverifizierte Druckprofil hin', () => {
    const cover = renderCover(VOLL, ctx);
    const befund = cover.warnings.find((w) => w.code === 'profile-unverified');
    expect(befund).toBeDefined();
    expect(coverWarningText(befund!)).toContain('unverifizierten');

    // Umgekehrt: Ist das Profil geprüft, entfällt der Hinweis.
    const geprueft: PrintProfile = {
      ...profile,
      provenance: { ...profile.provenance, verifiedAt: '2026-08-02' },
    };
    const ohne = renderCover(VOLL, { ...ctx, profile: geprueft });
    expect(ohne.warnings.some((w) => w.code === 'profile-unverified')).toBe(false);
  });

  it('ist deterministisch', () => {
    expect(renderCover(VOLL, ctx)).toEqual(renderCover(VOLL, ctx));
  });

  it('liefert Hilfslinien für Beschnitt, Umschlag, Gelenk, Rücken und Falz', () => {
    const cover = renderCover(VOLL, ctx);
    const arten = new Set(cover.guides.map((g) => g.kind));
    expect([...arten].sort()).toEqual(['bleed', 'fold', 'hinge', 'safety', 'spine', 'wrap']);
    expect(cover.guides.filter((g) => g.kind === 'fold')).toHaveLength(4);
    expect(cover.guides.filter((g) => g.kind === 'hinge')).toHaveLength(2);
  });
});
