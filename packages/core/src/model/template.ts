/**
 * Templates.
 *
 * Templates sind Daten, kein Code. Koordinaten sind normiert auf den
 * **Endformatbereich** der Doppelseite: (0,0) ist die obere linke Ecke der
 * Beschnittkante, (1,1) die untere rechte. Ein randabfallender Slot hat
 * deshalb Koordinaten außerhalb von 0..1 – das ist gewollt und nicht
 * versehentlich.
 *
 * Durch die Normierung funktioniert dasselbe Template für 21×21 cm und
 * 30×30 cm.
 */

export type TemplateId = string;

export interface TemplateSlot {
  id: string;
  /** Alle vier Werte normiert auf den Endformatbereich der Doppelseite. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Wie prominent der Slot ist, 1 = klein bis 3 = Hauptbild. Die Engine
   * ordnet hoch gewichtete Fotos bevorzugt prominenten Slots zu.
   */
  prominence: 1 | 2 | 3;
  /**
   * Für welche Bildausrichtung der Slot gedacht ist.
   *
   * Nicht bindend, aber die Zuordnung bestraft Abweichungen: Ein breiter Slot
   * mit einem Hochformat darin nutzt nur einen Bruchteil der Bildpixel und
   * fällt bei diesem Bestand schnell unter die Mindestauflösung.
   */
  prefers?: 'landscape' | 'portrait' | 'any';
}

export interface TemplateTextSlot {
  id: string;
  role: 'year' | 'eventTitle' | 'caption' | 'place' | 'freeText';
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  optional: boolean;
}

export interface Template {
  id: TemplateId;
  name: string;
  /** 1 = einzelne Seite, 2 = Doppelseite. Für den MVP immer 2. */
  pageSpan: 1 | 2;
  slots: TemplateSlot[];
  textSlots?: TemplateTextSlot[];
  tags?: string[];
}

/** Seitenverhältnis eines Slots in tatsächlichen Maßen. */
export function slotAspect(
  slot: TemplateSlot,
  spreadWidthMm: number,
  pageHeightMm: number,
): number {
  return (slot.w * spreadWidthMm) / (slot.h * pageHeightMm);
}

/**
 * Ob der Slot die Falzachse schneidet. Wird aus der Geometrie abgeleitet statt
 * im Template gepflegt – so kann es nicht auseinanderlaufen.
 */
export function crossesGutter(slot: TemplateSlot): boolean {
  return slot.x < 0.5 && slot.x + slot.w > 0.5;
}

/** Auf welcher Seite der Slot liegt. `both` heißt: er überspannt den Falz. */
export function slotPage(slot: TemplateSlot): 'left' | 'right' | 'both' {
  if (crossesGutter(slot)) return 'both';
  return slot.x + slot.w / 2 < 0.5 ? 'left' : 'right';
}

/** Spiegelt ein Template an der Falzachse. Verdoppelt die Bibliothek gratis. */
export function mirrorTemplate(template: Template): Template {
  return {
    ...template,
    id: `${template.id}.mirrored`,
    name: `${template.name} (gespiegelt)`,
    slots: template.slots.map((s) => ({ ...s, x: 1 - s.x - s.w })),
    ...(template.textSlots
      ? { textSlots: template.textSlots.map((t) => ({ ...t, x: 1 - t.x - t.w })) }
      : {}),
  };
}
