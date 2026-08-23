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
 *
 * **Und deshalb gibt es ihn auch je Buchseite** (`backgroundArea`): Über eine
 * halbe Doppelseite gerechnet verdoppelt sich die Auflösung fast — am Bestand
 * vom 21.8.2026 (962 Fotos) steigt der Median von 71 auf 141 dpi. Die Schwelle
 * von 150 dpi bleibt davon unberührt und wird auch knapp verfehlt: 14 Fotos
 * bestehen sie statt einem. Bei 140 dpi wären es 869 — die Kante liegt also
 * genau dort, wo dieser Bestand liegt, und das ist der Grund, die Zahl am Bild
 * zu zeigen, statt sie zu verschieben.
 */
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
 * Ob ein Wert einer der wählbaren Hintergrundfarben entspricht.
 *
 * Analog zu `isFrameId`: eine geschlossene Liste und kein freier Farbwähler –
 * aus demselben Grund wie bei `BACKGROUND_COLORS` selbst. Groß-/Kleinschreibung
 * des Hexcodes ist gleichgültig, `PATCH /api/settings` und `setSpreadBackground`
 * prüfen beide gegen diese Funktion, statt einen Wert ungeprüft zu übernehmen.
 */
export function isBackgroundColor(wert: unknown): wert is string {
  return (
    typeof wert === 'string' &&
    BACKGROUND_COLORS.some((c) => c.hex.toLowerCase() === wert.toLowerCase())
  );
}

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
  /**
   * Pixel, die das Bild für `BACKGROUND_MIN_DPI` bräuchte — an der Kante, die
   * **klemmt**.
   *
   * Nicht an der langen Kante der Fläche: Welche Seite stärker vergrößert
   * werden muss, hängt am Foto. Über eine Buchseite ist es fast immer die Höhe,
   * und der Satz „1630 px nötig, dieses hat 2048" nannte dann zwei Zahlen zu
   * verschiedenen Kanten — er las sich, als wäre alles in Ordnung.
   */
  benoetigtPx: number;
  /** Was das Foto an genau dieser Kante mitbringt. */
  vorhandenPx: number;
}

/** So viel vom Profil braucht die Hintergrundrechnung – und die Oberfläche hat es. */
type Seitenmasse = { page: { trimWidthMm: number; trimHeightMm: number; bleedMm: number } };

/**
 * Die Fläche, die ein Hintergrundbild deckt – ganze Doppelseite oder eine
 * Buchseite.
 *
 * Eine Buchseite reicht bis an die Falzachse und hat nur **außen** Beschnitt;
 * innen stößt sie an ihre Nachbarin, und ein Zuschlag dort wäre ein Streifen,
 * den niemand druckt. In der Höhe ändert sich nichts, und genau das ist der
 * Grund, warum die halbe Fläche die Auflösung nicht verdoppelt: Bei diesem
 * Bestand ist die kurze Kante der Engpass, nicht die lange.
 */
export function backgroundArea(
  profile: Seitenmasse,
  side?: 'left' | 'right',
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const hMm = spreadHeightMm(profile);
  if (!side) return { xMm: 0, yMm: 0, wMm: spreadWidthMm(profile), hMm };

  const halb = profile.page.trimWidthMm + profile.page.bleedMm;
  const achse = profile.page.bleedMm + profile.page.trimWidthMm;
  return side === 'left'
    ? { xMm: 0, yMm: 0, wMm: halb, hMm }
    : { xMm: achse, yMm: 0, wMm: halb, hMm };
}

/**
 * Prüft, ob ein Foto als randabfallender Hintergrund taugt.
 *
 * Gerechnet wird auf die Beschnittfläche und formatfüllend: Maßgeblich ist die
 * Kante, die stärker vergrößert werden muss – ein Panorama scheitert an der
 * Höhe, ein Hochformat an der Breite. Mit `side` gilt die Rechnung für eine
 * einzelne Buchseite; ohne sie für die ganze Doppelseite.
 *
 * Profil und Foto sind auf das verengt, was die Rechnung braucht — wie bei
 * `sideAxisPasst`: So rechnet die Oberfläche im Bildwähler mit **dieser**
 * Funktion und nicht mit einer zweiten, die dasselbe anders ergibt. Sie hat dort
 * nur die Fotoliste aus `/api/photos`, kein `Photo` des Modells; die Maße darin
 * sind bereits die aufgelösten (`effectivePhoto`), also die richtigen.
 */
