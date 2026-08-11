/**
 * Die Zeitachse als Lebensachse am Seitenrand.
 *
 * Der Gegenentwurf zum Fußraum, und eine andere Frage: Der Fußstrahl zeigt
 * achtzehn Monate um das Kapiteljahr und beantwortet „wie weit ist es seit der
 * letzten Seite"; diese Achse zeigt **alle** Jahrgänge des Buches und
 * beantwortet „wo im Leben stehe ich gerade". Für ein Buch über achtzehn Jahre
 * ist das die Frage, die man beim Blättern stellt.
 *
 * **Ort.** Senkrecht am äußeren Rand der linken Seite, in einem 5,8 mm breiten
 * Band **hinter** der Sicherheitslinie. Der ursprüngliche Entwurf setzte sie in
 * den Sicherheitsrand — der ist ohnehin frei, die Achse kostete also keinen
 * Platz, den die Bilder brauchen. Am gedruckten Buch war das ein Risiko, und
 * der Abnahmebericht hat es gemeldet: siehe `sideAxisPasst`. Sie kostet jetzt
 * den Platz, den die Vorlagen ohnehin freilassen — und wo der nicht reicht,
 * gibt es sie nicht.
 *
 * **Maßstab.** Die Spanne des Buches, nicht ein festes Fenster: 2008 bis 2026
 * sind 19 Jahrgänge auf 248 mm, also gut 13 mm im Jahr. Zwei aufeinanderfolgende
 * Doppelseiten liegen damit knapp 3 mm auseinander – sichtbar, aber grob. Genau
 * deshalb ersetzt diese Achse den Fußstrahl nicht, sondern steht zur Wahl.
 *
 * **Vier Fassungen.** `classic` ist stumm: kein Gruppentitel, keine
 * Jahreszahlen, nur Ticks. Die Begründung dafür war, Beschriftung müsste am
 * äußeren Rand gedreht werden – das gilt aber nur vierstellig. Zweistellig
 * misst „17" bei 5 pt 1,8 mm und passt waagerecht in das Band.
 * Darauf beruhen die drei anderen: `ladder` teilt die Achse in Jahrgänge,
 * `bar` macht sie zum Fortschrittsbalken, `column` lässt die Linie ganz weg und
 * behält nur die Zahlen. Maße in `docs/zeitleisten-fassungen.md`.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { libraryOuterMarginMm } from '../templates/index.js';
import { DEFAULT_BACKGROUND, luminance, textColorOn } from './background.js';
import type { RenderBox } from './rendered-spread.js';
import type { FontWeight } from './typography.js';
import { capHeightMm, estimatedTextWidthMm } from './typography.js';

/**
 * Einrückung der stummen Achse **innerhalb ihres Bandes**.
 *
 * Alle Fassungen rechnen so: Die Zahlen unten sind Abstände zur Außenkante des
 * Bandes, nicht zum Papier. Wo das Band liegt, entscheidet `x()` — und das ist
 * die eine Stelle, die sich geändert hat.
 */
const AXIS_INSET_MM = 4.5;

/**
 * Wo das Band der Randachse außen beginnt, gemessen wie die Einrückungen der
 * Fassungen: als Abstand zur Beschnittkante.
 *
 * Das ist der äußerste Punkt, den überhaupt eine Fassung zeichnet: `bar` setzt
 * ihre Perle (⌀ 3,2) mittig auf den Balken bei 1,8 und ragt damit bis 1,1
 * hinaus. Gemessen, nicht geschätzt — `side-timeline.test.ts` hält es fest.
 */
const BAND_AUSSEN_MM = 1.1;

/**
 * Breite des Bandes, das die Randachse für sich braucht.
 *
 * Gemessen über alle vier Fassungen: von der Perle der `bar` bei 1,1 bis zu
 * ihrem laufenden Jahr, das bei 6,8 endet — also 5,7 mm. Ein Zehntel Zuschlag,
 * weil die Textbreite geschätzt ist (`estimatedTextWidthMm`) und eine
 * vierstellige Zahl in einer anderen Schrift breiter geraten könnte.
 */
