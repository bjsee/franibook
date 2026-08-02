/**
 * Zeitstrahl am Fuß der Doppelseite.
 *
 * Erzeugt die Boxen, die zeigen, wo im Kalender die Fotos einer Doppelseite
 * liegen: Achse, Jahreszeitenbänder, Jahreszahlen, Spannbalken, Perle und das
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
 * **Marker.** Eine Kapsel über die Spanne der Fotos, darauf die Perle am
 * Median – eine Form, nicht zwei. Der Median der Spannen liegt bei 2,6 Monaten,
 * also gut 84 mm, und 27 von 62 Doppelseiten überschreiten drei Monate: Der
 * Balken ist die Regel, nicht die Ausnahme, und seine Form entscheidet, wie
 * laut der Fuß der Seite spricht. Nur unterhalb eines Perlendurchmessers
 * Spanne entfällt er, weil die Perle ihn ohnehin verdeckt.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { DEFAULT_BACKGROUND, textColorOn } from './background.js';
import type { RenderBox } from './rendered-spread.js';
import { ptToMm } from '../geometry/units.js';
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
 * Die Perle sitzt auf dem Spannbalken, dieser auf der Achse, das Label steht
 * darunter. In der Skizze stand das Label über der Achse; in 14 mm ist dafür
 * kein Platz, ohne die Schrift unlesbar klein zu machen.
 *
 * Die Ticks sind Jahreszeitenbändern gewichen. Siebzehn Härchen von 1,6 mm
 * ergaben auf 584 mm eine Strichelei, die man weder zählt noch liest; ein Band
 * je Jahreszeit beantwortet dagegen ohne eine einzige Beschriftung die Frage,
 * die man an ein Datum wirklich stellt.
 */
const LAYOUT = {
  /** Jahreszahlen, oberhalb des Markers. */
  yearTop: 0,
  yearHeight: 3.2,
  /** Perle am Median: liegt über dem Balken und ragt in die Jahreszahlzeile. */
  beadDiameter: 2.6,
  /** Spannbalken als Kapsel, sitzt unmittelbar auf der Achse auf. */
  barTop: 4,
  barHeight: 1.2,
  /** Die Achse selbst. */
  axisTop: 5.2,
  axisHeight: 0.3,
  /** Jahreszeitenbänder, hinter Achse und Balken. */
  seasonTop: 4.2,
  seasonHeight: 3.4,
  /** Label der Fotogruppe. */
  labelTop: 8.6,
  labelHeight: 4.2,
} as const;

const COLOR_CHAPTER = '#3f3f46';
const COLOR_MARGIN = '#a1a1aa';
const COLOR_ACCENT = '#1d4ed8';
/** Jahreszahlen treten hinter das Label zurück – sie ordnen ein, sie benennen nicht. */
const COLOR_YEAR = '#b3aca2';

/**
 * Die vier Jahreszeiten als Bandfarben, beginnend mit dem Winter.
 *
 * Gegen den Papierton muss jeder Ton für sich erkennbar sein. Ein erster
 * Entwurf lag zwei Prozent daneben: Sichtbar war allein der kühle Winter, den
 * Rest hielt man für Hintergrund – ein Band, das man nicht sieht, ist kein
 * ruhiges Band, sondern gar keins.
 */
const SEASON_TONES = ['#dde3ec', '#dfeadb', '#f7e9c9', '#ecd9cc'] as const;

/**
 * Sperrung des Labels als Anteil der Schriftgröße.
 *
 * Acht Prozent: genug, damit Versalien atmen, zu wenig, um als Effekt
 * aufzufallen. Darüber zerfällt ein kurzer Gruppenname in Einzelbuchstaben.
 */
const LABEL_TRACKING = 0.08;

/** Meteorologische Jahreszeit eines Monats: 0 Winter, 1 Frühling, 2 Sommer, 3 Herbst. */
function seasonOf(month: number): number {
  if (month === 12 || month <= 2) return 0;
  if (month <= 5) return 1;
  if (month <= 8) return 2;
  return 3;
}

export interface TimelineInput {
  /**
   * Hintergrund der Doppelseite. Auf dunklem Grund kehren Achse, Ticks und
   * Beschriftung ihre Helligkeit um, sonst wäre der Zeitstrahl unsichtbar.
   */
  background?: string;
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
  const auf = (farbe: string) => textColorOn(input.background ?? DEFAULT_BACKGROUND, farbe);

  // Jahreszeitenbänder, hinter allem anderen. Sie ersetzen die Monatsticks:
  // Wer auf eine Zeitachse sieht, will nicht wissen, wie viele Monate seither
  // vergangen sind, sondern in welche Zeit das Bild gehört. Die Grenzen sind
  // die meteorologischen, weil sie auf Monatsanfänge fallen – die Achse ist in
  // Monatsfelder geteilt, astronomische Grenzen lägen mitten darin.
  for (let i = 0; i < WINDOW_MONTHS; i++) {
    const monat = (((11 - LEAD_MONTHS + i) % 12) + 12) % 12;
    boxes.push({
      kind: 'rect',
      xMm: x(i),
      // Ein Hauch Überlappung: Zwei exakt aneinandergrenzende Flächen zeigen
      // beim Rastern eine helle Fuge, und im Druck stünde dort das Papier.
      wMm: monthWidth + 0.05,
      yMm: top + LAYOUT.seasonTop,
      hMm: LAYOUT.seasonHeight,
      fill: SEASON_TONES[seasonOf(monat + 1)]!,
    });
  }

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
  axis(axisX0, yearStart, auf(COLOR_MARGIN));
  axis(yearStart, yearEnd, auf(COLOR_CHAPTER));
  axis(yearEnd, axisX1, auf(COLOR_MARGIN));

