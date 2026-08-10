/**
 * Der Korrekturabzug: das Buch zum Durchsehen, nicht zum Drucken.
 *
 * Der Druckexport kann nur eines — Originale, 56 s Laufzeit, 160 MB. Zum
 * Durchsehen braucht es das Gegenteil: schnell, klein, blätterbar, und mit einer
 * gedruckten Seitenzahl, an der man sich eine Notiz macht („Seite 44, das Bild
 * raus"). Beides ist derselbe Renderer über demselben RSM; verschieden sind nur
 * die Bildquelle, die Auflösung und dieses Blatt hier.
 *
 * **Hier steht nur die Geometrie des Blattes**, nicht die des Buches: wie groß
 * das Blatt ist, wo die Doppelseite darauf sitzt, in welchem Maßstab, und was
 * daneben steht. Der Buchinhalt selbst wird nicht ein zweites Mal gerechnet — er
 * kommt fertig aus `renderSpread` und wird nur verschoben und verkleinert. Wäre
 * es anders, zeigte der Abzug ein anderes Buch als der Druck, und dann wäre er
 * wertlos.
 *
 * **DIN A4 quer, nicht das Buchformat verkleinert.** Ein Abzug im Seitenmaß des
 * Buches (bei 28×28 wären das 580 × 320 mm) landet im Druckdialog jedes Mal in
 * einem Skalierungsgespräch. A4 ist die Größe, die aus jedem Drucker kommt, ohne
 * dass jemand etwas einstellt — und weil eine Doppelseite mindestens doppelt so
 * breit wie hoch ist, bleibt unter ihr von selbst der Streifen frei, auf dem die
 * Notiz landet. Das Blattformat ist eine Norm und kein Anbieterwert; es steht
 * deshalb hier und nicht im `PrintProfile`.
 *
 * Der Abzug zeigt das **Endformat**: kein Beschnitt, keine Hilfslinien, keine
 * Marken. Wer durchsieht, soll das Buch sehen und nicht die Druckvorstufe.
 */
import { leftPageNumber } from '../render/page-number.js';
import type { RenderBox, Rect, TextBox } from '../render/rendered-spread.js';
import { textFontSizePt, type TextStyle } from '../render/typography.js';

/** DIN A4 quer. */
const BLATT = { breiteMm: 297, hoeheMm: 210 } as const;

/** Rand ringsum, in dem nichts vom Buch steht. */
const RAND_MM = 12;

/** Abstand zwischen der Unterkante des Buches und der Zeile mit den Zahlen. */
const ZAHL_ABSTAND_MM = 4;

/** Kastenhöhe der Seitenzahl. Bei 0,6 Versalanteil sind das 3,6 mm auf Papier. */
const ZAHL_HOEHE_MM = 6;

/** Kastenhöhe der Befundzeile — kleiner als die Zahl, sie ist Beiwerk. */
const BEFUND_HOEHE_MM = 4.4;

const ZAHL_STIL: TextStyle = { weight: 'semibold', capHeightRatio: 0.6, color: '#18181b' };

/**
 * Die Befundzeile in Grau, nicht in Rot.
 *
 * Sie sagt, was die Abnahme zu dieser Seite anmerkt — beim Durchsehen ist das
 * eine Erinnerung, kein Alarm. Rot stünde auf jedem zweiten Blatt und würde nach
 * dem dritten überlesen.
 */
const BEFUND_STIL: TextStyle = { weight: 'regular', capHeightRatio: 0.6, color: '#71717a' };

/**
 * Auflösung der Bilder auf dem fertigen Blatt.
 *
 * 150 dpi ist die Grenze, unterhalb derer man auf Papier anfängt, die Pixel für
 * Unschärfe zu halten — und für die Frage, um die es hier geht („welches Bild
 * fliegt raus"), reicht sie mit Abstand. Bezogen auf das **Blatt**: Was das für
 * das Buchmaß bedeutet, rechnet `bildDpi` über den Maßstab aus, denn
 * `prepareImage` bekommt die Millimeter des Buches und nicht die des Blattes.
 */
const BLATT_DPI = 150;