export const SIDE_AXIS_BAND_MM = 5.8;

/**
 * Ob die Randachse in diesem Format Platz hat, ohne in den Beschnitt oder auf
 * die Bilder zu geraten.
 *
 * **Die Achse lag einmal im Sicherheitsrand.** Der Entwurf hielt das für einen
 * Vorteil — der Rand ist ohnehin frei, die Achse kostet also keinen Platz, den
 * die Bilder brauchen. Am gedruckten Buch ist es ein Risiko: Am gemessenen
 * 28×28 standen die Jahreszahlen 1,8 mm vor der Schnittkante, und bei der
 * üblichen Schneidtoleranz von ein bis zwei Millimetern wird eine Zahl
 * angeschnitten oder steht von Blatt zu Blatt verschieden weit vom Rand. Bei
 * einer Linie fiele das nicht auf, bei einer halb weggeschnittenen „2008"
 * schon.
 *
 * Deshalb liegt das Band jetzt **hinter** der Sicherheitslinie, im druckbaren
 * Bereich. Dort hat es nur Platz, wenn der Satzspiegel der Bibliothek weit
 * genug nach innen rückt: 10 mm Sicherheitsrand plus 5,8 mm Band sind 15,8 mm,
 * und jede Vorlage hält 7,33 % der Seitenbreite frei. Am 28×28 sind das 19,8 mm
 * — es bleiben 4,0 mm Luft. An den fünf kleineren Formaten reicht es nicht (das
 * knappste, 21×28, verfehlt es um 0,4 mm), und dann
 * wird **nicht** gezeichnet: Eine Achse, die auf den Bildern läge, wäre die
 * schlechtere Antwort als keine. Die Oberfläche fragt dasselbe und bietet die
 * Randachse dort gar nicht erst an.
 */
export function sideAxisPasst(profile: {
  page: { trimWidthMm: number; safetyMm: number };
}): boolean {
  return libraryOuterMarginMm(profile) >= profile.page.safetyMm + SIDE_AXIS_BAND_MM;
}
/** Abstand oben und unten, damit die Achse nicht in die Ecken läuft. */
const AXIS_MARGIN_MM = 26;
const AXIS_WIDTH_MM = 0.3;
const TICK_LENGTH_MM = 1.8;
const BEAD_MM = 2.6;

/**
 * Ton der stillen Achse.
 *
 * Am Bildschirm gegen Creme (#faf7f2) geprüft: Ein hellerer Ton verschwindet,
 * und was man nicht sieht, ist keine ruhige Linie, sondern gar keine. Der
 * zurückgelegte Teil steht in der Akzentfarbe darüber.
 */
const COLOR_AXIS = '#b0a89c';
const COLOR_ACCENT = '#1d4ed8';

/**
 * Zurückgelegt und noch kommend, als Paar.
 *
 * Auf dunklem Grund getauscht statt umgerechnet: `textColorOn` macht aus beiden
 * Tönen dasselbe Weiß – für Schrift richtig, für zwei Flächen, deren ganze
 * Aussage ihr Unterschied ist, unbrauchbar. Getauscht bleibt die Rolle erhalten,
 * denn kräftig heißt auf Anthrazit hell und auf Creme dunkel.
 */
const SIDE_TONES = { vergangen: '#bdb3a6', kommend: '#e3ded5' } as const;

/** Die Zahlen der Achse – leiser als ihre Linie, sie zählen nur mit. */
const COLOR_NUMBER = '#a89e91';

/**
 * Präfix aller Kennungen, die die Randachse vergibt. Siehe
 * `TIMELINE_SLOT_PREFIX` — dieselbe Begründung.
 */
export const SIDE_TIMELINE_SLOT_PREFIX = 'side-timeline-';

/** Die Fassungen der Randachse. `classic` ist die Vorgabe und der Bestand. */
export const TIMELINE_SIDE_VARIANTS = ['classic', 'ladder', 'bar', 'column'] as const;

