/**
 * Ein Bild einwerfen: wo es landet und wie groß es dasteht.
 *
 * Der Einwurf ist die Geste „diese Datei gehört hierhin" – eine Datei fällt auf
 * eine Doppelseite, und das Bild steht an der Stelle, an der die Hand losgelassen
 * hat. Was daran Layout ist, steht hier: Kastengröße, Lage, Kennung des Platzes.
 * Der Server schreibt die Datei und liest ihre Maße; die Millimeter rechnet er
 * nicht (`.claude/rules/server.md`).
 *
 * **Die übrigen Bilder rühren sich nicht.** Das ist der ganze Punkt: Ein Einwurf
 * ist kein Neuanordnen. Deshalb bekommt das Bild einen **freien Platz**
 * (`wirksamePlaetze` in `model/spread.ts`) statt eines Platzes aus der Vorlage –
 * die Alternative wäre gewesen, für jede Bilderzahl eine Trägervorlage zu bauen
 * und alle Bilder der Seite neu zuzuordnen, also genau das Umwerfen, das der
 * Benutzer hier nicht bestellt hat. Ob die Seite danach neu angeordnet wird,
 * entscheidet er selbst (`setSpreadTemplate` mit `auto`).
 *
 * Verworfen wurde außerdem, das Bild in einen freien Platz der Vorlage zu
 * setzen, falls es einen gibt: Dann sprang es beim Fallenlassen an eine andere
 * Stelle als die, auf die man gezielt hat – und „an der Stelle, wo der Drop
 * erfolgt" ist die Zusage der Geste.
 */
import type { Photo } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import { FULL_CROP } from '../model/crop.js';
import type { PrintProfile } from '../print/profile.js';

/** Ein normiertes Rechteck, wie ein Templateslot. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Höhe eines eingeworfenen Bildes, als Anteil der Seitenhöhe.
 *
 * Ein Drittel: groß genug, um zu sehen, was man eingeworfen hat, klein genug,
 * um die Seite nicht zu verdecken – und weit unter der Größe, bei der ein
 * Handybild unter die Mindestauflösung fällt (bei 28×28 cm sind 0,33 der Höhe
 * 89 mm, ein 3024-Pixel-Bild steht dort bei 860 dpi).
 *
 * Die Höhe und nicht die Fläche ist der Maßstab, weil ein Hochformat sonst
 * schmal und lang würde: Bei gleicher Fläche ist ein 3:4-Bild 1,4-mal höher als
 * ein 4:3 breit ist. Über die Höhe stehen beide gleich hoch da, wie
 * Bilder auf einem Tisch.
 */
export const EINWURF_HOEHE = 1 / 3;

/** Der Vorsatz, unter dem freie Plätze ihre Kennung bekommen. */
export const EINWURF_PREFIX = 'frei.';

/**
 * Ob dieser Platz frei gesetzt wurde und nicht aus einer Vorlage kommt.
 *
 * Über die Kennung und nicht über die Abwesenheit in der Vorlage: Diese Frage
 * stellt sich auch dort, wo die Vorlage nicht zur Hand ist – in der Oberfläche
 * etwa, die aus dem RSM nur Boxen kennt.
 */
export function istEinwurfPlatz(slotId: string): boolean {
  return slotId.startsWith(EINWURF_PREFIX);
}

/**
 * Die nächste freie Kennung auf dieser Doppelseite: `frei.1`, `frei.2` …
 *
 * Fortlaufend gezählt und nicht aus der Zahl der Slots abgeleitet: Wird ein
 * eingeworfenes Bild wieder herausgenommen, darf die Kennung nicht an das
 * nächste fallen – Ausschnitt, Neigung und Ebene hängen daran.
 */
export function einwurfPlatzId(spread: Pick<Spread, 'slots'>): string {
  const belegt = new Set(spread.slots.map((s) => s.slotId));
  for (let n = 1; ; n++) {
    const id = `${EINWURF_PREFIX}${n}`;
    if (!belegt.has(id)) return id;
  }
}

/**
 * Hält ein normiertes Rechteck auf dem Blatt.
 *
 * Über die Endformatkante hinaus darf es sehr wohl – randabfallend ist gewollt,
 * dafür ist der Beschnitt da. Ganz außerhalb der Seite wäre dagegen kein
 * Gestaltungsmittel, sondern ein verlorenes Element.
 *
 * Im Kern und nicht im Server, weil zwei Griffe dieselbe Klemme brauchen: der
 * Kasten, den man am Griff zieht (`setSlotRect`), und der eingeworfene. Zwei
 * gleich lautende Formeln wären eine zweite Wahrheit über den Rand des Blattes.
 */
