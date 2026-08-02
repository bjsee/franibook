/**
 * Berechnet aus dem Cover-Datenmodell das Rendered Cover Model.
 *
 * Gegenstück zu `render/render-spread.ts` und mit derselben Aufgabenteilung:
 * Hier fallen alle Layoutentscheidungen, die Renderer zeichnen nur noch. Jede
 * Länge kommt entweder aus der Cover-Geometrie (und damit aus dem Druckprofil)
 * oder aus einer der drei Gestaltungskonstanten unten.
 *
 * Deterministisch: gleiche Eingaben ergeben exakt dasselbe Cover.
 */
import { effectiveDpi } from '../geometry/units.js';
import { FULL_CROP, coverCrop, cropToPixels } from '../model/crop.js';
import type { Crop } from '../model/crop.js';
import type { Photo, PhotoId } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import type { ImageBox, Rect, RenderWarning } from '../render/rendered-spread.js';
import type { CoverDesign } from './cover.js';
import { withCoverDefaults } from './cover.js';
import type { CoverGeometry, CoverPanelKind } from './geometry.js';
import { containsRect, coverGeometry, overlapsHinge, safeArea } from './geometry.js';
import type {
  CoverBox,
  CoverGuide,
  CoverTextBox,
  CoverWarning,
  RenderedCover,
} from './rendered-cover.js';

/**
 * Titelhöhe als Anteil der Seitenhöhe.
 *
 * 0,05 sind bei 300 mm Seitenhöhe 15 mm Zeilenhöhe, also rund 30 pt – groß
 * genug, um auf dem Regal lesbar zu sein, und klein genug, dass ein
 * zweizeiliger Titelsatz mit Untertitel im Sicherheitsbereich bleibt.
 */
const TITLE_HEIGHT_FRACTION = 0.05;
/** Untertitel und Rückseitentext als Anteil der Titelhöhe. */
const SUBTITLE_FRACTION = 0.45;
const BACK_TEXT_FRACTION = 0.35;
/** Abstand zwischen Titel und Untertitel, als Anteil der Titelhöhe. */
const GAP_FRACTION = 0.25;

/**
 * Kleinste sinnvolle Zeilenhöhe auf dem Rücken: 4 mm sind knapp 8 pt.
 * Darunter wäre der Rückentitel im Regal ohnehin nicht mehr zu lesen.
 */
export const MIN_SPINE_TEXT_HEIGHT_MM = 4;
/**
 * Größte Zeilenhöhe auf dem Rücken.
 *
 * Ohne Deckel würde ein 25 mm breiter Rücken eine 35-pt-Zeile tragen und damit
 * größer wirken als der Titel der Vorderseite (30 pt).
 */
export const MAX_SPINE_TEXT_HEIGHT_MM = 12;

export interface CoverRenderContext {
  profile: PrintProfile;
  /**
   * Endgültige Seitenzahl des Innenteils.
   *
   * Der einzige veränderliche Eingang der Geometrie: Zwei Seiten mehr machen
   * den Rücken 0,26 mm breiter und verschieben die ganze Vorderseite.
   */
  pageCount: number;
  photos: ReadonlyMap<PhotoId, Photo>;
}

/** Schriftgrad aus der Zeilenhöhe – dieselbe Näherung wie im Innenteil. */
function fontSizeFor(hMm: number): number {
  return (hMm / 25.4) * 72 * 0.7;
}

/**
 * Umschließendes Rechteck einer möglicherweise gedrehten Textbox.
 *
 * Es treten ausschließlich rechte Winkel auf – der Rückentext ist der einzige
 * gedrehte Inhalt des Covers. Bei 90° tauschen Breite und Höhe um den
 * Mittelpunkt, alles andere bliebe unverändert.
 */
function boundsOf(box: CoverTextBox): Rect {
  const gedreht = box.rotateDeg !== undefined && Math.abs(box.rotateDeg) % 180 === 90;
  if (!gedreht) return { xMm: box.xMm, yMm: box.yMm, wMm: box.wMm, hMm: box.hMm };
  const cx = box.xMm + box.wMm / 2;
  const cy = box.yMm + box.hMm / 2;
  return {
    xMm: cx - box.hMm / 2,
    yMm: cy - box.wMm / 2,
    wMm: box.hMm,
    hMm: box.wMm,
  };
}

function imageBox(
  slotId: string,
  rect: Rect,
  photoId: PhotoId,
  gespeichert: Crop | undefined,
  ctx: CoverRenderContext,
): ImageBox {
  const photo = ctx.photos.get(photoId);
  if (!photo) {
    // Wie im Innenteil: Ein fehlendes Bild darf das Rendern nicht verhindern,
    // sonst hat der Benutzer keine Ansicht, in der er den Fehler sieht.
    return {
      kind: 'image',
      ...rect,
      slotId,
      photoId,
      crop: gespeichert ?? { ...FULL_CROP },
      effectiveDpi: 0,
      warnings: [{ code: 'photo-missing', photoId }],
    };
  }

  const crop =
    gespeichert?.mode === 'manual'
      ? gespeichert
      : coverCrop(aspectRatio(photo), rect.wMm / rect.hMm, gespeichert?.focal);

  const px = cropToPixels(crop, photo.width, photo.height);
  const dpi = effectiveDpi(px.width, rect.wMm);

  const warnings: RenderWarning[] = [];
  if (dpi < ctx.profile.resolution.minDpi) {
    warnings.push({ code: 'below-min-dpi', dpi, minDpi: ctx.profile.resolution.minDpi });
  } else if (dpi < ctx.profile.resolution.targetDpi) {
    warnings.push({
      code: 'below-target-dpi',
      dpi,
      targetDpi: ctx.profile.resolution.targetDpi,
    });
  }

  return { kind: 'image', ...rect, slotId, photoId, crop, effectiveDpi: dpi, warnings };
}

