/**
 * Gesichter und Aufmerksamkeitsschwerpunkt eines Bildes.
 *
 * Der Kern zielt den automatischen Ausschnitt auf diese Rechtecke
 * (`model/focal.ts`); erkennen kann er sie nicht, denn er hat keine Pixel.
 * Diese Datei ist die Brücke: ein kleines Swift-Werkzeug über Apples
 * Vision-Framework (`apps/server/vision/bildmerkmale.swift`), aufgerufen als
 * Prozess, Antwort als NDJSON.
 *
 * **Bordmittel statt Modelldatei** — dieselbe Begründung wie beim `sips`-Pfad
 * für HEIC (`decode.ts`): kein Gewicht im Repo, keine Abhängigkeit, offline.
 * Verworfen wurde onnxruntime-node mit einem Gesichtsmodell: mehr Gewicht, kein
 * besseres Ergebnis für diesen Zweck.
 *
 * Damit hängt auch dieser Pfad an macOS. Fehlt `swiftc` oder scheitert der Bau,
 * **entfällt das Merkmal stillschweigend** und der Ausschnitt bleibt in der
 * Bildmitte — kein Fehler, eine fehlende Auskunft. Genau deshalb liegt die
 * Erkennung nicht im Importpfad, an dem ein Buch hängt.
 *
 * Messwerte: 65 ms je Bild, 87,3 % der Fotos mit Gesicht, Salienz bei 100 %
 * (`docs/spikes/gesichter.md`).
 */
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FocusRect } from '@franibook/core';

const execFileAsync = promisify(execFile);

/** Wo die Swift-Quellen liegen, relativ zu diesem Modul. */
const VISION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vision');

/**
 * Wie viele Dateien ein Aufruf bekommt.
 *
 * Nicht eine je Aufruf: Vision lädt sein Modell beim ersten Bild, und das ist
 * der Unterschied zwischen 637 ms und 61 ms. Nicht alle auf einmal: Die
 * Argumentliste eines Prozesses ist begrenzt (ARG_MAX), und in Blöcken lässt
 * sich der Fortschritt melden. 200 Pfade sind rund 16 KB Argumente.
 */
const BLOCK = 200;

/** Was das Werkzeug je Datei meldet. */
interface Befund {
  datei: string;
  breite: number;
  hoehe: number;
  orientierung: number;
  gesichter: FocusRect[];
  salienz?: FocusRect;
  fehler?: string;
  millisekunden: number;
}

/** Was davon am Foto landet. */
export interface Bildmerkmale {
  faces: FocusRect[];
  salience?: FocusRect;
}

/**
 * Ein Swift-Werkzeug, bei Bedarf gebaut.
 *
 * Zwei Werkzeuge teilen sich diesen Ablauf (`bildmerkmale`, `bildabstand`), und
 * sie teilen auch die Haltung dazu: **Fehlt `swiftc` oder scheitert der Bau,
 * entfällt das Merkmal stillschweigend.** Was der Ausfall bedeutet, weiß nur
 * der Aufrufer — deshalb bringt er den Satz für das Log mit.
 */
class SwiftWerkzeug {
  private gebaut?: string;
  /** Der laufende Bau, damit zwei Anfragen nicht zweimal kompilieren. */
  private bau?: Promise<string | undefined>;
  /** Warum es nicht geht — einmal ermittelt, danach ohne weiteren Versuch. */
  private untauglich?: string;

  constructor(
    private readonly cacheDir: string,
    private readonly name: string,
    private readonly folge: string,
  ) {}

  /**
   * Baut das Werkzeug, wenn nötig, und liefert seinen Pfad.
   *
   * Neu gebaut wird nur, wenn die Quelle jünger ist als das Binary — ein
   * `swiftc`-Lauf kostet rund sieben Sekunden, und beim Entwickeln startet der
   * Server oft. Das Binary liegt im Cache und nicht im Repo: Es ist
   * plattformabhängig, und ein eingechecktes Binary wäre eine Zusage über
   * fremde Rechner, die dieses Projekt nicht einlösen kann.
   */
  async pfad(): Promise<string | undefined> {
    if (this.gebaut) return this.gebaut;
    if (this.untauglich) return undefined;
    this.bau ??= this.baue();
    return this.bau;
  }

