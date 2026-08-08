/**
 * Doppel: mehrere Aufnahmen desselben Augenblicks.
 *
 * Drei Bilder derselben Szene im Abstand von Sekunden sind für `contentHash`
 * drei verschiedene Fotos, und sie landen zu dritt im Buch. „Von diesen dreien
 * das schärfste" ist bei einem vorausgewählten Bestand der häufigste Handgriff
 * überhaupt (Issue #18).
 *
 * **Nicht `Serie` genannt**, obwohl es umgangssprachlich eine wäre: Der Begriff
 * ist in diesem Projekt vergeben (`segment.ts`, Tag → Serie, hält Aufnahmen
 * einer Stunde auf derselben Doppelseite). Ein Doppel ist enger und hat einen
 * anderen Zweck — es wird nicht zusammengehalten, sondern ausgedünnt.
 *
 * ## Warum in zwei Schritten
 *
 * Gemessen (`docs/spikes/serien.md`) findet **kein Bildvergleich allein** die
 * Doppel, und die Zeit allein findet zu viele:
 *
 * - Ein Wahrnehmungshash (dHash) trennt gar nicht — Doppel liegen bei Abstand
 *   12–45, zwei zufällige Fotos im Median bei 28. Die Doppel dieses Bestands
 *   sind keine bitnahen Bursts, sondern verschiedene Aufnahmen desselben
 *   Moments; dHash kodiert Helligkeitsverläufe, und die kippen schon bei einem
 *   Schritt zur Seite.
 * - Apples FeaturePrint trennt brauchbar (Doppel median 0,73, fremde Paare
 *   1,08), aber ohne Zeitfenster fängt Schwelle 0,6 mehr Fehlfunde als echte
 *   Funde — wiederkehrende Motive derselben Wohnung über fünf Jahre.
 *
 * Also: **Die Zeit schlägt die Kandidaten vor, die Ähnlichkeit bestätigt sie.**
 * Der erste Schritt steht hier und braucht nur das Datum. Den zweiten füttert
 * der Server mit gemessenen Abständen (`bestaetigeDoppel`) — der Kern sieht
 * keine Pixel, und der Merkmalsvektor wird nirgends gespeichert: Für 997 Fotos
 * wäre er ein Vielfaches der ganzen `project.json`.
 */
import type { NaiveDateTime, PhotoId } from '../model/photo.js';

export interface DoppelKandidat {
  id: PhotoId;
  date: NaiveDateTime;
}

export interface Doppel {
  /** In der Reihenfolge der Aufnahme. */
  photoIds: PhotoId[];
  from: NaiveDateTime;
  to: NaiveDateTime;
  /**
   * Der größte gemessene Bildabstand innerhalb des Doppels.
   *
   * Die Begründung des Vorschlags, und deshalb Teil des Ergebnisses: Wer eine
   * Automatik vor sich hat, die zwei Bilder für dasselbe hält, soll nachlesen
   * können, **warum** — sonst bleibt nur Glauben oder Ignorieren. Der größte
   * und nicht der mittlere, weil er die schwächste Stelle der Gruppe benennt:
   * Bis hierher hat jedes Paar gehalten.
   *
   * Fehlt, wenn kein Bildvergleich stattgefunden hat (kein `swiftc`); dann
   * stammt der Vorschlag allein aus der Zeit.
   */
  aehnlichkeit?: number;
}

/**
 * Die Kennung eines Doppels — für alles, was man sich darüber merkt.
 *
 * Aus den Fotokennungen und nicht aus einer laufenden Nummer: Der Vorschlag
 * entsteht bei jedem Aufruf neu, und eine Nummer bezeichnete morgen ein anderes
 * Doppel. Sortiert, damit die Reihenfolge der Aufnahme den Schlüssel nicht
 * ändert — eine Datumskorrektur an einem der Bilder soll ein „beide behalten"
 * nicht vergessen machen.
 *
 * Fällt ein Foto weg, ist es ein anderes Doppel und kommt zu Recht wieder: Aus
 * dreien zwei zu behalten ist eine andere Entscheidung als aus dreien drei.
 */
