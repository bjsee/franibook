/**
 * Der QR-Code am Bild: ein Verweis auf ein Video, gedruckt.
 *
 * Ein Standbild steht als gewöhnliches Foto auf der Seite; wo das Video zu sehen
 * ist, sagt ein Code in seiner Ecke. Wie der Rahmen ist das im RSM **kein neuer
 * Begriff, sondern mehr Boxen** – eine weiße Fläche und darüber eine Reihe
 * schwarzer Rechtecke. Deshalb steht die ganze Rechnung hier und nicht in den
 * Renderern: Die bekommen fertige Millimeter wie für jede andere Box auch, und
 * der Parity-Test deckt sie ohne neues Können ab.
 *
 * **Verworfen wurde eine `QrBox` mit der Matrix darin**, aus der jeder Renderer
 * selbst zeichnet. Das wären zwei unabhängige Zeichenwege für dieselbe Form –
 * genau die Klasse Abweichung, die der Parity-Test aufdecken soll; dieselbe
 * Begründung wie bei `PolygonBox` gegen eine semantische `TimelineBox`.
 *
 * **Die Matrix kommt aus einer Bibliothek** (`uqr`), Geometrie und
 * Fehlerkorrekturstufe von hier. Sie ist die erste Abhängigkeit dieses Pakets
 * überhaupt, und das war eine Abwägung: Reed-Solomon-Kodierung und die Wahl
 * unter acht Maskenmustern sind rund 400 Zeilen, deren Fehler man nicht sieht –
 * ein selbst gebauter Code wirkt richtig, bis ein gedrucktes Buch nicht
 * scanbar ist. `uqr` rechnet nur die Matrix, hat selbst keine Abhängigkeit,
 * kein `node:`-Modul, kein `Math.random` und kein `Date.now`; die Reinheit des
 * Kerns bleibt damit erhalten und wird in `tests/architektur/` festgeschrieben
 * statt zugesagt.
 *
 * **Was hier gerechnet wird, wirkt ohne Neuanordnen** – wie Neigung und Rahmen.
 * Eine hinterlegte Adresse erscheint durch erneutes Rendern, sie verschiebt kein
 * Foto und ändert keine Vorlage.
 */
import { encode } from 'uqr';
import { spreadHeightMm, spreadWidthMm, type PrintProfile } from '../print/profile.js';
import type { Rect, RectBox, RenderWarning } from './rendered-spread.js';

/**
 * Fehlerkorrekturstufe.
 *
 * `M` verkraftet 15 % Verlust und ist hier die **gemessene** Abwägung gegen die
 * knappe Größe: Eine Kurzadresse mit 25 Zeichen passt bei `M` in Version 2
 * (25×25 Module), bei `Q` erst in Version 3 (29×29). Auf 20 mm Außenmaß sind das
 * 0,61 mm gegen 0,54 mm je Modul – die höhere Stufe kostet also genau dort, wo
 * es eng ist. Ein Buchcode liegt nicht im Wetter wie ein Aufkleber am Laternen-
 * pfahl; was ihn unlesbar macht, ist ein zu kleines Modul und nicht Verschmutzung.
 */
const ECC = 'M' as const;

/**
 * Ruhezone in Modulen, auf jeder Seite.
 *
 * Vier, wie die Norm es für QR verlangt. Verkürzen wäre die naheliegende
 * Versuchung – die Zone kostet bei Version 2 ein Drittel der Kantenlänge –, aber
 * dieser Code steht **über einem Foto**: Ohne den weißen Kragen grenzt die
 * Findermarke direkt an Bildrauschen, und genau daran scheitert die Erkennung.
 */
const RUHEZONE_MODULE = 4;

