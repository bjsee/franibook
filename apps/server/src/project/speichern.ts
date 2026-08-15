/**
 * Atomar schreiben: erst daneben, dann umbenennen.
 *
 * Die Zusage lautet, dass `project.json` zu jedem Zeitpunkt entweder ganz der
 * alte Stand ist oder ganz der neue — nie etwas dazwischen. Sie hängt an einer
 * Eigenschaft des Dateisystems: `rename` innerhalb desselben Verzeichnisses ist
 * unteilbar. Wer in die Zieldatei selbst schriebe, hinterließe bei jedem
 * Stromausfall ein halbes JSON, und ein halbes JSON ist kein Projekt mehr,
 * sondern eine Datei, aus der niemand mehr 830 Fotos, 61 Gruppen und die
 * Handarbeit eines Nachmittags herausholt.
 *
 * Eigenes Modul und nicht eine Methode in `Project`, damit genau diese Zusage
 * prüfbar ist: `schreibe` und `benenneUm` sind austauschbar, und ein Test kann
 * den Vorgang an jeder Stelle abbrechen lassen — an einer echten Datei, nicht
 * an einer Attrappe des Dateisystems.
 */
import { rename as fsRename, rm, writeFile } from 'node:fs/promises';

export interface SchreibWerkzeuge {
  schreibe: (pfad: string, inhalt: string) => Promise<void>;
  benenneUm: (von: string, nach: string) => Promise<void>;
}

/** Das Dateisystem. Exportiert, damit ein Test nur die eine Stufe ersetzt, die er abbricht. */
export const echteWerkzeuge: SchreibWerkzeuge = {
  schreibe: (pfad, inhalt) => writeFile(pfad, inhalt, 'utf8'),
  benenneUm: (von, nach) => fsRename(von, nach),
};

/**
 * Schreibt `inhalt` nach `ziel`, ohne `ziel` je in einem halben Zustand zu
 * hinterlassen.
 *
 * @param nebendatei Der Name der Nebendatei. Er muss im selben Verzeichnis
 * liegen — `rename` ist nur dort unteilbar — und je Vorgang eindeutig sein: Die
 * Serialisierung in `Project.save()` verhindert das Rennen innerhalb eines
 * Prozesses, zwei Server auf demselben Verzeichnis wären davon unberührt.
 *
 * Scheitert das Schreiben, wird die Nebendatei weggeräumt und der Fehler
 * weitergereicht; `ziel` ist dann unverändert. Scheitert erst das Umbenennen,
 * bleibt die Nebendatei liegen — sie zu löschen hieße, den einzigen
 * vollständigen neuen Stand wegzuwerfen, während der alte vielleicht gerade
 * nicht mehr lesbar ist.
 */
export async function schreibeAtomar(
  ziel: string,
  inhalt: string,
  nebendatei: string,
  werkzeuge: SchreibWerkzeuge = echteWerkzeuge,
): Promise<void> {
  try {
    await werkzeuge.schreibe(nebendatei, inhalt);
  } catch (fehler) {
    await rm(nebendatei, { force: true }).catch(() => undefined);
    throw fehler;
  }
  await werkzeuge.benenneUm(nebendatei, ziel);
}
