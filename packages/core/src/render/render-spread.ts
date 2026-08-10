/**
 * Berechnet aus Buchdaten das Rendered Spread Model.
 *
 * Diese Funktion ist die einzige Stelle, an der normierte Templatekoordinaten
 * in Millimeter übersetzt werden. Beide Renderer bekommen ausschließlich das
 * Ergebnis – keiner rechnet selbst.
 */
import { effectiveDpi, ptToMm } from '../geometry/units.js';
import type { ColorMatrix } from '../model/adjust.js';
import { farbmatrix, wirktAdjust } from '../model/adjust.js';
import { coverCrop, cropToPixels, fitCropToAspect } from '../model/crop.js';
import { focalForCrop, focusRectOnPage, visibleShare } from '../model/focal.js';
import type { EffectiveDate, PhotoOverride } from '../model/date.js';
import { effectivePhotos } from '../model/effective-photo.js';
import type { NaiveDateTime, Photo, PhotoId } from '../model/photo.js';
import { aspectRatio, orientationOf } from '../model/photo.js';
import type { SlotAssignment, Spread, TextBlock, TextElement } from '../model/spread.js';
import { slotReihenfolge, wirksamePlaetze } from '../model/spread.js';
import type { Template, TemplateSlot, TemplateTextSlot } from '../model/template.js';
import { crossesGutter } from '../model/template.js';
import type { PrintProfile } from '../print/profile.js';
import { isJustified } from '../templates/justified.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';
import { templateMeta } from '../templates/index.js';
import {
  BACKGROUND_MIN_DPI,
  DEFAULT_BACKGROUND,
  accentOn,
  backgroundFit,
  textColorOn,
} from './background.js';
import type { FrameId } from './frame.js';
import { frameBoxes, frameInset } from './frame.js';
import type {
  Guide,
  ImageBox,
  Rect,
  RenderBox,
  RenderWarning,
  RenderedSpread,
} from './rendered-spread.js';
import type { TimelineSideVariant } from './side-timeline.js';
import { sideTimelineBoxes } from './side-timeline.js';
import type { TimelineFootVariant } from './timeline.js';
import { timelineBoxes, timelineFootTopMm } from './timeline.js';
import {
  leftPageNumber,
  pageNumberBoxes,
  pageNumberInsetMm,
  pageNumberRect,
} from './page-number.js';
import { randabfallend, tiltDeg } from './tilt.js';
import { estimatedTextWidthMm, resolveWeight, textFontSizePt, textStyle } from './typography.js';

/**
 * Die Kennung der Hintergrundbildbox.
 *
 * Als Konstante, weil drei Stellen sie brauchen und keine von ihnen sie erraten
 * soll: Der Renderer legt sie an, das Ebenenpanel nimmt sie aus dem Stapel
 * (`useSpreadEditor.ts` — der Hintergrund ist keine Ebene), und der
 * Abnahmebericht zählt sie nicht als Bild der Seite. Ein Tippfehler in einer der
 * drei wäre stumm.
 */
export const BACKGROUND_SLOT_ID = 'background';

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
  /**
   * Welche Achse gezeichnet wird.
   *
   * `foot` ist der Zeitstrahl am Seitenfuß: achtzehn Monate um das Kapiteljahr,
   * mit Gruppentitel – er beantwortet „wie weit ist es seit der letzten Seite".
   * `side` ist die Lebensachse am äußeren Rand über alle Jahrgänge des Buches;
   * sie beantwortet „wo im Leben stehe ich" und schweigt sonst.
   */
  style?: 'foot' | 'side';
  /**
   * Fassung der Zeichnung, je Achse eine.
   *
   * Zwei Felder und nicht eines: Die Fassungen der beiden Achsen haben nichts
   * miteinander zu tun, und wer zwischen Fuß und Rand hin und her schaltet,
   * soll auf jeder Seite seine Wahl wiederfinden. Ohne Angabe der Bestand.
   */
  footVariant?: TimelineFootVariant;
  sideVariant?: TimelineSideVariant;
  /**
   * Erstes und letztes Jahr des Buches – der Maßstab der Randachse. Nur der
   * Aufrufer kennt sie; die Engine sieht immer nur eine Doppelseite.
   */
  bookYears?: { from: number; to: number };
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

/**
 * Seitenzahlen im Fuß jeder Buchseite.
 *
 * Fehlt der Kontext, trägt das Buch keine – wie beim Zeitstrahl lebt der
 * globale Schalter beim Aufrufer und nicht in der Engine.
 */
export interface PageNumberContext {
  /**
   * Buchseitenzahl der linken Seite der **ersten** Doppelseite. Ohne Angabe 1.
   *
   * Der Zähler und nicht die Zahl dieser Seite: Welche Nummer eine Doppelseite
   * trägt, folgt aus ihrem Platz im Buch, und den kennt sie selbst
   * (`Spread.index`). Ein Aufrufer, der sie mitgäbe, könnte sie falsch angeben;
   * ein Vorsatzblatt verschiebt dagegen alle gleichermaßen und gehört hierher.
   */
  startAt?: number;
}

export interface RenderContext {
  profile: PrintProfile;
  template: Template;
  photos: ReadonlyMap<PhotoId, Photo>;
  /**
   * Benutzerkorrekturen. Werden beim Eintritt über `effectivePhotos` aufgelöst –
   * ohne sie rechnet die Engine mit dem rohen Importergebnis, und eine
   * korrigierte Ausrichtung bliebe wirkungslos.
   */
  overrides?: Record<PhotoId, PhotoOverride>;