/**
 * Wieviel der kürzeren Kastenkante der Code höchstens einnimmt, und wie groß er
 * überhaupt werden darf.
 *
 * **Die Größe folgt aus der Zielmodulgröße, sie ist nicht gesetzt.** Der erste
 * Entwurf gab dem Code einen Anteil der Bildkante mit Klemmen bei 15 und 22 mm –
 * und der Test rechnete vor, dass 15 mm selbst für eine Kurzadresse zu klein
 * sind: 25 Zeichen ergeben Version 2, mit Ruhezone 33 Module, also 0,45 mm je
 * Modul und damit unter dem eigenen Ziel von 0,5. Eine Vorgabe, die das eigene
 * Ziel verfehlt, ist geraten und nicht gerechnet.
 *
 * Jetzt gilt: so groß, dass jedes Modul die Zielkante hat – begrenzt durch das,
 * was der Kasten hergibt (`QR_MAX_ANTEIL`, sonst verdeckte der Code das Motiv)
 * und durch `QR_MAX_KANTE_MM`, damit er nicht beliebig mitwächst. Wer die Grenze
 * reißt, hat eine zu lange Adresse, und genau das meldet die Warnung.
 */
const QR_MAX_ANTEIL = 0.4;
export const QR_MAX_KANTE_MM = 22;

/**
 * Abstand des Codes von der Kastenkante.
 *
 * Klein, weil die Ruhezone schon im Außenmaß steckt: Dieser Rand trennt den
 * weißen Kragen von der Bildkante, damit der Code nicht angeschnitten *wirkt*.
 */
const RAND_MM = 1.5;

/**
 * Modulgrößen, ab denen ein gedruckter Code als lesbar gilt.
 *
 * **Diese beiden Zahlen sind gesetzt und nicht gemessen** – wie `gutterLossMm`
 * eine Stelle, an der erst ein Testdruck die Wahrheit sagt. Sie stützen sich auf
 * die verbreitete Faustregel, dass Mobilkameras ab etwa 0,4 mm Modulkante
 * zuverlässig auslösen, und lassen mit 0,5 mm Luft nach oben. Zwei Schwellen und
 * nicht eine, weil die Fälle sich unterscheiden wie bei der Auflösung: Das Ziel
 * ist ein Wunsch, das Mindestmaß eine Grenze.
 *
 * Wer den ersten Testdruck in der Hand hat, ersetzt sie durch Messwerte und
 * nennt hier die Vorlage.
 */
export const QR_ZIEL_MODUL_MM = 0.5;
export const QR_MIN_MODUL_MM = 0.4;

/**
 * Reines Schwarz auf reinem Weiß.
 *
 * Ausdrücklich **nicht** das warme Kartonweiß der Rahmen (`frame.ts`): Dort ist
 * die Farbe Gestaltung, hier ist sie Funktion. Ein Leser rechnet mit Kontrast,
 * und den senkt jede Tönung – auf Papier, wo der Druck ihn ohnehin schon
 * zusammenzieht.
 */
const DUNKEL = '#000000';
const HELL = '#ffffff';

/**
 * Die vier Ecken eines Kastens, in denen der Code stehen kann.
 *
 * **Die Reihenfolge ist die Rangfolge bei Gleichstand**, und deshalb stehen die
 * unteren vorn: Ein Code unten im Bild liest sich wie eine Signatur, oben
 * konkurriert er mit dem Motiv — bei einem Standbild aus einem Film steht dort
 * meistens das Gesicht, um das es geht.
 */
const ECKEN = ['ul', 'ur', 'ol', 'or'] as const;
export type QrEcke = (typeof ECKEN)[number];

export interface QrPlan {
  /** Außenmaß samt Ruhezone – die Fläche, die der Code auf dem Papier braucht. */
  aussen: Rect;
  /** Kantenlänge eines einzelnen Moduls. Daran hängt die Lesbarkeit. */
  modulMm: number;
  /** Kantenlänge der Matrix in Modulen, ohne Ruhezone. */
  module: number;
  /** Version des Codes, 1 bis 40 – wächst mit der Länge der Adresse. */
  version: number;
  ecke: QrEcke;
}

