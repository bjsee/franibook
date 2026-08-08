/**
 * Bewertungsfunktionen der Layout-Engine.
 *
 * Alle Kosten sind so normiert, dass 0 „ideal" bedeutet und Werte um 1 einen
 * spürbaren Mangel. Harte Ausschlüsse bekommen bewusst Werte jenseits von 5,
 * damit sie keine Summe aus kleinen Vorteilen überstimmen kann.
 */
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop, cropToPixels } from '../model/crop.js';
import type { Photo } from '../model/photo.js';
import { aspectRatio, orientationOf } from '../model/photo.js';
import type { TemplateSlot } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import type { PhotoWeight } from '../model/date.js';

export interface SlotGeometry {
  widthMm: number;
  heightMm: number;
}

/** Slotmaße in Millimetern aus den normierten Templatekoordinaten. */
export function slotGeometry(slot: TemplateSlot, profile: PrintProfile): SlotGeometry {
  return {
    widthMm: slot.w * 2 * profile.page.trimWidthMm,
    heightMm: slot.h * profile.page.trimHeightMm,
  };
}

export interface SlotCostContext {
  profile: PrintProfile;
  weightOf: (photoId: string) => PhotoWeight;
}

export interface SlotCostBreakdown {
  total: number;
  cropLoss: number;
  orientationClash: number;
  dpiPenalty: number;
  weightMismatch: number;
  /** Zuschlag für ein unscharfes Bild in einem prominenten Platz. */
  qualityPenalty: number;
  /** Auflösung, die sich bei dieser Zuordnung ergibt. */
  dpi: number;
}

const WEIGHT_RANK: Record<PhotoWeight, number> = { filler: 1, normal: 2, hero: 3 };

/**
 * Ab welcher Schärfe ein Bild als gut gilt, und ab welcher als schwach.
 *
 * Gemessen am echten Bestand (`docs/spikes/serien.md`, 956 Fotos): Die
 * Laplace-Varianz auf der 320-px-Vorschau liegt im Median bei 1.036 und im
 * zehnten Perzentil bei 316. Die beiden Zahlen sind also der Median und das
 * untere Zehntel — keine gesetzten Striche, sondern die Lage dieses Bestands.
 *
 * **Damit hängen sie an ihm.** Ein Bestand aus einer anderen Kamerageneration
 * läge anders, und die Zahlen gehörten nachgemessen. Der Alternative — Rang
 * innerhalb der Doppelseite statt absoluter Kennlinie — fehlt genau das, was
 * hier zählt: Auf einer Seite mit sechs gleich guten Bildern bestrafte sie das
 * minimal schlechteste, obwohl nichts daran fehlt.
 */
const SHARPNESS_SCHWACH = 316;
const SHARPNESS_GUT = 1036;

/**
 * Zuschlag für ein technisch schwaches Bild in einem prominenten Platz.
 *
 * Der große Platz fällt im Buch auf, und ein unscharfes Bild fällt dort doppelt
 * auf (Issue #19). Der Zuschlag wächst mit der Prominenz und verschwindet im
 * kleinsten Platz ganz: Ein verwackeltes Foto soll nicht aus dem Buch fallen,
 * es soll nur nicht die Seite tragen.
 *
 * **Ohne Messung kein Zuschlag.** Ein Foto ohne `quality` — vor der Bewertung
 * eingelesen, Vorschau nicht lesbar — wird behandelt wie ein gutes. Die
 * Umkehrung hieße, fehlende Auskunft als Mangel zu werten, und dann verlöre
 * ein frisch eingeworfenes Bild seinen Platz an ein gemessenes.
 *
 * Höchstens 0,3 und damit unter dem Orientierungsbruch (0,6): Ein Hochformat
 * im Querformatslot bleibt der schwerere Fehler. Die Belichtung geht bewusst
 * **nicht** ein — am Bestand sind 14 % abgesoffene Pixel im neunten Dezil ganz
 * normal (Nacht, Gegenlicht), und ein Zuschlag darauf benachteiligte richtig
 * belichtete dunkle Bilder.
 */
function qualityCost(photo: Photo, prominence: 1 | 2 | 3): number {
  const sharpness = photo.quality?.sharpness;
  if (sharpness === undefined) return 0;
  const mangel = Math.min(
    1,
    Math.max(0, (SHARPNESS_GUT - sharpness) / (SHARPNESS_GUT - SHARPNESS_SCHWACH)),
  );
  return mangel * ((prominence - 1) / 2) * 0.3;
}

