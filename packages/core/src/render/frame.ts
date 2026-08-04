/**
 * Rahmen um ein Bild: Polaroid, Passepartout, Kontur, Klebestreifen.
 *
 * Ein Rahmen ist im RSM kein neuer Begriff, sondern **mehr Boxen um dieselbe
 * Bildbox**: Der Polaroidkarton ist ein Rechteck dahinter, der Klebestreifen
 * eines davor. Deshalb steht die ganze Rechnung hier im Kern und nicht in den
 * Renderern – die bekommen fertige Millimeter wie für jede andere Box auch.
 *
 * **Der Rahmen frisst Fläche.** Das Außenmaß bleibt der Platz aus der Vorlage;
 * das Bild schrumpft nach innen. Das ist die einzige Reihenfolge, die stimmt:
 * Ausschnitt, effektive Auflösung und die DPI-Warnungen rechnen danach mit dem
 * kleineren Kasten weiter. Andersherum – Bild behält seine Größe, Karton wächst
 * nach außen – überliefe der Rahmen die Nachbarslots und den Sicherheitsrand.
 *
 * Dass die Auflösung dabei nicht immer sinkt, ist kein Widerspruch, sondern der
 * eigentliche Grund für die Reihenfolge: Der Polaroidkarton nimmt unten mehr
 * weg als an den Seiten, der Kasten wird dadurch breiter im Verhältnis, und ein
 * Querformat wird weniger beschnitten. Die Zahl darf deshalb nicht aus dem Platz
 * der Vorlage kommen – sie gilt für den Kasten, in dem das Bild wirklich steht.
 *
 * **Randabfallende Bilder bekommen keinen.** Dieselbe Regel wie bei der Neigung
 * (`randabfallend` in `tilt.ts`): Ein Karton, der über die Beschnittkante läuft,
 * wird abgeschnitten, und was bleibt, ist ein weißer Streifen an der
 * Papierkante. Geprüft wird das beim Aufrufer, wo das Außenmaß bekannt ist.
 *
 * **Kein weicher Schlagschatten.** Der klassische Polaroid-Look lebt davon, aber
 * pdfkit kann keine Weichzeichnung, und CSS `box-shadow` nachzubauen hieße, im
 * PDF ein vorgerendertes PNG unterzuschieben – zwei unabhängige Zeichenwege für
 * dieselbe Form, also genau die Klasse Abweichung, die der Parity-Test aufdecken
 * soll. Stattdessen ein harter Versatzschatten: eine zweite, verschobene Fläche
 * mit Deckkraft. Im Druck steht der ohnehin besser als ein simulierter
 * Weichschatten, der auf Papier zu Bandenbildung neigt.
 */
import type { PolygonBox, Rect, RectBox, RenderBox, TextBox } from './rendered-spread.js';
import { TEXT_STYLES, estimatedTextWidthMm, textFontSizePt } from './typography.js';

export type FrameId = 'keiner' | 'polaroid' | 'passepartout' | 'kontur' | 'klebestreifen';

export interface Frame {
  id: FrameId;
  name: string;
  /** Ein Satz für die Oberfläche – was der Rahmen tut, nicht wie er aussieht. */
  hinweis: string;
}

/**
 * Die wählbaren Rahmen.
 *
 * Vier und keine offene Liste: Ein Fotobuch verträgt einen Rahmen, nicht vier
 * verschiedene auf derselben Doppelseite. Die Auswahl ist deshalb als Buchvorgabe
 * gedacht, die man an einzelnen Bildern übersteuert – nicht als Sammlung, aus der
 * man je Bild etwas anderes greift.
 */