export type TimelineSideVariant = (typeof TIMELINE_SIDE_VARIANTS)[number];

/**
 * Lage des Bandes: Außenkante, Anfang und Länge der Achse.
 *
 * Eigene Funktion aus demselben Grund wie `footAxis` im Fußstrahl: Außer der
 * Zeichnung braucht das Vorschaufenster dieselben Zahlen, und zweimal gerechnet
 * wären sie zwei Wahrheiten über einen Ort, der sich schon einmal verschoben
 * hat — vom Sicherheitsrand hinter die Sicherheitslinie, siehe `sideAxisPasst`.
 */
function sideBand(profile: PrintProfile) {
  const { bleedMm, trimHeightMm, safetyMm } = profile.page;
  const y0 = bleedMm + AXIS_MARGIN_MM;
  return {
    aussen: bleedMm + safetyMm - BAND_AUSSEN_MM,
    y0,
    laenge: bleedMm + trimHeightMm - AXIS_MARGIN_MM - y0,
  };
}

/**
 * Anteil eines Datums an der Buchspanne, auf 0..1 geklemmt.
 *
 * Monatsgenau plus Tagesanteil: Auf 13 mm im Jahr ist ein Tag ein dreißigstel
 * Millimeter – die Genauigkeit spielt keine Rolle, aber die Rechnung soll nicht
 * an Monatsgrenzen springen.
 */
export function sideAxisFraction(fromYear: number, toYear: number, at: NaiveDateTime): number {
  const jahre = toYear - fromYear + 1;
  if (!(jahre > 0)) return 0;
  const jahr = Number(at.slice(0, 4));
  const monat = Number(at.slice(5, 7));
  const tag = Number(at.slice(8, 10));
  const seit = Math.max(0, Math.min(jahre, jahr - fromYear + (monat - 1 + (tag - 1) / 31) / 12));
  return seit / jahre;
}

/** Höhe des Vorschaufensters. Vier Jahrgänge am 28×28, genug für eine Zahl der Jahresleiter. */
const PREVIEW_HEIGHT_MM = 58;

/**
 * Fenster für eine Miniatur der Randachse, in Millimetern der Druckfläche.
 *
 * Ganz gezeigt wäre die Achse ein Strich – 248 mm auf die Höhe einer
 * Knopfzeile. Gezeigt wird das Band in seiner ganzen Breite und senkrecht der
 * Abschnitt um den Marker, weit genug, dass die Jahresleiter noch eine ihrer
 * Zahlen trägt (sie beschriftet jedes fünfte Jahr).
 *
 * Wie beim Fußstrahl rechnet das der Kern und nicht die Oberfläche: Der
 * Ausschnitt dort stammte noch aus der Zeit, als das Band im Sicherheitsrand
 * lag, und zeigte nach dessen Verschiebung ins Papier neben die Achse.
 */
export function sideTimelinePreviewWindowMm(
  profile: PrintProfile,
  input: { fromYear: number; toYear: number; at?: NaiveDateTime },
): { x0: number; x1: number; y0: number; y1: number } {
  const { aussen, y0, laenge } = sideBand(profile);
  const anteil = input.at ? sideAxisFraction(input.fromYear, input.toYear, input.at) : 0.5;
  // Um den Marker zentriert und in die Achse geklemmt: Steht er am Anfang des
  // Buches, rutscht das Fenster nicht über die Achse hinaus in die Ecke.
  const mitte = Math.max(
    y0 + PREVIEW_HEIGHT_MM / 2,
    Math.min(y0 + laenge - PREVIEW_HEIGHT_MM / 2, y0 + anteil * laenge),
  );
  return {
    // Ein halber Millimeter Luft außen, damit die Perle der `bar` nicht auf der
    // Kante des Fensters sitzt.
    x0: aussen - 0.5,
    x1: aussen + SIDE_AXIS_BAND_MM + 0.5,
    y0: mitte - PREVIEW_HEIGHT_MM / 2,
    y1: mitte + PREVIEW_HEIGHT_MM / 2,
  };
}