/**
 * Kosten, ein bestimmtes Foto in einen bestimmten Slot zu legen.
 *
 * Die Gewichtung der Terme ist an diesem Bestand ausgerichtet: Weil praktisch
 * alle Fotos bei 2048 px liegen, ist die Auflösung der knappe Faktor und wiegt
 * entsprechend schwer.
 */
export function slotCost(
  photo: Photo,
  slot: TemplateSlot,
  geometry: SlotGeometry,
  ctx: SlotCostContext,
): SlotCostBreakdown {
  const photoAr = aspectRatio(photo);
  const slotAr = geometry.widthMm / geometry.heightMm;

  const crop = coverCrop(photoAr, slotAr);
  const px = cropToPixels(crop, photo.width, photo.height);
  const dpi = effectiveDpi(px.width, geometry.widthMm);

  // 1. Beschnittverlust: Anteil der Bildfläche, der wegfällt
  const cropLoss = 1 - crop.w * crop.h;

  // 2. Orientierungsbruch. Ein Hochformat in einem Querformatslot sieht auch
  //    dann falsch aus, wenn der Flächenverlust rechnerisch erträglich wäre.
  const photoOrientation = orientationOf(photo);
  const wanted = slot.prefers ?? 'any';
  let orientationClash = 0;
  if (wanted !== 'any' && photoOrientation !== 'square') {
    const matches =
      (wanted === 'landscape' && photoOrientation === 'landscape') ||
      (wanted === 'portrait' && photoOrientation === 'portrait');
    if (!matches) orientationClash = 0.6;
  }

  // 3. Auflösung. Unterhalb der Mindestauflösung praktisch verboten, dazwischen
  //    linear ansteigend.
  const { minDpi, targetDpi } = ctx.profile.resolution;
  let dpiPenalty = 0;
  if (dpi < minDpi) {
    dpiPenalty = 8;
  } else if (dpi < targetDpi) {
    dpiPenalty = (0.5 * (targetDpi - dpi)) / (targetDpi - minDpi);
  }

  // 4. Gewichtung: ein Hauptbild gehört in einen prominenten Slot
  const weightMismatch = Math.abs(WEIGHT_RANK[ctx.weightOf(photo.id)] - slot.prominence) * 0.25;

  // 5. Bildqualität: der große Platz für das schärfere Bild
  const qualityPenalty = qualityCost(photo, slot.prominence);

  return {
    total: cropLoss + orientationClash + dpiPenalty + weightMismatch + qualityPenalty,
    cropLoss,
    orientationClash,
    dpiPenalty,
    weightMismatch,
    qualityPenalty,
    dpi,
  };
}

/**
 * Optimale Zuordnung von Fotos zu Slots.
 *
 * Ungarische Methode auf der Kostenmatrix. Bei bis zu acht Slots ist die
 * kubische Laufzeit bedeutungslos, und im Gegensatz zu einem gierigen
 * Verfahren findet sie das tatsächliche Optimum – gerade bei gemischten
 * Ausrichtungen macht das einen sichtbaren Unterschied.
 *
 * @returns Für jeden Foto-Index den zugewiesenen Slot-Index.
 */
export function assign(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  const size = Math.max(n, m);

  // Auf quadratisch auffüllen
  const a: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i < n && j < m ? cost[i]![j]! : 0)),
  );

  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const p = new Array<number>(size + 1).fill(0);
  const way = new Array<number>(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(size + 1).fill(INF);
    const used = new Array<boolean>(size + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }

      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    const i = p[j]! - 1;
    if (i < n && j - 1 < m) result[i] = j - 1;
  }
  return result;
}

/**
 * Bewertet, wie gut eine Gruppe Fotos zu einem Template passt.
 *
 * Enthält die optimale Zuordnung; der Aufrufer bekommt sie mitgeliefert, damit
 * sie nicht zweimal gerechnet werden muss.
 */
export interface TemplateFit {
  templateId: string;
  /** Gesamtkosten, kleiner ist besser. */
  score: number;
  /** Slot-Index je Foto-Index. */
  assignment: number[];
  breakdowns: SlotCostBreakdown[];
  /** Schlechteste Auflösung in dieser Anordnung. */
  worstDpi: number;
}
