/**
 * Cover-Geometrie.
 *
 * Der Coverbogen ist ein einziges, flach liegendes Blatt. Von links nach
 * rechts liegen darauf fünf Felder:
 *
 * ```
 *  0                                                              widthMm
 *  ├─ Beschnitt ─┬─ Umschlag ─┬────── Rückseite ──────┬─ Gelenk ─┐
 *                                                                │
 *                                     ┌── Rücken ──┬─ Gelenk ─┬──┴── Vorderseite ── Umschlag ── Beschnitt
 * ```
 *
 * Ursprung ist – wie beim Innenteil (`render/rendered-spread.ts`) – die obere
 * linke Ecke der **Beschnittfläche**, nicht der sichtbaren Kante. Damit liegen
 * alle Boxen im positiven Bereich, auch randabfallende.
 *
 * Sämtliche Maße kommen aus dem `PrintProfile`. Diese Datei enthält keine
 * einzige Zahl, die einen Druckdienstleister beschreibt – die Rückenbreite
 * hängt allein an `cover.spine` und an der Seitenzahl. Solange
 * `provenance.verifiedAt` null ist, sind die Ergebnisse deshalb genau so
 * unverifiziert wie das Profil selbst; der Export weist darauf hin.
 */
import type { PrintProfile } from '../print/profile.js';
import { coverHeightMm, coverWidthMm, spineWidthMm } from '../print/profile.js';
import type { Rect } from '../render/rendered-spread.js';

/** Die fünf Felder des Bogens, in Leserichtung des flach liegenden Blatts. */
export type CoverPanelKind = 'back' | 'hinge-back' | 'spine' | 'hinge-front' | 'front';

export interface CoverGeometry {
  /** Gesamtbreite des Bogens einschließlich Umschlag und Beschnitt. */
  widthMm: number;
  /** Gesamthöhe des Bogens einschließlich Umschlag und Beschnitt. */
  heightMm: number;
  /** Beschnitt an den seitlichen Kanten – der Ursprung der x-Achse. */
  bleedMm: number;
  /** Beschnitt an Ober- und Unterkante; beim Anbieter kleiner als seitlich. */
  bleedTopMm: number;
  overhangSideMm: number;
  overhangTopMm: number;
  hingeMm: number;
  /**
   * Warnzone links und rechts des Rückens (Falzbereich des Anbieters).
   *
   * Sie ist breiter als das Gelenk und ragt deshalb in die Deckelflächen
   * hinein – anders als `hingeMm`, das ein eigenes Feld des Bogens ist.
   */
  hingeSafeMm: number;
  /** Sicherheitsabstand ab sichtbarer Kante, gilt für Vorder- und Rückseite. */
  safetyMm: number;
  /**
   * Toleranz an den beiden Rückenkanten.
   *
   * Bewusst `cover.bleedMm` und nicht `cover.safetyMm`: Der
   * Sicherheitsabstand von 10 mm beschreibt die Außenkanten und wäre auf einem
   * 6 mm breiten Rücken sinnlos. Der Beschnitt ist die einzige Zahl im Profil,
   * die überhaupt eine Fertigungstoleranz benennt.
   */
  spineToleranceMm: number;
  /** Rückenbreite zu genau dieser Seitenzahl. */
  spineMm: number;
  pageCount: number;
  panels: Record<CoverPanelKind, Rect>;
  /**
   * Falzlinien, von der linken Beschnittkante gemessen, aufsteigend: die
   * beiden Gelenkkanten der Rückseite und die beiden der Vorderseite.
   */
  foldsXMm: number[];
  /** Sichtbare Fläche: Bogen ohne Beschnitt und ohne Umschlag. */
  visible: Rect;
}

/**
 * Rechnet die vollständige Cover-Geometrie aus Profil und Seitenzahl.
 *
 * Die Seitenzahl ist der einzige veränderliche Eingang: Jede Änderung am
 * Innenteil verschiebt den Rücken und damit alles, was rechts davon liegt.
 * Deshalb wird die Geometrie nicht gespeichert, sondern immer neu gerechnet.
 */
export function coverGeometry(profile: PrintProfile, pageCount: number): CoverGeometry {
  const { trimWidthMm, trimHeightMm } = profile.page;
  const { overhang, hingeMm, hingeSafeMm, safetyMm, bleed } = profile.cover;
  const bleedMm = bleed.sideMm;

  const spineMm = spineWidthMm(profile, pageCount);
  const widthMm = coverWidthMm(profile, pageCount);
  const heightMm = coverHeightMm(profile);

  const yMm = bleed.topMm + overhang.topMm;
  const hMm = trimHeightMm;

  const xBack = bleedMm + overhang.sideMm;
  const xHingeBack = xBack + trimWidthMm;
  const xSpine = xHingeBack + hingeMm;
  const xHingeFront = xSpine + spineMm;
  const xFront = xHingeFront + hingeMm;

  return {
    widthMm,
    heightMm,
    bleedMm,
    bleedTopMm: bleed.topMm,
    overhangSideMm: overhang.sideMm,
    overhangTopMm: overhang.topMm,
    hingeMm,
    hingeSafeMm,
    safetyMm,
    spineToleranceMm: bleedMm,
    spineMm,
    pageCount,
    panels: {
      back: { xMm: xBack, yMm, wMm: trimWidthMm, hMm },
      'hinge-back': { xMm: xHingeBack, yMm, wMm: hingeMm, hMm },
      spine: { xMm: xSpine, yMm, wMm: spineMm, hMm },
      'hinge-front': { xMm: xHingeFront, yMm, wMm: hingeMm, hMm },
      front: { xMm: xFront, yMm, wMm: trimWidthMm, hMm },
    },
    foldsXMm: [xHingeBack, xSpine, xHingeFront, xFront],
    visible: {
      xMm: xBack,
      yMm,
      wMm: 2 * trimWidthMm + 2 * hingeMm + spineMm,
      hMm,
    },
  };
}

