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

/** Die Quelle des Werkzeugs, relativ zu diesem Modul. */
const QUELLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vision', 'bildmerkmale.swift');

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

export class VisionErkennung {
  /** Pfad zum gebauten Werkzeug, sobald es einmal gebaut wurde. */
  private werkzeug?: string;
  /** Der laufende Bau, damit zwei Anfragen nicht zweimal kompilieren. */
  private bau?: Promise<string | undefined>;
  /** Warum es nicht geht — einmal ermittelt, danach ohne weiteren Versuch. */
  private untauglich?: string;

  constructor(private readonly cacheDir: string) {}

  /**
   * Baut das Werkzeug, wenn nötig, und liefert seinen Pfad.
   *
   * Neu gebaut wird nur, wenn die Quelle jünger ist als das Binary — ein
   * `swiftc`-Lauf kostet rund sieben Sekunden, und beim Entwickeln startet der
   * Server oft. Das Binary liegt im Cache und nicht im Repo: Es ist
   * plattformabhängig, und ein eingechecktes Binary wäre eine Zusage über
   * fremde Rechner, die dieses Projekt nicht einlösen kann.
   */
  private async werkzeugPfad(): Promise<string | undefined> {
    if (this.werkzeug) return this.werkzeug;
    if (this.untauglich) return undefined;
    this.bau ??= this.baue();
    return this.bau;
  }

  private async baue(): Promise<string | undefined> {
    const ziel = join(this.cacheDir, 'bin', 'bildmerkmale');
    try {
      const [quelle, binary] = await Promise.all([stat(QUELLE), stat(ziel).catch(() => undefined)]);
      if (binary && binary.mtimeMs >= quelle.mtimeMs) {
        this.werkzeug = ziel;
        return ziel;
      }
      await mkdir(dirname(ziel), { recursive: true });
      await execFileAsync('swiftc', ['-O', '-o', ziel, QUELLE], { timeout: 120_000 });
      this.werkzeug = ziel;
      return ziel;
    } catch (err) {
      // Kein Wurf: Ohne Erkennung bleibt der Ausschnitt in der Bildmitte, und
      // das Buch entsteht wie bisher. Der Satz geht einmal ins Log, damit
      // niemand rätselt, warum die Ausschnitte nicht besser werden.
      this.untauglich = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `Bildmerkmale nicht verfügbar (${this.untauglich.split('\n')[0]}) – ` +
          `die Ausschnitte bleiben mittig.\n`,
      );
      return undefined;
    }
  }

  /** Ob die Erkennung zur Verfügung steht, ohne sie anzustoßen. */
  get abgeschaltet(): boolean {
    return this.untauglich !== undefined;
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
