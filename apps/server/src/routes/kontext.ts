/**
 * Was jedes Routenmodul kennt.
 *
 * `main.ts` baut die vier Objekte einmal und reicht sie hier durch. Ein
 * Fastify-Plugin je Ressource wäre die schwerere Alternative gewesen — die
 * Kapselung, die es bringt (eigene Hooks, eigene Fehlerbehandlung je Zweig),
 * braucht dieser Server nirgends, und `app.register` hätte jeden Aufruf
 * asynchron gemacht.
 *
 * Die Routenmodule sind reine Adapter: Parameter lesen, prüfen, genau eine
 * Methode auf `project` rufen, das Ergebnis in einen Statuscode übersetzen.
 * Steht in einer Route eine Rechnung mit Millimetern oder eine Schleife über
 * Doppelseiten, gehört sie nach `project.ts` oder in den Kern.
 */
import { coverWarningText, mosaicWarningText, teilbar } from '@franibook/core';
import type { Dateidialog } from '../dateidialog.js';
import type { DecodeCache } from '../decode.js';
import type { PreviewCache } from '../previews.js';
import type { Project } from '../project.js';
import type { Umschlagmosaik } from '../project/umschlagmosaik.js';
import type { Sources } from '../sources.js';
import type { Videowerkzeuge } from '../video.js';
import type { AbstandsErkennung } from '../vision.js';
import type { Zuletzt } from '../zuletzt.js';

/**
 * Ein Dateiname für den PDF-Export.
 *
 * Der Name kommt aus dem Anfragekörper und landet über `join(outDir, name)` auf
 * der Platte – ein `..` darin wäre ein Schreibloch, das quasi überallhin
 * schreiben ließe, wo der Serverprozess Rechte hat. Derselbe Gedanke wie beim
 * Notanker-Namen (`project/notanker.ts`), nur für Endungen statt Zeitstempel.
 */
export const EXPORT_DATEINAME = /^[a-zA-Z0-9_-]+\.pdf$/;

/** Dasselbe für den Poster-Export — ein JPEG statt eines PDF. */
export const EXPORT_DATEINAME_JPG = /^[a-zA-Z0-9_-]+\.jpg$/;

/**
 * Ob ein Fehler von einer nicht lesbaren Datei stammt – ein ausgehängtes
 * Netzlaufwerk etwa, oder eine Quelle, die zwischen Anfrage und Zugriff
 * verschwunden ist.
 *
 * Gebraucht in den Export- und Bildendpunkten (`buch.ts`, `umschlag.ts`,
 * `fotos.ts`): Ohne diese Prüfung schlägt die rohe Exception bis zu Fastifys
 * Standardfehler durch, und die enthält den vollen NAS-Pfad – ein deutscher
 * Satz mit `503` ist die ehrlichere und ungefährlichere Antwort. Bewusst
 * großzügig gefasst wie `istDecoderFehler` in `decode.ts`: Ein zu Unrecht als
 * Dateifehler gedeuteter Fehler kostet eine falsche Statuszahl, ein
 * übersehener eine Exception mit Pfad in der Antwort.
 */
export function istDateiFehler(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (
    code &&
    /^E(NOENT|ACCES|PERM|NOTDIR|ISDIR|STALE|IO|CONNRESET|TIMEDOUT|HOSTUNREACH|NETDOWN|NETUNREACH)$/.test(
      code,
    )
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOENT|no such file|permission denied|nicht erreichbar/i.test(msg);
}

/**
 * Liest eine eingeworfene Datei aus Rumpf und Query.
 *
 * Zwei Routen nehmen einen Einwurf an – in den Pool und auf eine Doppelseite –,
 * und beide müssen dieselben zwei Dinge prüfen: dass überhaupt Bytes ankamen
 * (ein `POST` ohne Rumpf oder mit einem Medientyp, für den kein Parser
 * angemeldet ist, liefert keinen Buffer) und dass ein Name dabei ist. Was ein
 * brauchbarer *Name* ist, entscheidet dagegen die Fachlogik (`pruefeName` in
 * `project/einwurf.ts`) – die Endungen des Imports haben in einer Route nichts
 * zu suchen.
 */
export function leseEinwurf(
  body: unknown,
  name: string | undefined,
): { datei: { name: string; bytes: Buffer } } | { error: string } {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return { error: 'Es kamen keine Bilddaten an' };
  }
  if (!name || name.trim().length === 0) {
    return { error: 'Der Dateiname fehlt (Query `name`)' };
  }
  return { datei: { name, bytes: body } };
}

