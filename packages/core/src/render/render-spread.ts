/**
 * Berechnet aus Buchdaten das Rendered Spread Model.
 *
 * Diese Funktion ist die einzige Stelle, an der normierte Templatekoordinaten
 * in Millimeter übersetzt werden. Beide Renderer bekommen ausschließlich das
 * Ergebnis – keiner rechnet selbst.
 */
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop, cropToPixels } from '../model/crop.js';
import type { EffectiveDate } from '../model/date.js';
import type { NaiveDateTime, Photo, PhotoId } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import type { Template, TemplateSlot } from '../model/template.js';
import { crossesGutter } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';
import { templateMeta } from '../templates/index.js';
import {
  BACKGROUND_MIN_DPI,
  DEFAULT_BACKGROUND,
  accentOn,
  backgroundFit,
  textColorOn,
} from './background.js';
import type {
  Guide,
  ImageBox,
  Rect,
  RenderBox,
  RenderWarning,
  RenderedSpread,
} from './rendered-spread.js';
import { timelineBoxes, timelineFootTopMm } from './timeline.js';
import { randabfallend, tiltDeg } from './tilt.js';
import { textFontSizePt, textStyle } from './typography.js';

/**
 * Was der Zeitstrahl über die Doppelseite hinaus wissen muss.
 *
 * Fehlt er im Kontext, entsteht kein Zeitstrahl – der globale Schalter lebt
 * damit beim Aufrufer, nicht in der Engine.
 */
export interface TimelineContext {
  /** Effektives Datum eines Fotos. */
  dateOf: (photoId: PhotoId) => EffectiveDate | undefined;
  /** Aktive Fotogruppe eines Fotos, sofern es zu einer gehört. */
  groupOf?: (photoId: PhotoId) => { id: string; title: string } | undefined;
  /**
   * Jahr für Doppelseiten ohne belastbares Datum. Der Aufrufer kennt die
   * Reihenfolge im Buch und kann es aus den Nachbarseiten ableiten.
   */
  fallbackYear?: number;
  accentColor?: string;
}

/**
 * Wie stark die Bilder aus der Waagerechten kippen dürfen.
 *
 * Fehlt der Kontext, steht alles gerade – wie der Zeitstrahl lebt der globale
 * Schalter beim Aufrufer, nicht in der Engine. Eine von Hand gesetzte Neigung
 * an einem Slot gilt trotzdem: Sie ist eine Entscheidung über dieses eine
 * Bild, keine Voreinstellung des Buchs.
 */
export interface TiltContext {
  /** Stärkste Neigung in Grad. */
  maxDeg: number;
  /** Derselbe Seed wie beim Generieren – gleiches Buch, gleiche Winkel. */
  seed: number;
}

export interface RenderContext {
  profile: PrintProfile;
  template: Template;
  photos: ReadonlyMap<PhotoId, Photo>;
  /** Hintergrund der Doppelseite. Weiß, solange nichts anderes gesetzt ist. */
  background?: string;
  timeline?: TimelineContext;
  tilt?: TiltContext;
}

/**
 * Übersetzt eine normierte Templatekoordinate in Millimeter.
 *
 * Normiert bezieht sich auf den Endformatbereich; der Ursprung des RSM liegt
 * dagegen an der Beschnittkante. Der Beschnitt ist deshalb der Versatz.
 */
function toMm(
  slot: Pick<TemplateSlot, 'x' | 'y' | 'w' | 'h'>,
  profile: PrintProfile,
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const trimSpreadW = 2 * profile.page.trimWidthMm;
  const trimH = profile.page.trimHeightMm;
  const bleed = profile.page.bleedMm;
  return {
    xMm: bleed + slot.x * trimSpreadW,
    yMm: bleed + slot.y * trimH,
    wMm: slot.w * trimSpreadW,
    hMm: slot.h * trimH,
  };
}

/**
 * Neigung dieses Bildes: von Hand gesetzt, sonst aus Slot, Foto und Seed.
 */
