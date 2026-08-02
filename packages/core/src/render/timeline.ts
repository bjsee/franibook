/**
 * Zeitstrahl am Fuß der Doppelseite.
 *
 * Erzeugt die Boxen, die zeigen, wo im Kalender die Fotos einer Doppelseite
 * liegen: Achse, Monatsticks, Jahreszahlen, Spannbalken, Markerspitze und das
 * Label der Fotogruppe. Wie jede andere Geometrie entsteht sie hier und nicht
 * in einem Renderer.
 *
 * **Fenster.** Immer das Kalenderjahr der Doppelseite plus drei Monate Vorlauf
 * und Nachlauf, zusammen 18 Monate auf 584 mm – also gut 32 mm im Monat, und
 * zwar buchweit gleich. Der Leser lernt den Maßstab einmal und sieht danach auf
 * jeder Seite, ob seit der letzten ein Monat oder ein Jahr vergangen ist. Das
 * Fenster springt nur zum 1. Januar, an einer Grenze also, die der
 * Kapitelauftakt ohnehin setzt; dadurch stehen die Jahreszahlen im ganzen Buch
 * an derselben Stelle.
 *
 * Verworfen wurde ein strikt auf den Median zentriertes Fenster: Dann steht der
 * Marker auf jeder Seite mittig, also genau auf der Falzachse, und es wandern
 * die Jahreszahlen statt des Markers.
 *
 * **Marker.** Immer beides zugleich – ein Balken über die Spanne der Fotos,
 * darauf die Spitze am Median. Die Form ist damit stetig und braucht keinen
 * Grenzwert: Bei einem Tag Spanne bleibt ein Millimeter Fuß unter der Spitze,
 * bei der breitesten gemessenen Doppelseite (11,7 Monate) sind es 374 mm. Eine
 * Schwelle „ab hier Balken statt Spitze“ wäre am Bestand ohnehin die Regel und
 * nicht die Ausnahme: Der Median der Spannen liegt bei 2,6 Monaten, 27 von 62
 * Doppelseiten überschreiten drei Monate.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import type { RenderBox } from './rendered-spread.js';
import { textFontSizePt, textStyle } from './typography.js';

/** Fensterbreite in Monaten: Kalenderjahr plus Vorlauf und Nachlauf. */
const WINDOW_MONTHS = 18;
/** Monate Vorlauf vor dem 1. Januar des Kapiteljahres. */
const LEAD_MONTHS = 3;

/**
 * Höhe des Fußraums.
 *
 * So viel lassen alle 60 Templates unten frei: Sie enden bei 278 mm der
 * 300 mm hohen Referenzseite, der Sicherheitsrand liegt bei 292 mm. Der
 * Zeitstrahl kommt damit ohne eine einzige Templateänderung aus – die Layouts
 * bleiben bitidentisch und das Seitenbudget unberührt.
 */
export const TIMELINE_FOOT_HEIGHT_MM = 14;

/** Oberkante des Fußraums in RSM-Koordinaten. */
export function timelineFootTopMm(profile: PrintProfile): number {
  const { bleedMm, trimHeightMm, safetyMm } = profile.page;
  return bleedMm + trimHeightMm - safetyMm - TIMELINE_FOOT_HEIGHT_MM;
}

/**
 * Aufteilung der 14 mm, gemessen von der Oberkante des Fußraums.
 *
 * Die Spitze sitzt oben und zeigt nach unten auf die Achse, das Label steht
 * darunter. In der Skizze stand das Label über der Achse; in 14 mm ist dafür
 * kein Platz, ohne die Schrift unlesbar klein zu machen.
 */
const LAYOUT = {
  /** Markerspitze und Jahreszahlen. */
  markerTop: 0,
  markerHeight: 4,
  /** Spannbalken, sitzt unmittelbar auf der Achse auf. */
  barTop: 4,
  barHeight: 1.2,
  /** Die Achse selbst. */
  axisTop: 5.2,
  axisHeight: 0.3,
  /** Monatsticks unterhalb der Achse. */
  tickTop: 5.5,
  tickHeight: 1.6,
  tickWidth: 0.3,
  /** Label der Fotogruppe. */
  labelTop: 8.5,
  labelHeight: 3.5,
} as const;

const COLOR_CHAPTER = '#3f3f46';
const COLOR_MARGIN = '#a1a1aa';
const COLOR_ACCENT = '#1d4ed8';

export interface TimelineInput {
  /**
   * Aufnahmedaten der Doppelseite – nur belastbare, also `high` oder `medium`.
   * Ein Dateidatum ist häufig das Kopierdatum und würde den Spannbalken über
   * Jahre aufziehen; die Auswahl trifft der Aufrufer.
   */
  dates: readonly NaiveDateTime[];
  /**
   * Jahr des Fensters, wenn die Doppelseite selbst kein belastbares Datum
   * trägt. Dann bleiben Achse und Ticks stehen, damit die Reihe nicht reißt,
   * und nur der Marker entfällt.
   */
  fallbackYear?: number;
  /** Titel der Fotogruppe, die die meisten Fotos der Doppelseite stellt. */
  label?: string;
  /**
   * Achse ohne Marker. Für Kapitelauftakte: Ihr Bild wird nach Auflösung und
   * Passung gewählt, nicht nach Datum, ein Marker an seinem Datum würde beim
   * Blättern also zurückspringen.
   */
  markerless?: boolean;
  /** Farbe des Markers. Er ist das einzige farbige Element im Innenteil. */
  accentColor?: string;
}

