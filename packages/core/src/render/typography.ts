/**
 * Typografie: Schrift, Textstile, Grundlinie.
 *
 * Hier steht alles, was beide Renderer über Text wissen müssen – und nur das.
 * Die Schriftdateien selbst liegen in `@franibook/fonts`; dieses Modul bleibt
 * frei von I/O, damit `core` im Browser lauffähig bleibt.
 *
 * Warum die Grundlinie im Kern und nicht im Renderer? Weil sie eine
 * Layoutentscheidung ist. Vor Issue #5 zentrierte die Vorschau den Text in
 * einer CSS-Zeilenbox, während pdfkit vom Kastenoberrand aus setzte – bei
 * einem 13-mm-Titelkasten sind das rund 4 mm Höhenunterschied für denselben
 * Text, und keiner der beiden Adapter war dabei „falsch“. Genau solche
 * Doppelrechnungen soll das RSM verhindern: Der Kern legt die Grundlinie fest,
 * die Adapter treffen sie nur noch mit ihren eigenen Mitteln.
 */
import { mmToPt, ptToMm } from '../geometry/units.js';

/**
 * Die Buchschrift.
 *
 * Abgeleitet von Source Sans 3 (Adobe, SIL Open Font License 1.1). Umbenannt,
 * weil „Source“ ein Reserved Font Name der OFL ist und wir eine geänderte
 * Fassung ausliefern: statische Instanzen aus der Variable Font, Zeichensatz
 * auf Latein reduziert. Herkunft und verworfene Alternativen stehen in
 * `packages/fonts/HERKUNFT.md`.
 *
 * Bewusst ohne Fallback-Stack: Griffe der Browser auf eine Systemschrift
 * zurück, liefe die Vorschau lautlos gegen eine andere Schrift als das PDF.
 * Ohne Fallback fällt das sofort auf – und der Parity-Test meldet es.
 */
export const BOOK_FONT_FAMILY = 'Franibook Sans';

/** Die beiden eingebetteten Schnitte. Mehr braucht das Buch bisher nicht. */
export const FONT_WEIGHTS = ['regular', 'semibold'] as const;

export type FontWeight = (typeof FONT_WEIGHTS)[number];

export type FontFamilyId = 'sans' | 'serif' | 'hand' | 'display';

export interface FontFamily {
  id: FontFamilyId;
  /** Name in der Oberfläche – sagt, wofür sie taugt, nicht wie sie heißt. */
  label: string;
  /** Familienname für CSS und für die Registrierung im PDF. */
  cssName: string;
  /** Welche Schnitte es gibt. Nicht jede Familie hat einen zweiten. */
  weights: readonly FontWeight[];
}

/**
 * Die Schriften des Buches.
 *
 * Alle vier liegen als Datei im Repo und werden ins PDF eingebettet – der
 * Druckdienstleister verlangt das, und ohne Einbettung hinge das Ergebnis an
 * seiner Schriftenliste. Dieselben Dateien lädt die Vorschau: Zwei Fassungen
 * derselben Schrift wären eine Parity-Abweichung mit Ansage.
 *
 * `sans` ist die Buchschrift und die Vorgabe; alles, was die Engine selbst
 * setzt – Jahreszahlen, Zeitstrahl, Auftakttitel –, steht in ihr. Die übrigen
 * drei stehen nur für von Hand gesetzte Textblöcke zur Wahl, und zwar für
 * verschiedene Zwecke, nicht als Geschmackssache: eine Serife für längere
 * Zeilen, eine Handschrift für Persönliches, eine Display für ein großes Wort.
 *
 * Herkunft, Lizenzen und verworfene Alternativen: `packages/fonts/HERKUNFT.md`.
 */
