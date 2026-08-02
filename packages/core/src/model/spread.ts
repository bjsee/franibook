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