export interface SideTimelineInput {
  /** Hintergrund der Doppelseite – auf dunklem Grund kehrt die Achse ihre Helligkeit um. */
  background?: string;
  /** Erstes und letztes Jahr des Buches. Ohne sie gibt es keinen Maßstab. */
  fromYear: number;
  toYear: number;
  /**
   * Das Datum, das diese Doppelseite vertritt – der Median ihrer belastbaren
   * Aufnahmedaten. Fehlt es, bleibt die Achse stehen und nur der Marker entfällt.
   */
  at?: NaiveDateTime;
  /** Farbe von Marker und zurückgelegtem Abschnitt. */
  accentColor?: string;
  /** Fassung der Zeichnung. Ohne Angabe der Bestand. */
  variant?: TimelineSideVariant;
}

/**
 * Boxen der Randachse, in Zeichenreihenfolge.
 *
 * Leer, wenn die Buchspanne unsinnig ist – ohne Maßstab gibt es nichts zu
 * zeichnen.
 */
export function sideTimelineBoxes(input: SideTimelineInput, profile: PrintProfile): RenderBox[] {
  const { fromYear, toYear } = input;
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || toYear < fromYear) return [];

  // Kein Platz, keine Achse: Sie läge sonst auf den Bildern oder im Beschnitt.
  if (!sideAxisPasst(profile)) return [];

  const { aussen, y0, laenge } = sideBand(profile);
  if (laenge <= 0) return [];

  const jahre = toYear - fromYear + 1;
  const papier = input.background ?? DEFAULT_BACKGROUND;
  const auf = (farbe: string) => textColorOn(papier, farbe);
  const akzent = input.accentColor ?? COLOR_ACCENT;
  const dunkel = luminance(papier) <= 0.45;

  /** Jahrgänge seit dem Beginn des Buches, als Bruch. */
  const seit = (wert: NaiveDateTime): number => sideAxisFraction(fromYear, toYear, wert) * jahre;

  /** Anteil eines Datums an der Buchspanne, auf 0..1 geklemmt. */
  const anteil = (wert: NaiveDateTime): number => sideAxisFraction(fromYear, toYear, wert);

  const ctx: SideContext = {
    /**
     * Absolute x-Werte entstehen aus dem Abstand zur Außenkante des Bandes —
     * und die liegt an der Sicherheitslinie.
     *
     * Die Einrückungen der vier Fassungen bleiben, wie sie sind: Sie
     * beschreiben die Achse in sich, und verschoben wird das ganze Band. Vorher
     * stand hier `bleedMm + insetMm`, das Band also im Beschnittrand — siehe
     * `sideAxisPasst`.
     */
    x: (insetMm: number) => aussen + insetMm,
    y0,
    laenge,
    jahre,
    fromYear,
    seit,
    anteil,
    auf,
    papier,
    akzent,
    dunkel,
  };

  switch (input.variant ?? 'classic') {
    case 'ladder':
      return ladder(ctx, input.at);
    case 'bar':
      return bar(ctx, input.at, toYear);
    case 'column':
      return column(ctx, input.at);
    default:
      return classic(ctx, input.at);
  }
}

/** Was die vier Zeichenroutinen von Buch und Doppelseite wissen müssen. */
interface SideContext {
  /**
   * Absolute Position aus einer Einrückung **im Band**.
   *
   * Die Einrückungen der Fassungen liegen zwischen 1,1 und 6,8; wo das Band
   * selbst liegt, entscheidet der Aufbau in `sideTimelineBoxes`.
   */
  x: (insetMm: number) => number;
  y0: number;
  laenge: number;
  jahre: number;
  fromYear: number;
  /** Jahrgänge seit Buchbeginn, als Bruch. */
  seit: (wert: NaiveDateTime) => number;
  /** Anteil an der Buchspanne, 0 bis 1. */
  anteil: (wert: NaiveDateTime) => number;
  auf: (farbe: string) => string;
  papier: string;
  akzent: string;
  dunkel: boolean;
}

