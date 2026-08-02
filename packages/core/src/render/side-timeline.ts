/**
 * Die Zeitachse als Lebensachse am Seitenrand.
 *
 * Der Gegenentwurf zum Fußraum, und eine andere Frage: Der Fußstrahl zeigt
 * achtzehn Monate um das Kapiteljahr und beantwortet „wie weit ist es seit der
 * letzten Seite"; diese Achse zeigt **alle** Jahrgänge des Buches und
 * beantwortet „wo im Leben stehe ich gerade". Für ein Buch über achtzehn Jahre
 * ist das die Frage, die man beim Blättern stellt.
 *
 * **Ort.** Senkrecht im äußeren Sicherheitsrand der linken Seite. Der ist
 * ohnehin frei, die Achse kostet also keinen Platz, den die Bilder brauchen –
 * anders als der Fußstrahl, der 14 mm belegt.
 *
 * **Stumm.** Kein Gruppentitel, keine Jahreszahlen, nur Ticks: Diese Achse sagt,
 * wo man ist, und sonst nichts. Beschriftung wäre am äußeren Rand entweder
 * gedreht (im Buch nur mit gedrehtem Kopf zu lesen) oder so schmal gesetzt, dass
 * sie stört, wo sie erklären soll.
 *
 * **Maßstab.** Die Spanne des Buches, nicht ein festes Fenster: 2008 bis 2026
 * sind 19 Jahrgänge auf 240 mm, also gut 12 mm im Jahr. Zwei aufeinanderfolgende
 * Doppelseiten liegen damit knapp 3 mm auseinander – sichtbar, aber grob. Genau
 * deshalb ersetzt diese Achse den Fußstrahl nicht, sondern steht zur Wahl.
 */
import type { NaiveDateTime } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { DEFAULT_BACKGROUND, textColorOn } from './background.js';
import type { RenderBox } from './rendered-spread.js';

/** Abstand der Achse von der Beschnittkante, in Millimetern. */
const AXIS_INSET_MM = 4.5;
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

  const { bleedMm, trimHeightMm } = profile.page;
  const x = bleedMm + AXIS_INSET_MM;
  const y0 = bleedMm + AXIS_MARGIN_MM;
  const y1 = bleedMm + trimHeightMm - AXIS_MARGIN_MM;
  const laenge = y1 - y0;
  if (laenge <= 0) return [];

  const jahre = toYear - fromYear + 1;
  const auf = (farbe: string) => textColorOn(input.background ?? DEFAULT_BACKGROUND, farbe);
  const akzent = input.accentColor ?? COLOR_ACCENT;

  /** Anteil eines Datums an der Buchspanne, auf 0..1 geklemmt. */
  const anteil = (wert: NaiveDateTime): number => {
    const jahr = Number(wert.slice(0, 4));
    const monat = Number(wert.slice(5, 7));
    const tag = Number(wert.slice(8, 10));
    // Monatsgenau plus Tagesanteil: Auf 12 mm im Jahr ist ein Tag ein
    // dreißigstel Millimeter – die Genauigkeit spielt keine Rolle, aber die
    // Rechnung soll nicht an Monatsgrenzen springen.
    const seit = jahr - fromYear + (monat - 1 + (tag - 1) / 31) / 12;
    return Math.max(0, Math.min(1, seit / jahre));
  };

  const boxes: RenderBox[] = [];

  boxes.push({
    kind: 'rect',
    xMm: x - AXIS_WIDTH_MM / 2,
    yMm: y0,
    wMm: AXIS_WIDTH_MM,
    hMm: laenge,
    fill: auf(COLOR_AXIS),
  });

  // Ein Tick je Jahrgang. Ohne Zahl: Die Achse zeigt eine Stelle, sie erklärt
  // keinen Kalender – dafür gibt es den Fußstrahl.
  for (let i = 0; i <= jahre; i++) {
    boxes.push({
      kind: 'rect',
      xMm: x - TICK_LENGTH_MM / 2,
      yMm: y0 + (i / jahre) * laenge - AXIS_WIDTH_MM / 2,
      wMm: TICK_LENGTH_MM,
      hMm: AXIS_WIDTH_MM,
      fill: auf(COLOR_AXIS),
    });
  }

  if (input.at) {
    const y = y0 + anteil(input.at) * laenge;

    // Der zurückgelegte Teil kräftig: Aus der Achse wird damit eine
    // Fortschrittsanzeige durch die Jahre, ohne ein einziges Wort.
    boxes.push({
      kind: 'rect',
      xMm: x - AXIS_WIDTH_MM / 2,
      yMm: y0,
      wMm: AXIS_WIDTH_MM,
      hMm: y - y0,
      fill: akzent,
    });

    boxes.push({
      kind: 'rect',
      xMm: x - BEAD_MM / 2,
      yMm: y - BEAD_MM / 2,
      wMm: BEAD_MM,
      hMm: BEAD_MM,
      rxMm: BEAD_MM / 2,
      fill: akzent,
    });
  }

  return boxes;
}
