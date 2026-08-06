/**
 * Farbraum des Exports: was durchgesetzt wird und was im PDF darübersteht.
 *
 * Die Pixel im PDF sind sRGB, und zwar ohne dass hier etwas dafür getan wird:
 * sharp wandelt ein Bild mit eingebettetem Profil beim Einlesen selbst um
 * (`icc_transform` mit `embedded: true`, perzeptiv). Am Bestand ist das keine
 * Kleinigkeit — 224 von 973 Dateien (23 %) tragen „Apple Wide Color Sharing
 * Profile", also einen weiten Farbraum. Ohne die Wandlung lägen sie um
 * ΔE 0,9–2,3 im Mittel und bis 11,7 im Maximum daneben (sechs Dateien
 * gemessen, Lab-Abstand gegen denselben Lauf mit `ignoreIcc`), und zwar in
 * Richtung flauer: Weitfarbige Werte, die als sRGB gelesen werden, verlieren
 * Sättigung.
 *
 * Diese Datei existiert, weil genau das unbemerkt kippen kann, sobald jemand die
 * Metadaten eines Bildes behalten will — ein naheliegender Wunsch, etwa um EXIF
 * mitzunehmen. Gemessen an einem als P3 getaggten Testbild mit dem sRGB-Wert
 * (20, 200, 90), dessen Pixel im weiten Farbraum bei (93, 197, 103) liegen:
 *
 * | Aufruf                              | Pixel        | Profil im Ergebnis |
 * | ----------------------------------- | ------------ | ------------------ |
 * | ohne Zusatz                         | 23, 200, 90  | keins              |
 * | `keepIccProfile()`/`keepMetadata()` | 93, 197, 103 | P3                 |
 * | `withMetadata()`                    | 23, 200, 90  | P3                 |
 * | `withIccProfile('srgb', …)`         | 23, 200, 90  | keins              |
 *
 * Die Vorgabe ist also richtig, und die beiden mittleren Zeilen sind auf
 * verschiedene Weise falsch: `keepIccProfile` lässt die Pixel weitfarbig (in
 * einem PDF, das als sRGB gelesen wird, ein flauer Druck), `withMetadata`
 * wandelt sie und hängt trotzdem das alte Profil an (ein farbmanagender Leser
 * wandelt dann ein zweites Mal). Beides neutralisiert ein genanntes
 * Ausgabeprofil: Auch `keepIccProfile().withIccProfile('srgb')` liefert
 * (23, 200, 90) ohne Profil. Deshalb steht der Aufruf in `prepare-image.ts`,
 * obwohl er heute nichts verändert.
 *
 * `pruefeFarbraum` deckt den anderen Fall ab: dass ein Druckprofil etwas
 * verlangt, das dieser Weg nicht leistet.
 *
 * Der zweite Teil ist der Ausgabe-Intent: Bisher war „das PDF ist sRGB" eine
 * Annahme, die nirgends im PDF stand. Sie steht jetzt drin.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrintProfile } from '@franibook/core';

/**
 * Der Farbraumname, unter dem sharp und libvips das Ziel kennen.
 *
 * Absichtlich nur eine Zuordnung und kein `default`: Ein Profil mit
 * `adobe-rgb` oder `cmyk` bekäme sonst stillschweigend sRGB — die Zahl im
 * Druckprofil wäre dann Zierde. Wer einen weiteren Farbraum ausliefern will,
 * bringt hier den sharp-Namen unter und prüft, ob pdfkit das Bild überhaupt so
 * einbetten kann (bei CMYK-JPEG ist das offen, siehe Issue #3).
 */
const SHARP_FARBRAUM: Partial<Record<PrintProfile['color']['workingSpace'], string>> = {
  srgb: 'srgb',
};

/**
 * Der Rendering-Intent, mit dem sharp wandelt. Fest verdrahtet in libvips
 * (`VIPS_INTENT_PERCEPTUAL`) und daher nicht durchreichbar — deshalb prüft
 * `pruefeFarbraum`, dass das Profil nichts anderes verlangt, statt ein Feld zu
 * lesen und zu ignorieren.
 */
const UNTERSTUETZTER_INTENT: PrintProfile['color']['renderingIntent'] = 'perceptual';

/** Verzeichnis der ICC-Dateien, die dieses Paket ausliefert. */
const ICC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icc');

/**
 * Der Farbraumname für sharp, oder ein Wurf.
 *
 * Ein Wurf beim ersten Bild ist unangenehm, aber die Alternative ist ein
 * vollständig exportiertes Buch in einem Farbraum, den niemand bestellt hat.
 */
export function sharpFarbraum(profile: PrintProfile): string {
  pruefeFarbraum(profile);
  return SHARP_FARBRAUM[profile.color.workingSpace]!;
}