/**
 * Wie groß der Code wird: so groß, dass jedes Modul die Zielkante hat – soweit
 * der Kasten es zulässt.
 *
 * `moduleGesamt` ist die Matrix **samt Ruhezone**, denn die gehört zum Platz auf
 * dem Papier. Die Zahl hängt am Text, nicht am Bild: Dieselben Millimeter tragen
 * eine kurze Adresse bequem und eine lange nicht mehr.
 */
function kanteMmFuer(kasten: Pick<Rect, 'wMm' | 'hMm'>, moduleGesamt: number): number {
  const kurz = Math.min(kasten.wMm, kasten.hMm);
  const gewuenscht = moduleGesamt * QR_ZIEL_MODUL_MM;
  return Math.min(gewuenscht, QR_MAX_KANTE_MM, QR_MAX_ANTEIL * kurz);
}

/**
 * Wie weit ein Rechteck von den beiden Gefahren entfernt ist.
 *
 * Beide machen einen Code unlesbar, aber nicht auf dieselbe Weise, und deshalb
 * stehen sie getrennt: In der **Falzzone** verschwinden Module im Bund, an der
 * **Endformatkante** nimmt sie der Schnitt ganz. Der Bericht nennt den Grund, und
 * einen Grund kann er nur nennen, wenn die Rechnung ihn kennt.
 *
 * Negativ heißt „liegt schon darin".
 */
function abstaende(r: Rect, profile: PrintProfile): { falz: number; rand: number } {
  const { bleedMm, trimWidthMm, safetyMm, gutterSafeMm } = profile.page;
  const falzX = bleedMm + trimWidthMm;

  // Zur Falzachse: der Abstand der näheren Kante, um die Schutzzone verkürzt.
  // Ein Kasten, der die Achse überspannt, bekommt einen negativen Wert – dort
  // hilft keine Ecke, und genau das soll die Wahl sehen.
  const zurAchse =
    r.xMm + r.wMm <= falzX
      ? falzX - (r.xMm + r.wMm)
      : r.xMm >= falzX
        ? r.xMm - falzX
        : -Math.min(r.xMm + r.wMm - falzX, falzX - r.xMm);

  // Zu den Rändern: die Sicherheitslinie liegt um `safetyMm` innerhalb des
  // Endformats, das Endformat um `bleedMm` innerhalb des Blattes.
  const rand = bleedMm + safetyMm;
  return {
    falz: zurAchse - gutterSafeMm,
    rand: Math.min(
      r.xMm - rand,
      r.yMm - rand,
      spreadWidthMm(profile) - rand - (r.xMm + r.wMm),
      spreadHeightMm(profile) - rand - (r.yMm + r.hMm),
    ),
  };
}

/** Das Außenmaß des Codes in einer bestimmten Ecke des Kastens. */
function inEcke(kasten: Rect, kanteMm: number, ecke: QrEcke): Rect {
  const links = kasten.xMm + RAND_MM;
  const rechts = kasten.xMm + kasten.wMm - RAND_MM - kanteMm;
  const oben = kasten.yMm + RAND_MM;
  const unten = kasten.yMm + kasten.hMm - RAND_MM - kanteMm;
  const xMm = ecke === 'ol' || ecke === 'ul' ? links : rechts;
  const yMm = ecke === 'ol' || ecke === 'or' ? oben : unten;
  return { xMm, yMm, wMm: kanteMm, hMm: kanteMm };
}

/**
 * In welche Ecke des Bildes der Code kommt.
 *
 * Nicht immer dieselbe: Ein Bild an der Falzachse hat dort seine schlechteste
 * Ecke, ein randabfallendes an der Papierkante. Gewählt wird die Ecke mit dem
 * größten Abstand zu allem, was den Code unlesbar macht (`abstandMm`) – bei
 * Gleichstand die erste in der festen Reihenfolge, damit die Wahl deterministisch
 * bleibt.
 *
 * Gerechnet wird am **ungedrehten** Kasten. Bei der Neigung, die dieses Buch
 * vergibt (bis 4°), verschiebt die Drehung die Ecken um Bruchteile eines
 * Millimeters; eine Rechnung über die gedrehten Eckpunkte wäre genauer und an
 * jeder Stelle schwerer zu prüfen. Von Hand stark gedrehte Bilder sind die
 * Ausnahme, für die der Abnahmebericht da ist.
 */