function textBox(
  slotId: string,
  rect: Rect,
  content: string,
  color: string,
  rotateDeg?: number,
): CoverTextBox {
  return {
    kind: 'text',
    ...rect,
    slotId,
    content,
    fontSizePt: fontSizeFor(rect.hMm),
    align: 'left',
    color,
    ...(rotateDeg !== undefined ? { rotateDeg } : {}),
  };
}

function buildGuides(geo: CoverGeometry): CoverGuide[] {
  const guides: CoverGuide[] = [
    { kind: 'bleed', xMm: 0, yMm: 0, wMm: geo.widthMm, hMm: geo.heightMm },
    { kind: 'wrap', ...geo.visible },
    { kind: 'hinge', ...geo.panels['hinge-back'], panel: 'hinge-back' },
    { kind: 'hinge', ...geo.panels['hinge-front'], panel: 'hinge-front' },
    { kind: 'spine', ...geo.panels.spine, panel: 'spine' },
  ];

  for (const panel of ['back', 'spine', 'front'] as const) {
    guides.push({ kind: 'safety', ...safeArea(geo, panel), panel });
  }

  // Falzlinien über die ganze Bogenhöhe: Gefalzt wird auch durch den Umschlag
  // hindurch, nicht nur im sichtbaren Bereich.
  for (const xMm of geo.foldsXMm) {
    guides.push({ kind: 'fold', xMm, yMm: 0, wMm: 0, hMm: geo.heightMm });
  }

  return guides;
}

/**
 * Erzeugt das Rendered Cover Model.
 *
 * Reihenfolge der Boxen ist Zeichenreihenfolge: erst die randabfallenden
 * Bilder, dann der Rücken, dann die deckenden Textbalken, zuletzt der Text.
 */
