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
import type { FontFamilyId } from '../render/typography.js';
import type { PhotoId } from '../model/photo.js';
import type { MosaicCropMode } from '../mosaic/mosaic.js';

/**
 * Ein Titelbild, das aus vielen kleinen Fotos zusammengesetzt ist.
 *
 * Gespeichert wird die **Anweisung**, nicht das Ergebnis: Welcher Text, welches
 * Zielbild, wie fein das Raster. Das Bild selbst backt der Server daraus
 * (`apps/server/src/mosaik/`) und legt es in den Cache — es hängt am Bestand
 * und wäre im Projekt ein zweiter Stand, der veraltet.
 *
 * `text` und `photoId` schließen einander nicht aus: Beide zusammen ergeben
 * eine Ziffer, die das Motiv des Zielbilds trägt. Ohne beides bleibt ein
 * gleichmäßiges Feld aus Bildern.
 */
export interface CoverMosaic {
  /** Der Text, dessen Form gefüllt wird — etwa „18". */
  text?: string;
  /** Schriftfamilie der Form. Ohne Angabe die plakative. */
  family?: FontFamilyId;
  /** Foto aus dem Bestand, dessen Motiv nachgebaut wird. */
  photoId?: PhotoId;
  /**
   * Spalten des Rasters. Die Zeilenzahl folgt aus der Form der Fläche.
   *
   * Der eine Regler, der alles verändert: Wenige Spalten zeigen große,
   * erkennbare Bilder und eine grobe Form, viele das Gegenteil.
   */
  cols: number;
  crop?: MosaicCropMode;
  /** Fugenbreite als Anteil der Zellkante. */
  gap?: number;
  /** Einfärbung zur Zielfarbe, 0..1. Ohne Zielbild wirkungslos. */
  tint?: number;
  /**
   * Wie stark eine Wiederholung bestraft wird, in Lab-Einheiten.
   *
   * Der Regler zwischen **Vielfalt und Vorlagentreue**: Hoch angesetzt kommen
   * mehr verschiedene Aufnahmen ins Bild, aber jede sitzt an einer schlechter
   * passenden Stelle. Bei einer reinen Textform kostet er nichts — dort gibt es
   * keine Wunschfarbe, gegen die er abgewogen werden müsste.
   */
  reuseCost?: number;
  /** Rand um eine Textform, als Anteil der kürzeren Flächenkante. */
  padding?: number;
  /** Kacheln außerhalb der Textform statt innerhalb. */
  inverted?: boolean;
  /** Variation ohne Zufall — wie `settings.seed` im Buch. */
  seed?: number;
}

