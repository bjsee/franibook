/**
 * Was sich auf einer Doppelseite als Text greifen lässt.
 *
 * Es gibt davon zwei Sorten, und für die Hand sind sie dieselbe Sache: einen
 * **Textblock**, den jemand selbst gesetzt hat, und einen **Vorlagentext** an
 * einem Textplatz der Vorlage – Jahreszahl, Gruppentitel, Ereigniszeilen. Beide
 * werden gezogen, an Griffen aufgezogen und gedreht, mit derselben Geste und in
 * derselben Reihenfolge.
 *
 * Deshalb dieser gemeinsame Begriff, statt die Bühne und die Griffe zwei fast
 * gleiche Listen führen zu lassen. Wo die Sorten sich unterscheiden, steht es in
 * `art` und an genau drei Stellen im Code: die Schriftgröße (der Block hat eine,
 * der Vorlagentext bekommt sie aus der Kastenhöhe), der Endpunkt beim Speichern,
 * und dass ein Vorlagentext keine Schrift und keine Farbe wählt.
 */
import type { RenderedSpread, TemplateTextSlot, TextElement } from '@franibook/core';
import { templateById, withTextBlock, withTextElement } from '@franibook/core';
import type { TextBlockData } from '../TextBlocks.js';

export interface Bewegtext {
  /**
   * Kennung, unter der der Text im RSM steht.
   *
   * Beim Block seine eigene, beim Vorlagentext die seines Textplatzes (`t-year`).
   * Genau darum ist es dieselbe Kennung, mit der die Bühne eine angeklickte Box
   * zuordnet und mit der der Endpunkt ihn anspricht.
   */
  id: string;
  art: 'block' | 'platz';
  content: string;
  rect: { x: number; y: number; w: number; h: number };
  rotateDeg?: number;
  /** Nur am Block. Am Vorlagentext folgt die Größe der Kastenhöhe. */
  fontSizePt?: number;
  /** Nur am Vorlagentext: der Platz, an dem er ohne Handarbeit hängt. */
  textSlot?: TemplateTextSlot;
  /** Die Rohdaten, für die Vorschau beim Ziehen – je Sorte die eine oder die andere. */
  element?: TextElement;
  block?: TextBlockData;
}

/**
 * Die beweglichen Texte einer Doppelseite, in Zeichenreihenfolge.
 *
 * Vorlagentexte zuerst, Blöcke darüber – dieselbe Ordnung wie im RSM
 * (`renderSpread` setzt die Blöcke nach den Vorlagentexten). Sonst läge der
 * Auswahlrahmen anders als das Gezeichnete.
 *
 * Ein Vorlagentext ohne eigenes Rechteck bekommt das seines Platzes: Angefasst
 * wird er dort, wo er steht, und ob das aus der Vorlage kommt oder aus einer
 * früheren Handbewegung, ist für den Griff dasselbe.
 */
export function bewegtexte(spread: {
  blocks?: readonly TextBlockData[];
  texts?: readonly TextElement[];
  templateId?: string | null;
}): Bewegtext[] {
  const template = spread.templateId ? templateById(spread.templateId) : undefined;
  const platzVon = new Map((template?.textSlots ?? []).map((t) => [t.id, t]));

  const plaetze: Bewegtext[] = [];
  for (const text of spread.texts ?? []) {
    const textSlot = platzVon.get(text.slotId);
    // Ohne Platz in der Vorlage steht der Text auch im RSM nicht – es gibt
    // nichts zu greifen. Das passiert nach einem Vorlagenwechsel, bis der
    // Server den Text nachzieht.
    if (!textSlot) continue;
    plaetze.push({
      id: textSlot.id,
      art: 'platz',
      content: text.content,
      rect: text.rect ?? { x: textSlot.x, y: textSlot.y, w: textSlot.w, h: textSlot.h },
      ...(text.rotateDeg !== undefined ? { rotateDeg: text.rotateDeg } : {}),
      textSlot,
      element: text,
    });
  }

  const bloecke: Bewegtext[] = (spread.blocks ?? []).map((block) => ({
    id: block.id,
    art: 'block',
    content: block.content,
    rect: block.rect,
    ...(block.rotateDeg !== undefined ? { rotateDeg: block.rotateDeg } : {}),
    fontSizePt: block.fontSizePt,
    block,
  }));

  return [...plaetze, ...bloecke];
}

/**
 * Wie ein Text in der Oberfläche genannt wird.
 *
 * Der Wortlaut zuerst, denn den hat der Benutzer geschrieben. Ist der Platz noch
 * leer, sagt die Rolle, was dort hingehört – „Textplatz" wäre die Auskunft, die
 * niemand braucht.
 */
export function textName(text: Bewegtext): string {
  const erste = text.content.split('\n')[0]?.trim() ?? '';
  if (erste.length > 0) return erste;
  if (text.art === 'block') return 'Textblock';
  switch (text.textSlot?.role) {
    case 'year':
      return 'Jahreszahl';
    case 'eventTitle':
      return 'Überschrift';
    case 'freeText':
      return 'Ereignisse';
    default:
      return 'Text';
  }
}

/**
 * Das RSM mit dem offenen Stand dieses Textes.
 *
 * Gebaut wird mit den Funktionen des Renderers (`withTextBlock`,
 * `withTextElement`), damit während des Ziehens dasselbe zu sehen ist wie danach.
 * Die Fallunterscheidung steht hier einmal und nicht in jedem Aufrufer.
 */
export function mitOffenemStand(
  spread: RenderedSpread,
  text: Bewegtext,
  offen: {
    rect: { x: number; y: number; w: number; h: number };
    fontSizePt?: number;
    rotateDeg?: number;
  },
): RenderedSpread {
  if (text.art === 'block') {
    if (!text.block) return spread;
    return withTextBlock(spread, {
      ...text.block,
      rect: offen.rect,
      ...(offen.fontSizePt !== undefined ? { fontSizePt: offen.fontSizePt } : {}),
      ...(offen.rotateDeg !== undefined ? { rotateDeg: offen.rotateDeg } : {}),
    });
  }

  if (!text.element || !text.textSlot) return spread;
  return withTextElement(
    spread,
    {
      ...text.element,
      rect: offen.rect,
      ...(offen.rotateDeg !== undefined ? { rotateDeg: offen.rotateDeg } : {}),
    },
    text.textSlot,
  );
}
