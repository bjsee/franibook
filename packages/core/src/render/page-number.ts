/**
 * Die Seitenzahl im Fuß der Buchseite.
 *
 * Sie ist die Voraussetzung für alles, was auf eine Seite verweist – eine
 * Jahresübersicht vorn, ein Ortsregister hinten, ein Verweis in einer
 * Bildunterschrift. Ohne sie steht `pageNumber` nur in der Budgetrechnung.
 *
 * **Die Zahl wird gerechnet, nicht gesetzt.** Sie ergibt sich aus dem Platz der
 * Doppelseite im Buch (`Spread.index`) und der Seitenparität; kein Feld im
 * Modell hält sie fest. Damit stimmt sie nach jedem Einschub von selbst – und
 * ein Einschub verschiebt tatsächlich alle folgenden Zahlen, denn gezählt wird
 * die Buchseite und nicht das Blatt.
 *
 * **Ort: der Fußraum, außen.** Dieselbe Zeile, in der auch der Fußstrahl sitzt –
 * es ist der einzige Streifen der Seite, den keine Vorlage belegt, und die
 * Sicherheitszone endet unmittelbar darunter. Weiter zur Papierkante wäre
 * typografisch schöner und im Druck ein Risiko: Der Abnahmebericht meldete es
 * zu Recht. Der Fußstrahl macht dafür Platz (`pageNumberInsetMm`), statt dass
 * die Zahl ihm ausweicht: Die Achse ist eine Fläche, die Zahl ein Punkt, und
 * eine Achse, die von Seite zu Seite unterschiedlich weit reicht, sähe man beim
 * Blättern zappeln.
 */
import type { PrintProfile } from '../print/profile.js';
import { textColorOn } from './background.js';
import type { RenderBox } from './rendered-spread.js';
import { TEXT_STYLES, estimatedTextWidthMm, textFontSizePt } from './typography.js';

/**
 * Kennung der beiden Boxen (`page-number-left`, `page-number-right`).
 *
 * Als Präfix und neben den Kennungen, aus demselben Grund wie beim Zeitstrahl:
 * Der Abnahmebericht entscheidet daran, ob ein Textfund eine Rechnung der
 * Engine ist – und damit über alle Doppelseiten **ein** Fund – oder Handarbeit
 * auf dieser einen Seite.
 */
export const PAGE_NUMBER_SLOT_PREFIX = 'page-number';

/**
 * Höhe des Kastens und damit die Schriftgröße: 4,2 mm ergeben 8,33 pt.
 *
 * Genau die Kastenhöhe des Fußstrahl-Labels in der Vorgabefassung
 * (`FOOT_LAYOUT.classic.label`, aus `LAYOUT.labelHeight`), und das ist Absicht:
 * Beide stehen in derselben Zeile, und zwei fast gleiche Grade nebeneinander
 * liest man als Versehen. Was nicht übereinstimmt, ist die Grundlinie – das
 * Label sitzt 1,2 mm höher, und in den drei anderen Fassungen wieder anders.
 * Die Zahl hängt bewusst nicht daran: Sie steht an der Sicherheitslinie, und
 * die gibt es auch ohne Zeitstrahl.
 */
const HOEHE_MM = 4.2;

/**
 * Breite, die für die Zahl freigehalten wird.
 *
 * Gerechnet für drei Ziffern, obwohl das größte Profil bei 160 Seiten steht:
 * Die Zahl bleibt damit an derselben Stelle stehen, wenn das Buch von 99 auf
 * 100 Seiten wächst. Eine mitwachsende Breite hieße, dass die Achse des
 * Fußstrahls im Buch zweimal unterschiedlich weit reicht.
 */
function zahlenbreiteMm(): number {
  return estimatedTextWidthMm('888', textFontSizePt(HOEHE_MM, TEXT_STYLES.pageNumber));
}

/**
 * Abstand zwischen Zahl und Fußstrahl.
 *
 * Zwei Millimeter genügen, weil die Zahl rechts- bzw. linksbündig an der
 * Satzspiegelkante steht und ihre geschätzte Breite (`estimatedTextWidthMm`)
 * für eine dreistellige Zahl eher zu groß ausfällt als zu klein.
 */
const LUFT_MM = 2;

