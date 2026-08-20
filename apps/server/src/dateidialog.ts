/**
 * Der Dateidialog des Systems — der einzige Weg zu einem Pfad, den niemand
 * tippen muss.
 *
 * Der Browser kann das nicht leisten: Ein `<input type="file">` liefert Bytes
 * und einen nackten Dateinamen, keinen Pfad — der Server müsste die Datei
 * entgegennehmen und irgendwohin legen, und „Speichern unter" gäbe es gar
 * nicht. Die Oberfläche steht aber ohnehin auf `127.0.0.1` neben einem Server,
 * der auf demselben Rechner läuft, und der darf den echten Dialog öffnen.
 *
 * **macOS-gebunden**, wie `sips` beim Dekodieren und die beiden Swift-Werkzeuge
 * der Bildmerkmale (`decode.ts`, `vision.ts`). Fehlt `osascript`, sagt der
 * Endpunkt einen Satz und die Oberfläche bleibt bei der Pfadeingabe — dieselbe
 * Behandlung wie beim fehlenden `ffmpeg` des Videoeinwurfs.
 *
 * Warum kein Verzeichnisbrowser im Server: Er wäre ein Endpunkt, der jeden
 * Ordner des Rechners auflistet, und damit ein Leseloch mit größerer Reichweite
 * als alles andere hier. Der Systemdialog gibt genau eine Datei heraus, die ein
 * Mensch ausgewählt hat.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ENDUNG } from './project/ablage.js';

export interface Dateidialog {
  /** Eine bestehende Datei wählen. `null` heißt abgebrochen. */
  oeffnen(startOrdner?: string): Promise<string | null>;
  /** Einen Namen für eine neue Datei wählen. `null` heißt abgebrochen. */
  speichern(vorschlag: string, startOrdner?: string): Promise<string | null>;
}

/**
 * Eine Zeichenkette, wie AppleScript sie liest.
 *
 * Zwei Zeichen sind zu behandeln, und beide kommen in Dateinamen vor: der
 * Rückstrich und das Anführungszeichen. Ohne diese vier Zeilen wäre der
 * Startordner die Stelle, an der ein Ordnername das Skript umschreiben kann.
 */
function alsText(wert: string): string {
  return `"${wert.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Führt ein AppleScript aus und gibt seine Ausgabe zurück.
 *
 * Das Skript geht über die Standardeingabe (`osascript -`) und nicht als
 * `-e`-Argument: Mehrzeilige Skripte sind so lesbar, und der Text muss nicht
 * zweimal durch eine Zitierregel.
 *
 * `null` heißt „der Benutzer hat abgebrochen" — AppleScript meldet das als
 * Fehler `-128`, und ein Abbruch ist kein Fehlschlag, über den jemand eine
 * Meldung sehen will.
 */
async function osascript(skript: string): Promise<string | null> {
  const kind = spawn('osascript', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  kind.stdin.end(skript, 'utf8');

  let aus = '';
  let fehler = '';
  kind.stdout.setEncoding('utf8');
  kind.stderr.setEncoding('utf8');
  kind.stdout.on('data', (t: string) => (aus += t));
  kind.stderr.on('data', (t: string) => (fehler += t));

  const code = await new Promise<number | null>((fertig, scheitere) => {
    kind.on('error', scheitere);
    kind.on('close', fertig);
  }).catch((err: unknown) => {
    // Kein `osascript` im Pfad: Das ist der Fall „nicht macOS", und der gehört
    // als Satz an die Oberfläche und nicht als Absturz in den Prozess.
    throw new Error(`Der Dateidialog des Systems ist nicht verfügbar: ${String(err)}`);
  });

  if (code === 0) return aus.trim();
  // `-128` ist der Abbruch. Er kommt auch als „User canceled." durch, je
  // nachdem, welche Fassung antwortet — beide Formen werden gelesen.
  if (/-128|User canceled/i.test(fehler)) return null;
  throw new Error(`Der Dateidialog schlug fehl: ${fehler.trim() || `Abbruch mit Code ${code}`}`);
}

/**
 * Der Startordner, so weit er brauchbar ist.
 *
 * `default location` erwartet in AppleScript ein existierendes Verzeichnis;
 * zeigt es ins Leere, bricht der ganze Dialog mit einem Fehler ab, statt einfach
 * im letzten Ordner aufzugehen. Deshalb wird hier nachgesehen und die Zeile
 * andernfalls weggelassen.
 */
async function ordnerZeile(ordner: string | undefined): Promise<string> {
  if (!ordner) return '';
  try {
    if (!(await stat(ordner)).isDirectory()) return '';
  } catch {
    return '';
  }
  return ` default location (POSIX file ${alsText(ordner)})`;
}

/**
 * Der echte Dialog.
 *
 * `activate` als erste Zeile, damit er vor dem Browser erscheint: Ohne sie
 * öffnet er sich hinter dem Fenster, aus dem er angefordert wurde, und blockiert
 * dort unsichtbar jede weitere Bedienung.
 *
 * Ohne Typfilter, obwohl `.franibook` naheliegt: AppleScript filtert über
 * Dateitypen des Systems, und die Endung ist bei keinem registriert — der Filter
 * versteckte damit genau die Dateien, die er zeigen soll. Ob die gewählte Datei
 * ein Projekt ist, entscheidet ohnehin erst das Lesen (`Project.oeffne`).
 */
export const echterDialog: Dateidialog = {
  async oeffnen(startOrdner) {
    return osascript(
      [
        'activate',
        `POSIX path of (choose file with prompt "Projekt öffnen"${await ordnerZeile(startOrdner)})`,
      ].join('\n'),
    );
  },

  async speichern(vorschlag, startOrdner) {
    return osascript(
      [
        'activate',
        `POSIX path of (choose file name with prompt "Projekt speichern"` +
          ` default name ${alsText(vorschlag)}${await ordnerZeile(startOrdner)})`,
      ].join('\n'),
    );
  },
};

/**
 * Der Ordner, in dem ein Dialog aufgehen soll: der des offenen Projekts.
 *
 * Nicht der Heimatordner: Wer ein zweites Buch öffnet oder eine Kopie ablegt,
 * tut das fast immer neben dem ersten.
 */
export function startOrdnerVon(dateiPfad: string): string {
  return dirname(dateiPfad);
}

/** Ein Namensvorschlag für „Speichern unter": derselbe Name, als Kopie. */
export function kopieVorschlag(name: string): string {
  return `${name} Kopie${ENDUNG}`;
}