/**
 * `classic`: eine Linie, ein Tick je Jahrgang, kein Wort.
 */
function classic({ x, y0, laenge, jahre, anteil, auf, akzent }: SideContext, at?: NaiveDateTime) {
  const boxes: RenderBox[] = [];
  const achseX = x(AXIS_INSET_MM);

  boxes.push({
    kind: 'rect',
    xMm: achseX - AXIS_WIDTH_MM / 2,
    yMm: y0,
    wMm: AXIS_WIDTH_MM,
    hMm: laenge,
    fill: auf(COLOR_AXIS),
  });

  // Ein Tick je Jahrgang. Ohne Zahl: Diese Fassung zeigt eine Stelle, sie
  // erklärt keinen Kalender – dafür gibt es den Fußstrahl und die drei
  // beschrifteten Fassungen.
  for (let i = 0; i <= jahre; i++) {
    boxes.push({
      kind: 'rect',
      xMm: achseX - TICK_LENGTH_MM / 2,
      yMm: y0 + (i / jahre) * laenge - AXIS_WIDTH_MM / 2,
      wMm: TICK_LENGTH_MM,
      hMm: AXIS_WIDTH_MM,
      fill: auf(COLOR_AXIS),
    });
  }

  if (at) {
    const y = y0 + anteil(at) * laenge;

    // Der zurückgelegte Teil kräftig: Aus der Achse wird damit eine
    // Fortschrittsanzeige durch die Jahre, ohne ein einziges Wort.
    boxes.push({
      kind: 'rect',
      xMm: achseX - AXIS_WIDTH_MM / 2,
      yMm: y0,
      wMm: AXIS_WIDTH_MM,
      hMm: y - y0,
      fill: akzent,
    });

    boxes.push({
      kind: 'rect',
      xMm: achseX - BEAD_MM / 2,
      yMm: y - BEAD_MM / 2,
      wMm: BEAD_MM,
      hMm: BEAD_MM,
      rxMm: BEAD_MM / 2,
      fill: akzent,
    });
  }

  return boxes;
}

/** Lücke zwischen zwei Jahrgängen der Jahresleiter. */
const LADDER_GAP_MM = 0.7;

/**
 * `ladder`: die Achse in ihre Jahrgänge zerlegt.
 *
 * Neunzehn Kapseln statt einer Linie mit Ticks, und der laufende Jahrgang nur
 * anteilig gefüllt: Damit ist nicht bloß zu sehen, wie weit das Buch fort ist,
 * sondern auch, wo im Jahr die Seite liegt. Die Ziffern stehen alle fünf Jahre –
 * neunzehn Zahlen auf 248 mm ergäben eine Tabelle am Papierrand.
 */
function ladder(
  { x, y0, laenge, jahre, fromYear, seit, auf, akzent, dunkel }: SideContext,
  at?: NaiveDateTime,
) {
  const boxes: RenderBox[] = [];
  const balkenX = x(2.0);
  const breite = 1.3;
  const segment = (laenge - (jahre - 1) * LADDER_GAP_MM) / jahre;
  const oben = (i: number) => y0 + i * (segment + LADDER_GAP_MM);

  const stand = at ? seit(at) : undefined;
  const laufend = stand === undefined ? undefined : Math.min(jahre - 1, Math.floor(stand));

  const vergangen = dunkel ? SIDE_TONES.kommend : SIDE_TONES.vergangen;
  const kommend = dunkel ? SIDE_TONES.vergangen : SIDE_TONES.kommend;

  for (let i = 0; i < jahre; i++) {
    const zurueck = laufend !== undefined && i < laufend;
    boxes.push({
      kind: 'rect',
      xMm: balkenX,
      yMm: oben(i),
      wMm: breite,
      hMm: segment,
      rxMm: breite / 2,
      fill: zurueck ? vergangen : kommend,
    });

    // Der laufende Jahrgang trägt seinen Anteil im Akzent – die einzige Farbe
    // der Achse steht damit genau auf dem Jahr, in dem die Seite liegt.
    if (laufend === i && stand !== undefined) {
      const hoch = (stand - i) * segment;
      if (hoch > 0) {
        boxes.push({
          kind: 'rect',
          xMm: balkenX,
          yMm: oben(i),
          wMm: breite,
          hMm: hoch,
          rxMm: breite / 2,
          fill: akzent,
        });
      }
    }

    const jahr = fromYear + i;
    if (jahr % 5 === 0) {
      boxes.push(
        zahl({
          slotId: `side-timeline-year-${jahr}`,
          text: zweistellig(jahr),
          xMm: x(4.2),
          mitteMm: oben(i) + segment / 2,
          fontSizePt: 5,
          weight: 'regular',
          color: auf(COLOR_NUMBER),
        }),
      );
    }
  }

  if (stand !== undefined) {
    const y = oben(Math.min(jahre - 1, Math.floor(stand))) + (stand % 1) * segment;
    boxes.push(perle(balkenX + breite / 2, y, BEAD_MM, akzent));
  }

  return boxes;
}