export interface CoverDesign {
  /** Titelbild. Läuft randabfallend über die ganze Vorderseite. */
  frontPhotoId?: PhotoId;
  frontCrop?: Crop;
  /**
   * Titelbild aus vielen kleinen Fotos.
   *
   * Schlägt `frontPhotoId`: Wer ein Mosaik gesetzt hat, will es sehen, und das
   * vorbelegte Titelbild bliebe sonst als stille Konkurrenz stehen. Gelöscht
   * wird es, indem das Feld entfernt wird — dann gilt wieder das einzelne Foto.
   */
  frontMosaic?: CoverMosaic;
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

/**
 * Vorgabe für ein neu angelegtes Titelmosaik.
 *
 * 44 Spalten sind am echten Bestand eingestellt: Eine „18" belegt damit rund
 * 660 der 1936 Zellen, also 660 verschiedene Fotos bei 971 im Bestand — jedes
 * höchstens einmal, und die Kacheln sind auf 280 mm noch gut 6 mm groß.
 */
export const DEFAULT_COVER_MOSAIC: CoverMosaic = { cols: 44 };

/**
 * Grenzen der Rasterweite.
 *
 * Nach unten wären weniger als vier Spalten kein Mosaik mehr, sondern eine
 * Collage aus vier Bildern. Nach oben ist die Grenze eine Notbremse und keine
 * Gestaltungsaussage: Die Zellenzahl wächst quadratisch, und ein `cols: 20000`
 * aus einem vertippten Aufruf hieße 400 Millionen Zellen und ein 160 000 px
 * breites Zwischenbild — der Server hält genau ein Projekt und wäre danach weg.
 * 120 Spalten sind auf 280 mm gut 2 mm je Kachel; darüber sieht man ohnehin nur
 * noch Farbe.
 *
 * Die Werte stehen im Kern, weil beide Seiten sie brauchen: Die Oberfläche
 * begrenzt damit ihren Regler, die Route weist damit einen unbrauchbaren
 * Parameter ab. Zwei Zahlen wären zwei Gelegenheiten, sie auseinanderlaufen zu
 * lassen.
 */
export const MIN_MOSAIC_COLS = 4;
export const MAX_MOSAIC_COLS = 120;

/**
 * Ob eine Mosaikanweisung brauchbar ist — und wenn nicht, warum.
 *
 * Der Rumpf von `PATCH /api/cover` kommt ungeprüft aus dem Netz und wird in den
 * Projektzustand gespreizt. Ein unbrauchbarer Parameter ist nach
 * `.claude/rules/server.md` ein `400` mit Satz und keine stille Zurechtbiegung:
 * Wer 20 000 Spalten schickt, hat sich vertippt, und ein stillschweigend auf
 * 120 geklemmtes Ergebnis verschwiege ihm das.
 */
export function pruefeCoverMosaic(m: CoverMosaic): string | undefined {
  if (!Number.isFinite(m.cols)) return 'Die Rasterweite ist keine Zahl';
  if (m.cols < MIN_MOSAIC_COLS || m.cols > MAX_MOSAIC_COLS) {
    return `Die Rasterweite muss zwischen ${MIN_MOSAIC_COLS} und ${MAX_MOSAIC_COLS} Spalten liegen`;
  }
  for (const [feld, wert] of [
    ['Fuge', m.gap],
    ['Einfärbung', m.tint],
    ['Rand', m.padding],
  ] as const) {
    if (wert !== undefined && (!Number.isFinite(wert) || wert < 0 || wert > 1)) {
      return `${feld} muss zwischen 0 und 1 liegen`;
    }
  }
  if (m.reuseCost !== undefined && (!Number.isFinite(m.reuseCost) || m.reuseCost < 0)) {
    return 'Die Vielfalt darf nicht negativ sein';
  }
  if (m.seed !== undefined && !Number.isFinite(m.seed)) return 'Der Seed ist keine Zahl';
  // Ein sehr langer Text ergibt kein sinnvolles Bild, und die Glyphenkonturen
  // aller Zeichen landen in einem SVG — hier ist eine Grenze billiger als eine
  // Zwischenstufe von unabsehbarer Breite.
  if (m.text !== undefined && m.text.length > 40) return 'Die Form ist auf 40 Zeichen begrenzt';
  return undefined;
}

/**
 * Reserviertes Präfix der Kennung, unter der ein gebackenes Mosaik läuft.
 *
 * Es ist kein Foto des Bestands, muss aber wie eines durch `renderCover` und
 * beide Renderer laufen — sonst bräuchte die `ImageBox` einen zweiten Begriff
 * für ihre Bildquelle, und jeder Adapter eine zweite Fallunterscheidung. Statt
 * dessen erkennen die beiden Auflöser (`resolvePhoto` im Export, `imageSrc` in
 * der Vorschau) das Präfix und greifen in den Cache.
 *
 * Ein Doppelpunkt kann in einer echten Fotokennung nicht vorkommen: Die ist ein
 * Hexadezimal-Hash.
 */
export const MOSAIC_ID_PREFIX = 'mosaik:';

/** Ob eine Kennung auf ein gebackenes Mosaik zeigt statt auf ein Foto. */
export function istMosaikId(id: PhotoId): boolean {
  return id.startsWith(MOSAIC_ID_PREFIX);
}

/** Ergänzt ein gespeichertes Cover um die Vorgaben. */
export function withCoverDefaults(design: CoverDesign | undefined): CoverDesign {
  return { ...DEFAULT_COVER_DESIGN, ...design };
}