export const FRAMES: readonly Frame[] = [
  { id: 'keiner', name: 'Ohne', hinweis: 'Das Bild steht direkt auf der Seite.' },
  {
    id: 'polaroid',
    name: 'Polaroid',
    hinweis: 'Weißer Karton mit breitem Fuß, wie ein Sofortbild.',
  },
  {
    id: 'passepartout',
    name: 'Passepartout',
    hinweis: 'Gleichmäßiger heller Rand mit feiner Kontur.',
  },
  { id: 'kontur', name: 'Kontur', hinweis: 'Nur eine dünne Linie auf der Bildkante.' },
  {
    id: 'klebestreifen',
    name: 'Klebestreifen',
    hinweis: 'Zwei Streifen über die Ecken, wie ins Album geklebt.',
  },
];

export const DEFAULT_FRAME: FrameId = 'keiner';

export function isFrameId(wert: unknown): wert is FrameId {
  return typeof wert === 'string' && FRAMES.some((f) => f.id === wert);
}

/**
 * Randbreite als Anteil der kürzeren Kante.
 *
 * Nicht absolut in Millimetern, obwohl ein echtes Polaroid feste 5 mm hat: Die
 * Bilder in diesem Buch stehen zwischen 40 und 250 mm breit, und ein fester Rand
 * wäre am kleinen Bild ein Passepartout und am großen ein Härchen. 5 % der
 * kürzeren Kante trifft bei den häufigen 90 mm die 4,5 mm, die dem Original nahe
 * kommen.
 */
const RAND_ANTEIL = 0.05;

/** Unter 1,8 mm ist der Rand im Druck ein Zufallsergebnis der Schneidetoleranz. */
const RAND_MIN_MM = 1.8;

/** Darüber wird aus dem Rahmen eine Fläche, die mit dem Bild konkurriert. */
const RAND_MAX_MM = 7;

/**
 * Wie viel breiter der Fuß des Polaroids ist als seine Seiten.
 *
 * Aus dem Original: 13 mm unten zu 5 mm seitlich. Genau dieses Verhältnis macht
 * die Form erkennbar – bei gleichmäßigem Rand ist es kein Polaroid mehr, sondern
 * ein Passepartout.
 */
const POLAROID_FUSS = 2.6;

/** Farbe des Kartons. Nicht reines Weiß: Fotopapier ist warm. */
const KARTON = '#fdfbf6';

/** Kontur des Passepartouts – dieselbe Grauabstufung wie die Hilfslinien. */
const KONTUR = '#a8a29e';

/** Strichstärke der Kontur, in Millimetern. Bei 0,25 mm im Druck sicher sichtbar. */
const KONTUR_MM = 0.25;

/** Schatten: Schwarz mit dieser Deckkraft, statt eines aufgehellten Grautons. */
const SCHATTEN = '#000000';
const SCHATTEN_DECKUNG = 0.16;

/** Versatz des Schattens als Anteil der Randbreite, mindestens 0,4 mm. */
const SCHATTEN_ANTEIL = 0.35;
const SCHATTEN_MIN_MM = 0.4;

/**
 * Farbe und Deckkraft des Klebestreifens.
 *
 * Durchscheinend und nicht deckend: Ein undurchsichtiger Streifen liest sich als
 * aufgeklebtes Papier, ein durchscheinender als Klebeband – und nur das Zweite
 * erklärt, warum er über der Bildecke liegt.
 */
const TAPE = '#cfc6b4';
const TAPE_DECKUNG = 0.66;

/**
 * Schrift der Bildunterschrift: die Handschrift, nicht die Buchschrift.
 *
 * Auf ein Sofortbild schreibt man mit dem Filzstift; gesetzte Groteske im Fuß
 * sähe aus wie ein Etikett. Fest und nicht wählbar – wer eine andere Schrift am
 * Bild will, setzt einen `TextBlock`, der kann alle vier Familien.
 */
const CAPTION_FAMILY = 'hand' as const;

/** Seitlicher Freiraum im Fuß, als Anteil der Kartonbreite. */
const CAPTION_RAND = 0.08;

