/**
 * Wo ein Projekt liegt — und was ein Pfad darauf bedeutet.
 *
 * Bis hierher war der Ort des Projekts eine Umgebungsvariable und damit auf
 * Lebenszeit des Prozesses festgelegt: ein Verzeichnis mit `project.json` und
 * `history/` darin. Wer ein zweites Buch wollte, startete einen zweiten Server.
 *
 * Jetzt ist der Stand eine **benannte Datei** — `franziska-2019.franibook` —,
 * und der Server kann sie zur Laufzeit wechseln. Der Unterschied ist nicht
 * kosmetisch: Eine Datei lässt sich kopieren, sichern, weitergeben und in einem
 * Dateidialog auswählen, ein Verzeichnis mit einem festen Dateinamen darin nicht
 * ohne Erklärung.
 *
 * **Die alte Form bleibt lesbar**, und zwar an derselben Regel, die auch das
 * Speichern lenkt: Endet der Pfad auf `.franibook`, ist er die Datei selbst;
 * heißt er `project.json`, ist das Verzeichnis darüber gemeint; sonst ist er
 * selbst ein Verzeichnis in der alten Form. Damit funktioniert
 * `FRANIBOOK_PROJECT=.franibook-project` unverändert weiter — der Bestand
 * musste nicht wandern, und `just probe` schreibt weiter in seinen
 * Wegwerf-Ordner.
 *
 * Kein `stat` in dieser Entscheidung, obwohl es naheliegt: Ein „Speichern
 * unter" nennt eine Datei, die es noch nicht gibt, und eine Regel, die vom
 * Zustand der Platte abhängt, wäre für denselben Pfad einmal so und einmal
 * anders zu lesen.
 */
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ANKER_ORDNER } from './notanker.js';

/** Die Endung, an der eine Projektdatei erkennbar ist. */
export const ENDUNG = '.franibook';

/** Wie die Datei heißt, wenn der Pfad ein Verzeichnis der alten Form ist. */
export const ALTE_DATEI = 'project.json';

export interface Ablage {
  /** Die Datei, in die der Stand geschrieben wird. */
  datei: string;
  /** Der Ordner, in dem die Notanker dieses Projekts liegen. */
  anker: string;
  /**
   * Wie das Projekt heißt — Dateiname ohne Endung, in der alten Form der
   * Ordnername.
   *
   * Steht in der Kopfzeile und in der Liste der zuletzt geöffneten Projekte.
   * Der Pfad allein wäre dort in der Regel zu lang, und der nackte Dateiname
   * mit Endung zu technisch.
   */
  name: string;
}

/**
 * Was ein Pfad über den Ort des Projekts sagt.
 *
 * Der Pfad wird absolut gemacht: Jeder weitere Schritt — schreiben,
 * vergleichen, in der Liste der letzten Projekte wiederfinden — hängt daran,
 * dass derselbe Ort auch dieselbe Zeichenkette ist. Ein relativer Pfad wäre
 * beides je nach Arbeitsverzeichnis.
 */
export function ablageVon(pfad: string): Ablage {
  const abs = resolve(pfad);

  // Der Pfad der Datei **in** einem Verzeichnis der alten Form meint dieses
  // Verzeichnis. Ohne diese Zeile wäre die Deutung nicht wiederholbar: Die Liste
  // der letzten Projekte vermerkt `Ablage.datei`, und das ist bei der alten Form
  // `…/.franibook-project/project.json` — beim nächsten Start hätte der Server
  // daraus ein Verzeichnis dieses Namens gemacht und darin eine zweite
  // `project.json` erwartet. Der echte Bestand wäre damit unauffindbar gewesen.
  if (basename(abs) === ALTE_DATEI) return alsOrdner(dirname(abs));

  if (abs.toLowerCase().endsWith(ENDUNG)) {
    return {
      datei: abs,
      // Neben der Datei und nicht darin: Die Notanker sind zehn ganze
      // Projektstände (`notanker.ts`), also Dateien, und eine Datei kann keine
      // Dateien enthalten. Der Name trägt die Endung mit, damit
      // `buch.franibook.history` neben `buch.franibook` als sein Zubehör
      // lesbar bleibt.
      anker: `${abs}.history`,
      name: basename(abs).slice(0, -ENDUNG.length),
    };
  }

  return alsOrdner(abs);
}

/** Die alte Form: ein Verzeichnis mit `project.json` und `history/` darin. */
function alsOrdner(ordner: string): Ablage {
  return {
    datei: join(ordner, ALTE_DATEI),
    anker: join(ordner, ANKER_ORDNER),
    name: basename(ordner),
  };
}

/**
 * Der Pfad mit Endung, wie ihn ein „Speichern unter" braucht.
 *
 * Wer im Dialog „franziska" tippt, meint `franziska.franibook` und nicht ein
 * Verzeichnis namens `franziska` mit einer `project.json` darin. Die Ergänzung
 * steht hier und nicht in der Route, weil sie zur Deutung eines Pfades gehört —
 * dieselbe Regel, nur in der anderen Richtung.
 */
export function mitEndung(pfad: string): string {
  return pfad.toLowerCase().endsWith(ENDUNG) ? pfad : `${pfad}${ENDUNG}`;
}

/**
 * Ob ein Pfad als Ziel taugt — samt Satz, warum nicht.
 *
 * Absolut, weil der Server sein Arbeitsverzeichnis nicht mit dem des Benutzers
 * teilt: `../buch.franibook` bedeutet in der Oberfläche und im Serverprozess
 * verschiedene Orte, und ein Projekt, das an einer überraschenden Stelle
 * landet, ist ein verlorenes Projekt.
 *
 * Ein Verzeichnis als Ziel ist ausdrücklich erlaubt (die alte Form), ein leerer
 * Pfad nicht.
 */
export function pruefePfad(pfad: unknown): { pfad: string } | { fehler: string } {
  if (typeof pfad !== 'string' || pfad.trim().length === 0) {
    return { fehler: 'Es fehlt der Pfad zur Projektdatei' };
  }
  const roh = pfad.trim();
  if (!isAbsolute(roh)) {
    return { fehler: `„${roh}" ist kein vollständiger Pfad — erwartet wird einer ab „/"` };
  }
  // Ein Pfad, dessen Elternverzeichnis der Pfad selbst ist, ist die Wurzel.
  // Dort landet kein Projekt, und `mkdir` darauf wäre der verwirrendste
  // Fehlschlag von allen.
  if (dirname(roh) === roh) {
    return { fehler: 'Das Wurzelverzeichnis ist kein Ort für ein Projekt' };
  }
  return { pfad: roh };
}
