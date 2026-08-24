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
import { farbmatrix, wirktAdjust } from '../model/adjust.js';
import { FULL_CROP, coverCrop, cropToPixels } from '../model/crop.js';
import type { Crop } from '../model/crop.js';
import type { PhotoOverride } from '../model/date.js';
import { effectivePhoto } from '../model/effective-photo.js';
import type { Photo, PhotoId } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import type { ImageBox, Rect, RenderWarning } from '../render/rendered-spread.js';
import type { FontFamilyId } from '../render/typography.js';
import {
  type TextStyleName,
  textBoxHeightMm,
  textFontSizePt,
  textStyle,
} from '../render/typography.js';
import type { CoverDesign, CoverTextName, CoverTextStyle } from './cover.js';
import { withCoverDefaults } from './cover.js';
import type { CoverGeometry, CoverPanelKind } from './geometry.js';
import {
  containsRect,
  coverGeometry,
  coverImageArea,
  overlapsHinge,
  safeArea,
} from './geometry.js';
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
  /**
   * Benutzerkorrekturen. Werden beim Eintritt über `effectivePhotos` aufgelöst –
   * ohne sie rechnet die Engine mit dem rohen Importergebnis, und eine
   * korrigierte Ausrichtung bliebe wirkungslos.
   */
  overrides?: Record<PhotoId, PhotoOverride>;
}

/** Schriftgrad aus der Zeilenhöhe – dieselbe Näherung wie im Innenteil. */
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
  // Punktuell aufgelöst und nicht über `effectivePhotos`: Der Umschlag liest
  // genau ein Foto, eine Kopie der ganzen Map wäre Arbeit für nichts.
  const roh = ctx.photos.get(photoId);
  const photo = roh && effectivePhoto(roh, ctx.overrides?.[photoId]);
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

  // Dieselbe Bildanpassung wie im Innenteil: Sie hängt am Foto, und dasselbe
  // Bild sepia im Buch und farbig auf dem Umschlag wäre keine Entscheidung,
  // sondern eine vergessene Stelle.
  const adjust = ctx.overrides?.[photoId]?.adjust;
  const colorMatrix = wirktAdjust(adjust) ? farbmatrix(adjust) : undefined;

  return {
    kind: 'image',
    ...rect,
    slotId,
    photoId,
    crop,
    effectiveDpi: dpi,
    ...(colorMatrix ? { colorMatrix } : {}),
    warnings,
  };
}

function textBox(
  slotId: string,
  rect: Rect,
  content: string,
  color: string,
  opt: {
    rotateDeg?: number;
    /** Textstil aus `render/typography.ts`. */
    styleName?: TextStyleName;
    family?: FontFamilyId;
    /** Ohne Angabe `left` — wie vor `CoverTextStyle.align`. */
    align?: 'left' | 'center' | 'right';
  } = {},
): CoverTextBox {
  // Größe und Schnitt kommen aus demselben Stilsatz wie im Innenteil – zwei
  // eigene Regeln für dieselbe Frage laufen auseinander. Die Farbe bleibt ein
  // Argument: Auf dem Titelbalken steht der Text hell, nicht in Stilfarbe.
  const style = textStyle(opt.styleName ?? 'body');
  return {
    kind: 'text',
    ...rect,
    slotId,
    content,
    // Aus der Kastenhöhe und nicht aus `CoverTextStyle.sizePt`: Eine gesetzte
    // Punktgröße ist oben in die Kastenhöhe geflossen (`hoeheVon`), und die
    // Grundlinie hängt in beiden Adaptern am Kasten. Zwei Wege zur Schriftgröße
    // wären zwei Gelegenheiten, dass Zeile und Kasten auseinanderstehen.
    fontSizePt: textFontSizePt(rect.hMm, style),
    weight: style.weight,
    align: opt.align ?? 'left',
    color,
    ...(opt.family ? { family: opt.family } : {}),
    ...(opt.rotateDeg !== undefined ? { rotateDeg: opt.rotateDeg } : {}),
  };
}

/**
 * Die Kastenhöhe eines Umschlagtexts.
 *
 * Ohne gesetzte Punktgröße die Vorgabe, die am Anteil der Seitenhöhe hängt und
 * damit jedes Format mitnimmt. Mit gesetzter Größe deren Kasten — der Kasten ist
 * der Träger der Grundlinie, also folgt er der Schrift und nicht umgekehrt.
 */
