/**
 * Seitenhintergrund: Farbe oder Foto.
 *
 * Weiß ist die sichere Vorgabe, aber über achtzig Doppelseiten hinweg wirkt es
 * leer. Ein Farbton trägt die Bilder, ohne mit ihnen zu konkurrieren — deshalb
 * die gedeckte Palette hier und keine freie Farbwahl: Ein kräftiges Blau hinter
 * Fotos ist in einem Fotobuch fast immer ein Fehler, und die Palette macht ihn
 * unmöglich, statt ihn zu erlauben und dann zu bereuen.
 *
 * **Zum Hintergrundbild.** Es füllt die Beschnittfläche formatfüllend, also
 * 606 × 306 mm bei diesem Profil. Bei 240 dpi verlangt das 5726 px lange Kante.
 * Am Zielbestand gemessen (820 Fotos, Median 2048 px): **kein einziges Foto**
 * erreicht 240 dpi, zwei erreichen 150 dpi, 106 erreichen 96 dpi. Die Funktion
 * gibt es trotzdem – aber sie prüft, und die Prüfung wird meist abraten. Das ist
 * der Sinn: Der Fehler soll vor dem Druck auffallen, nicht danach.
 */
import type { Photo } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';

export interface BackgroundColor {
  id: string;
  name: string;
  hex: string;
}

/**
 * Die wählbaren Hintergrundfarben.
 *
 * Gedeckte, leicht warme Töne plus zwei dunkle. Die hellen liegen dicht
 * beieinander – der Unterschied soll auf einer Doppelseite wirken, nicht beim
 * Vergleich zweier Farbfelder auffallen.
 */
export const BACKGROUND_COLORS: readonly BackgroundColor[] = [
  { id: 'weiss', name: 'Weiß', hex: '#ffffff' },
  { id: 'creme', name: 'Creme', hex: '#faf7f2' },
  { id: 'papier', name: 'Papier', hex: '#f4f1ea' },
  { id: 'sand', name: 'Sand', hex: '#eae5db' },
  { id: 'salbei', name: 'Salbei', hex: '#e2e7e2' },
  { id: 'nebel', name: 'Nebel', hex: '#e4e6ea' },
  { id: 'taupe', name: 'Taupe', hex: '#d9d3cb' },
  { id: 'anthrazit', name: 'Anthrazit', hex: '#3f3f46' },
  { id: 'tinte', name: 'Tinte', hex: '#1c1917' },
];

export const DEFAULT_BACKGROUND = '#ffffff';

/**
 * Empfohlene Mindestauflösung für ein Hintergrundbild.
 *
 * Deutlich unter der Mindestauflösung für Motive (240 dpi im Profil): Ein
 * Hintergrund liegt hinter Bildern und Text, seine Unschärfe fällt weniger auf
 * als bei einem Foto, das für sich stehen soll. Unter 150 dpi wird sie bei
 * formatfüllender Vergrößerung aber auch dort sichtbar.
 */
export const BACKGROUND_MIN_DPI = 150;

export interface BackgroundFit {
  /** Auflösung, mit der das Bild formatfüllend gedruckt würde. */
  dpi: number;
  /** Ob sie für einen Hintergrund reicht. */
  taugt: boolean;
  /** Pixel, die das Bild für `BACKGROUND_MIN_DPI` bräuchte. */
  benoetigtPx: number;
}

/**
 * Prüft, ob ein Foto als randabfallender Hintergrund taugt.
 *
 * Gerechnet wird auf die Beschnittfläche und formatfüllend: Maßgeblich ist die
 * Kante, die stärker vergrößert werden muss – ein Panorama scheitert an der
 * Höhe, ein Hochformat an der Breite.
 */
export function backgroundFit(photo: Photo, profile: PrintProfile): BackgroundFit {
  const wMm = spreadWidthMm(profile);
  const hMm = spreadHeightMm(profile);
  const skala = Math.max(wMm / photo.width, hMm / photo.height);
  const dpi = 25.4 / skala;
  return {
    dpi,
    taugt: dpi >= BACKGROUND_MIN_DPI,
    benoetigtPx: Math.ceil((Math.max(wMm, hMm) / 25.4) * BACKGROUND_MIN_DPI),
  };
}

/**
 * Relative Helligkeit einer Farbe nach WCAG.
 *
 * Gebraucht für die Entscheidung, ob Text darauf dunkel oder hell stehen muss.
 * Die Gewichte sind nicht willkürlich: Das Auge nimmt Grün deutlich heller wahr
 * als Blau, ein Mittelwert der Kanäle würde Anthrazit und Salbei gleich
 * behandeln.
 */
export function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const teil = (i: number) => parseInt(n.slice(i * 2, i * 2 + 2), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(teil(0)) + 0.7152 * linear(teil(1)) + 0.0722 * linear(teil(2));
}

/**
 * Textfarbe, die auf diesem Hintergrund lesbar ist.
 *
 * Wird gebraucht, sobald der Hintergrund dunkel ist: Die Jahreszahl auf
 * Anthrazit in Schwarz zu setzen ergäbe eine unsichtbare Überschrift. Die
 * Entscheidung fällt hier und nicht im Renderer – sie gehört zur Geometrie des
 * Buches, nicht zur Darstellung.
 */
export function textColorOn(background: string, gewuenscht: string): string {
  const hell = luminance(background) > 0.45;
  if (hell) return gewuenscht;
  // Auf dunklem Grund die Helligkeit umkehren, den Farbcharakter behalten:
  // Aus dem dunklen Grau der Zeitstrahlbeschriftung wird ein helles.
  return luminance(gewuenscht) < 0.2 ? '#f4f4f5' : '#fafafa';
}