export function doppelSchluessel(photoIds: readonly PhotoId[]): string {
  return [...photoIds].sort().join('+');
}

/** Ein gemessener Abstand zwischen zwei Bildern, 0 = gleich. */
export interface Bildabstand {
  a: PhotoId;
  b: PhotoId;
  distanz: number;
}

/**
 * Die Vorgaben, exportiert, weil sie in der Antwort des Servers stehen.
 *
 * Die Oberfläche begründet den Vorschlag damit („0,59 von höchstens 0,85"), und
 * eine zweite Fassung dieser Zahlen dort wäre früher oder später die falsche —
 * beide sind über die Query verstellbar.
 */
export const DOPPEL_FENSTER_S = 120;
export const DOPPEL_HOECHSTABSTAND = 0.85;

export interface DoppelOptions {
  /**
   * Größte Lücke in Sekunden, über die hinweg zwei Aufnahmen noch als ein
   * Doppel gelten.
   *
   * Am Bestand gemessen: 60 s ergeben 38 Doppel mit 81 Fotos (8,5 %), 120 s
   * ergeben 58 mit 121 Fotos (12,7 %), 15 s nur 17 mit 35 Fotos. Die Vorgabe
   * 120 fängt großzügig ein und überlässt das Aussieben der Bestätigung — ein
   * Vorschlag zu viel kostet einen Blick, ein verpasster kostet ein Bild im
   * Buch.
   */
  fensterSekunden?: number;
  /**
   * Größter Abstand, bis zu dem zwei Bilder als dasselbe Motiv gelten.
   *
   * Aus 69 gemessenen Paaren: Bei 0,80 bleiben 71 % der Kandidatenpaare übrig,
   * bei 0,90 sind es 88 %. Die Vorgabe 0,85 liegt dazwischen und trennt die
   * beiden belegten Nicht-Doppel ab — zwei Kameras auf demselben Fest (1,08)
   * und zwei Stunden desselben Tages. Der Wert stammt aus einer kleinen
   * Stichprobe und gehört an den sichtbaren Vorschlägen nachgezogen.
   */
  hoechstabstand?: number;
}

function parse(date: NaiveDateTime): number {
  return Date.parse(`${date}Z`);
}

