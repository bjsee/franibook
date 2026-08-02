/**
 * Doppelseiten im Buch.
 */
import type { Crop } from './crop.js';
import type { PhotoId } from './photo.js';
import type { TemplateId } from './template.js';

export type SpreadId = string;

export interface SlotAssignment {
  slotId: string;
  /** `null` bedeutet: bewusst leer gelassen, nicht "noch nicht befüllt". */
  photoId: PhotoId | null;
  crop: Crop;
  /**
   * Von Hand gesetzte Neigung in Grad, im Uhrzeigersinn.
   *
   * Fehlt der Wert, bestimmt ihn `render/tilt.ts` aus Slot, Foto und Seed. Der
   * Unterschied zu einer gesetzten `0` ist deshalb bedeutsam: `undefined`
   * heißt „automatisch", `0` heißt „ausdrücklich geradestellt". Genau dafür
   * ist das Feld da – die Automatik wird auf einzelnen Seiten unglücklich, und
   * dann will man ein Bild geraderücken, ohne den Seed des ganzen Buchs
   * anzufassen.
   */
  rotateDeg?: number;
  /**
   * Von Hand gesetzte Position und Größe, normiert wie ein Templateslot.
   *
   * Ohne Angabe gilt der Platz aus der Vorlage. Mit Angabe verlässt das Bild
   * das Raster: Es steht dort, wo jemand es hingezogen hat, in der Größe, die
   * er ihm gegeben hat.
   *
   * Bewusst normiert und nicht in Millimetern – dieselbe Rechnung wie bei den
   * Vorlagen, damit ein Wechsel des Druckprofils von 30×30 auf 21×21 cm die
   * Handarbeit nicht zerreißt. Und bewusst am Slot und nicht als eigene
   * Boxart: Es bleibt derselbe Platz mit demselben Foto, demselben Ausschnitt
   * und derselben Neigung, nur an einer anderen Stelle.
   */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface TextElement {
  id: string;
  role: 'year' | 'eventTitle' | 'caption' | 'place' | 'freeText';
  content: string;
  /** Verweist auf einen Textslot des Templates. */
  slotId: string;
}

export interface Spread {
  id: SpreadId;
  index: number;
  templateId: TemplateId;
  slots: SlotAssignment[];
  texts?: TextElement[];
  /** Von "Buch neu generieren" ausgenommen. */
  locked?: boolean;
  /**
   * Hintergrundfarbe dieser Doppelseite. Ohne Angabe gilt die globale Vorgabe.
   */
  background?: string;
  /**
   * Foto als randabfallender Hintergrund. Schlägt die Farbe.
   *
   * Ob die Auflösung dafür reicht, prüft `backgroundFit`; sie tut es bei diesem
   * Bestand fast nie. Das Feld bleibt trotzdem eine Entscheidung des Benutzers –
   * die Engine setzt sie um und meldet, was sie davon hält.
   */
  backgroundPhotoId?: PhotoId;
  /**
   * Zeitstrahl auf dieser Doppelseite. Ohne Angabe gilt die globale Vorgabe.
   *
   * Übersteht den Neuaufbau und ein handbearbeitetes Layout-Dokument, geht beim
   * vollen Neugenerieren aber verloren – wie jede andere Eigenschaft einer
   * Doppelseite, die die Engine neu erzeugt.
   */
  timeline?: boolean;
}