/**
 * Die Fläche, auf die sich ein Abzugsblatt bezieht.
 *
 * Ein `RenderedSpread` erfüllt sie — und genau den soll man übergeben. Dieselbe
 * Machart wie `TextBlockArea` und `randabfallend`: Das Maßpaar statt des
 * Druckprofils, damit die Rechnung nicht an zwei Stellen aus zwei Quellen
 * stattfindet.
 *
 * Das ist hier kein Stilfrage. Käme der Maßstab aus dem `PrintProfile` und der
 * Zuschnitt aus dem RSM, säße das Buch nach einem Formatwechsel ohne Neurendern
 * verschoben auf dem Blatt — und nichts meldete es, weil beide Zahlen für sich
 * genommen stimmen. Aus einer Quelle kann das nicht passieren.
 */
export interface Abzugsflaeche {
  /** Breite einschließlich Beschnitt. */
  widthMm: number;
  /** Höhe einschließlich Beschnitt. */
  heightMm: number;
  bleedMm: number;
}

export interface AbzugOptionen {
  /**
   * Nummer der linken Buchseite dieser Doppelseite. Die rechte ist die folgende.
   *
   * Als Angabe von außen und nicht aus dem Index gerechnet: Welche Zahl eine
   * Doppelseite trägt, hängt daran, ob das Buch mit einer linken Seite beginnt —
   * das weiß der Aufrufer, der das ganze Buch kennt, und nicht dieses Blatt.
   */
  linkeSeite: number;
  /**
   * Was die Abnahme zu dieser Doppelseite offen hat, als fertige Zeile.
   *
   * Ein Satz und keine Liste von Befunden: Der Abzug ist kein zweiter
   * Abnahmebericht, sondern eine Marke, die sagt „hier steht noch etwas an" —
   * nachgelesen wird es in der Oberfläche.
   */
  befundzeile?: string;
}

export interface Abzugsblatt {
  breiteMm: number;
  hoeheMm: number;
  /**
   * Wohin das **Endformat** der Doppelseite auf dem Blatt kommt.
   *
   * Endformat, nicht Beschnittfläche: Der Ursprung des RSM liegt an der
   * Beschnittkante, also verschiebt der Adapter zusätzlich um `bleedMm` nach
   * links oben und schneidet an diesem Rechteck ab.
   */
  inhalt: Rect;
  /** Blattmillimeter je Buchmillimeter. Immer kleiner als 1. */
  massstab: number;
  /**
   * Zielauflösung der Bildaufbereitung, bezogen auf die Buchmaße.
   *
   * Nicht die 150 dpi des Blattes: `prepareImage` rechnet mit der Kastengröße
   * aus dem RSM, und die ist in Buchmillimetern. Ein 100 mm breiter Kasten, auf
   * 49 mm verkleinert, braucht die Pixel für 49 mm — also 150 × Maßstab dpi.
   */
  bildDpi: number;
  /** Was neben dem Buch auf dem Blatt steht, in Blattkoordinaten. */
  boxen: RenderBox[];
}

/**
 * Blattgeometrie und Beiwerk eines Korrekturabzugs.
 *
 * Reine Rechnung aus den Maßen der Doppelseite und ihrer Seitennummer —
 * dieselben Eingaben ergeben dasselbe Blatt.
 */
