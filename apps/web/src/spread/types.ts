/**
 * Die Naht zwischen Gerüst und Editor.
 *
 * Was hier steht, gehört nicht der Doppelseite, sondern ihrem Platz im Buch:
 * blättern, festhalten, Seiten einfügen und löschen, den Zeitstrahl dieser einen
 * Seite abschalten. Es kommt aus `App.tsx`, weil dort das Projekt liegt — und es
 * geht unverändert durch alle drei Varianten, damit ein Wechsel der Variante
 * keine Funktion kostet.
 */
import type { GuideVisibility } from '@franibook/render-dom';

/** Eine Fotogruppe, soweit die Doppelseite sie betrifft. */
export interface SpreadGroup {
  id: string;
  title: string;
  active: boolean;
  /** Fotos dieser Gruppe auf dieser Doppelseite. */
  count: number;
}

export interface SpreadAussen {
  index: number;
  spreadCount: number;
  /** Jahrgang dieser Doppelseite, soweit bekannt. */
  jahr?: number | undefined;
  /** Die Jahrgänge des Buches – der Buchnavigator der Werkbank gliedert damit. */
  chapters: readonly { year: number; photoCount: number; firstSpreadIndex: number }[];
  /** Gruppen, die auf dieser Doppelseite liegen. */
  gruppen: readonly SpreadGroup[];
  /** Ob diese Doppelseite ein Neuanordnen unverändert übersteht. */
  locked: boolean;
  /** Ob sich einzelne Buchseiten daraus nehmen lassen. */
  splittable: boolean;
  /** Ob der Zeitstrahl auf dieser Seite steht. */
  hatZeitstrahl: boolean;
  /** Ob der Zeitstrahl überhaupt eingeschaltet ist. */
  zeitstrahlGlobal: boolean;
  /** Hintergrundfarbe, die als Vorgabe gilt. */
  hintergrundGlobal: string;
  minDpi: number;
  targetDpi: number;

  guides: GuideVisibility;
  onGuides: (g: GuideVisibility) => void;

  /**
   * Ob Aufnahmezeit und Ort über den Bildern stehen (`i`).
   *
   * Steht hier und nicht im Editor, obwohl nur die Bühne ihn zeichnet: Beim
   * Blättern setzt `App.tsx` die Doppelseite kurz auf `null`, der Editor hängt
   * dabei aus, und ein Schalter in seinem Zustand fiele mit ihm weg. Wer achtzig
   * Seiten mit eingeblendeten Daten durchsieht, hätte ihn achtzigmal neu
   * eingeschaltet — dieselbe Überlegung wie bei den Hilfslinien darüber.
   */
  infosSichtbar: boolean;
  onInfosSichtbar: (sichtbar: boolean) => void;

  /**
   * Ob der Fotopool aufgeklappt ist — aus demselben Grund von außen.
   *
   * Der Pool gehört dem Bestand und nicht dieser Doppelseite: Wer Bilder
   * verteilt, blättert mit offenem Pool. Der Rahmen entscheidet weiter, *wie* er
   * dasteht (Spalte im Fuß, Blatt über der Seite) — die Werkbank zeigt ihn ohne
   * Schalter und lässt ihn deshalb unbeachtet.
   */
  poolOffen: boolean;
  onPoolOffen: (offen: boolean) => void;

  onIndex: (index: number) => void;
  onLocked: (locked: boolean) => void;
  onZeitstrahl: (wert: boolean | null) => void;
  onEinfuegen: (at: number) => void;
  onSeiteLoeschen: (seite: 'left' | 'right') => void;
  onSpreadLoeschen: () => void;
  onGruppeOeffnen: (id: string) => void;
  /** Kennzahlen der Kopfzeile neu laden. */
  onGeaendert: () => void;
  /** Die Doppelseite verwerfen und neu holen – nach einer Darstellungsänderung. */
  onNeuRendern: () => void;
  /**
   * Die Pixel eines Bildes haben sich geändert (Ausrichtung gekippt).
   *
   * Zählt die Bildversion hoch, die an jeder Vorschau-Adresse hängt. Ohne das
   * bliebe das gedrehte Bild unsichtbar, weil Vorschauen `immutable` ausgeliefert
   * werden und die Fotokennung sich beim Kippen nicht ändert.
   */
  onBildGeaendert: () => void;
}