export function renderCover(design: CoverDesign, ctx: CoverRenderContext): RenderedCover {
  const { profile } = ctx;
  const d = withCoverDefaults(design);
  const geo = coverGeometry(profile, ctx.pageCount);

  const boxes: CoverBox[] = [];
  const warnings: CoverWarning[] = [];

  const front = geo.panels.front;
  const back = geo.panels.back;
  const spine = geo.panels.spine;

  // Bilder laufen bewusst über die Gelenkzone bis zur Blattkante. Endeten sie
  // an der sichtbaren Kante, zeigte jede Falztoleranz einen weißen Streifen.
  if (d.frontPhotoId) {
    const rect: Rect = {
      xMm: geo.panels['hinge-front'].xMm,
      yMm: 0,
      wMm: geo.widthMm - geo.panels['hinge-front'].xMm,
      hMm: geo.heightMm,
    };
    boxes.push(imageBox('front-photo', rect, d.frontPhotoId, d.frontCrop, ctx));
  } else {
    boxes.push({ kind: 'empty', ...front, slotId: 'front-photo' });
  }

  if (d.backPhotoId) {
    const rect: Rect = { xMm: 0, yMm: 0, wMm: spine.xMm, hMm: geo.heightMm };
    boxes.push(imageBox('back-photo', rect, d.backPhotoId, d.backCrop, ctx));
  }

  // Der Rücken ist immer einfarbig. Ein über den Rücken laufendes Foto wirkt
  // beliebig, und der Rückentitel bräuchte ohnehin einen deckenden Grund.
  // Die Toleranz nach beiden Seiten hin verhindert, dass eine Falzabweichung
  // Bildkante auf dem Rücken zeigt.
  boxes.push({
    kind: 'rect',
    xMm: spine.xMm - geo.spineToleranceMm,
    yMm: 0,
    wMm: spine.wMm + 2 * geo.spineToleranceMm,
    hMm: geo.heightMm,
    fill: d.accent ?? '#1a1a1a',
  });

  const titleH = profile.page.trimHeightMm * TITLE_HEIGHT_FRACTION;
  const gap = titleH * GAP_FRACTION;

  // ------------------------------------------------------------- Vorderseite

  if (d.title || d.subtitle) {
    const subH = d.subtitle ? titleH * SUBTITLE_FRACTION : 0;
    const unten = front.yMm + front.hMm - geo.safetyMm;
    const titelY = unten - (d.title ? titleH : 0) - (d.subtitle ? subH + (d.title ? gap : 0) : 0);
    const balkenY = titelY - geo.safetyMm;
    const aufBild = d.frontPhotoId !== undefined;

    if (aufBild) {
      boxes.push({
        kind: 'rect',
        xMm: front.xMm,
        yMm: balkenY,
        wMm: geo.widthMm - front.xMm,
        hMm: geo.heightMm - balkenY,
        fill: d.accent ?? '#1a1a1a',
      });
    }

    const farbe = (aufBild ? d.accentText : d.accent) ?? '#1a1a1a';
    const xMm = front.xMm + geo.safetyMm;
    const wMm = front.wMm - 2 * geo.safetyMm;

    if (d.title) {
      boxes.push(textBox('front-title', { xMm, yMm: titelY, wMm, hMm: titleH }, d.title, farbe));
    }
    if (d.subtitle) {
      const yMm = unten - subH;
      boxes.push(textBox('front-subtitle', { xMm, yMm, wMm, hMm: subH }, d.subtitle, farbe));
    }
  }

  // --------------------------------------------------------------- Rückseite

  if (d.backText) {
    const hMm = titleH * BACK_TEXT_FRACTION;
    const yMm = back.yMm + back.hMm - geo.safetyMm - hMm;
    const aufBild = d.backPhotoId !== undefined;

    if (aufBild) {
      const balkenY = yMm - geo.safetyMm;
      boxes.push({
        kind: 'rect',
        xMm: 0,
        yMm: balkenY,
        wMm: spine.xMm,
        hMm: geo.heightMm - balkenY,
        fill: d.accent ?? '#1a1a1a',
      });
    }

    boxes.push(
      textBox(
        'back-text',
        { xMm: back.xMm + geo.safetyMm, yMm, wMm: back.wMm - 2 * geo.safetyMm, hMm },
        d.backText,
        (aufBild ? d.accentText : d.accent) ?? '#1a1a1a',
      ),
    );
  }

  // ------------------------------------------------------------------ Rücken

  if (d.spineText) {
    const verfuegbar = spine.wMm - 2 * geo.spineToleranceMm;
    if (verfuegbar < MIN_SPINE_TEXT_HEIGHT_MM) {
      warnings.push({
        code: 'spine-too-narrow-for-text',
        spineMm: spine.wMm,
        requiredMm: MIN_SPINE_TEXT_HEIGHT_MM + 2 * geo.spineToleranceMm,
      });
    } else {
      const hMm = Math.min(verfuegbar, MAX_SPINE_TEXT_HEIGHT_MM);
      const wMm = spine.hMm - 2 * geo.safetyMm;
      // Ungedrehte Lage: waagerecht, mittig auf dem Rücken. Die Drehung um den
      // Mittelpunkt macht daraus die senkrechte Zeile.
      //
      // Von oben nach unten lesend (+90°): deutsche Buchbindetradition.
      // Englischsprachige Bücher setzen den Rückentitel von unten nach oben.
      boxes.push(
        textBox(
          'spine-text',
          {
            xMm: spine.xMm + spine.wMm / 2 - wMm / 2,
            yMm: geo.heightMm / 2 - hMm / 2,
            wMm,
            hMm,
          },
          d.spineText,
          d.accentText ?? '#ffffff',
          90,
        ),
      );
    }
  }

  // ------------------------------------------------------------------ Befunde

  for (const box of boxes) {
    if (box.kind === 'image') {
      for (const w of box.warnings) {
        if (w.code === 'below-min-dpi') {
          warnings.push({ code: w.code, slotId: box.slotId, dpi: w.dpi, minDpi: w.minDpi });
        } else if (w.code === 'below-target-dpi') {
          warnings.push({ code: w.code, slotId: box.slotId, dpi: w.dpi, targetDpi: w.targetDpi });
        } else if (w.code === 'photo-missing') {
          warnings.push({ code: w.code, slotId: box.slotId, photoId: w.photoId });
        }
      }
      continue;
    }

    // Nur Text wird geprüft. Bilder und Balken laufen absichtlich über Falz und
    // Sicherheitsbereich hinaus – das ist bei ihnen die Vorgabe, kein Befund.
    if (box.kind !== 'text') continue;

    const bounds = boundsOf(box);
    if (overlapsHinge(geo, bounds)) {
      warnings.push({ code: 'in-hinge', slotId: box.slotId });
    }

    const panel: CoverPanelKind =
      box.slotId === 'spine-text' ? 'spine' : box.slotId === 'back-text' ? 'back' : 'front';
    if (!containsRect(safeArea(geo, panel), bounds)) {
      warnings.push({ code: 'outside-safety', slotId: box.slotId, panel });
    }
  }

  // Zuletzt, damit der Hinweis in der Liste unter den konkreten Befunden steht.
  if (profile.provenance.verifiedAt === null) {
    warnings.push({ code: 'profile-unverified', source: profile.provenance.source });
  }

  return {
    coverId: 'cover',
    widthMm: geo.widthMm,
    heightMm: geo.heightMm,
    bleedMm: geo.bleedMm,
    geometry: geo,
    background: d.background ?? '#ffffff',
    boxes,
    guides: buildGuides(geo),
    warnings,
  };
}