export function backgroundFit(
  photo: { width: number; height: number },
  profile: Seitenmasse,
  side?: 'left' | 'right',
): BackgroundFit {
  const { wMm, hMm } = backgroundArea(profile, side);
  const skalaBreite = wMm / photo.width;
  const skalaHoehe = hMm / photo.height;
  const skala = Math.max(skalaBreite, skalaHoehe);
  const dpi = 25.4 / skala;
  // Die klemmende Kante ist die mit der größeren Skala – sie bestimmt die
  // Auflösung, und nur über sie ist die Auskunft „so viel fehlt" wahr.
  const engpassMm = skalaBreite >= skalaHoehe ? wMm : hMm;
  return {
    dpi,
    taugt: dpi >= BACKGROUND_MIN_DPI,
    benoetigtPx: Math.ceil((engpassMm / 25.4) * BACKGROUND_MIN_DPI),
    vorhandenPx: skalaBreite >= skalaHoehe ? photo.width : photo.height,
  };
}

/**
 * Hintergrundfarben, die als Kapitelfarbe taugen.
 *
 * Weiß fehlt hier, sonst wären einzelne Jahrgänge weiß und der Wechsel wirkte
 * wie ein Versehen. Die beiden dunklen fehlen ebenfalls: Über einen ganzen
 * Jahrgang getragen kippt Anthrazit von „ruhig" nach „Trauerband", und die
 * Fotos stehen darauf schwerer. Sie bleiben für die Handauswahl je Doppelseite.
 */
const CHAPTER_TONES: readonly string[] = ['creme', 'papier', 'sand', 'salbei', 'nebel', 'taupe']
  .map((id) => BACKGROUND_COLORS.find((c) => c.id === id)?.hex)
  .filter((hex): hex is string => hex !== undefined);

/**
 * Weist jedem Jahrgang eine Hintergrundfarbe zu.
 *
 * Zwei Zusagen: Benachbarte Jahre haben nie denselben Ton – sonst wäre der
 * Kapitelwechsel farblich unsichtbar und die Abwechslung wäre keine. Und das
 * Ergebnis hängt allein von Jahren und Seed ab, nicht von der Reihenfolge des
 * Aufrufs; dasselbe Buch bekommt zweimal dieselben Farben (Regel 4).
 *
 * Der Seed verschiebt die Folge, damit „Buch neu anordnen" auch farblich etwas
 * ändert. Verworfen: je Jahr unabhängig zu würfeln – dann liegen irgendwann zwei
 * gleiche nebeneinander, und genau das soll nicht passieren.
 */