export function qrEckeFuer(kasten: Rect, kanteMm: number, profile: PrintProfile): QrEcke {
  const bewertet = ECKEN.map((ecke) => {
    const rect = inEcke(kasten, kanteMm, ecke);
    return { ecke, ...abstaende(rect, profile) };
  });

  // Unter den **sicheren** Ecken entscheidet der Abstand zur Falzachse, nicht der
  // schlechtere der beiden Abstände. Sonst geriete die Wahl zwischen zwei
  // gleichermaßen sicheren Ecken zufällig: Am gemessenen Fall lagen 71 mm zur
  // Falzzone gegen 65 mm zum Papierrand — beides unbedenklich weit, und die Wahl
  // fiel trotzdem nach innen zur Bindung. Außen ist die bessere Vorgabe: Dort
  // greift die Hand beim Blättern nicht über den Code, und im gebundenen Buch
  // liegt er flach.
  const sicher = bewertet.filter((b) => b.falz >= 0 && b.rand >= 0);
  const wahl = sicher.length > 0 ? sicher : bewertet;
  const schlechtester = (b: { falz: number; rand: number }) => Math.min(b.falz, b.rand);

  // Bei Gleichstand gewinnt die erste Ecke der festen Folge – die Wahl muss
  // deterministisch bleiben.
  return wahl.reduce((a, b) =>
    sicher.length > 0 ? (b.falz > a.falz ? b : a) : schlechtester(b) > schlechtester(a) ? b : a,
  ).ecke;
}

/**
 * Die Matrix zu einem Text – dunkle Module als Zeilen von Wahrheitswerten.
 *
 * `border: 0`, weil die Ruhezone hier Geometrie ist und nicht Teil der Matrix:
 * Sie steht im Außenmaß und wird als eine weiße Fläche gezeichnet, nicht als
 * Ring aus Modulen.
 */
function matrix(text: string): { module: number; dunkel: readonly (readonly boolean[])[] } {
  const ergebnis = encode(text, { ecc: ECC, border: 0 });
  return { module: ergebnis.size, dunkel: ergebnis.data };
}

/**
 * Wo der Code steht und wie groß seine Module werden – ohne die Boxen.
 *
 * Zwei Stellen brauchen genau das und nicht die 150 Rechtecke: die Oberfläche,
 * die neben dem Adressfeld die zu erwartende Modulgröße anzeigt, und alles, was
 * über Lesbarkeit reden will, ohne zu zeichnen. Die Matrix wird dafür trotzdem
 * gerechnet – ihre Größe *ist* die Auskunft, und ohne sie wäre die Zahl geraten.
 */
export function qrPlan(text: string, kasten: Rect, profile: PrintProfile): QrPlan {
  const { module } = matrix(text);
  const moduleGesamt = module + 2 * RUHEZONE_MODULE;
  const kanteMm = kanteMmFuer(kasten, moduleGesamt);
  const ecke = qrEckeFuer(kasten, kanteMm, profile);

  return {
    aussen: inEcke(kasten, kanteMm, ecke),
    modulMm: kanteMm / moduleGesamt,
    module,
    // Aus der Kantenlänge zurückgerechnet: Version 1 hat 21 Module, jede
    // weitere vier mehr. Die Bibliothek gibt sie auch her, aber dann stünde
    // dieselbe Zahl auf zwei Wegen im Plan.
    version: (module - 17) / 4,
    ecke,
  };
}

