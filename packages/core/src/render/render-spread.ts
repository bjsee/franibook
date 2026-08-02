/**
 * Berechnet aus Buchdaten das Rendered Spread Model.
 *
 * Diese Funktion ist die einzige Stelle, an der normierte Templatekoordinaten
 * in Millimeter übersetzt werden. Beide Renderer bekommen ausschließlich das
 * Ergebnis – keiner rechnet selbst.
 */
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop, cropToPixels } from '../model/crop.js';
import type { Photo, PhotoId } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import type { Template, TemplateSlot } from '../model/template.js';
import { crossesGutter } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';
import type {
  Guide,
  ImageBox,
  RenderBox,
  RenderWarning,
  RenderedSpread,
} from './rendered-spread.js';

export interface RenderContext {
  profile: PrintProfile;
  template: Template;
  photos: ReadonlyMap<PhotoId, Photo>;
  /** Hintergrund der Doppelseite. Weiß, solange nichts anderes gesetzt ist. */
  background?: string;
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

  return {
    kind: 'image',
    ...rect,
    slotId: slot.id,
    photoId: photo.id,
    crop,
    effectiveDpi: dpi,
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
    boxes.push({
      kind: 'text',
      ...rect,
      slotId: textSlot.id,
      content: text.content,
      // Vorläufig aus der Slothöhe abgeleitet; echte Textstile mit Schriftwahl
      // und Sicherheitsbereichsprüfung folgen in Phase 9.
      fontSizePt: (rect.hMm / 25.4) * 72 * 0.7,
      align: textSlot.align ?? 'left',
      color: '#000000',
    });
  }

  return {
    spreadId: spread.id,
    widthMm: spreadWidthMm(profile),
    heightMm: spreadHeightMm(profile),
    bleedMm: profile.page.bleedMm,
    gutterXMm: profile.page.bleedMm + profile.page.trimWidthMm,
    background: ctx.background ?? '#ffffff',
    boxes,
    guides: buildGuides(profile),
  };
}
