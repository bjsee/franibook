/**
 * Der Verlauf: was sich zurücknehmen lässt.
 *
 * Ein Schritt hält den **ganzen veränderbaren Stand** von vorher, nicht die
 * Umkehrung einer Aktion. Das ist die eine Entscheidung, aus der alles Weitere
 * folgt, und sie ist bewusst die grobe: Die gespeicherte `project.json` ist bei
 * 820 Fotos 680 KB groß, fünfzig Stände liegen damit in der Größenordnung von
 * 30 MB — für ein lokales Einzelplatzwerkzeug nichts —, und dafür gibt es keine
 * einzige Umkehrfunktion, die falsch sein kann. „Buch neu anordnen" ist damit
 * genauso rückholbar wie ein Ausschnitt; mit inversen Kommandos wäre es das nie
 * geworden.
 *
 * Verworfen wurde der Weg, den `docs/konzept.md` einmal vorsah: Immer mit
 * `produceWithPatches`, Patch und Inverse aus derselben Operation. Elegant und
 * speicherarm, verlangt aber, dass jede Mutation durch einen Producer läuft —
 * `project.ts` samt `project/*` sind über zweitausend Zeilen imperative
 * Mutation, und der Umbau wäre eine neue Zustandsarchitektur gewesen, nicht
 * eine Funktion.
 *
 * Das Modul weiß nichts über Fotos, Doppelseiten oder Dateien: Der Stand ist
 * ein Typparameter, die Bewegung einer Datei eine eingespeiste Wirkung. Damit
 * ist der Verlauf ohne Projekt prüfbar — und die Uhr ist es auch, denn das
 * Verschmelzen hängt an ihr.
 */

/**
 * Eine Datei, die diese Aktion verschoben hat.
 *
 * Nur das Aussortieren hat eine Wirkung außerhalb des Projektzustands
 * (`<quelle>/.franibook-geloescht/`), und sie ist genau ein `rename`. Als Daten
 * am Schritt und nicht als Rückruf: So bleibt der Verlauf eine Datenstruktur,
 * die man ausdrucken kann, und das Zurücknehmen bleibt nachvollziehbar.
 */
export interface Dateizug {
  /** Wo die Datei vorher lag. */
  von: string;
  /** Wohin sie gelegt wurde. */
  nach: string;
}

/** Ein Stand, wie er vor einer Aktion war — samt allem, was ihn beschreibt. */
export interface Schritt<S> {
  /** Deutscher Satzanfang für die Oberfläche: „Ausschnitt gesetzt". */
  label: string;
  /** Der Stand vor der Aktion. */
  stand: S;
  /** Gleicher Schlüssel in kurzer Folge verschmilzt zu einem Schritt. */
  schluessel?: string;
  /** Wann der Schritt zuletzt berührt wurde, für das Verschmelzfenster. */
  zeit: number;
  /** Welche Doppelseite betroffen war, damit die Oberfläche hinspringen kann. */
  spreadIndex?: number;
  dateizug?: Dateizug;
}

/**
 * Wie viele Schritte aufbewahrt werden.
 *
 * Fünfzig, nicht die hundert aus dem Konzept: Dort waren es Patches von
 * wenigen Bytes, hier sind es ganze Stände von je ~680 KB. Fünfzig Schritte sind
 * eine lange Sitzung am Buch, und wer weiter zurückwill, will in Wahrheit den
 * Notanker.
 */
export const VERLAUF_TIEFE = 50;

/**
 * Innerhalb dieser Zeit verschmilzt gleicher Schlüssel zu einem Schritt.
 *
 * 1,5 s und nicht die 250 ms, mit denen die Oberfläche ihre Schreibvorgänge
 * verzögert: Ein Ziehen mit Denkpausen ist eine Bewegung, und ein getippter
 * Satz ist ein Satz. Das Fenster wandert bei jedem Treffer mit, ein
 * ununterbrochenes Ziehen bleibt also ein Schritt, wie lange es auch dauert.
 */
export const VERSCHMELZ_FENSTER_MS = 1500;

export interface VerlaufOptionen<S> {
  /** Den aktuellen Stand als eigene Kopie holen. */
  lies: () => S;
  /** Einen Stand wieder in Kraft setzen. */
  schreib: (stand: S) => void;
  /**
   * Eine Datei zurück- oder wieder wegbewegen.
   *
   * Wirft die Funktion, geschieht **nichts** — kein Stand wird gesetzt, kein
   * Stapel bewegt. Ein Zustand, der auf eine Datei zeigt, die nicht da ist,
   * wäre schlimmer als ein abgelehntes Zurücknehmen.
   */
  verschiebe?: (zug: Dateizug, richtung: 'zurueck' | 'vor') => Promise<void>;
  jetzt?: () => number;
  tiefe?: number;
  fenster?: number;
}

/** Was die Oberfläche für ihre beiden Knöpfe braucht. */
export interface VerlaufAuskunft {
  /** Bezeichnung des Schritts, den Cmd+Z zurücknähme. */
  zurueck: string | null;
  /** Bezeichnung des Schritts, den Cmd+Umschalt+Z wiederholte. */
  vor: string | null;
  tiefe: { zurueck: number; vor: number };
}

export class Verlauf<S> {
  private readonly zurueckStapel: Schritt<S>[] = [];
  private readonly vorStapel: Schritt<S>[] = [];
  private readonly jetzt: () => number;
  private readonly tiefe: number;
  private readonly fenster: number;