export function aufsBlatt(rect: NormRect, profile: PrintProfile): NormRect {
  // Der Beschnitt in normierten Einheiten: So weit darf etwas über das
  // Endformat hinausragen, ohne dass es aus dem Blatt fällt.
  const { bleedMm, trimWidthMm, trimHeightMm } = profile.page;
  const randX = bleedMm / (2 * trimWidthMm);
  const randY = bleedMm / trimHeightMm;
  const klemme = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const w = klemme(rect.w, 0.02, 1 + 2 * randX);
  const h = klemme(rect.h, 0.02, 1 + 2 * randY);
  return {
    x: klemme(rect.x, -randX, 1 + randX - w),
    y: klemme(rect.y, -randY, 1 + randY - h),
    w,
    h,
  };
}

/**
 * Der Kasten für ein eingeworfenes Bild: um den Punkt herum, im Seitenverhältnis
 * des Fotos.
 *
 * Um den Punkt und nicht mit der Ecke daran: Man zielt beim Fallenlassen auf die
 * Stelle, an der das Bild stehen soll, nicht auf seine linke obere Ecke. Am
 * Blattrand wird der Kasten hineingeschoben statt beschnitten – ein halb
 * außerhalb liegendes Bild wäre nach dem Einwurf kein sichtbares.
 *
 * Das Seitenverhältnis kommt aus dem Foto, damit der Ausschnitt nichts abschneidet:
 * Bei gleicher Form ist `coverCrop` die Identität, das Bild steht ganz da. Das
 * Foto muss dafür schon aufgelöst sein (`effectivePhoto`) – eine
 * Ausrichtungskorrektur tauscht Breite und Höhe.
 */
export function einwurfRect(punkt: { x: number; y: number }, photo: Photo, profile: PrintProfile) {
  const { trimWidthMm, trimHeightMm, bleedMm } = profile.page;
  const ar = aspectRatio(photo);

  let hoeheMm = EINWURF_HOEHE * trimHeightMm;
  // Ein Handy-Panorama ist bis zu 10:1 breit; ein Drittel Seitenhöhe hoch wäre
  // es 900 mm breit und damit breiter als das Blatt. Dann zieht die Höhe mit,
  // statt die Breite allein zu klemmen – sonst hätte der Kasten ein anderes
  // Seitenverhältnis als das Foto, und `coverCrop` schnitte beim Rendern die
  // Seiten ab. Das Bild soll ganz dastehen, das ist die Zusage des Einwurfs.
  const maxBreiteMm = 2 * trimWidthMm + 2 * bleedMm;
  if (hoeheMm * ar > maxBreiteMm) hoeheMm = maxBreiteMm / ar;

  const w = (hoeheMm * ar) / (2 * trimWidthMm);
  const h = hoeheMm / trimHeightMm;
  return aufsBlatt({ x: punkt.x - w / 2, y: punkt.y - h / 2, w, h }, profile);
}

/**
 * Legt ein Bild auf eine Doppelseite, dorthin, wo es fallen gelassen wurde.
 *
 * Der Platz kommt hinten dazu, damit das Bild obenauf liegt (siehe
 * `wirksamePlaetze`): Wer eben etwas eingeworfen hat, will es sehen und nicht
 * unter der Seite suchen.
 *
 * Der Ausschnitt bleibt automatisch. Ein eingeworfenes Bild ist noch keine
 * Handarbeit am Ausschnitt, und weil der Kasten die Form des Fotos hat, gibt es
 * ohnehin nichts wegzuschneiden.
 *
 * @param mitgebracht Was ein Bild von seinem alten Platz mitnimmt, wenn dieser
 *   Zug es dort weggeholt hat (`bildeigenes` in `layout/move.ts`): Rahmen und
 *   Unterschrift. Eine Datei von außen bringt nichts mit, also ist es leer.
 *   Ohne diesen Weg verlor ein Bild seine getippte Zeile, sobald man es um fünf
 *   Millimeter neben seinen Platz zog – derselbe Zug auf einen Nachbarplatz
 *   behielt sie.
 * @returns die neue Doppelseite und die Kennung des Platzes – die Oberfläche
 * wählt ihn danach aus, ohne nachzufragen.
 */
export function mitEinwurf(
  spread: Spread,
  photo: Photo,
  punkt: { x: number; y: number },
  profile: PrintProfile,
  mitgebracht: Partial<SlotAssignment> = {},
): { spread: Spread; slotId: string } {
  const slotId = einwurfPlatzId(spread);
  const rect = einwurfRect(punkt, photo, profile);

  return {
    spread: {
      ...spread,
      slots: [
        ...spread.slots,
        { slotId, photoId: photo.id, crop: { ...FULL_CROP }, rect, ...mitgebracht },
      ],
    },
    slotId,
  };
}