/**
 * `bar`: die Achse als Fortschrittsbalken.
 *
 * Ein Balken von 1,8 mm, gefüllt bis zur Seite, mit Kerben an den Jahresgrenzen.
 * Die vollen Jahreszahlen stehen oben und unten, wo die Achse 26 mm Luft hat –
 * dort passen sie auch vierstellig waagerecht. Am Marker steht der laufende
 * Jahrgang zweistellig, halbfett und im Akzent: Er beantwortet die Frage der
 * Achse in einer Zahl.
 */
function bar(
  { x, y0, laenge, jahre, fromYear, seit, anteil, auf, papier, akzent, dunkel }: SideContext,
  at: NaiveDateTime | undefined,
  toYear: number,
) {
  const boxes: RenderBox[] = [];
  const balkenX = x(1.8);
  const breite = 1.8;

  boxes.push({
    kind: 'rect',
    xMm: balkenX,
    yMm: y0,
    wMm: breite,
    hMm: laenge,
    rxMm: breite / 2,
    fill: dunkel ? SIDE_TONES.vergangen : SIDE_TONES.kommend,
  });

  if (at) {
    boxes.push({
      kind: 'rect',
      xMm: balkenX,
      yMm: y0,
      wMm: breite,
      hMm: anteil(at) * laenge,
      rxMm: breite / 2,
      fill: akzent,
    });
  }

  // Kerben nur an den inneren Grenzen: An den Enden schnitten sie die Kappe des
  // Balkens ab, statt ihn zu teilen.
  for (let i = 1; i < jahre; i++) {
    boxes.push({
      kind: 'rect',
      xMm: balkenX,
      yMm: y0 + (i / jahre) * laenge - 0.125,
      wMm: breite,
      hMm: 0.25,
      fill: papier,
    });
  }

  for (const [rolle, wert, mitteMm] of [
    ['from', fromYear, y0 - 2.6],
    ['to', toYear, y0 + laenge + 2.6],
  ] as const) {
    boxes.push(
      zahl({
        slotId: `side-timeline-${rolle}`,
        text: String(wert),
        xMm: balkenX,
        mitteMm,
        fontSizePt: 5,
        weight: 'regular',
        color: auf(COLOR_NUMBER),
      }),
    );
  }

  if (at) {
    const y = y0 + anteil(at) * laenge;
    boxes.push(perle(balkenX + breite / 2, y, 3.2, akzent));
    boxes.push(
      zahl({
        slotId: 'side-timeline-now',
        text: zweistellig(fromYear + Math.min(jahre - 1, Math.floor(seit(at)))),
        xMm: x(4.7),
        mitteMm: y,
        fontSizePt: 6,
        weight: 'semibold',
        color: akzent,
      }),
    );
  }

  return boxes;
}

