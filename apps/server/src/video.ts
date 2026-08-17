/**
 * Videos: aufnehmen, ein Standbild ziehen, die Dauer erfragen.
 *
 * Ein Video kommt nie ins Buch – ins Buch kommt ein **Standbild** daraus, als
 * gewöhnliches Foto, und daneben ein QR-Code mit der Adresse, unter der der Film
 * zu sehen ist (`model/video.ts` im Kern). Was dieses Modul tut, ist alles, was
 * dafür eine Datei anfassen muss.
 *
 * **Das Video liegt im Cache, nicht in der Bildquelle.** Das ist die eine
 * Entscheidung, die man hier verstehen muss. Die Bildquelle ist der Fotobestand –
 * sie wird von einem Sync-Dienst bewirtschaftet und gesichert, und ein
 * halbes Gigabyte Film gehört dort nicht hinein, nur weil ein Einzelbild daraus
 * gedruckt wird. Das **Standbild** dagegen nimmt den normalen Weg des Einwurfs
 * nach `<erste Quelle>/eingeworfen/` (`project/einwurf.ts`): Es ist ein Foto des
 * Buches und soll gesichert werden wie jedes andere.
 *
 * Der Preis ist benannt und klein: Wird der Cache gelöscht, lässt sich kein
 * **neues** Standbild mehr wählen, bis dasselbe Video erneut eingeworfen wird.
 * Das Buch verliert nichts – Standbild und Adresse liegen im Projekt. Das
 * Original des Films liegt ohnehin dort, wo es herkam; wir sind nie seine
 * einzige Kopie und wollen es nicht sein.
 *
 * **Wir hosten nichts.** Der Server liefert kein Video aus, es gibt keine Route,
 * die eines zurückgibt. Wo der Film zu sehen ist, sagt eine Adresse, die der
 * Benutzer angibt.
 */
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, rename, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { VIDEO_KENNUNG_LAENGE, istVideoKennung } from '@franibook/core';
import { VIDEO_EXT, dateiKennung } from './import.js';

const execFileAsync = promisify(execFile);

/**
 * Höchstgröße eines eingeworfenen Videos.
 *
 * 1 GB: Eine Minute 4K vom iPhone sind rund 400 MB, und länger als ein paar
 * Minuten wird niemand einwerfen, weil das Ziel ein Standbild ist. Die Grenze ist
 * kein Schutz vor Angriff – der Server hört nur auf `127.0.0.1` –, sondern gegen
 * einen versehentlich fallen gelassenen Filmordner, der sonst die Platte füllt.
 *
 * Anders als beim Bildeinwurf (`EINWURF_MAX_BYTES`) wird sie **beim Schreiben**
 * geprüft und nicht am Parser: Ein Video wandert im Strom auf die Platte, es
 * liegt nie ganz im Speicher, und `Content-Length` fehlt bei einem Upload ohne
 * Längenangabe.
 */
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;

/** Der Unterordner des Caches, in dem Videos liegen. */
const ORDNER = 'videos';

/**
 * Wie lange ein Standbild höchstens braucht, und wie groß es werden darf.
 *
 * `maxBuffer` muss ausdrücklich gesetzt werden: Die Vorgabe von `execFile` liegt
 * bei 1 MB, und ein JPEG aus einem 4K-Bild überschreitet das. Ohne die Angabe
 * scheitert der Aufruf mit `ENOBUFS` – an einer Stelle, die nichts über Bilder
 * sagt.
 */
const STANDBILD_MAX_BYTES = 64 * 1024 * 1024;
const ZEIT_GRENZE_MS = 30_000;

/**
 * Qualität des Standbildes.
 *
 * `-q:v 2` ist die zweitbeste Stufe von mjpeg; sie steht dem `q98` des
 * `sips`-Pfades nahe (`decode.ts`) und aus demselben Grund: Das Standbild ist
 * eine Druckvorlage und darf keine sichtbaren Artefakte einbringen. Es ist die
 * einzige Kopie dieses Bildes – aus dem Video ließe sich es neu ziehen, aber
 * nur, solange das Video im Cache liegt.
 */
const STANDBILD_QUALITAET = '2';

/**
 * Die drei Griffe, die eine Videodatei anfassen – als austauschbares Bündel.
 *
 * Dasselbe Muster wie bei `project/speichern.ts`, und aus demselben Grund: Was
 * `ffmpeg` tut, kann ein Test nicht prüfen, ohne `ffmpeg` vorauszusetzen – und
 * dann prüft er die Umgebung mit. Die Zusagen, um die es hier geht, sind aber
 * andere: dass ein Standbild als Foto im Bestand landet, dass die Adresse an
 * allen Standbildern desselben Films gilt, dass ein Cmd+Z beides zurücknimmt.
 * Die sind mit einem eingesetzten Bild prüfbar, ohne einen Film zu dekodieren.
 *
 * Im Produktivbetrieb steht hier `echteVideowerkzeuge`; der Kontext der Routen
 * lässt das Feld normalerweise weg (`routes/kontext.ts`).
 */