function tiltOf(assignment: SlotAssignment, rect: Rect, photoId: PhotoId, ctx: RenderContext) {
  const flaeche = {
    widthMm: spreadWidthMm(ctx.profile),
    heightMm: spreadHeightMm(ctx.profile),
  };
  // Auch eine von Hand gesetzte Neigung gilt hier nicht: Am Papierrand ist sie
  // kein Gestaltungsmittel, sondern ein Druckfehler.
  if (randabfallend(rect, flaeche)) return 0;
  if (assignment.rotateDeg !== undefined) return assignment.rotateDeg;
  if (!ctx.tilt) return 0;
  // Slot *und* Foto im Schlüssel: Ein Bild soll seinen Winkel behalten, wenn
  // die Nachbarseite umgebaut wird, ihn aber wechseln, wenn es selbst
  // umzieht – sonst stünden zwei getauschte Bilder identisch schief.
  return tiltDeg(`${assignment.slotId}:${photoId}`, ctx.tilt.seed, ctx.tilt.maxDeg);
}

function buildGuides(profile: PrintProfile): Guide[] {
  const { trimWidthMm, trimHeightMm, bleedMm, safetyMm, gutterSafeMm } = profile.page;
  const spreadW = spreadWidthMm(profile);
  const spreadH = spreadHeightMm(profile);
  const gutterX = bleedMm + trimWidthMm;

  return [
    { kind: 'bleed', xMm: 0, yMm: 0, wMm: spreadW, hMm: spreadH },
    {
      kind: 'trim',
      xMm: bleedMm,
      yMm: bleedMm,
      wMm: 2 * trimWidthMm,
      hMm: trimHeightMm,
    },
    {
      kind: 'safety',
      xMm: bleedMm + safetyMm,
      yMm: bleedMm + safetyMm,
      wMm: 2 * trimWidthMm - 2 * safetyMm,
      hMm: trimHeightMm - 2 * safetyMm,
    },
    {
      kind: 'gutter-zone',
      xMm: gutterX - gutterSafeMm,
      yMm: bleedMm,
      wMm: 2 * gutterSafeMm,
      hMm: trimHeightMm,
    },
    { kind: 'gutter', xMm: gutterX, yMm: bleedMm, wMm: 0, hMm: trimHeightMm },
  ];
}

function buildImageBox(
  slot: TemplateSlot,
  assignment: SlotAssignment,
  photo: Photo,
  ctx: RenderContext,
): ImageBox {
  const { profile } = ctx;
  const rect = toMm(slot, profile);
  const slotAr = rect.wMm / rect.hMm;

  // Ein `auto-cover`-Ausschnitt wird für die aktuellen Slotmaße neu gerechnet;
  // ein manuell gesetzter bleibt unangetastet.
  const crop =
    assignment.crop.mode === 'manual'
      ? assignment.crop
      : coverCrop(aspectRatio(photo), slotAr, assignment.crop.focal);

  // Die effektive Auflösung hängt an den *sichtbaren* Pixeln, nicht an der
  // Bildgröße – nach einem starken Ausschnitt kann ein großes Foto darunter
  // liegen. Gerechnet wird über die tatsächlich extrahierten Pixel, damit die
  // Zahl mit dem übereinstimmt, was der PDF-Renderer später verarbeitet.
  const px = cropToPixels(crop, photo.width, photo.height);
  const dpi = effectiveDpi(px.width, rect.wMm);

  const warnings: RenderWarning[] = [];
  if (dpi < profile.resolution.minDpi) {
    warnings.push({ code: 'below-min-dpi', dpi, minDpi: profile.resolution.minDpi });
  } else if (dpi < profile.resolution.targetDpi) {
    warnings.push({ code: 'below-target-dpi', dpi, targetDpi: profile.resolution.targetDpi });
  }
  if (crossesGutter(slot)) warnings.push({ code: 'crosses-gutter' });

  const drehung = tiltOf(assignment, rect, photo.id, ctx);

  return {
    kind: 'image',
    ...rect,
    slotId: slot.id,
    photoId: photo.id,
    crop,
    effectiveDpi: dpi,
    ...(drehung !== 0 ? { rotateDeg: drehung } : {}),
    warnings,
  };
}

/**
 * Erzeugt das Rendered Spread Model einer Doppelseite.
 *
 * Deterministisch: gleiche Eingaben ergeben exakt dasselbe Ergebnis. Das ist
 * die Voraussetzung für Snapshot-Tests und dafür, dass eine kleine Korrektur
 * an anderer Stelle nicht das ganze Buch umwirft.
 */