function hoeheVon(stil: CoverTextStyle, vorgabeMm: number, styleName: TextStyleName): number {
  if (stil.sizePt === undefined) return vorgabeMm;
  return textBoxHeightMm(stil.sizePt, textStyle(styleName));
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

  /** Der Stil eines der vier Texte — leer heißt „wie das Buch es vorgibt". */
  const stil = (name: CoverTextName): CoverTextStyle => d.texts?.[name] ?? {};

  // Die beiden Deckelfarben liegen als Fläche über dem Bogengrund und nicht
  // neben ihm: Dazwischen stehen Rücken, Gelenke und die Umschlagkanten, die
  // keinem der beiden Deckel gehören. Als drittes und viertes Feld in
  // `RenderedCover` hätte jeder Adapter drei Grundfarben zu zeichnen gehabt —
  // so sind es zwei gewöhnliche Rechtecke, für die die Parity längst gilt.
  //
  // Vor den Bildern, denn ein randabfallendes Titelbild deckt sie ohnehin zu;
  // sichtbar sind sie genau dort, wo keines liegt.
  for (const [farbe, panel] of [
    [d.backBackground, 'back'],
    [d.frontBackground, 'front'],
  ] as const) {
    if (farbe) boxes.push({ kind: 'rect', ...coverImageArea(geo, panel), fill: farbe });
  }

  // Bilder laufen bewusst über die Gelenkzone bis zur Blattkante. Endeten sie
  // an der sichtbaren Kante, zeigte jede Falztoleranz einen weißen Streifen.
  if (d.frontPhotoId) {
    boxes.push(
      imageBox('front-photo', coverImageArea(geo, 'front'), d.frontPhotoId, d.frontCrop, ctx),
    );
  } else {
    boxes.push({ kind: 'empty', ...front, slotId: 'front-photo' });
  }

  if (d.backPhotoId) {
    boxes.push(imageBox('back-photo', coverImageArea(geo, 'back'), d.backPhotoId, d.backCrop, ctx));
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
    // Der Grund des Rückentextes ist der Rücken selbst — eine eigene Balkenfarbe
    // gäbe es hier nichts zu unterlegen.
    fill: stil('spine').band ?? d.accent ?? '#1a1a1a',
  });

  const titleH = profile.page.trimHeightMm * TITLE_HEIGHT_FRACTION;

  // ------------------------------------------------------------- Vorderseite

  if (d.title || d.subtitle) {
    const titelStil = stil('title');
    const subStil = stil('subtitle');
    const titelH = d.title ? hoeheVon(titelStil, titleH, 'groupTitle') : 0;
    const subH = d.subtitle ? hoeheVon(subStil, titleH * SUBTITLE_FRACTION, 'body') : 0;
    // Der Zwischenraum wächst mit dem Titel und nicht mit der Vorgabe: Ein von
    // Hand auf 60 pt gesetzter Titel hätte sonst denselben knappen Abstand zum
    // Untertitel wie ein 30-pt-Titel, und das liest sich als Klumpen.
    const gap = d.title && d.subtitle ? titelH * GAP_FRACTION : 0;
    const unten = front.yMm + front.hMm - geo.safetyMm;
    const titelY = unten - titelH - subH - gap;
    const balkenY = titelY - geo.safetyMm;
    const aufBild = d.frontPhotoId !== undefined;

    /**
     * Die beiden Balken stoßen in der Mitte des Zwischenraums aneinander.
     *
     * Ein Balken für beide Texte ginge nicht mehr, seit Titel und Untertitel je
     * eine eigene Grundfarbe haben dürfen. Zwei Balken **mit Fuge** dazwischen
     * sähen bei gleicher Farbe aus wie ein Fehler — so ergeben zwei gleiche
     * Farben wieder genau die durchgehende Fläche von vorher.
     */
    const trennY = titelY + titelH + gap / 2;
    const balken = (von: number, bis: number, fill: string) => {
      boxes.push({
        kind: 'rect',
        xMm: front.xMm,
        yMm: von,
        wMm: geo.widthMm - front.xMm,
        hMm: bis - von,
        fill,
      });
    };

    // Ohne Bild darunter braucht der Text keinen deckenden Grund — es sei denn,
    // jemand hat ausdrücklich eine Farbe gewählt. Wer eine Farbe wählt, will sie
    // sehen; das ist derselbe Unterschied wie zwischen „automatisch" und „0" bei
    // der Bildneigung.
    const titelBalken = d.title && (aufBild || titelStil.band !== undefined);
    const subBalken = d.subtitle && (aufBild || subStil.band !== undefined);

    if (titelBalken) {
      balken(balkenY, subBalken ? trennY : geo.heightMm, titelStil.band ?? d.accent ?? '#1a1a1a');
    }
    if (subBalken) {
      balken(titelBalken ? trennY : balkenY, geo.heightMm, subStil.band ?? d.accent ?? '#1a1a1a');
    }

    const farbeVon = (s: CoverTextStyle, mitBalken: boolean): string =>
      s.color ?? (mitBalken ? d.accentText : d.accent) ?? '#1a1a1a';

    // Nicht `front.xMm + safetyMm`: Zur Rückenseite hin ist der Falzbereich
    // breiter als der Sicherheitsabstand, und die Prüfung weiter unten misst
    // gegen genau diese Fläche. Zwei Rechnungen für dieselbe Kante wären eine
    // zu viel.
    const { xMm, wMm } = safeArea(geo, 'front');

    if (d.title) {
      boxes.push(
        textBox(
          'front-title',
          { xMm, yMm: titelY, wMm, hMm: titelH },
          d.title,
          farbeVon(titelStil, !!titelBalken),
          {
            styleName: 'groupTitle',
            ...(titelStil.family ? { family: titelStil.family } : {}),
            ...(titelStil.align ? { align: titelStil.align } : {}),
          },
        ),
      );
    }
    if (d.subtitle) {
      const yMm = unten - subH;
      boxes.push(
        textBox(
          'front-subtitle',
          { xMm, yMm, wMm, hMm: subH },
          d.subtitle,
          farbeVon(subStil, !!subBalken),
          {
            ...(subStil.family ? { family: subStil.family } : {}),
            ...(subStil.align ? { align: subStil.align } : {}),
          },
        ),
      );
    }
  }

  // --------------------------------------------------------------- Rückseite

  if (d.backText) {
    const backStil = stil('backText');
    const hMm = hoeheVon(backStil, titleH * BACK_TEXT_FRACTION, 'body');
    const yMm = back.yMm + back.hMm - geo.safetyMm - hMm;
    const aufBild = d.backPhotoId !== undefined;
    const mitBalken = aufBild || backStil.band !== undefined;

    if (mitBalken) {
      const balkenY = yMm - geo.safetyMm;
      boxes.push({
        kind: 'rect',
        xMm: 0,
        yMm: balkenY,
        wMm: spine.xMm,
        hMm: geo.heightMm - balkenY,
        fill: backStil.band ?? d.accent ?? '#1a1a1a',
      });
    }

    const sicher = safeArea(geo, 'back');
    boxes.push(
      textBox(
        'back-text',
        { xMm: sicher.xMm, yMm, wMm: sicher.wMm, hMm },
        d.backText,
        backStil.color ?? (mitBalken ? d.accentText : d.accent) ?? '#1a1a1a',
        {
          ...(backStil.family ? { family: backStil.family } : {}),
          ...(backStil.align ? { align: backStil.align } : {}),
        },
      ),
    );
  }

  // ------------------------------------------------------------------ Rücken

  if (d.spineText) {
    const spineStil = stil('spine');
    const verfuegbar = spine.wMm - 2 * geo.spineToleranceMm;
    if (verfuegbar < MIN_SPINE_TEXT_HEIGHT_MM) {
      warnings.push({
        code: 'spine-too-narrow-for-text',
        spineMm: spine.wMm,
        requiredMm: MIN_SPINE_TEXT_HEIGHT_MM + 2 * geo.spineToleranceMm,
      });
    } else {
      // Der Rücken ist die eine Stelle, an der die Breite eine harte Schranke
      // ist: Was breiter gesetzt wird als der Rücken, läuft auf die Deckel. Eine
      // gesetzte Größe wird deshalb geklemmt — aber gemeldet, denn ein still auf
      // 12 mm zurückgestellter 40-pt-Wunsch sähe aus wie ein Fehler im Regler.
      const gewuenscht = hoeheVon(spineStil, MAX_SPINE_TEXT_HEIGHT_MM, 'body');
      const hMm = Math.min(verfuegbar, gewuenscht);
      // Nur ein **ausdrücklicher** Wunsch wird gemeldet: `MAX_SPINE_TEXT_HEIGHT_MM`
      // ist ein Deckel und keine Anforderung — dass ein schmaler Rücken ihn nicht
      // ausschöpft, ist der Normalfall und kein Befund.
      if (spineStil.sizePt !== undefined && gewuenscht > verfuegbar) {
        warnings.push({ code: 'spine-text-clipped', requestedMm: gewuenscht, availableMm: hMm });
      }
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
          spineStil.color ?? d.accentText ?? '#ffffff',
          {
            rotateDeg: 90,
            ...(spineStil.family ? { family: spineStil.family } : {}),
            ...(spineStil.align ? { align: spineStil.align } : {}),
          },
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