  private async baue(): Promise<string | undefined> {
    const quellPfad = join(VISION_DIR, `${this.name}.swift`);
    const ziel = join(this.cacheDir, 'bin', this.name);
    try {
      const [quelle, binary] = await Promise.all([
        stat(quellPfad),
        stat(ziel).catch(() => undefined),
      ]);
      if (binary && binary.mtimeMs >= quelle.mtimeMs) {
        this.gebaut = ziel;
        return ziel;
      }
      await mkdir(dirname(ziel), { recursive: true });
      await execFileAsync('swiftc', ['-O', '-o', ziel, quellPfad], { timeout: 120_000 });
      this.gebaut = ziel;
      return ziel;
    } catch (err) {
      // Kein Wurf: Ohne das Werkzeug entsteht das Buch wie bisher. Der Satz
      // geht einmal ins Log, damit niemand rätselt, warum eine Auskunft fehlt.
      this.untauglich = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${this.name} nicht verfügbar (${this.untauglich.split('\n')[0]}) – ${this.folge}\n`,
      );
      return undefined;
    }
  }

  get abgeschaltet(): boolean {
    return this.untauglich !== undefined;
  }
}

export class VisionErkennung {
  private readonly werkzeug: SwiftWerkzeug;

  constructor(cacheDir: string) {
    this.werkzeug = new SwiftWerkzeug(cacheDir, 'bildmerkmale', 'die Ausschnitte bleiben mittig.');
  }

  private async werkzeugPfad(): Promise<string | undefined> {
    return this.werkzeug.pfad();
  }

  /** Ob die Erkennung zur Verfügung steht, ohne sie anzustoßen. */
  get abgeschaltet(): boolean {
    return this.werkzeug.abgeschaltet;
  }

  /**
   * Erkennt Merkmale für die gegebenen Dateien.
   *
   * Gibt eine Karte von Dateipfad auf Merkmale zurück. **Eine gesehene Datei
   * steht darin auch dann, wenn nichts gefunden wurde** (`faces: []`) — nur so
   * ist „kein Gesicht im Bild" von „Datei gescheitert" zu unterscheiden, und
   * genau daran hängt, ob der nächste Start es erneut versucht.
   *
   * Ein einzelnes unlesbares Bild hält den Durchlauf nicht an; es fehlt in der
   * Karte. Dieselbe Haltung wie beim Vorschau-Warmlauf.
   */
  async erkenne(
    pfade: readonly string[],
    onProgress?: (fertig: number, gesamt: number) => void,
  ): Promise<Map<string, Bildmerkmale>> {
    const ergebnis = new Map<string, Bildmerkmale>();
    if (pfade.length === 0) return ergebnis;

    const werkzeug = await this.werkzeugPfad();
    if (!werkzeug) return ergebnis;

    for (let i = 0; i < pfade.length; i += BLOCK) {
      const block = pfade.slice(i, i + BLOCK);
      let aus: string;
      try {
        const lauf = await execFileAsync(werkzeug, block, {
          maxBuffer: 64 * 1024 * 1024,
          timeout: 10 * 60_000,
        });
        aus = lauf.stdout;
      } catch {
        // Ein ganzer Block kann an einer einzigen Datei scheitern. Statt den
        // Rest zu verlieren, wird er einzeln nachgefasst — teurer, aber nur im
        // Fehlerfall.
        aus = await this.einzeln(werkzeug, block);
      }

      for (const zeile of aus.split('\n')) {
        if (!zeile.trim()) continue;
        let befund: Befund;
        try {
          befund = JSON.parse(zeile) as Befund;
        } catch {
          continue;
        }
        if (befund.fehler) continue;
        ergebnis.set(befund.datei, {
          faces: befund.gesichter ?? [],
          ...(befund.salienz ? { salience: befund.salienz } : {}),
        });
      }
      onProgress?.(Math.min(i + BLOCK, pfade.length), pfade.length);
    }
    return ergebnis;
  }

  private async einzeln(werkzeug: string, block: readonly string[]): Promise<string> {
    const zeilen: string[] = [];
    for (const pfad of block) {
      try {
        const lauf = await execFileAsync(werkzeug, [pfad], {
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60_000,
        });
        zeilen.push(lauf.stdout);
      } catch {
        // Diese eine Datei bleibt ohne Merkmale.
      }
    }
    return zeilen.join('\n');
  }
}

/** Ein gemessener Abstand innerhalb einer Gruppe, Indizes wie übergeben. */
export interface Abstandspaar {
  i: number;
  j: number;
  distanz: number;
}

/**
 * Bildähnlichkeit über FeaturePrint, gruppenweise.
 *
 * Für die Doppel (Issue #18): Welche zeitlich benachbarten Aufnahmen dieselbe
 * Szene zeigen, entscheidet kein Wahrnehmungshash — am Bestand gemessen trennt
 * dHash gar nicht (`docs/spikes/serien.md`). Verglichen wird ausschließlich
 * **innerhalb** einer Gruppe: Über den ganzen Bestand wären es eine halbe
 * Million Vergleiche, über die Kandidaten rund hundert.
 *
 * Der Merkmalsvektor selbst wird nirgends gespeichert. Er hat rund 2.048
 * Zahlen; für 997 Fotos wäre das ein Vielfaches der ganzen `project.json`, und
 * gebraucht wird er nur für den einen Vergleich.
 *
 * Messwert: 3,2 ms je Bild auf der 320-px-Vorschau.
 */
export class AbstandsErkennung {
  private readonly werkzeug: SwiftWerkzeug;

  constructor(cacheDir: string) {
    this.werkzeug = new SwiftWerkzeug(
      cacheDir,
      'bildabstand',
      'Doppel werden allein nach der Zeit vorgeschlagen.',
    );
  }

  get abgeschaltet(): boolean {
    return this.werkzeug.abgeschaltet;
  }

  /**
   * Vergleicht die Dateien jeder Gruppe untereinander.
   *
   * @returns Je Gruppenindex die gemessenen Paare. **Ein Paar, dessen Bild
   * nicht lesbar war, fehlt** — der Aufrufer behandelt eine fehlende Messung
   * als „nicht verbunden" und lässt das Bild aus dem Vorschlag heraus, statt es
   * ungeprüft darin zu behalten.
   *
   * Ist das Werkzeug nicht verfügbar, kommt eine leere Karte zurück: kein
   * Fehler, eine fehlende Auskunft.
   */
  async vergleiche(gruppen: readonly (readonly string[])[]): Promise<Map<number, Abstandspaar[]>> {
    const ergebnis = new Map<number, Abstandspaar[]>();
    if (gruppen.length === 0) return ergebnis;

    const werkzeug = await this.werkzeug.pfad();
    if (!werkzeug) return ergebnis;

    // Mehrere Gruppen je Aufruf, aber die Argumentliste bleibt begrenzt
    // (ARG_MAX). Dieselbe Überlegung wie bei `BLOCK` oben — und derselbe
    // Nebeneffekt: Vision lädt sein Modell einmal je Aufruf, nicht je Gruppe.
    let von = 0;
    while (von < gruppen.length) {
      let bis = von;
      let pfade = 0;
      while (bis < gruppen.length && (pfade === 0 || pfade + gruppen[bis]!.length <= BLOCK)) {
        pfade += gruppen[bis]!.length;
        bis++;
      }

      const args: string[] = [];
      for (let g = von; g < bis; g++) {
        if (g > von) args.push('--');
        args.push(...gruppen[g]!);
      }

      let aus = '';
      try {
        const lauf = await execFileAsync(werkzeug, args, {
          maxBuffer: 64 * 1024 * 1024,
          timeout: 10 * 60_000,
        });
        aus = lauf.stdout;
      } catch {
        // Ein ganzer Aufruf kann an einer einzigen Datei scheitern. Anders als
        // bei den Merkmalen wird hier nicht einzeln nachgefasst: Die Gruppen
        // sind klein, und ein fehlendes Doppel kostet einen Vorschlag, keine
        // Bildinformation.
      }

      for (const zeile of aus.split('\n')) {
        if (!zeile.trim()) continue;
        let satz: { gruppe?: number; i?: number; j?: number; d?: number };
        try {
          satz = JSON.parse(zeile) as typeof satz;
        } catch {
          continue;
        }
        // Fehlerzeilen tragen kein `j` und keinen Abstand.
        if (satz.gruppe === undefined || satz.i === undefined || satz.j === undefined) continue;
        if (typeof satz.d !== 'number') continue;

        const index = von + satz.gruppe;
        const liste = ergebnis.get(index);
        const paar = { i: satz.i, j: satz.j, distanz: satz.d };
        if (liste) liste.push(paar);
        else ergebnis.set(index, [paar]);
      }

      von = bis;
    }
    return ergebnis;
  }
}