export const FONT_FAMILIES: readonly FontFamily[] = [
  {
    id: 'sans',
    label: 'Buchschrift',
    cssName: BOOK_FONT_FAMILY,
    weights: ['regular', 'semibold'],
  },
  { id: 'serif', label: 'Serife', cssName: 'Crimson Text', weights: ['regular', 'semibold'] },
  { id: 'hand', label: 'Handschrift', cssName: 'Kalam', weights: ['regular', 'semibold'] },
  // Nur ein Schnitt: Abril Fatface ist selbst schon fett, ein zweiter wäre
  // keine Steigerung, sondern ein Klumpen.
  { id: 'display', label: 'Plakativ', cssName: 'Abril Fatface', weights: ['regular'] },
];

export function fontFamily(id: FontFamilyId): FontFamily {
  const f = FONT_FAMILIES.find((x) => x.id === id);
  if (!f) throw new Error(`Schriftfamilie nicht gefunden: ${id}`);
  return f;
}

/**
 * Der Schnitt, den diese Familie tatsächlich hat.
 *
 * Wer „halbfett" wählt und dann auf eine Familie mit nur einem Schnitt
 * wechselt, soll seinen Text behalten und nicht eine Fehlermeldung bekommen.
 */
export function resolveWeight(id: FontFamilyId, weight: FontWeight): FontWeight {
  const f = fontFamily(id);
  return f.weights.includes(weight) ? weight : f.weights[0]!;
}

/** Schnittname → CSS-`font-weight`. */
export const CSS_FONT_WEIGHT: Record<FontWeight, number> = {
  regular: 400,
  semibold: 600,
};

/**
 * Metriken der eingebetteten Schnitte, in Einheiten je Em.
 *
 * Aus den Schriftdateien gelesen; `packages/fonts/src/index.test.ts` hält die
 * Werte gegen die tatsächlichen Tabellen. Beide Schnitte teilen dieselben
 * Werte – sonst müsste die Grundlinie je Schnitt gerechnet werden.
 *
 * `capHeight` ist der einzige Wert, der in die Geometrie eingeht:
 * Schriftgröße und Grundlinie hängen an der Versalhöhe, weil das die Größe
 * ist, die man auf der Seite tatsächlich sieht.
 */
export const FONT_METRICS = {
  unitsPerEm: 1000,
  /** hhea.ascent, identisch zu OS/2.sTypoAscender. */
  ascender: 1024,
  descender: -400,
  capHeight: 660,
} as const;

/** Versalhöhe als Anteil der Em-Größe: 0,66. */
const CAP_PER_EM = FONT_METRICS.capHeight / FONT_METRICS.unitsPerEm;

/**
 * Versalhöhe je Familie, als Anteil der Em-Größe.
 *
 * Aus den Schriftdateien gelesen, geprüft in `packages/fonts/src/index.test.ts`.
 * Die Werte gehen auseinander – Kalam steht mit 0,739 em zwölf Prozent über der
 * Buchschrift –, und weil die Grundlinie am Versalband hängt, muss sie je
 * Familie gerechnet werden. Mit einem festen Wert säße dieselbe Zeile in
 * derselben Box je nach Schrift sichtbar anders; die Parität litte nicht (beide
 * Adapter rechnen gleich), die Optik schon.
 */
const CAP_PER_EM_BY_FAMILY: Record<FontFamilyId, number> = {
  sans: 660 / 1000,
  serif: 656 / 1024,
  hand: 739 / 1000,
  display: 700 / 1000,
};

export type TextStyleName = 'yearLarge' | 'groupTitle' | 'body' | 'timelineYear' | 'timelineLabel';

export interface TextStyle {
  weight: FontWeight;
  /**
   * Versalhöhe als Anteil der Kastenhöhe.
   *
   * Nicht die Schriftgröße in Punkt: Ein Template gilt für 21×21 cm wie für
   * 30×30 cm, eine feste Punktgröße würde im kleineren Format zu groß wirken.
   * Und nicht die Em-Größe: Die ist bei gleicher Optik von Schnitt zu Schnitt
   * verschieden, die Versalhöhe ist es nicht.
   */
  capHeightRatio: number;
  color: string;
}