/**
 * `column`: nur die Zahlen.
 *
 * Keine Linie, keine Fläche – neunzehn zweistellige Jahrgänge in einer Spalte,
 * der laufende halbfett im Akzent. Die leiseste der drei neuen Fassungen und
 * die einzige, die ganz ohne Grafik auskommt: Sie beantwortet die Frage der
 * Achse, ohne am Papierrand etwas zu zeichnen. Der Punkt daneben sitzt taggenau
 * und nicht auf der Zahl, damit die Seite innerhalb ihres Jahres verortet ist.
 */
function column(
  { x, y0, laenge, jahre, fromYear, seit, anteil, auf, akzent }: SideContext,
  at?: NaiveDateTime,
) {
  const boxes: RenderBox[] = [];
  const laufend = at ? fromYear + Math.min(jahre - 1, Math.floor(seit(at))) : undefined;

  for (let i = 0; i < jahre; i++) {
    const jahr = fromYear + i;
    const jetzt = jahr === laufend;
    boxes.push(
      zahl({
        slotId: `side-timeline-year-${jahr}`,
        text: zweistellig(jahr),
        xMm: x(3.0),
        mitteMm: y0 + ((i + 0.5) * laenge) / jahre,
        fontSizePt: jetzt ? 6.5 : 5,
        weight: jetzt ? 'semibold' : 'regular',
        color: jetzt ? akzent : auf(COLOR_NUMBER),
      }),
    );
  }

  if (at) {
    boxes.push(perle(x(1.6) + 0.55, y0 + anteil(at) * laenge, 1.1, akzent));
  }

  return boxes;
}

/** Perle oder Punkt: ein Kreis um seinen Mittelpunkt. */
function perle(xMitteMm: number, yMitteMm: number, durchmesser: number, fill: string): RenderBox {
  return {
    kind: 'rect',
    xMm: xMitteMm - durchmesser / 2,
    yMm: yMitteMm - durchmesser / 2,
    wMm: durchmesser,
    hMm: durchmesser,
    rxMm: durchmesser / 2,
    fill,
  };
}

/**
 * Eine Zahl an der Achse, waagerecht.
 *
 * Die Kennung benennt die Rolle und leitet sich nicht aus dem Text ab: In einem
 * Buch über einen einzigen Jahrgang trügen erste und letzte Jahreszahl des
 * Fortschrittsbalkens denselben Text, und zwei Boxen mit derselben Kennung
 * verwirft die Vorschau als doppelten React-Key.
 *
 * Angegeben ist die Mitte ihres Versalbands und nicht die Oberkante eines
 * Kastens: Am Rand steht sie neben einem Segment oder einer Perle und muss auf
 * deren Mitte liegen. Der Kasten ist deshalb genau so hoch wie das Versalband –
 * `textBaselineOffsetMm` setzt es mittig, bei dieser Höhe also bündig, und beide
 * Renderer lesen dieselbe Zahl aus dem RSM.
 */
function zahl(o: {
  /** Rolle dieser Zahl, nicht ihr Inhalt – siehe unten. */
  slotId: string;
  text: string;
  xMm: number;
  mitteMm: number;
  fontSizePt: number;
  weight: FontWeight;
  color: string;
}): RenderBox {
  const hoehe = capHeightMm(o.fontSizePt);
  return {
    kind: 'text',
    xMm: o.xMm,
    yMm: o.mitteMm - hoehe / 2,
    wMm: estimatedTextWidthMm(o.text, o.fontSizePt),
    hMm: hoehe,
    slotId: o.slotId,
    content: o.text,
    fontSizePt: o.fontSizePt,
    weight: o.weight,
    align: 'left',
    color: o.color,
  };
}

/**
 * Jahrgang auf zwei Stellen.
 *
 * Der Grund, warum diese Achse überhaupt beschriftet werden kann: Vierstellig
 * müsste die Zahl gedreht werden und wäre im Buch nur mit gedrehtem Kopf zu
 * lesen. „17" misst bei 5 pt 1,8 mm und passt waagerecht in das Band.
 */
function zweistellig(jahr: number): string {
  return String(jahr).slice(-2).padStart(2, '0');
}