  constructor(private readonly opts: VerlaufOptionen<S>) {
    this.jetzt = opts.jetzt ?? (() => Date.now());
    this.tiefe = opts.tiefe ?? VERLAUF_TIEFE;
    this.fenster = opts.fenster ?? VERSCHMELZ_FENSTER_MS;
  }

  /**
   * Hält den Stand vor einer Aktion fest.
   *
   * @returns ob ein neuer Schritt entstanden ist. `false` heißt: mit dem
   * vorherigen verschmolzen — der Aufrufer darf ihn dann nicht verwerfen,
   * wenn seine Aktion scheitert, denn der Stand gehört noch der früheren.
   */
  punkt(label: string, opts: { schluessel?: string; spreadIndex?: number } = {}): boolean {
    const jetzt = this.jetzt();
    const oben = this.zurueckStapel.at(-1);

    if (
      opts.schluessel !== undefined &&
      oben?.schluessel === opts.schluessel &&
      jetzt - oben.zeit <= this.fenster
    ) {
      // Das Fenster wandert mit, statt ab dem ersten Treffer zu laufen: Sonst
      // zerfiele ein langsames Ziehen nach 1,5 s in zwei Schritte.
      oben.zeit = jetzt;
      return false;
    }

    // Eine neue Aktion verwirft das Wiederholen. Alles andere wäre ein Verlauf,
    // der sich verzweigt, und mit ganzen Ständen hieße das: zwei Bücher.
    this.vorStapel.length = 0;

    this.zurueckStapel.push({
      label,
      stand: this.opts.lies(),
      zeit: jetzt,
      ...(opts.schluessel !== undefined ? { schluessel: opts.schluessel } : {}),
      ...(opts.spreadIndex !== undefined ? { spreadIndex: opts.spreadIndex } : {}),
    });
    if (this.zurueckStapel.length > this.tiefe) this.zurueckStapel.shift();
    return true;
  }

  /**
   * Nimmt den zuletzt angelegten Schritt zurück.
   *
   * Für Anfragen, die nichts geändert haben — ein `409` auf einen Zug, der
   * nicht geht. Ein Schritt darauf wäre ein Cmd+Z, das aussieht wie ein
   * Fehler: Es geschieht nichts.
   */
  verwerfe(): void {
    this.zurueckStapel.pop();
  }

  /**
   * Vermerkt am zuletzt angelegten Schritt, welche Datei bewegt wurde.
   *
   * Getrennt von `punkt()`, weil erst die Aktion selbst weiß, wohin die Datei
   * gewandert ist — der Hook, der den Stand festhält, läuft vorher.
   */
  merkeDateizug(zug: Dateizug): void {
    const oben = this.zurueckStapel.at(-1);
    if (oben) oben.dateizug = zug;
  }

  /**
   * Vergisst alles Zurückliegende.
   *
   * Für Aktionen, deren Rücknahme nur so aussähe wie eine: Ein Import legt
   * Fotos, Vorschauen und aufgelöste Orte an, und ein zurückgesetzter Stand
   * ließe die halbe Wirkung stehen. Danach ist die Grundlage eine andere — der
   * Notanker ist hier der ehrlichere Weg zurück.
   */
  barriere(): void {
    this.zurueckStapel.length = 0;
    this.vorStapel.length = 0;
  }

  auskunft(): VerlaufAuskunft {
    return {
      zurueck: this.zurueckStapel.at(-1)?.label ?? null,
      vor: this.vorStapel.at(-1)?.label ?? null,
      tiefe: { zurueck: this.zurueckStapel.length, vor: this.vorStapel.length },
    };
  }

  /** @returns der zurückgenommene Schritt, oder `null` bei leerem Stapel. */
  zurueck(): Promise<Schritt<S> | null> {
    return this.bewege(this.zurueckStapel, this.vorStapel, 'zurueck');
  }

  /** @returns der wiederholte Schritt, oder `null` bei leerem Stapel. */
  vor(): Promise<Schritt<S> | null> {
    return this.bewege(this.vorStapel, this.zurueckStapel, 'vor');
  }

  /**
   * Ein Schritt von einem Stapel auf den anderen.
   *
   * Zurücknehmen und Wiederholen sind dieselbe Bewegung in verschiedene
   * Richtungen — der aktuelle Stand tritt an die Stelle des gespeicherten. Weil
   * beide Stapel ganze Stände halten, braucht es dafür keine zweite Rechnung.
   *
   * Die Datei zuerst, der Stand danach: Scheitert das `rename`, ist noch
   * nichts geschehen und der Aufrufer kann es melden.
   */
  private async bewege(
    von: Schritt<S>[],
    nach: Schritt<S>[],
    richtung: 'zurueck' | 'vor',
  ): Promise<Schritt<S> | null> {
    const schritt = von.at(-1);
    if (!schritt) return null;

    if (schritt.dateizug && this.opts.verschiebe) {
      await this.opts.verschiebe(schritt.dateizug, richtung);
    }

    von.pop();
    nach.push({
      label: schritt.label,
      stand: this.opts.lies(),
      // Ohne Schlüssel: In einen wiederhergestellten Stand darf keine folgende
      // Aktion hineinverschmelzen, sonst verschluckt sie ihn.
      zeit: this.jetzt(),
      ...(schritt.spreadIndex !== undefined ? { spreadIndex: schritt.spreadIndex } : {}),
      ...(schritt.dateizug ? { dateizug: schritt.dateizug } : {}),
    });
    this.opts.schreib(schritt.stand);
    return schritt;
  }
}