export function renderSpread(spread: Spread, ctx: RenderContext): RenderedSpread {
  const { profile, template } = ctx;
  const boxes: RenderBox[] = [];

  const background = spread.background ?? ctx.background ?? DEFAULT_BACKGROUND;

  // Ein Hintergrundbild ist eine gewöhnliche Bildbox über die ganze
  // Beschnittfläche – kein neuer Kasten und kein Sonderweg in den Renderern.
  // Es kommt zuerst, damit alles andere darüber liegt.
  const backgroundPhoto = spread.backgroundPhotoId
    ? ctx.photos.get(spread.backgroundPhotoId)
    : undefined;
  if (backgroundPhoto) {
    const flaeche = {
      xMm: 0,
      yMm: 0,
      wMm: spreadWidthMm(profile),
      hMm: spreadHeightMm(profile),
    };
    const fit = backgroundFit(backgroundPhoto, profile);
    boxes.push({
      kind: 'image',
      ...flaeche,
      slotId: 'background',
      photoId: backgroundPhoto.id,
      crop: coverCrop(aspectRatio(backgroundPhoto), flaeche.wMm / flaeche.hMm),
      effectiveDpi: fit.dpi,
      warnings: fit.taugt
        ? []
        : [{ code: 'background-low-dpi', dpi: fit.dpi, recommendedDpi: BACKGROUND_MIN_DPI }],
    });
  }

  const bySlotId = new Map(spread.slots.map((s) => [s.slotId, s]));

  for (const slot of template.slots) {
    const assignment = bySlotId.get(slot.id);
    const rect = toMm(slot, profile);

    if (!assignment?.photoId) {
      boxes.push({ kind: 'empty', ...rect, slotId: slot.id });
      continue;
    }

    const photo = ctx.photos.get(assignment.photoId);
    if (!photo) {
      // Die Buchstruktur bleibt intakt, der Slot wird markiert. Ein fehlendes
      // Bild darf nicht das Rendern der ganzen Doppelseite verhindern.
      boxes.push({
        kind: 'image',
        ...rect,
        slotId: slot.id,
        photoId: assignment.photoId,
        crop: assignment.crop,
        effectiveDpi: 0,
        warnings: [{ code: 'photo-missing', photoId: assignment.photoId }],
      });
      continue;
    }

    boxes.push(buildImageBox(slot, assignment, photo, ctx));
  }

  const byTextSlotId = new Map((spread.texts ?? []).map((t) => [t.slotId, t]));
  for (const textSlot of template.textSlots ?? []) {
    const text = byTextSlotId.get(textSlot.id);
    if (!text?.content) continue;
    const rect = toMm(textSlot, profile);
    const style = textStyle(textSlot.style);
    const zeilen = text.content.split('\n').filter((z) => z.trim().length > 0);

    // Mehrzeilige Texte werden hier in einzelne Boxen zerlegt, statt sie einem
    // Renderer zu überlassen. Sonst müsste jeder Adapter den Zeilenabstand
    // selbst bestimmen – CSS `line-height` gegen pdfkit `lineGap` –, und genau
    // das wäre eine Layoutentscheidung im Renderer, die der Parity-Test
    // aufdecken soll. Der Zeilenabstand steckt deshalb in der Geometrie.
    // Die Zeilenhöhe folgt der Absicht des Templates, nicht der Zahl der
    // gesetzten Zeilen: Drei Ereignisse sollen so groß stehen wie fünf.
    const zeilenZahl = Math.max(textSlot.lines ?? zeilen.length, zeilen.length, 1);
    const zeilenHoeheMm = zeilenZahl > 1 ? rect.hMm / zeilenZahl : rect.hMm;
    // Größe, Schnitt und Farbe kommen aus dem Textstil (render/typography.ts);
    // die Renderer bekommen fertige Werte, keine Regeln.
    const fontSizePt = textFontSizePt(zeilenHoeheMm, style);

    zeilen.forEach((zeile, i) => {
      boxes.push({
        kind: 'text',
        xMm: rect.xMm,
        yMm: rect.yMm + i * zeilenHoeheMm,
        wMm: rect.wMm,
        hMm: zeilenHoeheMm,
        slotId: zeilen.length > 1 ? `${textSlot.id}-${i}` : textSlot.id,
        content: zeile,
        fontSizePt,
        weight: style.weight,
        align: textSlot.align ?? 'left',
        color: textColorOn(background, style.color),
      });
    });
  }

  // Der Zeitstrahl kommt zuletzt: Er liegt im Fußraum, den kein Slot belegt,
  // und soll auch in der Zeichenreihenfolge nichts überdecken.
  if (ctx.timeline && spread.timeline !== false) {
    boxes.push(...buildTimeline(spread, ctx, ctx.timeline, background));
  }

  return {
    spreadId: spread.id,
    widthMm: spreadWidthMm(profile),
    heightMm: spreadHeightMm(profile),
    bleedMm: profile.page.bleedMm,
    gutterXMm: profile.page.bleedMm + profile.page.trimWidthMm,
    background,
    boxes,
    guides: buildGuides(profile),
  };
}

