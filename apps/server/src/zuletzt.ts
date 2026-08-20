/**
 * Welche Projekte zuletzt offen waren.
 *
 * Die Liste ist der Grund, dass ein Start ohne Umgebungsvariable überhaupt
 * weiß, welches Buch gemeint ist: Der Server öffnet beim Hochfahren das oberste
 * Projekt, und die Oberfläche zeigt die Liste, solange keines offen ist.
 *
 * **Sie liegt außerhalb jedes Projekts** (`~/.franibook/zuletzt.json`), und das
 * ist die ganze Begründung für eine eigene Datei neben all den Feldern, die
 * schon im Projekt stehen: Was zuletzt offen war, ist eine Aussage über den
 * Benutzer und nicht über das Buch. In `project.json` wäre sie in jeder Kopie
 * mit unterwegs und nach dem ersten Weitergeben falsch.
 *
 * Eigener Adapter wie `Sources` und nicht ein Modul mit Umgebungszugriff: Der
 * Pfad kommt aus `main.ts` wie jeder andere Ort auch, und ein Test bekommt sein
 * eigenes Verzeichnis, ohne an der Umgebung zu drehen.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Wie viele Projekte in der Liste bleiben.
 *
 * Zehn: Die Liste ist ein Weg zurück zu dem, woran man arbeitet, kein Archiv.
 * Wer ein Projekt von vor zwanzig Wechseln sucht, sucht es im Dateisystem.
 */
export const ZULETZT_ZAHL = 10;

export interface Vermerk {
  /** Der volle Pfad zur Projektdatei — die Kennung des Eintrags. */
  pfad: string;
  /** Der Name für die Anzeige (`Ablage.name`). */
  name: string;
  /** Wann es zuletzt offen war, naive lokale Zeit wie alles Zeitliche hier. */
  zeit: string;
}

/** Ein Vermerk plus dem, was die Platte gerade dazu sagt. */
export interface Gesehen extends Vermerk {
  /**
   * Ob die Datei noch da ist.
   *
   * Ein fehlendes Projekt wird **nicht** stillschweigend aus der Liste
   * geworfen: Eine unerreichbare Datei kann ein abgehängtes Netzlaufwerk sein,
   * und die stille Löschung träfe dann gerade das Projekt, das man sucht. Die
   * Oberfläche zeigt es blass und bietet an, den Eintrag zu vergessen.
   */
  vorhanden: boolean;
  bytes?: number;
  /** Wann die Datei zuletzt geschrieben wurde, falls sie da ist. */
  gespeichert?: string;
}

/** Naive lokale Zeit auf die Sekunde: `2026-08-18T14:31:02`. */
function jetztLokal(jetzt: Date): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return (
    `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}` +
    `T${z(jetzt.getHours())}:${z(jetzt.getMinutes())}:${z(jetzt.getSeconds())}`
  );
}

/** Nur, was wirklich ein Vermerk ist — die Datei kann von Hand bearbeitet sein. */
function istVermerk(wert: unknown): wert is Vermerk {
  const v = wert as Partial<Vermerk> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.pfad === 'string' &&
    v.pfad.length > 0 &&
    typeof v.name === 'string' &&
    typeof v.zeit === 'string'
  );
}

export class Zuletzt {
  constructor(private readonly datei: string) {}

  /**
   * Die Vermerke, neuester zuerst.
   *
   * Eine unlesbare oder fehlende Datei ergibt eine leere Liste und keine
   * Meldung: Anders als bei `project.json` ist hier nichts zu verlieren, was
   * sich nicht in einem Handgriff wiederherstellen ließe — man öffnet das
   * Projekt einmal von Hand, und es steht wieder darin.
   */
  async vermerke(): Promise<Vermerk[]> {
    let roh: string;
    try {
      roh = await readFile(this.datei, 'utf8');
    } catch {
      return [];
    }
    try {
      const daten = JSON.parse(roh) as { zuletzt?: unknown };
      const liste = Array.isArray(daten.zuletzt) ? daten.zuletzt : [];
      return liste.filter(istVermerk).slice(0, ZULETZT_ZAHL);
    } catch {
      return [];
    }
  }

  /** Der oberste Vermerk — womit ein Start ohne Vorgabe weitermacht. */
  async oberster(): Promise<Vermerk | undefined> {
    return (await this.vermerke())[0];
  }

  /**
   * Die Liste mit dem, was die Platte dazu sagt.
   *
   * Je Eintrag ein `stat`, also zehn — am echten Bestand unter einer
   * Millisekunde, solange die Laufwerke da sind. Ein hängendes Netzlaufwerk
   * kostet hier Zeit; das ist der Preis dafür, ein fehlendes Projekt zu
   * erkennen, **bevor** jemand darauf klickt.
   */
  async liste(): Promise<Gesehen[]> {
    return Promise.all(
      (await this.vermerke()).map(async (v) => {
        try {
          const s = await stat(v.pfad);
          return {
            ...v,
            vorhanden: s.isFile() || s.isDirectory(),
            bytes: s.size,
            gespeichert: jetztLokal(s.mtime),
          };
        } catch {
          return { ...v, vorhanden: false };
        }
      }),
    );
  }

  /**
   * Setzt ein Projekt an die Spitze der Liste.
   *
   * Nimmt Pfad und Name und keine `Ablage`: Was hier vermerkt wird, ist genau
   * das, was `Project.ablageInfo` über das offene Projekt sagt — der
   * Notankerordner daneben gehört nicht in die Liste der letzten Projekte.
   */
  async merke(projekt: { pfad: string; name: string }, jetzt = new Date()): Promise<void> {
    const neu: Vermerk = { pfad: projekt.pfad, name: projekt.name, zeit: jetztLokal(jetzt) };
    const rest = (await this.vermerke()).filter((v) => v.pfad !== neu.pfad);
    await this.schreibe([neu, ...rest].slice(0, ZULETZT_ZAHL));
  }

  /** Nimmt ein Projekt aus der Liste. Der Stand selbst bleibt liegen. */
  async vergiss(pfad: string): Promise<boolean> {
    const alle = await this.vermerke();
    const rest = alle.filter((v) => v.pfad !== pfad);
    if (rest.length === alle.length) return false;
    await this.schreibe(rest);
    return true;
  }

  /**
   * Atomar wie das Projekt selbst — erst daneben, dann umbenennen.
   *
   * Nicht, weil der Verlust schwer wäre, sondern weil eine halb geschriebene
   * Liste beim nächsten Start als leere gelesen würde: Das sieht aus, als hätte
   * der Server jedes Projekt vergessen, und genau dieser Anblick soll nicht
   * vorkommen.
   */
  private async schreibe(liste: readonly Vermerk[]): Promise<void> {
    const inhalt = JSON.stringify({ zuletzt: liste }, null, 2);
    const tmp = `${this.datei}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(this.datei), { recursive: true });
      await writeFile(tmp, inhalt, 'utf8');
      await rename(tmp, this.datei);
    } catch (fehler) {
      // Kein Abbruch: Ein nicht vermerktes Projekt ist ein Komfortverlust, ein
      // gescheitertes Öffnen wegen einer Liste wäre ein Fehler mit Folgen.
      console.error(
        `Liste der letzten Projekte nicht geschrieben (${this.datei}): ${String(fehler)}`,
      );
    }
  }
}
