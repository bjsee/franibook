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
import { coverWarningText, teilbar } from '@franibook/core';
import type { DecodeCache } from '../decode.js';
import type { PreviewCache } from '../previews.js';
import type { Project } from '../project.js';
import type { Sources } from '../sources.js';

export interface Kontext {
  project: Project;
  sources: Sources;
  previews: PreviewCache;
  decodes: DecodeCache;
  /** Wohin die PDF-Ausgabe geht. */
  outDir: string;
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
export function coverAntwort(project: Project) {
  const cover = project.renderCover();
  return {
    design: project.coverDesign(),
    cover,
    candidates: project.coverCandidates(),
    // Derselbe Wortlaut wie im Exportbericht, damit nicht zwei Texte dieselbe
    // Ursache verschieden beschreiben.
    hints: cover.warnings.map(coverWarningText),
    profileVerified: project.profile.provenance.verifiedAt !== null,
  };
}