/**
 * Sammelt aus der Doppelseite, was der Zeitstrahl braucht.
 *
 * Die Auswahl der Daten steckt hier und nicht im Zeitstrahl selbst: Sie ist
 * eine Aussage über den Bestand, keine Geometrie.
 */
function buildTimeline(
  spread: Spread,
  ctx: RenderContext,
  tl: TimelineContext,
  background: string,
): RenderBox[] {
  const { profile, template } = ctx;

  // Reicht ein Slot in den Fußraum, entfällt der Strahl. Die Regel ist aus der
  // Geometrie abgeleitet und gilt damit auch für künftige Vorlagen; heute
  // betrifft sie allein den randabfallenden Gruppenauftakt.
  const footTop = timelineFootTopMm(profile);
  const belegt = template.slots.some((slot) => {
    const rect = toMm(slot, profile);
    return rect.yMm + rect.hMm > footTop;
  });
  if (belegt) return [];

  const photoIds = spread.slots
    .map((s) => s.photoId)
    .filter((id): id is PhotoId => id !== null && ctx.photos.has(id));

  // Nur belastbare Daten: Ein Dateidatum ist oft das Kopierdatum und würde den
  // Spannbalken über Jahre aufziehen.
  const dates = photoIds
    .map((id) => tl.dateOf(id))
    .filter((e): e is EffectiveDate => e !== undefined)
    .filter((e) => e.value !== null && (e.confidence === 'high' || e.confidence === 'medium'))
    .map((e) => e.value as NaiveDateTime);

  // Umfasst die Doppelseite mehrere Gruppen, gewinnt die mit den meisten Fotos.
  // Bei Gleichstand die zuerst auftretende – sonst wäre das Ergebnis von der
  // Reihenfolge einer Map abhängig und damit nicht mehr deterministisch.
  let label: string | undefined;
  if (tl.groupOf) {
    const counts = new Map<string, { title: string; n: number }>();
    for (const id of photoIds) {
      const group = tl.groupOf(id);
      if (!group) continue;
      const bestand = counts.get(group.id);
      if (bestand) bestand.n++;
      else counts.set(group.id, { title: group.title, n: 1 });
    }
    let best: { title: string; n: number } | undefined;
    for (const eintrag of counts.values()) {
      if (!best || eintrag.n > best.n) best = eintrag;
    }
    label = best?.title;
  }

  // Trägt die Vorlage den Gruppentitel schon als Überschrift, wäre das Label
  // eine Dopplung auf derselben Seite.
  const hatUeberschrift = (spread.texts ?? []).some(
    (t) => t.role === 'eventTitle' && t.content.length > 0,
  );

  return timelineBoxes(
    {
      dates,
      background,
      markerless: templateMeta(template.id).chapterOnly,
      ...(label && !hatUeberschrift ? { label } : {}),
      ...(tl.fallbackYear !== undefined ? { fallbackYear: tl.fallbackYear } : {}),
      // Der Akzent kommt aus dem Hintergrund dieser Doppelseite, nicht aus dem
      // Projekt: Nur hier ist bekannt, welche Jahresfarbe die Seite trägt, und
      // der Marker soll zu ihr gehören statt auf ihr zu liegen. Ein Aufrufer
      // kann ihn weiterhin übersteuern.
      accentColor: tl.accentColor ?? accentOn(background),
    },
    profile,
  );
}
