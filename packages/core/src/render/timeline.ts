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
 *
 * **Vier Fassungen.** Fenster, Maßstab und Marker sind allen gemeinsam, die
 * Zeichnung darunter nicht: `classic` ist die erste, leise Fassung – 584 mm
 * breit und kein Element höher als 3,4 mm. Die drei anderen nehmen den Fußraum
 * ernster, jede mit einer anderen Antwort darauf, was ein Datum sichtbar macht:
 * `band` die Jahreszeit, `ruler` den Monat, `ribbon` das Kapiteljahr als
 * Fläche. Es ist eine Wahl und keine Verbesserung, deshalb bleibt `classic`
 * unverändert erhalten – Maße und Begründung in `docs/zeitleisten-fassungen.md`.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { DEFAULT_BACKGROUND, luminance, textColorOn } from './background.js';
import type { RenderBox } from './rendered-spread.js';
import { ptToMm } from '../geometry/units.js';
import { capHeightMm, estimatedTextWidthMm, textFontSizePt, textStyle } from './typography.js';

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
 * bleiben bitidentisch und das Seitenbudget unberührt. Auch die drei neuen
 * Fassungen bleiben darin; keine von ihnen kostet eine Vorlage.
 */
export const TIMELINE_FOOT_HEIGHT_MM = 14;

/** Oberkante des Fußraums in RSM-Koordinaten. */
export function timelineFootTopMm(profile: PrintProfile): number {
  const { bleedMm, trimHeightMm, safetyMm } = profile.page;
  return bleedMm + trimHeightMm - safetyMm - TIMELINE_FOOT_HEIGHT_MM;
}

/** Die Fassungen des Fußstrahls. `classic` ist die Vorgabe und der Bestand. */
export const TIMELINE_FOOT_VARIANTS = ['classic', 'band', 'ruler', 'ribbon'] as const;

export type TimelineFootVariant = (typeof TIMELINE_FOOT_VARIANTS)[number];

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
 * Dieselben vier Jahreszeiten für `band`, um zwei Stufen kräftiger.
 *
 * Dort sind die Bänder 6 mm hoch statt 3,4 und tragen die Fassung; in den
 * Tönen von `classic`, die hinter einer Achse liegen sollten, wirkte die
 * Fläche gewaschen.
 */
const SEASON_TONES_BAND = ['#c9d5e4', '#cfe0c5', '#f0dda9', '#e5c8b2'] as const;

/**
 * Und dieselben auf dunklem Grund.
 *
 * Nicht über `textColorOn` gerechnet: Das kehrt Helligkeiten für Schrift um und
 * liefert für eine Fläche entweder Weiß oder den Ausgangston. Ein Jahreszeitband
 * muss sich vom Anthrazit abheben und darf ihn trotzdem nicht überstrahlen –
 * das sind eigene Werte, keine Umrechnung.
 */
const SEASON_TONES_DARK = ['#4a5563', '#4d5b48', '#6b6039', '#644f43'] as const;

/** Fläche des Jahresbandes (`ribbon`) auf hellem und auf dunklem Grund. */
const RIBBON_FILL = '#cfc6b8';
const RIBBON_FILL_DARK = '#5a544f';

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

/** Eine Textzeile im Fußraum: Kasten und Schriftgröße. */
interface FootLine {
  /** Oberkante des Kastens, ab der Oberkante des Fußraums. */
  topMm: number;
  /** Kastenhöhe. Beide Renderer zentrieren das Versalband darin. */
  heightMm: number;
  fontSizePt: number;
}

/**
 * Textkasten aus der Mitte seines Versalbands.
 *
 * Die Vorlage gibt für die neuen Fassungen die Mitte an und nicht die
 * Oberkante: Auf 14 mm entscheidet die Lage des Versalbands, nicht die eines
 * Kastens, den niemand sieht. Der Kasten ist deshalb genau so hoch wie das
 * Versalband – `textBaselineOffsetMm` setzt es mittig, bei dieser Höhe also
 * bündig, und beide Renderer lesen dieselbe Zahl aus dem RSM. Mit der Em-Höhe
 * ragte die 14-pt-Zahl der Monatsleiter rechnerisch aus dem Fußraum, ohne dass
 * ein Zeichen darüber stand.
 */
function zeile(mitteMm: number, fontSizePt: number): FootLine {
  const heightMm = capHeightMm(fontSizePt);
  return { topMm: mitteMm - heightMm / 2, heightMm, fontSizePt };
}

/**
 * Was allen vier Fassungen gemeinsam ist: Marker, Jahreszahlen, Label.
 *
 * Die Zeichnung darunter unterscheidet sie, diese drei Elemente nicht – sie
 * wandern nur. Deshalb stehen ihre Maße hier als Tabelle und nicht in vier
 * Zeichenroutinen.
 */