export interface Videowerkzeuge {
  findeVideo(cacheDir: string, kennung: string): Promise<string | undefined>;
  standbild(pfad: string, sekunde: number): Promise<Buffer>;
  videoDauerSek(pfad: string): Promise<number>;
}

/** Ob ein Dateiname als Video angenommen wird – und mit welcher Endung. */
export function videoEndung(name: string): string | undefined {
  const ext = extname(name).toLowerCase();
  return VIDEO_EXT.has(ext) ? ext : undefined;
}

/**
 * Ob `ffmpeg` und `ffprobe` im Pfad liegen.
 *
 * Geprüft und nicht vorausgesetzt: Ohne sie ist der Videoeinwurf die einzige
 * Funktion, die nicht geht, und das soll ein Satz mit Handlungsanweisung sagen –
 * nicht eine Ausnahme mit `ENOENT`. Dieselbe Haltung wie bei `swiftc` in
 * `vision.ts`, nur lauter: Dort entfällt eine Verbesserung stillschweigend, hier
 * scheitert ein ausdrücklicher Griff des Benutzers.
 */
export async function videoWerkzeuge(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Promise.all([
      execFileAsync('ffmpeg', ['-version'], { timeout: ZEIT_GRENZE_MS }),
      execFileAsync('ffprobe', ['-version'], { timeout: ZEIT_GRENZE_MS }),
    ]);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'Für Videos braucht der Server ffmpeg und ffprobe im Pfad – ' +
        'unter macOS mit `brew install ffmpeg`.',
    };
  }
}

/** Wohin ein Video mit dieser Kennung gehört. */
function pfadFuer(cacheDir: string, kennung: string, endung: string): string {
  return join(cacheDir, ORDNER, `${kennung}${endung}`);
}

/**
 * Das Video zu einer Kennung, falls es im Cache liegt.
 *
 * **Die Kennung wird geprüft, bevor sie in einen Pfad eingeht.** Sie kommt aus
 * einer Adresse, und `istVideoKennung` lässt nur Hexziffern fester Länge durch –
 * ohne diese Prüfung wäre `../../project.json` ein gültiger „Kennungswert" und
 * die Route ein Leseloch. Gesucht wird über den Ordnerinhalt und nicht über die
 * Endungsliste, damit ein Umbenennen von Hand keine Rolle spielt.
 */
export async function findeVideo(cacheDir: string, kennung: string): Promise<string | undefined> {
  if (!istVideoKennung(kennung)) return undefined;
  const ordner = join(cacheDir, ORDNER);
  const namen = await readdir(ordner).catch(() => [] as string[]);
  const treffer = namen.find((n) => n.startsWith(`${kennung}.`) && videoEndung(n));
  return treffer ? join(ordner, treffer) : undefined;
}

export interface Aufnahme {
  kennung: string;
  pfad: string;
  dauerSek: number;
}

/**
 * Nimmt ein Video im Strom auf und legt es unter seiner Kennung ab.
 *
 * Die Reihenfolge ist dieselbe wie beim Bildeinwurf und aus demselben Grund
 * (`project/einwurf.ts`): erst in eine Nebendatei schreiben, dann die Kennung
 * rechnen, dann an den endgültigen Platz umbenennen. Ein abgebrochener Upload
 * hinterlässt damit keine halbe Datei unter einer Kennung, die dann für immer
 * falsch wäre.
 *
 * Liegt dasselbe Video schon da, wird die Nebendatei verworfen: **Dieselbe
 * Kennung muss dasselbe Video bedeuten**, sonst zeigt ein gedruckter Code auf
 * einen anderen Film.
 */
export async function nimmVideoAuf(
  cacheDir: string,
  quelle: Readable,
  endung: string,
): Promise<Aufnahme> {
  const ordner = join(cacheDir, ORDNER);
  await mkdir(ordner, { recursive: true });

  // Der Name der Nebendatei hängt am Prozess und an der Uhr, nicht am Inhalt:
  // Den kennt man erst, wenn alles geschrieben ist.
  const neben = join(ordner, `.upload-${process.pid}-${Date.now()}${endung}`);

  try {
    let gelesen = 0;
    quelle.on('data', (stueck: Buffer) => {
      gelesen += stueck.length;
      // Selbst abbrechen und nicht auf ein Limit von Fastify hoffen: Ohne
      // `Content-Length` prüft dort niemand, und die Platte wäre voll, bevor es
      // jemandem auffällt.
      if (gelesen > VIDEO_MAX_BYTES) quelle.destroy(new Error('zu groß'));
    });
    await pipeline(quelle, createWriteStream(neben));

    const kennung = (await dateiKennung(neben)).slice(0, VIDEO_KENNUNG_LAENGE);
    const ziel = pfadFuer(cacheDir, kennung, endung);

    const liegtSchon = await stat(ziel).then(
      () => true,
      () => false,
    );
    if (liegtSchon) await rm(neben, { force: true });
    else await rename(neben, ziel);

    return { kennung, pfad: ziel, dauerSek: await videoDauerSek(ziel) };
  } catch (fehler) {
    await rm(neben, { force: true }).catch(() => undefined);
    throw fehler;
  }
}