  /** Hintergrund der Doppelseite. Weiß, solange nichts anderes gesetzt ist. */
  background?: string;
  timeline?: TimelineContext;
  pageNumbers?: PageNumberContext;
  tilt?: TiltContext;
  /**
   * Rahmen für alle Bilder, die keinen eigenen tragen.
   *
   * Wie die Neigung eine reine Rendereinstellung: Der Rahmen verkleinert das
   * Bild in seinem Kasten, verschiebt aber kein Foto und ändert keine Vorlage.
   * Ein Umstellen erfordert deshalb kein Neugenerieren, und der Schalter lebt
   * beim Aufrufer statt in der Engine.
   */
  frame?: FrameId;
}

/**
 * Übersetzt eine normierte Templatekoordinate in Millimeter.
 *
 * Normiert bezieht sich auf den Endformatbereich; der Ursprung des RSM liegt
 * dagegen an der Beschnittkante. Der Beschnitt ist deshalb der Versatz.
 *
 * Wer über das Endformat hinausragt, wird bis an die Blattkante gezogen. Die
 * Vorlagen der Bibliothek schreiben ihren Überstand als Anteil der
 * Referenzseite (3 mm auf 600 sind 0,005), der Beschnitt ist aber in jedem
 * Format dieselben 3 mm: Auf der 540 mm breiten Doppelseite blieben sonst
 * 0,3 mm weißes Papier neben einem randabfallenden Bild – und `randabfallend`
 * erkennte es nicht mehr als solches, gäbe ihm also auch noch eine Neigung.
 */
function toMm(
  slot: Pick<TemplateSlot, 'x' | 'y' | 'w' | 'h'>,
  profile: PrintProfile,
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const r = rectMm(slot, profile.page);
  const { bleedMm } = profile.page;
  const rechts = bleedMm + 2 * profile.page.trimWidthMm;
  const unten = bleedMm + profile.page.trimHeightMm;

  const links = slot.x < 0 ? 0 : r.xMm;
  const oben = slot.y < 0 ? 0 : r.yMm;
  const kanteRechts = slot.x + slot.w > 1 ? rechts + bleedMm : r.xMm + r.wMm;
  const kanteUnten = slot.y + slot.h > 1 ? unten + bleedMm : r.yMm + r.hMm;

  return { xMm: links, yMm: oben, wMm: kanteRechts - links, hMm: kanteUnten - oben };
}

/**
 * Dieselbe Rechnung, aber ohne Druckprofil.
 *
 * Die Oberfläche rechnet beim Ziehen an den Griffen mit, kennt dabei aber nur
 * die Maße aus dem fertigen `RenderedSpread` und kein Profil – dieselbe
 * Begründung wie bei `TextBlockArea`. Die Formel steht deshalb hier einmal,
 * statt an drei Stellen gleich zu lauten und irgendwann auseinanderzugehen.
 */