interface FootLayout {
  /** Spannbalken: Oberkante, Höhe. Der Eckenradius ist die halbe Höhe. */
  barTop: number;
  barHeight: number;
  /** Perle am Median: Oberkante und Durchmesser. */
  beadTop: number;
  beadDiameter: number;
  year: FootLine;
  label: FootLine;
}

const yearStyle = textStyle('timelineYear');
const labelStyle = textStyle('timelineLabel');

const FOOT_LAYOUT: Record<TimelineFootVariant, FootLayout> = {
  // Der Bestand, unverändert: Die Werte kommen weiter aus `LAYOUT`, damit hier
  // keine zweite Wahrheit über dieselbe Geometrie entsteht.
  classic: {
    barTop: LAYOUT.barTop,
    barHeight: LAYOUT.barHeight,
    beadTop: LAYOUT.barTop - LAYOUT.beadDiameter + LAYOUT.barHeight / 2,
    beadDiameter: LAYOUT.beadDiameter,
    year: {
      topMm: LAYOUT.yearTop,
      heightMm: LAYOUT.yearHeight,
      fontSizePt: textFontSizePt(LAYOUT.yearHeight, yearStyle),
    },
    label: {
      topMm: LAYOUT.labelTop,
      heightMm: LAYOUT.labelHeight,
      fontSizePt: textFontSizePt(LAYOUT.labelHeight, labelStyle),
    },
  },
  // Kalenderband: Die Jahreszeiten tragen die Fassung, die Achse ist nur noch
  // Grundlinie darunter. Der Marker steht darüber und braucht deshalb mehr
  // Gewicht als in `classic` – 2,2 mm Balken und eine Perle von 3,4 mm.
  band: {
    barTop: 2.9,
    barHeight: 2.2,
    beadTop: 1.2,
    beadDiameter: 3.4,
    year: zeile(2.0, 11),
    label: zeile(12.4, 8),
  },
  // Monatsleiter: hängende Zähne an jeder Monatsgrenze, ohne Jahreszeiten. Die
  // Jahreszahl steht mit 14 pt so groß wie nirgends sonst im Innenteil – sie
  // ist hier das einzige, was einordnet.
  ruler: {
    barTop: 4.0,
    barHeight: 2.2,
    beadTop: 0.6,
    beadDiameter: 3.4,
    year: zeile(2.4, 14),
    label: zeile(12.6, 8),
  },
  // Jahresband: das Kapiteljahr als Fläche, die Randmonate nur als Linie. Die
  // Jahreszahl liegt ausgespart in der Fläche, nicht über ihr.
  ribbon: {
    barTop: 2.6,
    barHeight: 2.0,
    beadTop: 1.0,
    beadDiameter: 3.2,
    year: zeile(7.3, 9),
    label: zeile(12.6, 8),
  },
};

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
  /** Fassung der Zeichnung. Ohne Angabe der Bestand. */
  variant?: TimelineFootVariant;
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

  const variant = input.variant ?? 'classic';
  const L = FOOT_LAYOUT[variant];

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
  const papier = input.background ?? DEFAULT_BACKGROUND;
  const auf = (farbe: string) => textColorOn(papier, farbe);
  // Dieselbe Schwelle wie `textColorOn` und `accentOn`: Was für die Schrift
  // dunkel ist, ist es auch für eine Fläche.
  const dunkel = luminance(papier) <= 0.45;

  const ctx: FootContext = { top, axisX0, axisX1, monthWidth, x, auf, papier, dunkel };

  // Der Grund: was die Fassung ausmacht. Alles Weitere – Marker, Jahreszahlen,
  // Label – liegt darüber und ist allen vier gemeinsam.
  if (variant === 'band') grundBand(boxes, ctx);
  else if (variant === 'ruler') grundRuler(boxes, ctx);
  else if (variant === 'ribbon') grundRibbon(boxes, ctx);
  else grundClassic(boxes, ctx, yearStart, yearEnd);

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
    if (x1 - x0 > L.beadDiameter) {
      boxes.push({
        kind: 'rect',
        xMm: x0,
        yMm: top + L.barTop,
        wMm: x1 - x0,
        hMm: L.barHeight,
        rxMm: L.barHeight / 2,
        fill: akzent,
      });
    }
    boxes.push({
      kind: 'rect',
      xMm: markerX - L.beadDiameter / 2,
      yMm: top + L.beadTop,
      wMm: L.beadDiameter,
      hMm: L.beadDiameter,
      rxMm: L.beadDiameter / 2,
      fill: akzent,
    });
  }

  boxes.push(...jahreszahlen(variant, L, ctx, year, yearStart, yearEnd, markerX));

  // Label der Fotogruppe, auf jeder Doppelseite der Gruppe: Ein Fotobuch wird
  // aufgeschlagen, nicht von vorn gelesen.
  //
  // In Versalien und gesperrt, weil es die einzige Stelle im Innenteil ist, die
  // etwas benennt: Gemischtschreibung in 3,5 mm sah aus wie das Kleingedruckte
  // unter einer Grafik. Versalien brauchen die Sperrung – ohne sie stehen sie
  // gedrängt und lesen sich schlechter als Gemischtes.
  if (input.label && markerX !== undefined) {
    const size = L.label.fontSizePt;
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
      yMm: top + L.label.topMm,
      wMm: width,
      hMm: L.label.heightMm,
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

/** Was die vier Zeichenroutinen von der Doppelseite wissen müssen. */
interface FootContext {
  /** Oberkante des Fußraums in RSM-Koordinaten. */
  top: number;
  axisX0: number;
  axisX1: number;
  monthWidth: number;
  /** Position einer Monatsfeldgrenze, in Feldern ab Fensterbeginn. */
  x: (offset: number) => number;
  /** Farbe, auf diesem Hintergrund lesbar gemacht. */
  auf: (farbe: string) => string;
  /** Die Papierfarbe selbst – Fugen und ausgesparte Schrift stehen darin. */
  papier: string;
  dunkel: boolean;
}

/**
 * `classic`: Jahreszeitenbänder hinter einer dreigeteilten Achse.
 */
function grundClassic(
  boxes: RenderBox[],
  { top, axisX0, axisX1, monthWidth, x, auf }: FootContext,
  yearStart: number,
  yearEnd: number,
): void {
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
}

/**
 * `band`: dasselbe Kalenderband, nur ernst gemeint.
 *
 * Sechs Millimeter hohe Jahreszeitenfelder mit Fugen in Papierfarbe, darunter
 * eine durchgehende Grundlinie. Die Fugen sind ausgespart und nicht gezeichnet:
 * Eine Trennlinie in Grau ergäbe auf 584 mm siebzehn weitere Striche, genau die
 * Strichelei, aus der `classic` schon einmal herausgewachsen ist.
 */
function grundBand(
  boxes: RenderBox[],
  { top, axisX0, axisX1, monthWidth, x, auf, papier, dunkel }: FootContext,
): void {
  const toene = dunkel ? SEASON_TONES_DARK : SEASON_TONES_BAND;
  for (let i = 0; i < WINDOW_MONTHS; i++) {
    const monat = (((11 - LEAD_MONTHS + i) % 12) + 12) % 12;
    boxes.push({
      kind: 'rect',
      xMm: x(i),
      wMm: monthWidth + 0.05,
      yMm: top + 4.0,
      hMm: 6.0,
      fill: toene[seasonOf(monat + 1)]!,
    });
  }

  for (let i = 1; i < WINDOW_MONTHS; i++) {
    boxes.push({
      kind: 'rect',
      xMm: x(i) - 0.1,
      wMm: 0.2,
      yMm: top + 4.0,
      hMm: 6.0,
      fill: papier,
    });
  }

  boxes.push({
    kind: 'rect',
    xMm: axisX0,
    yMm: top + 10.0,
    wMm: axisX1 - axisX0,
    hMm: 0.4,
    fill: auf(COLOR_CHAPTER),
  });
}

/**
 * `ruler`: Monatsleiter, ganz ohne Farbe.
 *
 * Zähne hängen an der Grundlinie, lang über die zwölf Monate des Kapiteljahres
 * und kurz über Vor- und Nachlauf. Das ersetzt die dreigeteilte Achse von
 * `classic`: Die Jahresgrenze steht dort, wo der Zahn seine Länge wechselt, und
 * dafür braucht es keinen zweiten Grauwert in der Linie selbst.
 */
function grundRuler(boxes: RenderBox[], { top, axisX0, axisX1, x, auf }: FootContext): void {
  boxes.push({
    kind: 'rect',
    xMm: axisX0,
    yMm: top + 6.6,
    wMm: axisX1 - axisX0,
    hMm: 0.35,
    fill: auf(COLOR_CHAPTER),
  });

  for (let i = 0; i <= WINDOW_MONTHS; i++) {
    const imJahr = i >= LEAD_MONTHS && i <= LEAD_MONTHS + 12;
    boxes.push({
      kind: 'rect',
      xMm: x(i) - 0.175,
      yMm: top + 6.6,
      wMm: 0.35,
      hMm: imJahr ? 4.4 : 1.9,
      fill: auf(imJahr ? COLOR_CHAPTER : COLOR_MARGIN),
    });
  }
}

/**
 * `ribbon`: das Kapiteljahr als Fläche.
 *
 * Die zwölf Monate stehen als ein Band, die Randmonate nur noch als Linie auf
 * seiner Höhe. Damit beantwortet die Fassung eine andere Frage als die beiden
 * anderen: nicht „welcher Monat", sondern „im Jahr oder daneben".
 */
function grundRibbon(
  boxes: RenderBox[],
  { top, axisX0, axisX1, x, auf, papier, dunkel }: FootContext,
): void {
  const von = x(LEAD_MONTHS);
  const bis = x(LEAD_MONTHS + 12);

  boxes.push({
    kind: 'rect',
    xMm: von,
    yMm: top + 3.6,
    wMm: bis - von,
    hMm: 7.4,
    fill: dunkel ? RIBBON_FILL_DARK : RIBBON_FILL,
  });

  for (let i = 1; i < 12; i++) {
    boxes.push({
      kind: 'rect',
      xMm: x(LEAD_MONTHS + i) - 0.125,
      yMm: top + 3.6,
      wMm: 0.25,
      hMm: 7.4,
      fill: papier,
    });
  }

  // Vor- und Nachlauf: eine blasse Linie auf der Unterkante des Bandes, damit
  // die Achse nicht an der Jahresgrenze abbricht.
  for (const [x0, x1] of [
    [axisX0, von],
    [bis, axisX1],
  ] as const) {
    boxes.push({
      kind: 'rect',
      xMm: x0,
      yMm: top + 10.7,
      wMm: x1 - x0,
      hMm: 0.3,
      fill: auf(COLOR_MARGIN),
    });
  }
}

/**
 * Die beiden Jahreszahlen an den Grenzen, die immer im Fenster liegen.
 *
 * Überdeckt der Marker eine Zahl, entfällt sie: Der Leser hat noch die andere
 * Zahl und die abgesetzten Randmonate. Bei `ribbon` steht die Zahl in der
 * Fläche und damit unterhalb des Markers – dort kann er sie nicht verdecken,
 * und die Prüfung entfällt.
 */
function jahreszahlen(
  variant: TimelineFootVariant,
  L: FootLayout,
  { top, axisX1, auf, papier }: FootContext,
  year: number,
  yearStart: number,
  yearEnd: number,
  markerX: number | undefined,
): RenderBox[] {
  const size = L.year.fontSizePt;
  const boxes: RenderBox[] = [];

  // `classic` setzt beide Zahlen blass: Sie ordnen ein, sie benennen nicht.
  // `band` und `ruler` stellen das Kapiteljahr in die Textfarbe und lassen nur
  // das Folgejahr blass – dort ist die Zahl groß genug, um Anker zu sein, und
  // dann muss zu sehen sein, welches der beiden Jahre die Seite trägt.
  const farben: readonly [string, string] =
    variant === 'classic'
      ? [auf(COLOR_YEAR), auf(COLOR_YEAR)]
      : variant === 'ribbon'
        ? // Ausgespart in der Fläche, nicht auf ihr: Die Zahl ist ein Loch im
          // Band. In Textfarbe stünde sie als sechster Grauwert im Fußraum.
          [papier, auf(COLOR_YEAR)]
        : [auf(COLOR_CHAPTER), auf(COLOR_YEAR)];

  const grenzen: readonly (readonly [number, number, string])[] =
    variant === 'ribbon'
      ? [
          [yearStart + 1.8, year, farben[0]],
          [yearEnd + 1.8, year + 1, farben[1]],
        ]
      : [
          [yearStart + 1, year, farben[0]],
          [yearEnd + 1, year + 1, farben[1]],
        ];

  for (const [boxX, wert, color] of grenzen) {
    const breite = estimatedTextWidthMm(String(wert), size);
    // Gegen die geschätzte Textbreite geprüft, nicht gegen ein großzügiges
    // Textfeld: Sonst verschwände die Jahreszahl schon, wenn der Marker
    // zwanzig Millimeter entfernt steht.
    if (
      variant !== 'ribbon' &&
      markerX !== undefined &&
      markerX > boxX - 2 &&
      markerX < boxX + breite
    ) {
      continue;
    }
    if (boxX + breite > axisX1) continue;
    boxes.push({
      kind: 'text',
      xMm: boxX,
      yMm: top + L.year.topMm,
      wMm: breite,
      hMm: L.year.heightMm,
      slotId: `timeline-year-${wert}`,
      content: String(wert),
      fontSizePt: size,
      weight: yearStyle.weight,
      align: 'left',
      color,
    });
  }

  return boxes;
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
