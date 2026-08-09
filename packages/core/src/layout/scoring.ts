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
import { slotPage } from '../model/template.js';
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
  /**
   * Wie prominent jeder Platz **tatsächlich** wirkt, aus `prominenceScale`.
   *
   * Ohne Angabe zählt allein die deklarierte Prominenz – für die Stellen, die
   * von `slotCost` nur die Auflösung wollen (`layout/document.ts`,
   * `kannAuftaktTragen`), ist das der kürzere Weg.
   */
  prominenceOf?: (slot: TemplateSlot) => number;
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
 * Wie prominent jeder Platz einer Anordnung **auf seiner Buchseite** wirkt.
 *
 * Die deklarierte Prominenz einer Vorlage ist auf die ganze Doppelseite
 * gemünzt, und dabei bleibt eine Buchseite regelmäßig ohne jede Abstufung:
 * `spread.12up.mosaic-quer` gibt allen acht linken Plätzen `prominence: 1`,
 * obwohl die beiden oberen mit 127 × 95 mm mehr als das Doppelte der sechs
 * unteren (82 × 61 mm) messen. Für die Zuordnung waren sie damit gleichwertig —
 * ein Hauptbild landete im kleinsten und ein Beifoto im größten Platz, und die
 * Auszeichnung blieb links wirkungslos. Wer aufschlägt, sieht aber eine
 * Buchseite und nicht die Doppelseite: Dort muss die Hierarchie stimmen.
 *
 * Gerechnet wird die Kantenlänge (√Fläche), linear zwischen dem kleinsten und
 * dem größten Platz **derselben** Buchseite auf 1 bis 3 gelegt. Die Kantenlänge
 * und nicht die Fläche, weil das Auge Bilder nach ihrer Ausdehnung vergleicht
 * und nicht nach ihrem Flächeninhalt — der halbiert schon bei 70 % Kantenlänge.
 *
 * Drei Grenzen hält die Rechnung ein, damit sie eine Verfeinerung bleibt und
 * keine Umdeutung der Bibliothek:
 *
 * - **Sie zeichnet aus, sie wertet nicht ab.** Die deklarierte Prominenz bleibt
 *   Untergrenze. `spread.12up.mosaic-quer` meint mit `r1b` (91 × 121 mm,
 *   hochkant, `prominence: 2`) einen prominenten Platz, den die Fläche allein
 *   nicht hergäbe — eine gestalterische Absicht, die die Rechnung nicht
 *   überstimmen soll.
 * - **Ohne Abstufung schweigt sie.** Sind alle Plätze einer Buchseite gleich
 *   groß (ein Gitter, oder die drei kleinen rechts in `spread.4up.hero-left`),
 *   gibt es nichts zu ordnen, und es bleibt bei der deklarierten Prominenz. Sie
 *   dort auf einen Mittelwert zu setzen hieße, die einzige verbliebene Auskunft
 *   — „das sind die kleinen Plätze" — gegen eine erfundene zu tauschen.
 * - **Die Doppelseite bricht den Gleichstand** (`FALZ_ANTEIL`, ein Zehntel).
 *   Ohne das war der größte linke Platz von `spread.12up.mosaic-quer` (127 ×
 *   95 mm) dem Ankerplatz rechts (162 × 121 mm) gleichwertig, und ein einzelnes
 *   Hauptbild landete im kleineren der beiden — 40 % Fläche verschenkt, weil
 *   danach nur noch der Beschnitt entschied. Ein Zehntel reicht dafür und ist
 *   zu wenig, um die Seitenhierarchie umzuwerfen: Der Abstand zwischen
 *   benachbarten Rängen einer Seite ist ein Vielfaches davon.
 *
 * Ein Platz über dem Falz zählt zu beiden Seiten und nimmt den kleineren der
 * beiden Anteile: prominent ist er erst, wenn er es auf beiden Seiten ist.
 */