/** Inset eines Feldes: der Rücken hat seine eigene, kleinere Toleranz. */
function insetOf(geo: CoverGeometry, panel: CoverPanelKind): number {
  return panel === 'spine' ? geo.spineToleranceMm : geo.safetyMm;
}

/**
 * Bereich eines Feldes, in dem Text unbedenklich steht.
 *
 * An der Rückenseite von Vorder- und Rückseite ist der Abstand größer als der
 * Sicherheitsabstand, wenn der Falzbereich über das schmale Gelenkfeld hinaus
 * in die Deckelfläche greift: Beim gemessenen 28×28 sind das bei 160 Seiten
 * 17 mm Falz gegen 10 mm Sicherheitsabstand. Ohne diese Unterscheidung stünde
 * die Beschriftung rechnerisch sicher und real im Falz.
 *
 * Nie negativ: Bei einem schmalen Rücken schrumpft der Bereich auf null, statt
 * ein umgekehrtes Rechteck zu liefern, mit dem sich nicht weiterrechnen lässt.
 */
export function safeArea(geo: CoverGeometry, panel: CoverPanelKind): Rect {
  const rect = geo.panels[panel];
  const inset = insetOf(geo, panel);
  const falzUeberstand = Math.max(0, geo.hingeSafeMm - geo.hingeMm);
  const links = panel === 'front' ? Math.max(inset, falzUeberstand) : inset;
  const rechts = panel === 'back' ? Math.max(inset, falzUeberstand) : inset;
  return {
    xMm: rect.xMm + links,
    yMm: rect.yMm + inset,
    wMm: Math.max(0, rect.wMm - links - rechts),
    hMm: Math.max(0, rect.hMm - 2 * inset),
  };
}

/**
 * Die Fläche, über die ein Umschlagbild randabfallend läuft.
 *
 * **Nicht das Feld selbst.** Ein Titelbild endet nicht an der sichtbaren
 * Vorderkante, sondern läuft über die Gelenkzone bis zur Blattkante — sonst
 * zeigte jede Falztoleranz einen weißen Streifen. Wer das Bild vorbereitet
 * (etwa ein Mosaik, das die Form dieser Fläche haben muss), braucht dieselbe
 * Rechnung wie der, der es platziert; zweimal geschrieben wären es zwei
 * Seitenverhältnisse und eine gestauchte Ziffer.
 */
export function coverImageArea(geo: CoverGeometry, panel: 'front' | 'back'): Rect {
  if (panel === 'front') {
    const xMm = geo.panels['hinge-front'].xMm;
    return { xMm, yMm: 0, wMm: geo.widthMm - xMm, hMm: geo.heightMm };
  }
  return { xMm: 0, yMm: 0, wMm: geo.panels.spine.xMm, hMm: geo.heightMm };
}

/** In welchem Feld liegt eine x-Koordinate? */
export function panelAt(geo: CoverGeometry, xMm: number): CoverPanelKind | undefined {
  const order: CoverPanelKind[] = ['back', 'hinge-back', 'spine', 'hinge-front', 'front'];
  for (const kind of order) {
    const p = geo.panels[kind];
    if (xMm >= p.xMm && xMm < p.xMm + p.wMm) return kind;
  }
  return undefined;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.xMm < b.xMm + b.wMm && a.xMm + a.wMm > b.xMm && a.yMm < b.yMm + b.hMm && a.yMm + a.hMm > b.yMm
  );
}

/**
 * Die beiden Falzbereiche: ab Rückenkante nach außen, `hingeSafeMm` breit.
 *
 * Sie enthalten die schmalen Gelenkfelder und greifen darüber hinaus auf die
 * Deckelflächen über – so gibt der Anbieter sie an. Deshalb sind sie keine
 * Felder des Bogens, sondern eine Zone darüber.
 */
export function hingeSafeZones(geo: CoverGeometry): [Rect, Rect] {
  const spine = geo.panels.spine;
  const breite = Math.max(geo.hingeSafeMm, geo.hingeMm);
  return [
    { xMm: spine.xMm - breite, yMm: spine.yMm, wMm: breite, hMm: spine.hMm },
    { xMm: spine.xMm + spine.wMm, yMm: spine.yMm, wMm: breite, hMm: spine.hMm },
  ];
}

/**
 * Ragt ein Rechteck in einen der beiden Falzbereiche?
 *
 * Für Bilder ist das erwünscht – sie sollen über den Falz laufen, damit an der
 * Kante kein weißer Streifen entsteht. Für Text ist es ein Befund: dort
 * verschwindet bei der Bindung real Fläche.
 */
export function overlapsHinge(geo: CoverGeometry, rect: Rect): boolean {
  const [links, rechts] = hingeSafeZones(geo);
  return overlaps(rect, links) || overlaps(rect, rechts);
}

/** Liegt `inner` vollständig in `outer`? Toleranz gegen Rundungsreste. */
export function containsRect(outer: Rect, inner: Rect, epsMm = 1e-6): boolean {
  return (
    inner.xMm >= outer.xMm - epsMm &&
    inner.yMm >= outer.yMm - epsMm &&
    inner.xMm + inner.wMm <= outer.xMm + outer.wMm + epsMm &&
    inner.yMm + inner.hMm <= outer.yMm + outer.hMm + epsMm
  );
}
