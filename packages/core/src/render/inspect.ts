/**
 * Ableitungen aus dem Rendered Spread Model, für die Oberfläche.
 *
 * Der Ausschnitt-Editor und das Verschieben von Fotos brauchen zwei Dinge, die
 * im RSM nicht ausdrücklich stehen: eine Doppelseite mit *probeweise*
 * geändertem Ausschnitt und die Auflösung, die ein Foto in einem anderen Slot
 * erreichen würde.
 *
 * Beides gehört hierher und nicht in den Renderer. Die Vorschau bleibt damit
 * eine reine Projektion des Modells (Architekturregel 2): Wer im Editor zieht,
 * ändert das Modell, das die Vorschau anschließend abbildet – der Renderer
 * rechnet nach wie vor nichts selbst. Genau deshalb kann der Ausschnitt-Editor
 * gar nicht erst aus der Parity laufen.
 */
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop, cropToPixels } from '../model/crop.js';
import type { Crop } from '../model/crop.js';
import type { TextBlock } from '../model/spread.js';
import type { ImageBox, Rect, RenderBox, RenderedSpread } from './rendered-spread.js';
import { textBlockBoxes } from './render-spread.js';

/**
 * Dieselbe Doppelseite mit einem anderen Ausschnitt in einem Slot.
 *
 * Für die Vorschau während des Ziehens: Der Server ist erst gefragt, wenn der
 * Ausschnitt steht. Die effektive Auflösung wird mitgeführt, weil sie am
 * Ausschnitt hängt und der Editor sie sofort anzeigen soll.
 *
 * Die Warnungen bleiben unangetastet: Ihre Schwellen (`minDpi`, `targetDpi`)
 * stehen im Druckprofil, nicht im RSM. Die Oberfläche kennt das Profil und
 * bewertet die neue Zahl selbst; nach dem Speichern liefert der Server die
 * verbindliche Fassung samt Warnungen.
 */
export function withCrop(spread: RenderedSpread, slotId: string, crop: Crop): RenderedSpread {
  return {
    ...spread,
    boxes: spread.boxes.map((box) =>
      box.kind === 'image' && box.slotId === slotId
        ? { ...box, crop, effectiveDpi: scaledDpi(box, crop) }
        : box,
    ),
  };
}

/**
 * Dieselbe Doppelseite mit einem verschobenen oder skalierten Bildkasten.
 *
 * Wie `withCrop` nur für die Vorschau während des Ziehens: Der Kasten folgt der
 * Hand, gespeichert wird beim Loslassen. Die Auflösung wird mitgerechnet – ein
 * größer gezogenes Bild verliert dpi, und das soll man sehen, bevor man
 * loslässt und nicht erst im Prüfbericht.
 */
export function withRect(
  spread: RenderedSpread,
  slotId: string,
  rect: { xMm: number; yMm: number; wMm: number; hMm: number },
): RenderedSpread {
  return {
    ...spread,
    boxes: spread.boxes.map((box) => {
      if (box.kind !== 'image' || box.slotId !== slotId) return box;
      const px = box.effectiveDpi * (box.wMm / 25.4);
      return { ...box, ...rect, effectiveDpi: px / (rect.wMm / 25.4) };
    }),
  };
}

/**
 * Dieselbe Doppelseite mit einer anderen Neigung in einem Slot.
 *
 * Das Gegenstück zu `withCrop`, aus demselben Grund: Der Regler soll sofort
 * zeigen, wie das Bild steht, und der Server erst gefragt werden, wenn der
 * Wert steht. `undefined` heißt hier wie im Modell „automatisch"; welchen
 * Winkel die Automatik wählt, weiß nur `renderSpread` – deshalb kommt für
 * diesen Fall die verbindliche Fassung vom Server.
 */
export function withRotation(
  spread: RenderedSpread,
  slotId: string,
  rotateDeg: number,
): RenderedSpread {
  return {
    ...spread,
    boxes: spread.boxes.map((box) =>
      box.kind === 'image' && box.slotId === slotId ? { ...box, rotateDeg } : box,
    ),
  };
}

