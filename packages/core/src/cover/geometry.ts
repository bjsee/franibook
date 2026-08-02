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
  bleedMm: number;
  wrapMm: number;
  hingeMm: number;
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
  const { wrapMm, hingeMm, safetyMm, bleedMm } = profile.cover;

  const spineMm = spineWidthMm(profile, pageCount);
  const widthMm = coverWidthMm(profile, pageCount);
  const heightMm = coverHeightMm(profile);

  const yMm = bleedMm + wrapMm;
  const hMm = trimHeightMm;

  const xBack = bleedMm + wrapMm;
  const xHingeBack = xBack + trimWidthMm;
  const xSpine = xHingeBack + hingeMm;
  const xHingeFront = xSpine + spineMm;
  const xFront = xHingeFront + hingeMm;

  return {
    widthMm,
    heightMm,
    bleedMm,
    wrapMm,
    hingeMm,
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
 * Nie negativ: Bei einem schmalen Rücken schrumpft der Bereich auf null, statt
 * ein umgekehrtes Rechteck zu liefern, mit dem sich nicht weiterrechnen lässt.
 */
export function safeArea(geo: CoverGeometry, panel: CoverPanelKind): Rect {
  const rect = geo.panels[panel];
  const inset = insetOf(geo, panel);
  return {
    xMm: rect.xMm + inset,
    yMm: rect.yMm + inset,
    wMm: Math.max(0, rect.wMm - 2 * inset),
    hMm: Math.max(0, rect.hMm - 2 * inset),
  };
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
 * Ragt ein Rechteck in eine der beiden Gelenkzonen?
 *
 * Für Bilder ist das erwünscht – sie sollen über den Falz laufen, damit an der
 * Kante kein weißer Streifen entsteht. Für Text ist es ein Befund: dort
 * verschwindet bei der Bindung real Fläche.
 */
export function overlapsHinge(geo: CoverGeometry, rect: Rect): boolean {
  return overlaps(rect, geo.panels['hinge-back']) || overlaps(rect, geo.panels['hinge-front']);
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