export function prominenceScale(slots: readonly TemplateSlot[]): (slot: TemplateSlot) => number {
  const kante = (s: TemplateSlot) => Math.sqrt(s.w * s.h);
  const kanten = slots.map(kante);

  const grenzen = new Map<'left' | 'right' | 'beide', Spanne>();
  grenzen.set('beide', spanne(kanten));
  for (const seite of ['left', 'right'] as const) {
    const eigene = slots.filter((s) => seitenVon(s).includes(seite)).map(kante);
    if (eigene.length > 0) grenzen.set(seite, spanne(eigene));
  }

  /** Anteil an einer Spanne, oder nichts, wenn dort alle Plätze gleich groß sind. */
  const anteil = (k: number, wo: 'left' | 'right' | 'beide'): number[] => {
    const g = grenzen.get(wo);
    if (!g || g.max <= g.min) return [];
    return [(k - g.min) / (g.max - g.min)];
  };

  const werte = new Map<string, number>();
  slots.forEach((s, i) => {
    const k = kanten[i]!;
    const aufSeite = seitenVon(s).flatMap((seite) => anteil(k, seite));
    if (aufSeite.length === 0) {
      werte.set(s.id, s.prominence);
      return;
    }
    const seitlich = Math.min(...aufSeite);
    const ganz = anteil(k, 'beide')[0] ?? seitlich;
    const gemischt = (1 - FALZ_ANTEIL) * seitlich + FALZ_ANTEIL * ganz;
    werte.set(s.id, Math.max(s.prominence, 1 + 2 * gemischt));
  });

  return (slot) => werte.get(slot.id) ?? slot.prominence;
}

/**
 * Wie stark die ganze Doppelseite in die Prominenz hineinredet.
 *
 * Klein genug, dass die Buchseite die Rangfolge bestimmt, groß genug, dass
 * zwischen zwei gleich rangigen Plätzen der absolut größere gewinnt.
 */
const FALZ_ANTEIL = 0.1;

interface Spanne {
  min: number;
  max: number;
}

function spanne(werte: readonly number[]): Spanne {
  return { min: Math.min(...werte), max: Math.max(...werte) };
}

function seitenVon(slot: TemplateSlot): ('left' | 'right')[] {
  const seite = slotPage(slot);
  return seite === 'both' ? ['left', 'right'] : [seite];
}

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
function qualityCost(photo: Photo, prominence: number): number {
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

  // Wie prominent dieser Platz für dieses Foto zählt.
  //
  // Für ein ausgezeichnetes Bild die gerechnete Prominenz seiner Buchseite
  // (`prominenceScale`), sonst die deklarierte. Die feinere Rechnung auch auf
  // `normal` anzuwenden legte am echten Stand 46 von 80 Doppelseiten anders,
  // ohne dass jemand etwas ausgezeichnet hätte: Ein normales Foto bevorzugt
  // dann mittelgroße Plätze, und das verschiebt jede Seite ein wenig. Eine
  // Auszeichnung soll wirken, wo sie gesetzt ist, und sonst nichts bewegen.
  //
  // **Beide Terme darunter nehmen denselben Wert**, und das ist keine
  // Bequemlichkeit: Rechnete die Schärfe weiter mit der deklarierten Prominenz,
  // hielte sie `l1a` von `spread.12up.mosaic-quer` für einen kleinen Platz,
  // während die Gewichtung ihn für den Ankerplatz seiner Seite hält. Am echten
  // Buch schob genau das ein leicht unscharfes Hauptbild aus dem größten Platz
  // der Doppelseite in den zweitgrößten — der große Platz war dort gratis.
  const weight = ctx.weightOf(photo.id);
  const prominence =
    weight === 'normal' ? slot.prominence : (ctx.prominenceOf?.(slot) ?? slot.prominence);

  // 4. Gewichtung: ein Hauptbild gehört in einen prominenten Slot
  const weightMismatch = Math.abs(WEIGHT_RANK[weight] - prominence) * 0.25;

  // 5. Bildqualität: der große Platz für das schärfere Bild
  const qualityPenalty = qualityCost(photo, prominence);

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
