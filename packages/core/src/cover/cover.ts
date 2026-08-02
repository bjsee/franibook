/**
 * Cover-Datenmodell.
 *
 * Der Umschlag ist kein Spread: Er hat kein Template, keine Slotbibliothek und
 * keine Vorlagenwahl. Seine Felder liegen fest (Rückseite, Rücken,
 * Vorderseite), und was der Benutzer bestimmt, ist deshalb kurz: je ein Bild
 * für Vorder- und Rückseite, ein Titel, ein Untertitel, ein Rückentext.
 *
 * Bewusst verworfen: das Cover als sechstes Template im Innenteil zu führen.
 * Die Slotkoordinaten des Innenteils sind auf die Doppelseite normiert, deren
 * Breite von der Seitenzahl unabhängig ist – die Coverbreite ist es nicht.
 * Ein Template hätte für jede Seitenzahl andere normierte Koordinaten
 * gebraucht.
 *
 * Gestaltung: schlicht, und zwar aus einem Grund, der nichts mit Geschmack zu
 * tun hat. Der Titel steht auf einem deckenden Balken am unteren Rand der
 * Vorderseite, nicht frei über dem Bild. Weiße Schrift direkt auf dem Foto ist
 * nur lesbar, solange das Bild an dieser Stelle dunkel ist – und welches Foto
 * dort landet, entscheidet der Benutzer später. Ein deckender Balken ist die
 * einzige Variante, die für jedes Bild funktioniert, und er kommt ohne
 * Transparenz aus (Saal verlangt Transparenzreduzierung).
 */
import type { Crop } from '../model/crop.js';
import type { PhotoId } from '../model/photo.js';

export interface CoverDesign {
  /** Titelbild. Läuft randabfallend über die ganze Vorderseite. */
  frontPhotoId?: PhotoId;
  frontCrop?: Crop;
  /** Bild der Rückseite. Ohne Angabe bleibt sie einfarbig. */
  backPhotoId?: PhotoId;
  backCrop?: Crop;

  /** Titel auf der Vorderseite. Leer lassen heißt: kein Titel. */
  title?: string;
  subtitle?: string;
  /** Text auf dem Buchrücken. Wird bei zu schmalem Rücken weggelassen. */
  spineText?: string;
  /** Kurzer Text unten auf der Rückseite, etwa der Zeitraum. */
  backText?: string;

  /** Grundfarbe des Bogens, sichtbar, wo kein Bild liegt. */
  background?: string;
  /** Farbe von Rücken und Titelbalken. */
  accent?: string;
  /** Schriftfarbe auf Rücken und Titelbalken. */
  accentText?: string;
}

/**
 * Ein Cover, das ohne jede Eingabe druckbar ist.
 *
 * Fast schwarz statt reinem Schwarz: Ein 100-%-Schwarz wirkt im Digitaldruck
 * auf mattem Papier häufig fleckig, 90 % deckt gleichmäßiger. Das ist eine
 * Gestaltungsvorgabe, kein Profilwert – deshalb steht sie hier und nicht im
 * `PrintProfile`.
 */
export const DEFAULT_COVER_DESIGN: CoverDesign = {
  background: '#ffffff',
  accent: '#1a1a1a',
  accentText: '#ffffff',
};

/** Ergänzt ein gespeichertes Cover um die Vorgaben. */
export function withCoverDefaults(design: CoverDesign | undefined): CoverDesign {
  return { ...DEFAULT_COVER_DESIGN, ...design };
}