export function chapterBackgrounds(years: readonly number[], seed = 1): Map<number, string> {
  const sortiert = [...years].sort((a, b) => a - b);
  const map = new Map<number, string>();
  const n = CHAPTER_TONES.length;
  if (n === 0) return map;

  // Schrittweite teilerfremd zur Palettengröße: Die Folge läuft dann durch alle
  // Töne, bevor sich einer wiederholt. Bei sechs Tönen ist 5 die Schrittweite,
  // die am wenigsten nach Muster aussieht – 1 wäre ein Durchzählen, 3 und 2
  // hätten mit 6 einen gemeinsamen Teiler und ließen Töne aus.
  const schritt = n > 2 ? 5 % n || 1 : 1;
  let i = seed % n;
  for (const year of sortiert) {
    map.set(year, CHAPTER_TONES[i]!);
    i = (i + schritt) % n;
  }
  return map;
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
 * Akzentfarbe zu einem Seitenhintergrund.
 *
 * Der Marker des Zeitstrahls ist das einzige farbige Element im Innenteil. Ein
 * fester Ton dafür – bisher ein kräftiges Blau – steht auf jedem der sechs
 * Jahrestöne anders im Raum und auf keinem gut: Über die typische Spanne von
 * 2,6 Monaten ist der Spannbalken ein 84 mm langer Strich, und in Signalblau
 * ist er das Lauteste auf einer Seite voller Fotos.
 *
 * Abgeleitet wird deshalb aus dem Hintergrund selbst: derselbe Farbton, kräftig
 * gesättigt und so weit abgedunkelt, dass er sicher trägt. Damit gehört der
 * Marker zur Seite, statt auf ihr zu liegen. Auf dunklem Grund geht es
 * andersherum – dort wird aufgehellt.
 */
export function accentOn(background: string): string {
  const { h, s } = toHsl(background);
  // Ein nahezu ungesättigter Grund (Weiß, Papier) hat keinen Ton, aus dem sich
  // etwas ableiten ließe. Dann bleibt es beim gedeckten Braunton der Palette:
  // Er steht auf allen hellen Tönen ruhig und ist nirgends bunt.
  const ton = s < 0.04 ? 32 : h;
  const saettigung = Math.min(0.34, Math.max(0.22, s * 3));
  const helligkeit = luminance(background) > 0.45 ? 0.42 : 0.72;
  return fromHsl(ton, saettigung, helligkeit);
}

export interface TimelineAccent {
  /** Wert für `settings.timelineAccent`. */
  value: string;
  label: string;
}

/**
 * Die Akzentfarben, die der Marker des Zeitstrahls tragen darf.
 *
 * Eine geschlossene Liste und kein freier Farbwähler: Der Marker ist das
 * einzige farbige Element im Innenteil, eine offene Wahl produziert dort
 * Neonrosa. Die vier festen Töne sind gegen Creme und gegen Anthrazit geprüft.
 *
 * `auto` steht voran und ist die Vorgabe – dann rechnet `accentOn` den Ton aus
 * der Jahresfarbe der Doppelseite. Das ist nicht bloß der Bestand, sondern
 * weiter das Bessere: Ein fester Ton steht auf jedem der sechs Jahrestöne
 * anders im Raum. Wählbar ist er trotzdem, weil ein Buch mit einer Farbe durch
 * alle Jahre eine legitime Entscheidung ist – nur keine, die man ungefragt
 * trifft.
 */
export const TIMELINE_ACCENTS: readonly TimelineAccent[] = [
  { value: 'auto', label: 'Jahresfarbe' },
  // Der Ton, den der Zeitstrahl vor `accentOn` trug: kalt gegen warmes Papier,
  // und auf Anthrazit fällt er zu.
  { value: '#1d4ed8', label: 'Kobalt' },
  // Nimmt Sommer- und Herbstband des Kalenderbandes auf – steht aber nah an der
  // Warnfarbe der Oberfläche.
  { value: '#b4462a', label: 'Rostrot' },
  // Kühl, aber gebrochen: hält auf hellem und auf dunklem Grund.
  { value: '#0f6f7a', label: 'Petrol' },
  // Kommt in keinem Jahreszeitband vor und ist deshalb unverwechselbar.
  { value: '#6b4696', label: 'Lila' },
];

/**
 * Farbe eines Textblocks ohne eigene Wahl: dieselbe wie im Fließtext des Buches.
 *
 * Steht hier und nicht mehr im Renderer, seit sie auch in der Palette darunter
 * auftaucht: Zwei Stellen mit demselben Hexwert wären zwei Vorgaben, sobald eine
 * davon geändert wird.
 */
export const TEXT_DEFAULT_COLOR = '#3f3f46';

export interface TextBlockColor {
  /** `auto` heißt: keine eigene Farbe, `textColorOn` entscheidet. */
  value: string;
  label: string;
}

/**
 * Die Farben, die ein eigener Textblock tragen darf.
 *
 * Wieder eine geschlossene Liste, aus demselben Grund wie bei den Hintergründen
 * und beim Marker des Zeitstrahls: Ein freier Farbwähler produziert im Fotobuch
 * irgendwann Neonrosa, und dagegen hilft keine Warnung, sondern nur eine Wahl,
 * die ihn nicht anbietet.
 *
 * `auto` steht voran und ist die Vorgabe — dann rechnet `textColorOn` aus dem
 * Hintergrund, ob dunkel oder hell gesetzt wird. Wer einen festen Ton wählt,
 * bekommt ihn dagegen unverändert: Auf einem Hintergrundbild ist Weiß genau die
 * Entscheidung, die keine Automatik treffen kann, weil sie das Motiv nicht
 * kennt.
 *
 * Die vier Akzente sind dieselben wie beim Zeitstrahl und keine zweiten Werte —
 * sie sind gegen Creme und gegen Anthrazit geprüft, und ein Buch mit zwei
 * ähnlichen, aber verschiedenen Rottönen ist ein Buch mit einem Fehler darin.
 */
export const TEXT_BLOCK_COLORS: readonly TextBlockColor[] = [
  { value: 'auto', label: 'wie der Grund' },
  { value: TEXT_DEFAULT_COLOR, label: 'Graphit' },
  { value: '#1c1917', label: 'Tinte' },
  // Für Text auf einem Hintergrundbild: Dort ist der „Grund" ein Motiv, und
  // `textColorOn` liest nur die Farbe darunter, die davon verdeckt ist.
  { value: '#ffffff', label: 'Weiß' },
  ...TIMELINE_ACCENTS.filter((a) => a.value !== 'auto').map((a) => ({
    value: a.value,
    label: a.label,
  })),
];

/**
 * Ob ein Wert eine wählbare Textfarbe ist – `auto` zählt nicht dazu.
 *
 * Analog zu `isBackgroundColor`: Der Server prüft damit, was er speichert,
 * statt einen fremden Wert bis in den Druck durchzureichen. „Keine Farbe" ist
 * kein Wert, sondern ein fehlendes Feld.
 */
export function isTextBlockColor(wert: unknown): wert is string {
  return (
    typeof wert === 'string' &&
    wert !== 'auto' &&
    TEXT_BLOCK_COLORS.some((c) => c.value.toLowerCase() === wert.toLowerCase())
  );
}

function toHsl(hex: string): { h: number; s: number; l: number } {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? 60 * (((g - b) / d) % 6)
      : max === g
        ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const zwei = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${zwei(r)}${zwei(g)}${zwei(b)}`;
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