  // Marker: Kapsel über die Spanne, Perle am Median.
  //
  // Eine Form statt zweier. Der Balken misst die Spanne, die Perle zeigt den
  // Median – als Rechteck mit aufgesetztem Dreieck lasen sich beide als zwei
  // Dinge, die zufällig übereinanderliegen. Runde Enden lohnen erst über die
  // typische Spanne: Der Median liegt bei 2,6 Monaten, also gut 84 mm.
  const akzent = input.accentColor ?? COLOR_ACCENT;
  const markerX = median !== undefined && !input.markerless ? x(offsetOf(median)) : undefined;
  if (markerX !== undefined && first !== undefined && last !== undefined) {
    const x0 = x(offsetOf(first));
    const x1 = x(offsetOf(last));
    // Bei einem einzigen Tag Spanne bliebe ein Strich von 1 mm übrig, den die
    // Perle vollständig verdeckt. Dann ist die Perle allein die Aussage.
    if (x1 - x0 > LAYOUT.beadDiameter) {
      boxes.push({
        kind: 'rect',
        xMm: x0,
        yMm: top + LAYOUT.barTop,
        wMm: x1 - x0,
        hMm: LAYOUT.barHeight,
        rxMm: LAYOUT.barHeight / 2,
        fill: akzent,
      });
    }
    boxes.push({
      kind: 'rect',
      xMm: markerX - LAYOUT.beadDiameter / 2,
      yMm: top + LAYOUT.barTop - LAYOUT.beadDiameter + LAYOUT.barHeight / 2,
      wMm: LAYOUT.beadDiameter,
      hMm: LAYOUT.beadDiameter,
      rxMm: LAYOUT.beadDiameter / 2,
      fill: akzent,
    });
  }

  // Jahreszahlen an den beiden Jahresgrenzen, die immer im Fenster liegen.
  // Überdeckt die Markerspitze eine Zahl, entfällt sie: Der Leser hat noch die
  // andere Zahl und die hell abgesetzten Randmonate.
  const yearStyle = textStyle('timelineYear');
  const yearSize = textFontSizePt(LAYOUT.yearHeight, yearStyle);
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
      yMm: top + LAYOUT.yearTop,
      wMm: breite,
      hMm: LAYOUT.yearHeight,
      slotId: `timeline-year-${wert}`,
      content: String(wert),
      fontSizePt: yearSize,
      weight: yearStyle.weight,
      align: 'left',
      // Leiser als das Label: Die Jahreszahl ordnet ein, sie benennt nicht.
      // Vorher standen beide in derselben Farbe und Größe – drei gleich laute
      // Stimmen auf 14 mm, von denen keine führte.
      color: auf(COLOR_YEAR),
    });
  }

  // Label der Fotogruppe, auf jeder Doppelseite der Gruppe: Ein Fotobuch wird
  // aufgeschlagen, nicht von vorn gelesen.
  //
  // In Versalien und gesperrt, weil es die einzige Stelle im Innenteil ist, die
  // etwas benennt: Gemischtschreibung in 3,5 mm sah aus wie das Kleingedruckte
  // unter einer Grafik. Versalien brauchen die Sperrung – ohne sie stehen sie
  // gedrängt und lesen sich schlechter als Gemischtes.
  if (input.label && markerX !== undefined) {
    const labelStyle = textStyle('timelineLabel');
    const size = textFontSizePt(LAYOUT.labelHeight, labelStyle);
    const versal = input.label.toLocaleUpperCase('de-DE');
    const spacing = ptToMm(size) * LABEL_TRACKING;
    const width = estimatedTextWidthMm(versal, size) + versal.length * spacing;
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
    // Beide Renderer setzen die Sperrung auch hinter das letzte Zeichen. Bei
    // zentriertem Satz steht der Text dadurch um eine halbe Sperrung zu weit
    // links, bei rechtsbündigem um eine ganze. Ausgeglichen wird das hier, in
    // der Box – die Adapter zeichnen weiter nur nach, was im Modell steht, und
    // können deshalb gar nicht auseinanderlaufen.
    const ausgleich = align === 'center' ? spacing / 2 : align === 'right' ? spacing : 0;
    boxes.push({
      kind: 'text',
      xMm: Math.max(axisX0, Math.min(labelX, axisX1 - width)) + ausgleich,
      yMm: top + LAYOUT.labelTop,
      wMm: width,
      hMm: LAYOUT.labelHeight,
      slotId: 'timeline-label',
      content: versal,
      fontSizePt: size,
      weight: labelStyle.weight,
      align,
      color: auf(labelStyle.color),
      letterSpacingMm: spacing,
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