/**
 * Die Fallstelle eines Einwurfs, normiert auf das Endformat.
 *
 * Drei Ergebnisse und nicht zwei: Fehlt sie ganz, ist das die Ansage „ordne die
 * Seite neu an" (so wirft der Baum ein Bild ein). Steht dort etwas Unbrauchbares,
 * ist es ein Fehler – stillschweigend als „keine Stelle" zu lesen hieße, aus
 * einem Tippfehler ein Neuanordnen zu machen.
 *
 * Hier und nicht in `spreads.ts`, seit der Videoeinwurf dieselbe Stelle liest:
 * Zwei gleichlautende Prüfungen wären zwei Gelegenheiten, die Grenzen
 * auseinanderlaufen zu lassen.
 */
export function lesePunkt(
  x: string | undefined,
  y: string | undefined,
): { x: number; y: number } | undefined | 'unbrauchbar' {
  if (x === undefined && y === undefined) return undefined;
  const zahlen = [Number(x), Number(y)];
  if (!zahlen.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return 'unbrauchbar';
  return { x: zahlen[0]!, y: zahlen[1]! };
}

export interface Kontext {
  project: Project;
  sources: Sources;
  /**
   * Welche Projekte zuletzt offen waren (`~/.franibook/zuletzt.json`).
   *
   * Ein Pflichtfeld ohne Rückfall, anders als `videos` und `dialog` darunter:
   * Ein Rückfall müsste die echte Datei im Heimatverzeichnis nehmen, und ein
   * Test, der die Liste der letzten Projekte des Benutzers umschreibt, wäre ein
   * Test mit Nebenwirkungen auf dessen Arbeit.
   */
  zuletzt: Zuletzt;
  previews: PreviewCache;
  decodes: DecodeCache;
  /**
   * Bildvergleich für die Doppel (`GET /api/photos/doppel`).
   *
   * Anders als die Gesichtserkennung steht sie hier: Ihr Ergebnis wird nicht
   * gespeichert, sondern auf Anfrage gerechnet — der Vorschlag hängt an den
   * Datumskorrekturen und wäre gespeichert nach der nächsten falsch.
   */
  abstaende: AbstandsErkennung;
  /** Wohin die PDF-Ausgabe geht. */
  outDir: string;
  /**
   * Wo die abgeleiteten Bilder liegen — Vorschauen und gebackene Mosaike.
   *
   * Der `PreviewCache` kennt den Ordner, behält ihn aber für sich. Das
   * Titelmosaik legt daneben seinen eigenen ab und braucht ihn deshalb; ihn aus
   * dem Cache herauszureichen hieße, dessen Kapselung für einen Nachbarn zu
   * öffnen.
   */
  cacheDir: string;
  /**
   * Die Griffe, die eine Videodatei anfassen — normalerweise nicht gesetzt.
   *
   * Ausdrücklich austauschbar, damit die Zusagen des Videoeinwurfs ohne `ffmpeg`
   * prüfbar sind (Begründung bei `Videowerkzeuge` in `video.ts`). Fehlt das Feld,
   * gelten die echten.
   */
  videos?: Videowerkzeuge;
  /**
   * Der Dateidialog des Systems — normalerweise nicht gesetzt.
   *
   * Austauschbar aus demselben Grund wie `videos`: Ein Test, der „Projekt
   * öffnen" prüft, darf keinen Dialog aufgehen lassen, auf den niemand klickt.
   * Fehlt das Feld, gilt der echte (`echterDialog`).
   */
  dialog?: Dateidialog;
  /**
   * Was nach einem Projektwechsel im Hintergrund nachgezogen wird.
   *
   * Vorschauen wärmen, Bildmerkmale, Bildqualität, Farbwerte — dieselbe Kette,
   * die ein Serverstart durchläuft. Sie steht in `main.ts`, weil sie die
   * Werkzeuge braucht, die dort gebaut werden (Vision), und keine Route sie
   * kennt. Als Rückruf und nicht als Objekt im Kontext: Die Route soll nichts
   * über die Reihenfolge dieser vier Schritte wissen müssen.
   */
  nachlauf?: () => void;
  /** Vorgabe für `FRANIBOOK_LIMIT`, wenn eine Anfrage keine eigene mitbringt. */
  importLimit?: number | undefined;
}

/**
 * Eine gerenderte Doppelseite, wie die Oberfläche sie braucht.
 *
 * Das Rendered Spread Model plus vier Auskünfte, die nicht hineingehören:
 * `timelineOverride` ist die Entscheidung des Benutzers zu dieser Doppelseite,
 * `groups` sagt, welche Fotogruppen hier liegen, `blocks` liefert die Rohdaten
 * der Textblöcke – im RSM stehen sie als Zeilen mit fertiger Geometrie, zum
 * Bearbeiten braucht es Kasten, Winkel und Größe. Die Renderer sehen nichts
 * davon.
 *
 * **Eine Funktion für alle Antworten.** Jeder Endpunkt, der eine Doppelseite
 * zurückgibt, muss dieselbe Form liefern: Die Oberfläche ersetzt damit ihren
 * Zustand. Gab ein Schreibvorgang nur das nackte RSM zurück, verschwanden die
 * Textblöcke aus der Ansicht, sobald man einen anlegte – und mit ihnen die
 * Auswahl, an der jede weitere Änderung hängt.
 */
export function spreadAntwort(project: Project, index: number) {
  const rendered = project.render(index);
  if (!rendered) return undefined;
  const spread = project.spreads[index];
  return {
    ...rendered,
    timelineOverride: spread?.timeline ?? null,
    lockedSide: spread?.lockedSide ?? null,
    // Das Hintergrundbild samt Buchseite. Aus dem RSM allein wäre beides nur zu
    // erraten – dort ist es eine Bildbox wie jede andere, und ob sie halb oder
    // ganz liegt, stünde in ihrer Breite.
    hintergrundBild: spread?.backgroundPhotoId
      ? { photoId: spread.backgroundPhotoId, side: spread.backgroundPhotoSide ?? null }
      : null,
    groups: project.spreadGroups(index),
    blocks: spread?.blocks ?? [],
    // Die Vorlagentexte samt Vorlage: Sie lassen sich verschieben, aufziehen und
    // drehen, und die Oberfläche braucht dafür beides – den Text mit seiner
    // Handarbeit und den Platz, an dem er ohne sie hängt (Stil, Ausrichtung,
    // Zeilenzahl stehen dort). Im RSM steht davon nur das Ergebnis.
    texts: spread?.texts ?? [],
    templateId: spread?.templateId ?? null,
    // Ob diese Seite das Neuanordnen übersteht. Die Oberfläche zeigt das
    // Schloss – sonst wäre nicht zu sehen, welche Seiten selbst gebaut sind.
    locked: spread?.locked ?? false,
    // Ob sich einzelne Buchseiten daraus nehmen lassen. Ein Auftakt trägt seinen
    // Text über beide Hälften, justierte Zeilen ihre Rechtecke – dort gibt es
    // nur das ganze Blatt, und die Oberfläche soll das gar nicht erst anbieten.
    // Gefragt wird mit `teilbar` und nicht mit `zerlegbar`: Ein festgehaltenes
    // Blatt wird beim Umpaaren geschont, auf Verlangen aber sehr wohl getrennt.
    splittable: spread ? teilbar(spread) : false,
    // Was die Abnahme über diese Seite sagt — samt der schon abgenickten Funde,
    // damit die Bühne sie leise zeigen kann statt gar nicht. Sie hängt an jeder
    // Doppelseitenantwort und nicht an einem eigenen Endpunkt: Ein Fund entsteht
    // und verschwindet mit dem Ausschnitt, den man gerade zieht, und ein zweiter
    // Abruf wäre immer einen Handgriff hinterher.
    befunde: project.befundeDerSeite(rendered, index),
  };
}

/**
 * Die Gruppen mit ihrem Platz im Buch.
 *
 * `firstSpreadIndex` fehlt, wenn keines der Fotos im Buch steht – etwa weil sie
 * noch im Pool liegen. Die Gruppenansicht sortiert danach und schreibt die
 * Seitenzahl an jede Gruppe; ohne sie war nicht zu sehen, wo eine Gruppe im
 * Buch überhaupt vorkommt.
 */
export function gruppenAntwort(project: Project) {
  const erste = project.firstSpreadOfGroup();
  return {
    groups: project.sortedGroups().map((g) => {
      const index = erste.get(g.id);
      return { ...g, ...(index !== undefined ? { firstSpreadIndex: index } : {}) };
    }),
  };
}

/**
 * Der Umschlag: Gestaltung, gerechnete Geometrie und Auswahl fürs Titelbild.
 *
 * Die Geometrie wird bei jedem Aufruf neu gerechnet, nie gespeichert – die
 * Rückenbreite hängt an der Seitenzahl, und die ändert sich mit jedem
 * Neuaufbau des Buchs.
 */
export function coverAntwort(project: Project, mosaikFehler?: string) {
  const cover = project.renderCover();
  const vorn = project.titelmosaik;
  const hinten = project.rueckmosaik;
  return {
    design: project.coverDesign(),
    cover,
    candidates: project.coverCandidates(),
    // Derselbe Wortlaut wie im Exportbericht, damit nicht zwei Texte dieselbe
    // Ursache verschieden beschreiben. Die Befunde eines Mosaiks tragen ihren
    // Deckel im Satz — „ohne Farbwerte" zweimal untereinander wäre sonst keine
    // Auskunft, sondern ein Rätsel.
    hints: [
      ...cover.warnings.map(coverWarningText),
      ...(vorn ? vorn.plan.warnings.map((w) => `Titelmosaik: ${mosaicWarningText(w)}`) : []),
      ...(hinten ? hinten.plan.warnings.map((w) => `Rückseite: ${mosaicWarningText(w)}`) : []),
      ...(mosaikFehler ? [`Ein Umschlagmosaik ließ sich nicht bauen: ${mosaikFehler}`] : []),
    ],
    profileVerified: project.profile.provenance.verifiedAt !== null,
    // Was aus den Anweisungen geworden ist. Die Oberfläche zeigt daran, wie
    // viele Bilder ein Mosaik trägt — die Zahl ist der eigentliche Reiz der
    // Sache und steht in keiner anderen Antwort.
    ...(vorn ? { mosaik: mosaikAntwort(vorn) } : {}),
    ...(hinten ? { rueckmosaik: mosaikAntwort(hinten) } : {}),
  };
}

function mosaikAntwort(m: Umschlagmosaik) {
  return {
    photoId: m.photoId,
    datei: m.vorschauDatei,
    kacheln: m.kacheln,
    fotos: m.fotos,
    // Erst im Verhältnis dazu bedeutet `fotos` etwas: Die Oberfläche
    // beschriftet damit den Vielfaltsregler.
    verfuegbar: m.plan.candidates,
    druckBreitePx: m.druckBreitePx,
    druckHoehePx: m.druckHoehePx,
  };
}