/** Prüft, ob der Exportweg leistet, was das Druckprofil ansagt. */
export function pruefeFarbraum(profile: PrintProfile): void {
  const { workingSpace, renderingIntent } = profile.color;
  if (!SHARP_FARBRAUM[workingSpace]) {
    throw new Error(
      `Druckprofil ${profile.id} verlangt den Farbraum „${workingSpace}", ` +
        `der Export liefert nur ${Object.keys(SHARP_FARBRAUM).join(', ')}.`,
    );
  }
  if (renderingIntent !== UNTERSTUETZTER_INTENT) {
    throw new Error(
      `Druckprofil ${profile.id} verlangt den Rendering-Intent „${renderingIntent}", ` +
        `der Export wandelt ${UNTERSTUETZTER_INTENT}.`,
    );
  }
}

/**
 * Liest das ICC-Profil, das im Druckprofil steht.
 *
 * Der Pfad dort ist relativ und wird gegen `icc/` dieses Pakets aufgelöst — die
 * Datei gehört zum Adapter, nicht zum Kern, denn nur der Adapter liest sie
 * (`packages/core` importiert kein `fs`). Nur der Dateiname zählt: Ein Profil,
 * das ein Verzeichnis mitbringt, würde sonst aus diesem Paket hinauszeigen.
 */
export function iccProfil(profile: PrintProfile): Buffer {
  const datei = basename(profile.color.iccProfilePath);
  try {
    return readFileSync(join(ICC_DIR, datei));
  } catch {
    throw new Error(
      `Druckprofil ${profile.id} nennt das ICC-Profil „${profile.color.iccProfilePath}", ` +
        `render-pdf liefert es nicht mit (erwartet in icc/${datei}).`,
    );
  }
}

/**
 * Schließt eine Referenz ohne Inhalt ab.
 *
 * `PDFKitReference.end()` ist bei pdfkit ohne Argument aufrufbar — sein eigener
 * PDF/A-Zweig macht genau das —, die Typdefinition aus `@types/pdfkit` verlangt
 * aber einen Chunk. Die Abweichung steht deshalb einmal hier und nicht als Cast
 * an der Aufrufstelle.
 */
function beende(ref: PDFKit.PDFKitReference): void {
  (ref.end as unknown as () => void)();
}

/**
 * Schreibt den Ausgabe-Intent ins Dokument: „diese Datei ist für sRGB gerechnet".
 *
 * Bewusst **ohne** PDF/A- oder PDF/X-Kennzeichnung. pdfkit kann PDF/A
 * (`subset: 'PDF/A-3b'`) und setzt dabei denselben Intent, zieht aber eine
 * Konformitätszusage nach sich, die dieses Dokument nicht einlöst — und die
 * niemand verlangt: Der Druckdienstleister nimmt ein gewöhnliches PDF. Ein
 * Ausgabe-Intent ohne Konformitätsclaim ist zulässig, und ein RIP liest ihn.
 *
 * `S: 'GTS_PDFX'` statt `GTS_PDFA1`, weil die Aussage eine über den Druck ist
 * und nicht eine über Langzeitarchivierung.
 */
export function setzeAusgabeIntent(doc: PDFKit.PDFDocument, profile: PrintProfile): void {
  // Hier und nicht erst beim ersten Bild: Der Aufruf steht am Anfang von
  // `renderPdf`, also bricht ein untaugliches Profil ab, bevor 84 Doppelseiten
  // gerechnet sind. `prepareImage` prüft trotzdem noch einmal – es ist auch
  // einzeln aufrufbar.
  pruefeFarbraum(profile);
  const icc = iccProfil(profile);
  // Der Profilstream trägt seine eigene Kanalzahl (`N`), sonst kann ein Leser
  // den Farbraum nicht auflösen. 3 für RGB — bei CMYK wären es 4, und dann
  // hätte `pruefeFarbraum` längst geworfen.
  const profilRef = doc.ref({ Length: icc.length, N: 3 });
  profilRef.end(icc);

  const name = basename(profile.color.iccProfilePath).replace(/\.icc$/i, '');
  const intentRef = doc.ref({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    // `new String` und nicht `name`: pdfkit erkennt daran, dass der Wert als
    // PDF-Zeichenkette in Klammern geschrieben wird und nicht als Name mit
    // Schrägstrich. Dieselbe Machart wie in pdfkits eigenem PDF/A-Zweig.
    Info: new String(name),
    OutputConditionIdentifier: new String(name),
    DestOutputProfile: profilRef,
  });
  beende(intentRef);

  // Dieselbe Stelle, die pdfkit für PDF/A benutzt. Ein zweites Setzen
  // überschreibt, kein Anhängen: Mehr als einen Ausgabe-Intent hat dieses
  // Dokument nicht.
  (doc as unknown as { _root: { data: Record<string, unknown> } })._root.data.OutputIntents = [
    intentRef,
  ];
}