/**
 * Die Dauer in Sekunden.
 *
 * Gebraucht für den Schieber, mit dem das Standbild gewählt wird – und als
 * Grenze für die Sekundenangabe: Ein Zeitpunkt hinter dem Ende liefert kein
 * Bild, und die Fehlermeldung von ffmpeg wäre keine Auskunft für die Oberfläche.
 */
export async function videoDauerSek(pfad: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      pfad,
    ],
    { timeout: ZEIT_GRENZE_MS },
  );
  const dauer = Number.parseFloat(stdout.trim());
  // Manche Container tragen keine Dauer. Dann ist 0 die ehrliche Antwort: Der
  // Schieber zeigt keinen Bereich, das erste Bild geht trotzdem.
  return Number.isFinite(dauer) && dauer > 0 ? dauer : 0;
}

/**
 * Ein Einzelbild an einer Stelle des Videos, als JPEG.
 *
 * **`-ss` steht vor `-i`**, und das ist eine Abwägung: Davor springt ffmpeg über
 * den Index zum nächsten Keyframe und braucht dafür Millisekunden statt
 * Sekunden; danach dekodiert es alles bis zum Zeitpunkt und trifft ihn genau.
 * Für einen Schieber, der beim Ziehen laufend Bilder holt, ist die schnelle
 * Variante die einzig brauchbare – und ein Standbild, das eine halbe Sekunde
 * neben dem gewählten Moment liegt, ist kein Fehler, sondern das nächste
 * vollständige Bild.
 *
 * **Die Sekunde geht als Zahl herein und als `String(zahl)` heraus.** Sie kommt
 * aus einer Query, und ein Wert wie `-f` wäre für ffmpeg ein eigenes Argument
 * statt einer Zeitangabe. `execFile` mit Argumentliste schließt eine Shell aus,
 * aber nicht, dass ein Argument als Schalter gelesen wird.
 */
export async function standbild(pfad: string, sekunde: number): Promise<Buffer> {
  const wann = Number.isFinite(sekunde) && sekunde > 0 ? sekunde : 0;
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      // Kein Nachfragen auf der Konsole, keine Ausgabe außer Fehlern: Der Server
      // hat kein Terminal, an dem jemand „überschreiben? [y/N]" beantwortet.
      '-nostdin',
      '-v',
      'error',
      '-ss',
      String(wann),
      '-i',
      pfad,
      '-frames:v',
      '1',
      '-f',
      'mjpeg',
      '-q:v',
      STANDBILD_QUALITAET,
      // Nach `-` schreibt ffmpeg auf die Standardausgabe. Eine Datei im Cache
      // wäre ein zweiter Ort, an dem ein Bild liegt, das niemand mehr braucht.
      '-',
    ],
    { timeout: ZEIT_GRENZE_MS, maxBuffer: STANDBILD_MAX_BYTES, encoding: 'buffer' },
  );

  if (stdout.length === 0) {
    throw new Error(`An dieser Stelle des Videos ist kein Bild (${wann} s)`);
  }
  return stdout;
}

/**
 * Der Dateiname, den das Standbild im Bestand bekommt.
 *
 * Der Name des Videos plus die Sekunde: `ostern.mov` bei 12,5 s wird zu
 * `ostern-12,5s.jpg`. Die Sekunde gehört dazu, weil derselbe Film mehrere
 * Standbilder hergeben kann und zwei Dateien namens `ostern.jpg` im Ordner
 * niemand unterscheidet – `schreibeOhneZuUeberschreiben` hängt sonst eine `-2`
 * an, die nichts sagt.
 */
export function standbildName(videoName: string, sekunde: number): string {
  const stamm = videoName.slice(0, videoName.length - extname(videoName).length);
  const wann = Number.isFinite(sekunde) ? Math.max(0, sekunde) : 0;
  // Komma statt Punkt: Ein zweiter Punkt im Namen sähe wie eine zweite Endung
  // aus, und die Oberfläche zeigt den Namen unverändert an.
  const zeit = Number.isInteger(wann) ? String(wann) : wann.toFixed(1).replace('.', ',');
  return `${stamm}-${zeit}s.jpg`;
}

/** Die echten Werkzeuge – `ffmpeg` und `ffprobe`, wie oben beschrieben. */
export const echteVideowerkzeuge: Videowerkzeuge = { findeVideo, standbild, videoDauerSek };