function klemme(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Randbreite dieses Rahmens an diesem Kasten, in Millimetern.
 *
 * Die zweite Klemmung auf ein Viertel der kürzeren Kante ist kein Detail: An
 * einem 20-mm-Bild wären 7 mm Rand zuzüglich Fuß mehr Karton als Bild.
 */
function randMm(rect: Rect, frame: FrameId): number {
  if (frame !== 'polaroid' && frame !== 'passepartout') return 0;
  const kurz = Math.min(rect.wMm, rect.hMm);
  const roh = klemme(kurz * RAND_ANTEIL, RAND_MIN_MM, RAND_MAX_MM);
  const platz = frame === 'polaroid' ? kurz / (2 + POLAROID_FUSS) : kurz / 4;
  return Math.min(roh, platz);
}

/**
 * Der Kasten, in dem das Bild steht – innerhalb seines Rahmens.
 *
 * Für Rahmen ohne Karton (`kontur`, `klebestreifen`) ist das der Außenkasten
 * selbst: Die Linie liegt mittig auf der Bildkante, der Streifen darüber. Beide
 * kosten keine Bildfläche, und ein Inset von null ist hier die richtige Antwort
 * und nicht ein vergessener Fall.
 */
export function frameInset(aussen: Rect, frame: FrameId): Rect {
  const rand = randMm(aussen, frame);
  if (rand <= 0) return aussen;

  const unten = frame === 'polaroid' ? rand * POLAROID_FUSS : rand;
  return {
    xMm: aussen.xMm + rand,
    yMm: aussen.yMm + rand,
    wMm: aussen.wMm - 2 * rand,
    hMm: aussen.hMm - rand - unten,
  };
}

/** Dreht einen Punkt im Uhrzeigersinn um einen anderen. */
function drehe(
  p: { xMm: number; yMm: number },
  um: { xMm: number; yMm: number },
  deg: number,
): { xMm: number; yMm: number } {
  if (deg === 0) return p;
  const bogen = (deg * Math.PI) / 180;
  const cos = Math.cos(bogen);
  const sin = Math.sin(bogen);
  const dx = p.xMm - um.xMm;
  const dy = p.yMm - um.yMm;
  return { xMm: um.xMm + dx * cos - dy * sin, yMm: um.yMm + dx * sin + dy * cos };
}

export interface FrameBoxes {
  /** Vor dem Bild zu zeichnen: Karton und Schatten. */
  hinter: RenderBox[];
  /** Nach dem Bild zu zeichnen: Kontur und Klebestreifen. */
  davor: RenderBox[];
}

export interface FrameOptions {
  /** Der Platz, den der Rahmen samt Bild einnimmt. */
  aussen: Rect;
  frame: FrameId;
  /** Neigung des Bildes. Der Rahmen dreht mit, sonst löst er sich von ihm. */
  rotateDeg?: number;
  /**
   * Bildunterschrift im Fuß. Nur das Polaroid hat einen.
   *
   * Bewusst am Rahmen und nicht als freier `TextBlock`: Ein Block steht, wo man
   * ihn hingesetzt hat, und bliebe liegen, wenn das Bild umzieht. Die
   * Unterschrift gehört zum Bild und wandert mit ihm – deshalb sind das zwei
   * verschiedene Dinge und nicht zwei Wege zu demselben.
   */
  caption?: string;
  /**
   * Kennung des Slots, zu dem der Rahmen gehört.
   *
   * Gebraucht allein für die Unterschrift: Ihre Box braucht eine eigene
   * Kennung, und `caption` allein wäre auf einer Doppelseite mit zwei
   * Polaroids zweimal dieselbe – in der Vorschau ein doppelter React-Key.
   */
  slotId?: string;
}

/** Ob dieser Rahmen einen Fuß hat, in dem eine Unterschrift stehen kann. */
export function frameHatFuss(frame: FrameId): boolean {
  return frame === 'polaroid';
}

/**
 * Die Boxen, die den Rahmen ausmachen.
 *
 * Alle tragen denselben Drehpunkt wie das Bild: **die Mitte des Außenkastens**.
 * Beim Polaroid ist das nicht die Mitte des Bildes – der Fuß ist breiter –, und
 * genau deshalb muss der Punkt ausdrücklich mitgegeben werden. Ließe man jede
 * Box um ihre eigene Mitte fahren, rutschte das Bild im Karton, je stärker es
 * geneigt ist.
 *
 * Auch der Schatten dreht mit. Physikalisch müsste er stehen bleiben – die
 * Lichtquelle kippt ja nicht –, aber bei der Neigung, um die es geht (Vorgabe
 * 1,2°, Automatik höchstens 4°), ist der Unterschied kleiner als die
 * Schneidetoleranz. Ein Schatten in Weltkoordinaten wäre eine zweite Geometrie
 * für dieselbe Form.
 */
export function frameBoxes(opts: FrameOptions): FrameBoxes {
  const { aussen, frame } = opts;
  const drehung = opts.rotateDeg ?? 0;
  if (frame === 'keiner') return { hinter: [], davor: [] };

  const mitte = { xMm: aussen.xMm + aussen.wMm / 2, yMm: aussen.yMm + aussen.hMm / 2 };
  const gedreht = drehung !== 0 ? { rotateDeg: drehung, rotateAboutMm: mitte } : {};

  if (frame === 'kontur') {
    const kontur: RectBox = {
      kind: 'rect',
      ...aussen,
      // Fläche transparent halten: Die Kontur liegt über dem Bild, eine
      // gefüllte Box verdeckte es. `fill: 'none'` ist die eine Stelle, an der
      // eine RectBox nichts füllt.
      fill: 'none',
      stroke: KONTUR,
      strokeWidthMm: KONTUR_MM,
      ...gedreht,
    };
    return { hinter: [], davor: [kontur] };
  }

  if (frame === 'klebestreifen') {
    return { hinter: [], davor: klebestreifen(aussen, mitte, drehung) };
  }

  const rand = randMm(aussen, frame);
  const versatz = Math.max(SCHATTEN_MIN_MM, rand * SCHATTEN_ANTEIL);

  const schatten: RectBox = {
    kind: 'rect',
    xMm: aussen.xMm + versatz,
    yMm: aussen.yMm + versatz,
    wMm: aussen.wMm,
    hMm: aussen.hMm,
    fill: SCHATTEN,
    opacity: SCHATTEN_DECKUNG,
    ...gedreht,
  };

  const karton: RectBox = {
    kind: 'rect',
    ...aussen,
    fill: KARTON,
    // Nur das Passepartout bekommt die Kontur. Beim Polaroid gehört sie nicht
    // hin: Ein Sofortbild hat keine Umrandung, es hat einen Schatten.
    ...(frame === 'passepartout' ? { stroke: KONTUR, strokeWidthMm: KONTUR_MM } : {}),
    ...gedreht,
  };

  const beschriftung = unterschrift(aussen, frame, opts.caption, opts.slotId, gedreht);
  return { hinter: [schatten, karton], davor: beschriftung ? [beschriftung] : [] };
}

/**
 * Die Bildunterschrift im Fuß des Polaroids.
 *
 * Sie sitzt mittig im leeren Rand unter dem Bild, in der Handschrift und in
 * einer Größe, die sich aus der Fußhöhe ergibt – dieselbe Rechnung wie bei
 * jedem anderen Text im Buch (`textFontSizePt`).
 *
 * Passt der Satz nicht in die Breite, wird die Schrift kleiner statt der Text
 * abgeschnitten oder umgebrochen. Zwei Zeilen wären im Fuß eines Sofortbilds
 * kein Gestaltungsmittel, sondern ein Fehler, und ein abgeschnittener Satz
 * verschweigt, dass etwas fehlt. Die Breite ist geschätzt
 * (`estimatedTextWidthMm`) – sie entscheidet hier nur über die Größe, nie über
 * die Position, und bleibt damit innerhalb dessen, wofür die Schätzung
 * gedacht ist.
 */
function unterschrift(
  aussen: Rect,
  frame: FrameId,
  caption: string | undefined,
  slotId: string | undefined,
  gedreht: { rotateDeg?: number; rotateAboutMm?: { xMm: number; yMm: number } },
): TextBox | undefined {
  const text = caption?.trim();
  if (!text || !frameHatFuss(frame)) return undefined;

  const innen = frameInset(aussen, frame);
  const fussOben = innen.yMm + innen.hMm;
  const fussHoehe = aussen.yMm + aussen.hMm - fussOben;
  if (fussHoehe <= 0) return undefined;

  const rand = aussen.wMm * CAPTION_RAND;
  const breite = aussen.wMm - 2 * rand;

  const style = TEXT_STYLES.caption;
  const passend = textFontSizePt(fussHoehe, style);
  const geschaetzt = estimatedTextWidthMm(text, passend);
  const fontSizePt = geschaetzt > breite ? passend * (breite / geschaetzt) : passend;

  return {
    kind: 'text',
    xMm: aussen.xMm + rand,
    yMm: fussOben,
    wMm: breite,
    hMm: fussHoehe,
    slotId: slotId ? `caption-${slotId}` : 'caption',
    content: text,
    fontSizePt,
    weight: style.weight,
    family: CAPTION_FAMILY,
    align: 'center',
    // Die Farbe kommt aus dem Stil und nicht aus `textColorOn`: Dieser Text
    // steht auf dem hellen Karton, nicht auf dem Seitenhintergrund. Auf einer
    // Doppelseite in Anthrazit stünde sonst weiße Schrift auf weißem Grund.
    color: style.color,
    ...gedreht,
  };
}

/**
 * Zwei Streifen über gegenüberliegende Ecken.
 *
 * Beide laufen in derselben Richtung und nicht spiegelbildlich: Gespiegelt
 * ergeben sie ein Muster, gleichgerichtet sieht es aus, als hätte jemand das
 * Bild mit zwei Handgriffen befestigt. Die Maße wachsen mit dem Bild – ein
 * fester Streifen wäre am großen Bild ein Pflaster.
 */
function klebestreifen(
  aussen: Rect,
  mitte: { xMm: number; yMm: number },
  drehung: number,
): PolygonBox[] {
  const kurz = Math.min(aussen.wMm, aussen.hMm);
  const laenge = klemme(kurz * 0.22, 9, 26);
  const breite = laenge * 0.42;

  // Der Streifen liegt unter 45° über der Ecke. Achse a zeigt in seine
  // Längsrichtung (nach rechts oben), b quer dazu.
  const s = Math.SQRT1_2;
  const a = { x: s * (laenge / 2), y: -s * (laenge / 2) };
  const b = { x: s * (breite / 2), y: s * (breite / 2) };

  const ecken = [
    { xMm: aussen.xMm, yMm: aussen.yMm },
    { xMm: aussen.xMm + aussen.wMm, yMm: aussen.yMm + aussen.hMm },
  ];

  return ecken.map((ecke) => ({
    kind: 'polygon' as const,
    pointsMm: [
      { xMm: ecke.xMm - a.x - b.x, yMm: ecke.yMm - a.y - b.y },
      { xMm: ecke.xMm + a.x - b.x, yMm: ecke.yMm + a.y - b.y },
      { xMm: ecke.xMm + a.x + b.x, yMm: ecke.yMm + a.y + b.y },
      { xMm: ecke.xMm - a.x + b.x, yMm: ecke.yMm - a.y + b.y },
      // Die Drehung des Bildes steckt hier in den Punkten und nicht in einer
      // Transformation an der Box: Ein Polygon trägt seine Koordinaten absolut,
      // und zwei Wege, dieselbe Lage auszudrücken, laufen irgendwann
      // auseinander.
    ].map((p) => drehe(p, mitte, drehung)),
    fill: TAPE,
    opacity: TAPE_DECKUNG,
  }));
}