/**
 * Die Textstile des Buchs.
 *
 * `capHeightRatio: 0.462` ist keine neue Setzung, sondern die alte:
 * 0,7 × Kastenhöhe als Em-Größe entspricht bei einer Versalhöhe von 0,66 em
 * genau 0,462 × Kastenhöhe als Versalhöhe. Die Umstellung begründet die Größe,
 * ohne die Optik zu verschieben; die Stile unterscheiden sich zunächst nur im
 * Schnitt. Bildunterschriften bekommen ihren eigenen Eintrag, sobald es sie
 * gibt – ein ungenutzter Stil mit geratenen Werten wäre nichts wert.
 */
export const TEXT_STYLES: Record<TextStyleName, TextStyle> = {
  // Jahreszahl auf dem Kapitelauftakt: 44-mm-Kasten → 20,3 mm Versalhöhe.
  // Regular, weil eine Zahl in dieser Größe von sich aus genug Gewicht hat.
  yearLarge: { weight: 'regular', capHeightRatio: 0.462, color: '#000000' },
  // Gruppentitel über einer Collage: 13-mm-Kasten → 6,0 mm Versalhöhe.
  // Halbfett, damit er neben den Bildern nicht verschwindet.
  groupTitle: { weight: 'semibold', capHeightRatio: 0.462, color: '#000000' },
  // Fortlaufender Text, etwa die Jahresereignisse auf dem Kapitelauftakt.
  body: { weight: 'regular', capHeightRatio: 0.462, color: '#000000' },
  // Zeitstrahl: Beide Stile sitzen im 14 mm hohen Fußraum und sind mit 4 bzw.
  // 3,5 mm Kastenhöhe die kleinsten Schriften im Buch. Die Jahreszahl ist
  // halbfett, weil sie als Anker dient; das Label bleibt zurückhaltend, damit
  // der Fuß der Seite ruhig wirkt. Dunkelgrau statt Schwarz: Der Zeitstrahl
  // begleitet die Fotos, er konkurriert nicht mit ihnen.
  timelineYear: { weight: 'semibold', capHeightRatio: 0.462, color: '#3f3f46' },
  timelineLabel: { weight: 'regular', capHeightRatio: 0.462, color: '#3f3f46' },
};

/**
 * Stil zu einem Namen aus dem Template.
 *
 * Templates führen den Stilnamen als Zeichenkette (`library.json`). Ein
 * unbekannter Name darf keine Doppelseite kosten – der Titelstil ist die
 * neutrale Rückfallebene.
 */
export function textStyle(name: string): TextStyle {
  return TEXT_STYLES[name as TextStyleName] ?? TEXT_STYLES.groupTitle;
}

/**
 * Schriftgröße in Punkt, damit die Versalhöhe den vom Stil vorgegebenen Anteil
 * der Kastenhöhe einnimmt.
 */
export function textFontSizePt(boxHeightMm: number, style: TextStyle): number {
  return mmToPt((boxHeightMm * style.capHeightRatio) / CAP_PER_EM);
}

/**
 * Grundlinie einer Textzeile, in Millimetern von der Oberkante ihres Kastens.
 *
 * Mittig gesetzt wird das Versalband, nicht die Zeilenbox: „2024“ hat keine
 * Unterlängen, „Sylt“ hat keine – wer die Zeilenbox mittet, schiebt beide um
 * die halbe Unterlänge nach oben und wundert sich, warum die Jahreszahl im
 * Kasten hängt.
 */
export function textBaselineOffsetMm(
  boxHeightMm: number,
  fontSizePt: number,
  family: FontFamilyId = 'sans',
): number {
  const capMm = ptToMm(fontSizePt) * (CAP_PER_EM_BY_FAMILY[family] ?? CAP_PER_EM);
  return boxHeightMm / 2 + capMm / 2;
}