/**
 * Plan und Boxen für den Code an einem Bildkasten.
 *
 * **Die dunklen Module werden zu waagerechten Läufen zusammengefasst**: Jede
 * Zeile ergibt eine Box je zusammenhängender Folge dunkler Module statt eine je
 * Modul. Bei Version 2 sind das rund 80 Boxen statt 300, und die Zusammenfassung
 * ist verlustfrei – benachbarte Module derselben Zeile bilden exakt ein
 * Rechteck. Rechteckige Blöcke über mehrere Zeilen zu suchen brächte weniger als
 * ein weiteres Drittel und wäre eine Optimierungsrechnung im Kern, die niemand
 * mehr prüft.
 *
 * `warnings` gehört dazu und nicht in den Abnahmebericht: Der sammelt, er
 * rechnet nicht (`pruefung/abnahme.ts`). Was hier über die Lesbarkeit bekannt
 * ist, wird hier gemeldet.
 */
export function qrBoxen(opts: {
  text: string;
  /** Der Kasten, in dessen Ecke der Code steht – das Bild, nicht der Platz. */
  kasten: Rect;
  profile: PrintProfile;
  /** Neigung des Bildes. Der Code fährt mit, sonst steht er schief darauf. */
  rotateDeg?: number;
  rotateAboutMm?: { xMm: number; yMm: number };
}): { plan: QrPlan; boxes: RectBox[]; warnings: RenderWarning[] } {
  const { text, kasten, profile } = opts;
  const plan = qrPlan(text, kasten, profile);
  const { aussen, modulMm, module } = plan;
  const { dunkel } = matrix(text);

  const drehung =
    opts.rotateDeg !== undefined && opts.rotateDeg !== 0 ? { rotateDeg: opts.rotateDeg } : {};
  const um = opts.rotateAboutMm ? { rotateAboutMm: opts.rotateAboutMm } : {};

  const grund: RectBox = { kind: 'rect', ...aussen, fill: HELL, ...drehung, ...um };
  const nullX = aussen.xMm + RUHEZONE_MODULE * modulMm;
  const nullY = aussen.yMm + RUHEZONE_MODULE * modulMm;

  const laeufe: RectBox[] = [];
  for (const [zeile, module_] of dunkel.entries()) {
    let von = -1;
    // Ein Durchlauf bis `module` **einschließlich**: Der Anschlag hinter der
    // letzten Spalte schließt einen Lauf ab, der bis zum Rand reicht.
    for (let spalte = 0; spalte <= module; spalte++) {
      const ist = spalte < module && module_?.[spalte] === true;
      if (ist && von < 0) von = spalte;
      if (!ist && von >= 0) {
        laeufe.push({
          kind: 'rect',
          xMm: nullX + von * modulMm,
          yMm: nullY + zeile * modulMm,
          wMm: (spalte - von) * modulMm,
          hMm: modulMm,
          fill: DUNKEL,
          ...drehung,
          ...um,
        });
        von = -1;
      }
    }
  }

  const warnings: RenderWarning[] = [];
  // Zwei Schwellen, eine Meldung: Wer unter dem Mindestmaß liegt, liegt auch
  // unter dem Ziel, und zwei Zeilen über denselben Code wären eine zu viel.
  if (modulMm < QR_MIN_MODUL_MM) {
    warnings.push({ code: 'qr-below-min-module', modulMm, minModulMm: QR_MIN_MODUL_MM });
  } else if (modulMm < QR_ZIEL_MODUL_MM) {
    warnings.push({ code: 'qr-below-target-module', modulMm, targetModulMm: QR_ZIEL_MODUL_MM });
  }
  // Auch die beste Ecke kann in der Falzzone oder im Beschnitt liegen – bei
  // einem randabfallenden Bild ist das der Normalfall und nicht der Ausnahmefall.
  // `wo` nennt den schwerwiegenderen Fall, wie bei `face-at-edge`: Was der
  // Schnitt nimmt, ist ganz weg; was im Bund liegt, nur zum Teil.
  const { falz, rand } = abstaende(aussen, profile);
  if (rand < 0 || falz < 0) {
    warnings.push({ code: 'qr-at-edge', wo: rand < 0 ? 'beschnitt' : 'falz' });
  }

  return { plan, boxes: [grund, ...laeufe], warnings };
}