/**
 * Was der Fußstrahl je Seite einrückt, damit die Zahl daneben Platz hat.
 *
 * `0`, solange keine Seitenzahlen gesetzt werden – dann liegt die Achse wie
 * bisher, und ein Buch ohne Zahlen zeichnet bitgleich wie vor dieser Rechnung.
 */
export function pageNumberInsetMm(): number {
  return zahlenbreiteMm() + LUFT_MM;
}

export interface PageNumberInput {
  /** Buchseitenzahl der linken Seite dieser Doppelseite. */
  leftPage: number;
  /** Hintergrund der Doppelseite – auf dunklem Grund kehrt die Schrift um. */
  background?: string;
  /**
   * Auf welchen Seiten die Zahl entfällt.
   *
   * Je Seite und nicht je Doppelseite: Ein randabfallendes Bild steht meist auf
   * einer von beiden, und die andere Zahl soll deshalb nicht mit verschwinden.
   */
  weglassen?: { links?: boolean; rechts?: boolean };
}

/** Die Boxen der beiden Seitenzahlen, in Zeichenreihenfolge. */
export function pageNumberBoxes(input: PageNumberInput, profile: PrintProfile): RenderBox[] {
  const { bleedMm, trimWidthMm, trimHeightMm, safetyMm } = profile.page;
  const style = TEXT_STYLES.pageNumber;
  const fontSizePt = textFontSizePt(HOEHE_MM, style);
  const breiteMm = zahlenbreiteMm();
  const color = textColorOn(input.background ?? '#ffffff', style.color);

  // Die Grundlinie sitzt so tief, wie die Sicherheitszone es zulässt: Ihre
  // Unterkante *ist* die Sicherheitslinie.
  const yMm = bleedMm + trimHeightMm - safetyMm - HOEHE_MM;
  const linksXMm = bleedMm + safetyMm;
  const rechtsXMm = bleedMm + 2 * trimWidthMm - safetyMm - breiteMm;

  const boxes: RenderBox[] = [];
  if (!input.weglassen?.links) {
    boxes.push({
      kind: 'text',
      xMm: linksXMm,
      yMm,
      wMm: breiteMm,
      hMm: HOEHE_MM,
      slotId: `${PAGE_NUMBER_SLOT_PREFIX}-left`,
      content: String(input.leftPage),
      fontSizePt,
      weight: style.weight,
      align: 'left',
      color,
    });
  }
  if (!input.weglassen?.rechts) {
    boxes.push({
      kind: 'text',
      xMm: rechtsXMm,
      yMm,
      wMm: breiteMm,
      hMm: HOEHE_MM,
      slotId: `${PAGE_NUMBER_SLOT_PREFIX}-right`,
      content: String(input.leftPage + 1),
      fontSizePt,
      weight: style.weight,
      align: 'right',
      color,
    });
  }
  return boxes;
}

/**
 * Die Nummer der linken Buchseite einer Doppelseite.
 *
 * **Die eine Rechnung**, die alle benutzen, die eine Seitenzahl nennen: der Fuß
 * im Buch und die Beschriftung des Korrekturabzugs (`pruefung/abzug.ts`).
 * Zweimal `2 * index + 1` zu schreiben ginge gut, bis jemand `startAt` setzt –
 * und dann stünde auf dem Blatt, auf dem man „Seite 44, das Bild raus" notiert,
 * eine andere Zahl als im Buch.
 */
export function leftPageNumber(spreadIndex: number, startAt = 1): number {
  return startAt + 2 * spreadIndex;
}

/** Das Rechteck, das eine der beiden Zahlen belegt – für die Kollisionsprüfung. */
export function pageNumberRect(
  seite: 'links' | 'rechts',
  profile: PrintProfile,
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const { bleedMm, trimWidthMm, trimHeightMm, safetyMm } = profile.page;
  const breiteMm = zahlenbreiteMm();
  return {
    xMm: seite === 'links' ? bleedMm + safetyMm : bleedMm + 2 * trimWidthMm - safetyMm - breiteMm,
    yMm: bleedMm + trimHeightMm - safetyMm - HOEHE_MM,
    wMm: breiteMm,
    hMm: HOEHE_MM,
  };
}