export function abzugsblatt(flaeche: Abzugsflaeche, opts: AbzugOptionen): Abzugsblatt {
  // Das Endformat, nicht die Beschnittfläche: Der Abzug zeigt, was nach dem
  // Schneiden übrig ist.
  const buchBreite = flaeche.widthMm - 2 * flaeche.bleedMm;
  const buchHoehe = flaeche.heightMm - 2 * flaeche.bleedMm;

  // Erst in die Breite, dann prüfen, ob die Höhe noch trägt. Bei jedem Format
  // dieses Repos gewinnt die Breite (eine Doppelseite ist mindestens 2:1); der
  // zweite Fall steht trotzdem da, weil ein Blatt, das unten herausläuft, kein
  // Abzug mehr wäre, sondern ein Fehler.
  const platzBreite = BLATT.breiteMm - 2 * RAND_MM;
  const platzHoehe = BLATT.hoeheMm - 2 * RAND_MM - ZAHL_ABSTAND_MM - ZAHL_HOEHE_MM;
  const massstab = Math.min(platzBreite / buchBreite, platzHoehe / buchHoehe);

  const wMm = buchBreite * massstab;
  const hMm = buchHoehe * massstab;
  const xMm = (BLATT.breiteMm - wMm) / 2;
  const yMm = RAND_MM;

  const zahlOben = yMm + hMm + ZAHL_ABSTAND_MM;
  const zahlSchrift = textFontSizePt(ZAHL_HOEHE_MM, ZAHL_STIL);

  // Die Zahl steht **außen** unter ihrer Seite, wie im gebundenen Buch: links
  // linksbündig an der Außenkante, rechts rechtsbündig. Innen, an der Falzachse,
  // stünden beide Zahlen nebeneinander und sähen aus wie eine.
  const boxen: RenderBox[] = [
    seitenzahl('links', opts.linkeSeite, {
      xMm,
      yMm: zahlOben,
      wMm: wMm / 2,
      hMm: ZAHL_HOEHE_MM,
      align: 'left',
      fontSizePt: zahlSchrift,
    }),
    seitenzahl('rechts', opts.linkeSeite + 1, {
      xMm: xMm + wMm / 2,
      yMm: zahlOben,
      wMm: wMm / 2,
      hMm: ZAHL_HOEHE_MM,
      align: 'right',
      fontSizePt: zahlSchrift,
    }),
  ];

  if (opts.befundzeile) {
    // Unter die Zahlen und über den Notizstreifen, mittig: Sie gehört zur
    // Doppelseite als Ganzes und nicht zu einer ihrer beiden Hälften.
    const schrift = textFontSizePt(BEFUND_HOEHE_MM, BEFUND_STIL);
    boxen.push({
      kind: 'text',
      slotId: 'abzug:befunde',
      xMm,
      yMm: zahlOben + ZAHL_HOEHE_MM + 1,
      wMm,
      hMm: BEFUND_HOEHE_MM,
      content: opts.befundzeile,
      fontSizePt: schrift,
      weight: BEFUND_STIL.weight,
      align: 'center',
      color: BEFUND_STIL.color,
    });
  }

  return {
    breiteMm: BLATT.breiteMm,
    hoeheMm: BLATT.hoeheMm,
    inhalt: { xMm, yMm, wMm, hMm },
    massstab,
    bildDpi: BLATT_DPI * massstab,
    boxen,
  };
}

function seitenzahl(
  seite: 'links' | 'rechts',
  nummer: number,
  rect: Rect & { align: TextBox['align']; fontSizePt: number },
): TextBox {
  return {
    kind: 'text',
    slotId: `abzug:seitenzahl-${seite}`,
    xMm: rect.xMm,
    yMm: rect.yMm,
    wMm: rect.wMm,
    hMm: rect.hMm,
    content: String(nummer),
    fontSizePt: rect.fontSizePt,
    weight: ZAHL_STIL.weight,
    align: rect.align,
    color: ZAHL_STIL.color,
  };
}

/**
 * Die Nummer der linken Seite einer Doppelseite.
 *
 * Seite 1 ist die linke der ersten Doppelseite. Das ist bei einem Layflat-Buch,
 * dessen Innenteil als Doppelseiten hochgeladen wird, die einzige Zählung, die
 * ohne Annahme über ein Vorsatzblatt auskommt — und der Abzug soll die Seiten
 * genauso zählen wie die Oberfläche, nicht wie eine Buchbinderei.
 *
 * Die Rechnung steht in `render/page-number.ts`, weil die Seitenzahl im Buch
 * dieselbe ist: Zweimal `2 * index + 1` ginge gut, bis jemand dort einen
 * anderen Anfang setzt — und dann trüge das Blatt, auf dem man „Seite 44, das
 * Bild raus" notiert, eine andere Zahl als das Buch.
 */
export function linkeSeitenzahl(spreadIndex: number): number {
  return leftPageNumber(spreadIndex);
}

/**
 * Die Marke unter dem Blatt: was an dieser Doppelseite offen ist.
 *
 * Aus fertigen Befundtexten und nicht aus dem Bericht selbst, damit dieses Modul
 * die Abnahme nicht kennen muss — gebündelt wird nach Wortlaut, weil vier Bilder
 * unter der Mindestauflösung eine Zeile sind und nicht vier.
 */
export function befundzeile(texte: readonly string[]): string | undefined {
  if (texte.length === 0) return undefined;

  const gezaehlt = new Map<string, number>();
  for (const text of texte) gezaehlt.set(text, (gezaehlt.get(text) ?? 0) + 1);

  const teile = [...gezaehlt].map(([text, anzahl]) => (anzahl > 1 ? `${text} (${anzahl})` : text));
  return teile.join(' · ');
}