function rectMm(
  rect: { x: number; y: number; w: number; h: number },
  area: TextBlockArea,
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const trimSpreadW = 2 * area.trimWidthMm;
  return {
    xMm: area.bleedMm + rect.x * trimSpreadW,
    yMm: area.bleedMm + rect.y * area.trimHeightMm,
    wMm: rect.w * trimSpreadW,
    hMm: rect.h * area.trimHeightMm,
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
  // Ein Bild über der Falzachse steht gerade, solange das Profil einen
  // Falzzuschlag führt: Der Zuschlag teilt an einer senkrechten Achse, und
  // schon 1,2° Vorgabeneigung nähmen ihn dem Bild wieder. `randabfallend`
  // deckt das nicht ab – es prüft die Papierkante, nicht den Bund. Eine von
  // Hand gesetzte Neigung steht oben und gilt weiter; sie ist eine Aussage
  // über dieses Bild, und dann bleibt der Falz eben unversorgt.
  if (falzverlustMm(rect, 0, ctx.profile) > 0) return 0;
  // Slot *und* Foto im Schlüssel: Ein Bild soll seinen Winkel behalten, wenn
  // die Nachbarseite umgebaut wird, ihn aber wechseln, wenn es selbst
  // umzieht – sonst stünden zwei getauschte Bilder identisch schief.
  return tiltDeg(`${assignment.slotId}:${photoId}`, ctx.tilt.seed, ctx.tilt.maxDeg);
}

/**
 * Liegt ein erkanntes Gesicht dort, wo das gebundene Buch es beschneidet?
 *
 * Zwei Zonen, in dieser Rangfolge: der Beschnitt jenseits der Endformatkante —
 * was dort liegt, ist nach dem Schneiden weg — und die Falzzone links und
 * rechts der Achse, in der ein Motiv teilweise im Bund verschwindet.
 *
 * Geprüft wird nur, was auch zu sehen ist: Ein Gesicht außerhalb des
 * Ausschnitts ist kein Fall für diese Warnung, es ist ohnehin nicht im Buch.
 * Und nur `faces` — ein Salienzobjekt umfasst oft die halbe Fläche und läge
 * damit fast immer irgendwo am Rand.
 */
function gesichterAmRand(
  photo: Photo,
  crop: { x: number; y: number; w: number; h: number },
  rect: Rect,
  profile: PrintProfile,
): RenderWarning | undefined {
  const gesichter = photo.faces;
  if (!gesichter?.length) return undefined;

  const { trimWidthMm, trimHeightMm, bleedMm, gutterSafeMm } = profile.page;
  const gutterX = bleedMm + trimWidthMm;
  const rechts = bleedMm + 2 * trimWidthMm;
  const unten = bleedMm + trimHeightMm;

  let imBeschnitt = 0;
  let imFalz = 0;

  for (const gesicht of gesichter) {
    // Ein Gesicht, das nur zu einem Zehntel im Ausschnitt liegt, ist kein
    // Gesicht im Buch — dieselbe Schwelle wie bei der Fokuspunktsuche.
    if (visibleShare(gesicht, crop) < 0.5) continue;
    const auf = focusRectOnPage(gesicht, crop, rect);

    if (
      auf.xMm < bleedMm ||
      auf.yMm < bleedMm ||
      auf.xMm + auf.wMm > rechts ||
      auf.yMm + auf.hMm > unten
    ) {
      imBeschnitt++;
    } else if (auf.xMm < gutterX + gutterSafeMm && auf.xMm + auf.wMm > gutterX - gutterSafeMm) {
      imFalz++;
    }
  }

  if (imBeschnitt > 0) return { code: 'face-at-edge', wo: 'beschnitt', anzahl: imBeschnitt };
  if (imFalz > 0) return { code: 'face-at-edge', wo: 'falz', anzahl: imFalz };
  return undefined;
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

/**
 * Rahmen dieses Bildes: von Hand gesetzt, sonst die Buchvorgabe.
 *
 * Am Papierrand entfällt er – dieselbe Regel und dieselbe Begründung wie bei
 * der Neigung: Ein Karton über der Beschnittkante wird abgeschnitten, und was
 * im Druck bleibt, ist ein weißer Streifen an der Papierkante. Auch eine von
 * Hand getroffene Wahl gilt dort nicht; sie wäre kein Gestaltungsmittel,
 * sondern ein Fehler.
 */
function frameOf(assignment: SlotAssignment, aussen: Rect, ctx: RenderContext): FrameId {
  const flaeche = {
    widthMm: spreadWidthMm(ctx.profile),
    heightMm: spreadHeightMm(ctx.profile),
  };
  if (randabfallend(aussen, flaeche)) return 'keiner';
  return assignment.frame ?? ctx.frame ?? 'keiner';
}

/**
 * Alle Boxen eines belegten Slots: Rahmen dahinter, Bild, Rahmen davor.
 *
 * Die Reihenfolge ist die Zeichenreihenfolge – beide Renderer arbeiten die
 * Liste von vorn nach hinten ab. Deshalb steht sie hier und nicht in einer
 * `z`-Angabe an der Box: Eine zweite Ordnung neben der Liste wäre eine zweite
 * Wahrheit.
 */
function slotBoxes(
  slot: TemplateSlot,
  assignment: SlotAssignment,
  photo: Photo,
  ctx: RenderContext,
  gerechnet: boolean,
): RenderBox[] {
  // Von Hand gesetzte Position schlägt den Platz der Vorlage.
  const aussen = toMm(assignment.rect ?? slot, ctx.profile);
  const frame = frameOf(assignment, aussen, ctx);
  // Der Rahmen nimmt sich seinen Rand vom Außenmaß; das Bild schrumpft. Alles
  // Weitere – Ausschnitt, Auflösung, Warnungen – rechnet mit dem kleineren
  // Kasten weiter, sonst versprächen die DPI-Zahlen mehr, als gedruckt wird.
  const innen = frameInset(aussen, frame);
  // Der Winkel hängt am Außenmaß und damit nicht am Rahmen: Ein Bild soll
  // gleich schief liegen, ob man ihm einen Karton gibt oder nicht.
  const drehung = tiltOf(assignment, aussen, photo.id, ctx);

  const rahmen = frameBoxes({
    aussen,
    frame,
    slotId: slot.id,
    ...(drehung !== 0 ? { rotateDeg: drehung } : {}),
    ...(assignment.caption ? { caption: assignment.caption } : {}),
  });

  const bild = buildImageBox(slot, assignment, photo, ctx, gerechnet, {
    aussen,
    innen,
    drehung,
    frame,
  });

  return [...rahmen.hinter, ...bild, ...rahmen.davor];
}

/**
 * Was dieses Bild an der Bindung verliert – oder 0, wenn der Zuschlag hier
 * nicht greift.
 *
 * Der Verlust ist eine Eigenschaft der Bindung und steht im Profil
 * (`page.gutterLossMm`); ob er ein Bild trifft, entscheidet allein dessen Lage.
 * Zwei Fälle bleiben ausgenommen, und beide aus demselben Grund – der Zuschlag
 * rechnet mit einer senkrechten Achse mitten im Kasten:
 *
 *  - **Ein geneigtes Bild.** Seine Kanten stehen schräg zur Achse, eine
 *    senkrechte Teilung schnitte quer durchs Motiv. Aus der Automatik ist der
 *    Fall ausgeschlossen – `tiltOf` stellt ein Bild über der Achse gerade,
 *    sobald das Profil einen Verlust führt. Bleibt die Handneigung, und dann
 *    ist ein unversorgter Falz das kleinere Übel gegenüber einem Versatz quer
 *    durchs Bild.
 *  - **Eine Hälfte schmaler als der Verlust.** Der Zuschlag verlangte dort mehr
 *    Motiv, als das Bild hergibt – die schmale Hälfte müsste einen Streifen
 *    zeigen, der jenseits ihres eigenen Ausschnitts liegt.
 *
 * `!(verlust > 0)` und nicht `verlust <= 0`: Ein Profil ohne das Feld – die
 * JSON-Dateien kommen per Typzusicherung herein, die ein fehlendes Feld nicht
 * bemerkt – ergäbe sonst `NaN` für **jede** Bildbox des Buches statt für keine.
 */
function falzverlustMm(rect: Rect, drehung: number, profile: PrintProfile): number {
  const verlust = profile.page.gutterLossMm;
  if (!(verlust > 0) || drehung !== 0) return 0;

  const gutterX = profile.page.bleedMm + profile.page.trimWidthMm;
  const links = gutterX - rect.xMm;
  const rechts = rect.xMm + rect.wMm - gutterX;
  if (links < verlust || rechts < verlust) return 0;

  return verlust;
}

/**
 * Ein Bild über der Falzachse als zwei Boxen, die einander um den Verlust
 * überlappen.
 *
 * Das ist der ganze Zuschlag: Der Streifen, den die Bindung schluckt, wird
 * **doppelt gedruckt** – einmal am rechten Rand der linken Seite, einmal am
 * linken der rechten. Im gebundenen Buch stoßen dann genau die Motivstellen
 * aneinander, die auch im Foto benachbart sind, und das Motiv reißt nicht
 * auseinander.
 *
 * Zwei Boxen und keine Sonderbehandlung in den Renderern: Beide zeichnen
 * gewöhnliche Bildboxen mit gewöhnlichem Ausschnitt, für die die Parity längst
 * gilt. Dieselbe Machart wie beim Rahmen, der auch nicht als Begriff im Modell
 * steht, sondern als mehr Boxen. Einen **eigenen** Parity-Fall hat die Teilung
 * trotzdem nicht: Der Test rendert mit dem Vorgabeprofil, und keines der acht
 * führt einen Verlust. Er entsteht mit dem ersten gemessenen Wert.
 *
 * Die Skala bleibt in beiden Hälften dieselbe – sie verzerren also nicht.
 * Bezahlt wird der Zuschlag mit Motiv: Der Ausschnitt ist für die **sichtbare**
 * Breite gerechnet (`wMm - verlust`), das Bild steht damit etwas größer im
 * Kasten als ohne Bindung.
 */
function falzTeilung(box: ImageBox, verlustMm: number, gutterXMm: number): ImageBox[] {
  const sichtbarMm = box.wMm - verlustMm;
  const linksMm = gutterXMm - box.xMm;
  const rechtsMm = box.xMm + box.wMm - gutterXMm;
  const anteilLinks = linksMm / sichtbarMm;
  const anteilRechts = rechtsMm / sichtbarMm;

  return [
    {
      ...box,
      wMm: linksMm,
      crop: { ...box.crop, w: box.crop.w * anteilLinks },
      gutterPart: 'links',
    },
    {
      ...box,
      xMm: gutterXMm,
      wMm: rechtsMm,
      crop: {
        ...box.crop,
        x: box.crop.x + box.crop.w * (1 - anteilRechts),
        w: box.crop.w * anteilRechts,
      },
      gutterPart: 'rechts',
      // Die Warnungen bleiben bei der linken Hälfte. Sie gelten dem Bild und
      // nicht der Fläche – doppelt gemeldet stünde jede zweimal im
      // Abnahmebericht, und `below-min-dpi` gälte für eine Breite, die es so
      // nicht gibt.
      warnings: [],
    },
  ];
}

/** Die Geometrie, die `slotBoxes` schon ausgerechnet hat. */
interface SlotGeometrie {
  /** Der ganze Platz einschließlich Rahmen. */
  aussen: Rect;
  /** Der Kasten, in dem das Bild selbst steht. */
  innen: Rect;
  drehung: number;
  /** Der Rahmen, der tatsächlich wirkt – am Papierrand also `keiner`. */
  frame: FrameId;
}

/**
 * Die Farbmatrix eines Fotos, oder `undefined`, wenn nichts eingestellt ist.
 *
 * Aus dem Override und nicht aus dem aufgelösten Foto: Eine Bildanpassung ist
 * keine Aussage über die Datei, und `Photo` bleibt das Importergebnis.
 */
function matrixVon(photoId: PhotoId, ctx: RenderContext): ColorMatrix | undefined {
  const adjust = ctx.overrides?.[photoId]?.adjust;
  return wirktAdjust(adjust) ? farbmatrix(adjust) : undefined;
}

function buildImageBox(
  slot: TemplateSlot,
  assignment: SlotAssignment,
  photo: Photo,
  ctx: RenderContext,
  gerechnet: boolean,
  geo: SlotGeometrie,
): ImageBox[] {
  const { profile } = ctx;
  const { aussen, innen: rect, drehung } = geo;
  // Sichtbar ist bei einem Bild über der Falzachse weniger als der Kasten breit
  // ist – der Rest verschwindet im Bund. Der Ausschnitt richtet sich nach dem
  // Sichtbaren, sonst stünde das Motiv nach der Bindung gestaucht.
  const verlustMm = falzverlustMm(rect, drehung, profile);
  const sichtbarMm = rect.wMm - verlustMm;
  const slotAr = sichtbarMm / rect.hMm;

  // Ein `auto-cover`-Ausschnitt wird für die aktuellen Slotmaße neu gerechnet.
  // Ein von Hand gesetzter bleibt in seiner Lage und Vergrößerung, wird aber in
  // die Form des Kastens gedreht: Beide Renderer bilden den Ausschnitt auf den
  // Kasten ab, ein anderes Seitenverhältnis wäre also ein gestauchtes Bild.
  // Vorher traf das jeden Vorlagenwechsel mit manuellem Ausschnitt; seit sich
  // der Kasten am Griff frei aufziehen lässt, wäre es der Normalfall.
  // Der Fokuspunkt wird beim Rendern gerechnet und nicht beim Anordnen
  // gespeichert — wie Neigung und Rahmen. Zwei Gründe: Ein bestehendes Buch
  // bekommt die besseren Ausschnitte, sobald die Gesichter erkannt sind, ohne
  // Neuaufbau. Und die beste Lage hängt an der Slotform, ein gespeicherter Wert
  // wäre nach jedem Vorlagenwechsel für die alte Form optimiert. Auf die
  // Auflösung schlägt das nicht durch: Der Fokus verschiebt den Ausschnitt, er
  // verkleinert ihn nicht — `bookStats` und `slotCost` rechnen deshalb weiter
  // ohne ihn und bekommen dieselbe Pixelzahl.
  const crop =
    assignment.crop.mode === 'manual'
      ? fitCropToAspect(assignment.crop, aspectRatio(photo), slotAr)
      : coverCrop(aspectRatio(photo), slotAr, assignment.crop.focal ?? focalForCrop(photo, slotAr));

  // Die effektive Auflösung hängt an den *sichtbaren* Pixeln, nicht an der
  // Bildgröße – nach einem starken Ausschnitt kann ein großes Foto darunter
  // liegen. Gerechnet wird über die tatsächlich extrahierten Pixel, damit die
  // Zahl mit dem übereinstimmt, was der PDF-Renderer später verarbeitet.
  const px = cropToPixels(crop, photo.width, photo.height);
  const dpi = effectiveDpi(px.width, sichtbarMm);

  const warnings: RenderWarning[] = [];
  if (dpi < profile.resolution.minDpi) {
    warnings.push({ code: 'below-min-dpi', dpi, minDpi: profile.resolution.minDpi });
  } else if (dpi < profile.resolution.targetDpi) {
    warnings.push({ code: 'below-target-dpi', dpi, targetDpi: profile.resolution.targetDpi });
  }
  // Auf das tatsächliche Rechteck geprüft: Wer ein Bild von Hand in den Falz
  // zieht, soll dieselbe Warnung bekommen wie eine Vorlage, die es täte.
  if (crossesGutter(assignment.rect ?? slot)) warnings.push({ code: 'crosses-gutter' });

  // Bild und Platz stehen quer zueinander. Gemeldet wird die Form, nicht der
  // Beschnitt: Ein von Hand eng gezogener Ausschnitt ist eine Entscheidung, ein
  // Hochformat in einem Querformatplatz ist ein Missstand – und nach einer
  // Ausrichtungskorrektur der Normalfall, weil das Bild kippt und sein Platz
  // nicht.
  const bildLage = orientationOf(photo);
  const platzLage = orientationOf({ width: rect.wMm, height: rect.hMm });
  if (bildLage !== 'square' && platzLage !== 'square' && bildLage !== platzLage) {
    warnings.push({ code: 'orientation-mismatch', sichtbar: crop.w * crop.h });
  }

  const amRand = gesichterAmRand(photo, crop, rect, profile);
  if (amRand) warnings.push(amRand);

  // Der Drehpunkt nur dann ausdrücklich, wenn der Rahmen ihn verschiebt: Beim
  // Polaroid liegt die Mitte des Kartons unter der des Bildes, und beide müssen
  // um denselben Punkt fahren. Bei gleichmäßigem Rand – und ohne Rahmen – ist
  // es die Mitte der Box, also die Vorgabe des Modells.
  const mitte = { xMm: aussen.xMm + aussen.wMm / 2, yMm: aussen.yMm + aussen.hMm / 2 };
  const eigeneMitte = { xMm: rect.xMm + rect.wMm / 2, yMm: rect.yMm + rect.hMm / 2 };
  const versetzt =
    Math.abs(mitte.xMm - eigeneMitte.xMm) > 1e-6 || Math.abs(mitte.yMm - eigeneMitte.yMm) > 1e-6;

  const colorMatrix = matrixVon(photo.id, ctx);

  const box: ImageBox = {
    kind: 'image',
    ...rect,
    slotId: slot.id,
    photoId: photo.id,
    crop,
    effectiveDpi: dpi,
    ...(colorMatrix ? { colorMatrix } : {}),
    ...(drehung !== 0 ? { rotateDeg: drehung } : {}),
    ...(drehung !== 0 && versetzt ? { rotateAboutMm: mitte } : {}),
    // Auf justierten Doppelseiten trägt jeder Slot ein Rechteck, aber keines
    // davon ist Handarbeit – der Neuaufbau rechnet sie wieder aus. Der Editor
    // hätte sonst nichts zurückzunehmen und würde es doch anbieten.
    ...(assignment.rect && !gerechnet ? { manualRect: true as const } : {}),
    // Nur der wirkende Rahmen, und nur wenn es einen gibt: Ein `'keiner'` im
    // Modell wäre dasselbe wie sein Fehlen und damit eine zweite Schreibweise.
    ...(geo.frame !== 'keiner' ? { frame: geo.frame } : {}),
    ...(assignment.frame !== undefined ? { manualFrame: true as const } : {}),
    ...(assignment.caption ? { caption: assignment.caption } : {}),
    warnings,
  };

  if (verlustMm === 0) return [box];
  return falzTeilung(box, verlustMm, profile.page.bleedMm + profile.page.trimWidthMm);
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
  // Beim Eintritt aufgelöst: Alles darunter rechnet mit den geltenden Maßen,
  // ohne die Korrektur zu kennen.
  const photos = effectivePhotos(ctx.photos, ctx.overrides);
  const boxes: RenderBox[] = [];

  const background = spread.background ?? ctx.background ?? DEFAULT_BACKGROUND;

  // Ein Hintergrundbild ist eine gewöhnliche Bildbox über die ganze
  // Beschnittfläche – kein neuer Kasten und kein Sonderweg in den Renderern.
  // Es kommt zuerst, damit alles andere darüber liegt.
  const backgroundPhoto = spread.backgroundPhotoId
    ? photos.get(spread.backgroundPhotoId)
    : undefined;
  if (backgroundPhoto) {
    const flaeche = {
      xMm: 0,
      yMm: 0,
      wMm: spreadWidthMm(profile),
      hMm: spreadHeightMm(profile),
    };
    const fit = backgroundFit(backgroundPhoto, profile);
    // Auch der Hintergrund trägt die Anpassung seines Fotos: Sie hängt am Bild,
    // nicht daran, wo es liegt – und ein schwarzweißer Hintergrund unter
    // farbigen Bildern ist genau der Fall, für den man sie einstellt.
    const hintergrundMatrix = matrixVon(backgroundPhoto.id, ctx);
    // Und auch er bekommt den Falzzuschlag. Er ist sogar der Regelfall dafür:
    // Ein flächenfüllender Hintergrund kreuzt die Achse immer, und ohne
    // Zuschlag reißt er an der Bindung wie jedes andere Motiv. Die Auflösung
    // bleibt die der ganzen Fläche – der Unterschied liegt unter einem Prozent
    // und `backgroundFit` misst das Papier, nicht den Ausschnitt.
    const hintergrundVerlust = falzverlustMm(flaeche, 0, profile);
    const hintergrund: ImageBox = {
      kind: 'image',
      ...flaeche,
      slotId: BACKGROUND_SLOT_ID,
      photoId: backgroundPhoto.id,
      crop: coverCrop(
        aspectRatio(backgroundPhoto),
        (flaeche.wMm - hintergrundVerlust) / flaeche.hMm,
      ),
      effectiveDpi: fit.dpi,
      ...(hintergrundMatrix ? { colorMatrix: hintergrundMatrix } : {}),
      warnings: fit.taugt
        ? []
        : [{ code: 'background-low-dpi', dpi: fit.dpi, recommendedDpi: BACKGROUND_MIN_DPI }],
    };
    boxes.push(
      ...(hintergrundVerlust === 0
        ? [hintergrund]
        : falzTeilung(
            hintergrund,
            hintergrundVerlust,
            profile.page.bleedMm + profile.page.trimWidthMm,
          )),
    );
  }

  const bySlotId = new Map(spread.slots.map((s) => [s.slotId, s]));

  // Nicht in der Reihenfolge der Vorlage, sondern in der des Stapels: Seit
  // Bildkästen frei gezogen werden, überlappen sich Bilder, und dann ist die
  // Zeichenreihenfolge eine Aussage (`SlotAssignment.layer`). Ohne `layer`
  // liefert `slotReihenfolge` genau die Reihenfolge der Vorlage.
  //
  // `wirksamePlaetze` statt `template.slots`: Ein eingeworfenes Bild hat einen
  // Platz, den keine Vorlage kennt – und der gezeichnet werden muss, sonst wäre
  // das Bild im Projekt und nicht auf dem Papier.
  for (const slot of slotReihenfolge(wirksamePlaetze(template, spread), spread)) {
    const assignment = bySlotId.get(slot.id);
    const rect = toMm(slot, profile);

    if (!assignment?.photoId) {
      boxes.push({ kind: 'empty', ...rect, slotId: slot.id });
      continue;
    }

    const photo = photos.get(assignment.photoId);
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

    boxes.push(...slotBoxes(slot, assignment, photo, ctx, isJustified(spread.templateId)));
  }

  const byTextSlotId = new Map((spread.texts ?? []).map((t) => [t.slotId, t]));
  for (const textSlot of template.textSlots ?? []) {
    const text = byTextSlotId.get(textSlot.id);
    if (!text) continue;
    boxes.push(...textElementBoxes(text, textSlot, profile.page, background));
  }

  // Von Hand gesetzte Blöcke, nach den Bildern: Wer einen Text auf ein Foto
  // legt, meint darüber und nicht darunter.
  for (const block of spread.blocks ?? []) {
    boxes.push(...textBlockBoxes(block, profile.page, background));
  }

  // Der Zeitstrahl kommt zuletzt: Er liegt im Fußraum, den kein Slot belegt,
  // und soll auch in der Zeichenreihenfolge nichts überdecken.
  if (ctx.timeline && spread.timeline !== false) {
    boxes.push(...buildTimeline(spread, ctx, ctx.timeline, background));
  }

  // Die Seitenzahl steht neben dem Zeitstrahl in derselben Zeile und kommt
  // nach ihm: Wo beide zusammenfallen könnten, gewinnt die Zahl, weil sie sich
  // nicht verschieben lässt.
  if (ctx.pageNumbers) {
    boxes.push(...buildPageNumbers(spread, ctx, ctx.pageNumbers, background));
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
 * Die Fläche, auf die ein normiertes Rechteck abgebildet wird.
 *
 * Als Maßpaar und nicht als `PrintProfile`, damit die Oberfläche dieselbe
 * Funktion auf einem fertigen `RenderedSpread` aufrufen kann – dieselbe
 * Begründung wie bei `randabfallend`.
 */
export interface TextBlockArea {
  bleedMm: number;
  trimWidthMm: number;
  trimHeightMm: number;
}

/**
 * Boxen eines Textes, der an einem Textplatz der Vorlage hängt.
 *
 * Position und Größe kommen aus dem Platz – es sei denn, jemand hat den Text
 * von Hand aufgezogen (`TextElement.rect`). Dann gilt sein Rechteck, und weil
 * die Schriftgröße in `TEXT_STYLES` die Versalhöhe als Anteil der Kastenhöhe
 * ist, wächst die Schrift damit von selbst mit. Genau deshalb braucht ein
 * bewegter Vorlagentext keine eigene Punktgröße.
 *
 * Exportiert aus demselben Grund wie `textBlockBoxes`: Der Editor zeigt beim
 * Ziehen an den Griffen den offenen Stand und muss dazu dieselbe Regel benutzen
 * – sonst zeigte die Vorschau während des Ziehens etwas anderes als danach.
 */
export function textElementBoxes(
  text: TextElement,
  textSlot: TemplateTextSlot,
  area: TextBlockArea,
  background: string,
): RenderBox[] {
  const zeilen = text.content.split('\n').filter((z) => z.trim().length > 0);
  if (zeilen.length === 0) return [];

  const rect = rectMm(text.rect ?? textSlot, area);
  const style = textStyle(textSlot.style);

  // Mehrzeilige Texte werden hier in einzelne Boxen zerlegt, statt sie einem
  // Renderer zu überlassen. Sonst müsste jeder Adapter den Zeilenabstand
  // selbst bestimmen – CSS `line-height` gegen pdfkit `lineGap` –, und genau
  // das wäre eine Layoutentscheidung im Renderer, die der Parity-Test
  // aufdecken soll. Der Zeilenabstand steckt deshalb in der Geometrie.
  // Die Zeilenhöhe folgt der Absicht des Templates, nicht der Zahl der
  // gesetzten Zeilen: Drei Ereignisse sollen so groß stehen wie fünf. Das gilt
  // auch für einen von Hand aufgezogenen Kasten – wer ihn höher zieht, will
  // größere Zeilen, nicht mehr davon.
  const zeilenZahl = Math.max(textSlot.lines ?? zeilen.length, zeilen.length, 1);
  const zeilenHoeheMm = zeilenZahl > 1 ? rect.hMm / zeilenZahl : rect.hMm;
  // Größe, Schnitt und Farbe kommen aus dem Textstil (render/typography.ts);
  // die Renderer bekommen fertige Werte, keine Regeln.
  const ausHoehe = textFontSizePt(zeilenHoeheMm, style);

  // Passt der Satz nicht in die Breite, wird die Schrift kleiner – dieselbe
  // Regel wie im Fuß des Polaroids (`frame.ts`), und aus demselben Grund:
  // Umbrechen bräuchte eine Zeilenlogik, die der Kern nicht hat, und
  // überlaufen ist im Druck ein Fehler. Vorher konnte das kaum auffallen, weil
  // in einem Jahresauftakt „2019" stand; seit der Wortlaut editierbar ist,
  // steht dort auch „2019 – das erste Jahr" und lief über den Falz.
  //
  // Maß nimmt die **längste** Zeile, und die kleinere Größe gilt für alle:
  // Zeilen desselben Textes in zwei Größen wären kein Satz, sondern ein
  // Versehen. `estimatedTextWidthMm` ist bewusst eine Näherung im Kern und
  // nicht die echte Breite eines Adapters – sonst entschiede jeder Adapter
  // anders und die Parität ginge auseinander.
  const laengste = zeilen.reduce((a, b) => (b.length > a.length ? b : a), '');
  const gebraucht = estimatedTextWidthMm(laengste, ausHoehe);
  const fontSizePt =
    gebraucht > rect.wMm && gebraucht > 0 ? ausHoehe * (rect.wMm / gebraucht) : ausHoehe;

  // Gedreht wird um die Mitte des ganzen Kastens, nicht um die jeder Zeile –
  // wie beim Textblock. Bei einem Platz für fünf Zeilen ist das die Mitte des
  // Platzes und nicht die des gesetzten Textes: Sonst wanderte eine gedrehte
  // Ereignisliste, sobald eine Zeile dazukommt.
  const drehung = text.rotateDeg ?? 0;
  const mitte = { xMm: rect.xMm + rect.wMm / 2, yMm: rect.yMm + rect.hMm / 2 };

  return zeilen.map((zeile, i) => ({
    kind: 'text' as const,
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
    ...(drehung !== 0 ? { rotateDeg: drehung, rotateAboutMm: mitte } : {}),
  }));
}

/**
 * Boxen eines von Hand gesetzten Textblocks.
 *
 * Der Zeilenabstand ist das Anderthalbfache der Schriftgröße – ein üblicher
 * Wert für Fließtext, und wichtiger: Er steht hier und nicht in einem Renderer.
 * Sonst entschiede CSS `line-height` gegen pdfkit `lineGap`, und genau das ist
 * die Art Abweichung, die der Parity-Test aufdecken soll.
 *
 * Gedreht wird der ganze Block um seine Mitte, nicht jede Zeile um ihre eigene:
 * Deshalb tragen alle Zeilen denselben Drehpunkt.
 *
 * Exportiert, weil der Editor beim Ziehen an den Griffen dieselben Boxen braucht
 * (`withTextBlock`): Die Regel, wie aus einem Textblock Boxen werden, soll es
 * genau einmal geben – sonst zeigte die Vorschau während des Ziehens etwas
 * anderes als danach.
 */
export function textBlockBoxes(
  block: TextBlock,
  area: TextBlockArea,
  background: string,
): RenderBox[] {
  const zeilen = block.content.split('\n');
  if (zeilen.every((z) => z.trim().length === 0)) return [];

  const rect = {
    xMm: area.bleedMm + block.rect.x * 2 * area.trimWidthMm,
    yMm: area.bleedMm + block.rect.y * area.trimHeightMm,
    wMm: block.rect.w * 2 * area.trimWidthMm,
    hMm: block.rect.h * area.trimHeightMm,
  };
  const zeilenHoeheMm = ptToMm(block.fontSizePt) * 1.5;
  const mitte = { xMm: rect.xMm + rect.wMm / 2, yMm: rect.yMm + rect.hMm / 2 };
  const drehung = block.rotateDeg ?? 0;

  return zeilen.map((zeile, i) => ({
    kind: 'text' as const,
    xMm: rect.xMm,
    yMm: rect.yMm + i * zeilenHoeheMm,
    wMm: rect.wMm,
    hMm: zeilenHoeheMm,
    slotId: zeilen.length > 1 ? `${block.id}-${i}` : block.id,
    content: zeile,
    fontSizePt: block.fontSizePt,
    weight: resolveWeight(block.family ?? 'sans', block.weight),
    ...(block.family && block.family !== 'sans' ? { family: block.family } : {}),
    align: block.align,
    color: block.color ?? textColorOn(background, TEXT_DEFAULT_COLOR),
    ...(drehung !== 0 ? { rotateDeg: drehung, rotateAboutMm: mitte } : {}),
  }));
}

/** Farbe eines Textblocks ohne eigene Wahl: dieselbe wie im Fließtext des Buches. */
const TEXT_DEFAULT_COLOR = '#3f3f46';

/**
 * Die beiden Seitenzahlen dieser Doppelseite – oder keine.
 *
 * Ausgespart bleiben Auftakte und jede Seite, auf der ein Bild bis in den Fuß
 * reicht. Beides aus demselben Grund: Die Zahl ist ein Wegweiser und kein
 * Gestaltungselement. Auf einem Auftakt, der eine Zäsur setzen soll, stört sie;
 * auf einem Bild stünde sie im Motiv, und ob sie dort noch zu lesen ist,
 * entschiede das Foto – die Schriftfarbe kommt aus der **Papierfarbe** und
 * weiß von Bildern nichts.
 *
 * Je Seite geprüft und nicht je Doppelseite: Ein randabfallendes Bild steht
 * meist auf einer von beiden, und die Zahl der anderen soll deshalb nicht
 * mitverschwinden. Nur ein Hintergrundbild nimmt beide – es liegt über die
 * ganze Beschnittfläche und ist damit randabfallend auf jeder Seite.
 */
function buildPageNumbers(
  spread: Spread,
  ctx: RenderContext,
  pn: PageNumberContext,
  background: string,
): RenderBox[] {
  const { profile, template } = ctx;
  if (templateMeta(template.id).chapterOnly) return [];
  if (template.tags?.includes('gruppenauftakt')) return [];
  if (spread.backgroundPhotoId && ctx.photos.has(spread.backgroundPhotoId)) return [];

  // Die tatsächlichen Rechtecke und nicht die der Vorlage: Wer ein Bild von
  // Hand in den Fuß zieht, verdeckt die Zahl genauso. Und nur belegte Plätze —
  // ein leerer Kasten wird nirgends gezeichnet, sein Rechteck bleibt nach einem
  // Umhängen aber stehen und nähme der Seite sonst dauerhaft ihre Zahl.
  const bySlotId = new Map(spread.slots.map((s) => [s.slotId, s]));
  const bilder: Rect[] = [];
  for (const slot of wirksamePlaetze(template, spread)) {
    const zuweisung = bySlotId.get(slot.id);
    const photoId = zuweisung?.photoId;
    if (!photoId || !ctx.photos.has(photoId)) continue;
    bilder.push(toMm(zuweisung.rect ?? slot, profile));
  }

  const verdeckt = (seite: 'links' | 'rechts') => {
    const zahl = pageNumberRect(seite, profile);
    return bilder.some(
      (r) =>
        r.xMm < zahl.xMm + zahl.wMm &&
        r.xMm + r.wMm > zahl.xMm &&
        r.yMm < zahl.yMm + zahl.hMm &&
        r.yMm + r.hMm > zahl.yMm,
    );
  };

  const weglassen = { links: verdeckt('links'), rechts: verdeckt('rechts') };
  if (weglassen.links && weglassen.rechts) return [];

  return pageNumberBoxes(
    {
      // Jede Doppelseite ist zwei Buchseiten – auch die, in der eine leere
      // Halbseite steht. Ein Einschub verschiebt deshalb alles Folgende, und
      // genau das ist der Grund, die Zahl zu rechnen statt zu tippen.
      leftPage: leftPageNumber(spread.index, pn.startAt),
      background,
      weglassen,
    },
    profile,
  );
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

  // Hier genügt die rohe Map: Gefragt ist nur, ob das Foto überhaupt existiert,
  // und daran ändert keine Korrektur etwas.
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

  // Die Randachse liegt im äußeren Sicherheitsrand und kommt deshalb keinem
  // Slot in die Quere – auch nicht dem randabfallenden Gruppenauftakt, den der
  // Fußstrahl meiden muss.
  if (tl.style === 'side') {
    if (!tl.bookYears) return [];
    const sortiertSeitlich = [...dates].sort();
    const mitte = sortiertSeitlich[Math.floor(sortiertSeitlich.length / 2)];

    // **Ein Jahresauftakt steht für den Beginn seines Jahrgangs**, nicht für den
    // Median seiner Bilder: Die wählt die Auflösung und nicht das Datum, und bei
    // neun dichten Auftaktbildern liegt der Median irgendwo im Frühjahr.
    //
    // Vorher entfiel `at` auf einer Auftaktseite ganz – gedacht war „kein
    // Marker" wie am Fuß, gewirkt hat es anders: Am Rand speist dasselbe Datum
    // den Marker **und** den zurückgelegten Abschnitt, also zeigte die
    // Randachse auf jeder Jahresseite einen leeren Balken. Gerade dort ist die
    // Stelle aber exakt bekannt.
    const stelle =
      templateMeta(template.id).chapterOnly && spread.chapterYear !== undefined
        ? (`${spread.chapterYear}-01-01T00:00:00` as NaiveDateTime)
        : mitte;

    return sideTimelineBoxes(
      {
        background,
        fromYear: tl.bookYears.from,
        toYear: tl.bookYears.to,
        ...(stelle ? { at: stelle } : {}),
        accentColor: tl.accentColor ?? accentOn(background),
        ...(tl.sideVariant ? { variant: tl.sideVariant } : {}),
      },
      profile,
    );
  }

  // Reicht ein Slot in den Fußraum, entfällt der Strahl. Die Regel ist aus der
  // Geometrie abgeleitet und gilt damit auch für künftige Vorlagen; heute
  // betrifft sie allein den randabfallenden Gruppenauftakt.
  const footTop = timelineFootTopMm(profile);
  const belegt = template.slots.some((slot) => {
    const rect = toMm(slot, profile);
    return rect.yMm + rect.hMm > footTop;
  });
  if (belegt) return [];

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
      ...(tl.footVariant ? { variant: tl.footVariant } : {}),
      // Die Achse rückt ein, sobald das Buch Seitenzahlen trägt – und zwar auf
      // jeder Doppelseite gleich, auch wo die Zahl gerade entfällt. Eine Achse,
      // die von Seite zu Seite unterschiedlich weit reicht, sähe man beim
      // Blättern zappeln.
      ...(ctx.pageNumbers ? { insetMm: pageNumberInsetMm() } : {}),
    },
    profile,
  );
}