/**
 * Boxen des Zeitstrahls, in Zeichenreihenfolge.
 *
 * Leer, wenn sich kein Jahr bestimmen lässt – ohne Fenster gibt es nichts zu
 * zeichnen.
 */
export function timelineBoxes(input: TimelineInput, profile: PrintProfile): RenderBox[] {
  const sorted = [...input.dates].sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const year = median ? Number(median.slice(0, 4)) : input.fallbackYear;
  if (year === undefined || !Number.isFinite(year)) return [];

  const { bleedMm, trimWidthMm, safetyMm, gutterSafeMm } = profile.page;
  const axisX0 = bleedMm + safetyMm;
  const axisX1 = bleedMm + 2 * trimWidthMm - safetyMm;
  const axisLen = axisX1 - axisX0;
  const gutterX = bleedMm + trimWidthMm;
  const top = timelineFootTopMm(profile);

  // Die Achse ist in 18 gleich breite Monatsfelder geteilt, innerhalb eines
  // Monats wird tagesproportional interpoliert.
  //
  // Der naheliegende Weg – linear in Tagen – wurde verworfen: Dann wäre die
  // Monatsbreite zwischen Februar (29,8 mm) und einem 31-Tage-Monat (33,0 mm)
  // verschieden, die Jahreszahlen stünden je nach Schaltjahr um bis zu 0,6 mm
  // versetzt, und die Falzachse träfe den 1. Juli nur ungefähr. Der Preis ist
  // umgekehrt, dass ein Tag je nach Monat 1,05 bis 1,16 mm entspricht – bei
  // dieser Strichstärke unsichtbar.
  const monthWidth = axisLen / WINDOW_MONTHS;
  const x = (offset: number) => axisX0 + offset * monthWidth;
  /** Monatsfelder ab Fensterbeginn, also ab dem 1. Oktober des Vorjahres. */
  const offsetOf = (value: NaiveDateTime) => {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5, 7));
    const d = Number(value.slice(8, 10));
    const hours = Number(value.slice(11, 13) || '0');
    const minutes = Number(value.slice(14, 16) || '0');
    const feld = (y - (year - 1)) * 12 + (m - (12 - LEAD_MONTHS + 1));
    const anteil = (d - 1 + (hours * 60 + minutes) / 1440) / daysInMonth(y, m);
    return feld + anteil;
  };

  /** Ob eine Position in der Schutzzone der Falzachse liegt. */
  const inGutter = (xMm: number) => Math.abs(xMm - gutterX) <= gutterSafeMm;

  const yearStart = x(LEAD_MONTHS);
  const yearEnd = x(LEAD_MONTHS + 12);

  const boxes: RenderBox[] = [];

  // Achse in drei Segmenten: Vorlauf, Kapiteljahr, Nachlauf. Die Randmonate
  // sind schwächer gezeichnet – so ist zu sehen, wo das Jahr beginnt und
  // endet, ohne den Blick über die Grenze zu verlieren. Die Achse läuft durch
  // den Falz; eine Linie dort ist bei layflat unkritisch.
  const axis = (x0: number, x1: number, fill: string) => {
    boxes.push({
      kind: 'rect',
      xMm: x0,
      yMm: top + LAYOUT.axisTop,
      wMm: x1 - x0,
      hMm: LAYOUT.axisHeight,
      fill,
    });
  };
  axis(axisX0, yearStart, COLOR_MARGIN);
  axis(yearStart, yearEnd, COLOR_CHAPTER);
  axis(yearEnd, axisX1, COLOR_MARGIN);

  // Monatsticks, ohne Beschriftung: abzählbar, aber ruhig. 18 Kürzel je
  // Doppelseite wären auf 85 Seiten zu geschwätzig. Im Falzband entfallen sie –
  // weil das Fenster am 1. Oktober beginnt, liegt die Achsenmitte auf jeder
  // Seite des Buches genau auf dem 1. Juli, und dieser Tick wäre immer verloren.
  for (let i = 1; i < WINDOW_MONTHS; i++) {
    const tickX = x(i);
    if (inGutter(tickX)) continue;
    const imKapiteljahr = i >= LEAD_MONTHS && i < LEAD_MONTHS + 12;
    boxes.push({
      kind: 'rect',
      xMm: tickX - LAYOUT.tickWidth / 2,
      yMm: top + LAYOUT.tickTop,
      wMm: LAYOUT.tickWidth,
      hMm: LAYOUT.tickHeight,
      fill: imKapiteljahr ? COLOR_CHAPTER : COLOR_MARGIN,
    });
  }

  // Marker: Balken über die Spanne, Spitze am Median.
  const markerX = median !== undefined && !input.markerless ? x(offsetOf(median)) : undefined;
  if (markerX !== undefined && first !== undefined && last !== undefined) {
    const x0 = x(offsetOf(first));
    const x1 = x(offsetOf(last));
    if (x1 > x0) {
      boxes.push({
        kind: 'rect',
        xMm: x0,
        yMm: top + LAYOUT.barTop,
        wMm: x1 - x0,
        hMm: LAYOUT.barHeight,
        fill: input.accentColor ?? COLOR_ACCENT,
      });
    }
    const halfWidth = LAYOUT.markerHeight * 0.6;
    const tip = top + LAYOUT.markerTop + LAYOUT.markerHeight;
    boxes.push({
      kind: 'polygon',
      pointsMm: [
        { xMm: markerX - halfWidth, yMm: top + LAYOUT.markerTop },
        { xMm: markerX + halfWidth, yMm: top + LAYOUT.markerTop },
        { xMm: markerX, yMm: tip },
      ],
      fill: input.accentColor ?? COLOR_ACCENT,
    });
  }

  // Jahreszahlen an den beiden Jahresgrenzen, die immer im Fenster liegen.
  // Überdeckt die Markerspitze eine Zahl, entfällt sie: Der Leser hat noch die
  // andere Zahl und die hell abgesetzten Randmonate.
  const yearStyle = textStyle('timelineYear');
  const yearSize = textFontSizePt(LAYOUT.markerHeight, yearStyle);
  for (const [grenze, wert] of [
    [yearStart, year],
    [yearEnd, year + 1],
  ] as const) {
    const boxX = grenze + 1;
    const breite = estimatedTextWidthMm(String(wert), yearSize);
    // Gegen die geschätzte Textbreite geprüft, nicht gegen ein großzügiges
    // Textfeld: Sonst verschwände die Jahreszahl schon, wenn der Marker
    // zwanzig Millimeter entfernt steht.
    if (markerX !== undefined && markerX > boxX - 2 && markerX < boxX + breite) continue;
    if (boxX + breite > axisX1) continue;
    boxes.push({
      kind: 'text',
      xMm: boxX,
      yMm: top + LAYOUT.markerTop,
      wMm: breite,
      hMm: LAYOUT.markerHeight,
      slotId: `timeline-year-${wert}`,
      content: String(wert),
      fontSizePt: yearSize,
      weight: yearStyle.weight,
      align: 'left',
      color: yearStyle.color,
    });
  }

  // Label der Fotogruppe, auf jeder Doppelseite der Gruppe: Ein Fotobuch wird
  // aufgeschlagen, nicht von vorn gelesen.
  if (input.label && markerX !== undefined) {
    const labelStyle = textStyle('timelineLabel');
    const size = textFontSizePt(LAYOUT.labelHeight, labelStyle);
    const width = estimatedTextWidthMm(input.label, size);
    // Zentriert unter dem Marker, außer der Marker steht im Falzband: Dann
    // weicht das Label auf die Seite mit mehr Platz aus. Die Breite ist
    // geschätzt und dient nur dieser Entscheidung – gesetzt wird der Text von
    // beiden Renderern in derselben Box, die Schätzung kann die Parität also
    // nicht verletzen.
    let labelX = markerX - width / 2;
    let align: 'left' | 'center' | 'right' = 'center';
    if (inGutter(markerX)) {
      if (markerX < gutterX) {
        labelX = gutterX - gutterSafeMm - width;
        align = 'right';
      } else {
        labelX = gutterX + gutterSafeMm;
        align = 'left';
      }
    }
    boxes.push({
      kind: 'text',
      xMm: Math.max(axisX0, Math.min(labelX, axisX1 - width)),
      yMm: top + LAYOUT.labelTop,
      wMm: width,
      hMm: LAYOUT.labelHeight,
      slotId: 'timeline-label',
      content: input.label,
      fontSizePt: size,
      weight: labelStyle.weight,
      align,
      color: labelStyle.color,
    });
  }

  return boxes;
}

/**
 * Grobe Textbreite.
 *
 * Eine halbe Geviertbreite je Zeichen ist für Proportionalschriften eine
 * brauchbare Näherung. Sie entscheidet ausschließlich darüber, ob das Label dem
 * Falz ausweicht – für die Position des Textes ist sie unerheblich, weil beide
 * Renderer denselben Text in derselben Box ausrichten.
 */
function estimatedTextWidthMm(text: string, fontSizePtValue: number): number {
  return (text.length * fontSizePtValue * 0.5 * 25.4) / 72;
}

/**
 * Tage eines Monats.
 *
 * Bewusst über `Date.UTC` und nicht über die lokale Zeitzone: Die Zeitangaben
 * des Projekts sind naive lokale Zeit ohne Offset, und eine Sommerzeitgrenze
 * darf die Position eines Markers nicht verschieben. Sonst wäre das Ergebnis von
 * der Zeitzone des rechnenden Systems abhängig – und damit nicht deterministisch.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