/** Ein Paar, unabhängig von der Reihenfolge seiner beiden Kennungen. */
function paarschluessel(a: PhotoId, b: PhotoId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Schlägt Doppel allein aus der Zeit vor.
 *
 * Erwartet keine sortierte Eingabe — sortiert selbst, weil ein falsch
 * sortierter Aufrufer sonst stillschweigend nichts fände.
 *
 * Ein Doppel wächst, solange der Abstand **zum jeweils letzten Foto** im
 * Fenster bleibt, nicht zum ersten: Vier Aufnahmen in Abständen von 90
 * Sekunden sind ein Griff und kein Zufall, auch wenn die erste und die letzte
 * viereinhalb Minuten trennen.
 */
export function findeDoppelKandidaten(
  kandidaten: readonly DoppelKandidat[],
  opts: DoppelOptions = {},
): Doppel[] {
  const fenster = (opts.fensterSekunden ?? DOPPEL_FENSTER_S) * 1000;
  const sortiert = [...kandidaten].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  const doppel: Doppel[] = [];
  let lauf: DoppelKandidat[] = [];

  const abschliessen = (): void => {
    if (lauf.length > 1) {
      doppel.push({
        photoIds: lauf.map((k) => k.id),
        from: lauf[0]!.date,
        to: lauf.at(-1)!.date,
      });
    }
    lauf = [];
  };

  for (const k of sortiert) {
    const letzte = lauf.at(-1);
    if (letzte && parse(k.date) - parse(letzte.date) <= fenster) lauf.push(k);
    else {
      abschliessen();
      lauf = [k];
    }
  }
  abschliessen();
  return doppel;
}

/**
 * Siebt die Kandidaten mit gemessenen Bildabständen.
 *
 * Ein Kandidat zerfällt dabei in so viele Doppel, wie die Abstände hergeben:
 * Liegen A und B beieinander und C daneben, bleibt A–B ein Doppel und C fällt
 * heraus. Zusammengehalten wird über Verbindungskomponenten, nicht über den
 * Abstand zum ersten Bild — bei einem langsamen Schwenk ist jedes Bild seinem
 * Nachbarn nah und dem ersten fremd, und das ist trotzdem ein Griff.
 *
 * Fehlt zu einem Paar die Messung, gilt es als **nicht** verbunden. Ein Bild,
 * dessen Vorschau fehlt oder an dem die Erkennung scheiterte, verschwindet so
 * aus dem Vorschlag, statt ungeprüft darin zu stehen.
 */
export function bestaetigeDoppel(
  kandidaten: readonly Doppel[],
  abstaende: readonly Bildabstand[],
  opts: DoppelOptions = {},
): Doppel[] {
  const grenze = opts.hoechstabstand ?? DOPPEL_HOECHSTABSTAND;

  const nah = new Map<PhotoId, Set<PhotoId>>();
  /** Jeder gemessene Abstand, für die Begründung des Vorschlags. */
  const gemessen = new Map<string, number>();
  for (const { a, b, distanz } of abstaende) {
    gemessen.set(paarschluessel(a, b), distanz);
    if (distanz > grenze) continue;
    if (!nah.has(a)) nah.set(a, new Set());
    if (!nah.has(b)) nah.set(b, new Set());
    nah.get(a)!.add(b);
    nah.get(b)!.add(a);
  }

  const bestaetigt: Doppel[] = [];
  for (const kandidat of kandidaten) {
    const offen = new Set(kandidat.photoIds);
    // Reihenfolge der Aufnahme, damit das Ergebnis deterministisch ist und die
    // Oberfläche die Bilder zeigen kann, wie sie entstanden sind.
    const reihenfolge = new Map(kandidat.photoIds.map((id, i) => [id, i]));

    for (const start of kandidat.photoIds) {
      if (!offen.has(start)) continue;
      offen.delete(start);

      const gruppe = [start];
      const warteschlange = [start];
      while (warteschlange.length > 0) {
        const aktuell = warteschlange.shift()!;
        for (const nachbar of nah.get(aktuell) ?? []) {
          if (!offen.has(nachbar)) continue;
          offen.delete(nachbar);
          gruppe.push(nachbar);
          warteschlange.push(nachbar);
        }
      }

      if (gruppe.length < 2) continue;
      gruppe.sort((a, b) => reihenfolge.get(a)! - reihenfolge.get(b)!);

      // Der größte Abstand **innerhalb der bestätigten Gruppe**, nicht innerhalb
      // des Kandidaten: Ein herausgefallenes drittes Bild soll die Begründung
      // der übrigen zwei nicht verschlechtern.
      let groesster = 0;
      for (let i = 0; i < gruppe.length; i++) {
        for (let j = i + 1; j < gruppe.length; j++) {
          const d = gemessen.get(paarschluessel(gruppe[i]!, gruppe[j]!));
          if (d !== undefined && d > groesster) groesster = d;
        }
      }

      bestaetigt.push({
        photoIds: gruppe,
        from: kandidat.from,
        to: kandidat.to,
        aehnlichkeit: groesster,
      });
    }
  }
  return bestaetigt;
}

/**
 * Die Paare, für die ein Abstand gemessen werden muss.
 *
 * Nur innerhalb eines Kandidaten und jedes Paar einmal — über den ganzen
 * Bestand wären es eine halbe Million Vergleiche, hier sind es rund hundert.
 */
export function zuMessendePaare(kandidaten: readonly Doppel[]): { a: PhotoId; b: PhotoId }[] {
  const paare: { a: PhotoId; b: PhotoId }[] = [];
  for (const k of kandidaten) {
    for (let i = 0; i < k.photoIds.length; i++) {
      for (let j = i + 1; j < k.photoIds.length; j++) {
        paare.push({ a: k.photoIds[i]!, b: k.photoIds[j]! });
      }
    }
  }
  return paare;
}