/**
 * Dieselbe Doppelseite mit einem geänderten Textblock.
 *
 * Das Gegenstück zu `withRect` für Text: Wer einen Block zieht, an seinen
 * Griffen aufzieht oder dreht, soll den **Text** dabei sehen und nicht nur einen
 * Rahmen, der ihm vorausläuft. Gebaut wird mit `textBlockBoxes`, also mit
 * derselben Funktion wie beim Rendern – eine zweite Fassung wäre eine zweite
 * Wahrheit über Zeilenabstand, Schnitt und Drehpunkt.
 *
 * Die Fläche kommt aus dem RSM selbst: Beschnitt und Gesamtmaße stehen dort, und
 * der Editor kennt kein Druckprofil.
 *
 * Die neuen Boxen stehen an der Stelle der alten, damit die Zeichenreihenfolge
 * bleibt – ein Textblock liegt über den Bildern und unter dem Zeitstrahl. Hat der
 * Block noch keine Box (leerer Inhalt), kommen sie ans Ende.
 */
export function withTextBlock(spread: RenderedSpread, block: TextBlock): RenderedSpread {
  const trimWidthMm = (spread.widthMm - 2 * spread.bleedMm) / 2;
  const trimHeightMm = spread.heightMm - 2 * spread.bleedMm;
  const neu = textBlockBoxes(
    block,
    { bleedMm: spread.bleedMm, trimWidthMm, trimHeightMm },
    spread.background,
  );

  const gehoertZuBlock = (box: RenderBox) =>
    box.kind === 'text' && (box.slotId === block.id || box.slotId.startsWith(`${block.id}-`));

  let gesetzt = false;
  const boxes: RenderBox[] = [];
  for (const box of spread.boxes) {
    if (!gehoertZuBlock(box)) {
      boxes.push(box);
      continue;
    }
    if (!gesetzt) {
      boxes.push(...neu);
      gesetzt = true;
    }
  }
  if (!gesetzt) boxes.push(...neu);

  return { ...spread, boxes };
}

/**
 * Auflösung nach einer Ausschnittsänderung.
 *
 * Die Slotbreite in Millimetern ist unverändert, sichtbar sind aber
 * `crop.w / alt.w` mal so viele Pixel – die Auflösung skaliert also genau
 * damit. Die Alternative wäre, die Pixelmaße des Fotos zu kennen und neu zu
 * rechnen; das Ergebnis ist dasselbe, bis auf die Rundung in `cropToPixels`
 * (unter 1 dpi).
 */
function scaledDpi(box: ImageBox, crop: Crop): number {
  if (box.crop.w <= 0 || crop.w <= 0) return box.effectiveDpi;
  return (box.effectiveDpi * crop.w) / box.crop.w;
}

/**
 * Pixelmaße des Fotos, aus der Bildbox zurückgerechnet.
 *
 * Das RSM führt sie nicht mit – kein Renderer braucht sie. Beim Ziehen eines
 * Fotos über die Doppelseite braucht die Oberfläche sie trotzdem, um je Slot
 * die zu erwartende Auflösung anzuzeigen. Die Umkehrrechnung ist billiger als
 * ein zusätzlicher Serverabruf je gezogenem Foto: Aus Auflösung und
 * Slotbreite ergeben sich die sichtbaren Pixel, daraus über den Ausschnitt das
 * ganze Bild.
 *
 * Vorausgesetzt ist ein Ausschnitt, der den Slot vollständig füllt – das gilt
 * für jeden von der Engine oder vom Editor gesetzten Ausschnitt.
 */
export function photoPixelsOf(box: ImageBox): { width: number; height: number } | undefined {
  if (!(box.effectiveDpi > 0) || box.crop.w <= 0 || box.crop.h <= 0) return undefined;
  if (box.wMm <= 0 || box.hMm <= 0) return undefined;

  const sichtbarW = (box.effectiveDpi * box.wMm) / 25.4;
  const sichtbarH = (sichtbarW * box.hMm) / box.wMm;
  return { width: sichtbarW / box.crop.w, height: sichtbarH / box.crop.h };
}

/**
 * Auflösung, mit der ein Foto einen Slot füllen würde.
 *
 * Gerechnet für den automatischen Ausschnitt – das ist der Zustand, in dem ein
 * verschobenes Foto in seinem neuen Slot landet.
 */
export function dpiInSlot(photo: { width: number; height: number }, slot: Rect): number {
  if (photo.width <= 0 || photo.height <= 0) return 0;
  const crop = coverCrop(photo.width / photo.height, slot.wMm / slot.hMm);
  const px = cropToPixels(crop, photo.width, photo.height);
  return effectiveDpi(px.width, slot.wMm);
}
