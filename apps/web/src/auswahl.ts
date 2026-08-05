/**
 * Mehrfachauswahl in einer Liste – Klick, Umschalt-Bereich, Cmd-einzeln.
 *
 * Dieselbe Geste in zwei Ansichten: in der Gruppenliste über die Fotokacheln
 * (`PhotoGroups.tsx`), im Baum über die Bilder aller Doppelseiten
 * (`baum/Baum.tsx`). Beim zweiten Mal fiel auf, dass die drei Zeilen Logik –
 * und vor allem der Anker für den Bereich – nichts mit der jeweiligen Ansicht
 * zu tun haben.
 *
 * Die Reihenfolge kommt von außen als Liste der sichtbaren Kennungen: Was ein
 * Umschalt-Klick einschließt, ist das, was **auf dem Bildschirm** dazwischen
 * liegt – nach dem Filtern, nach dem Sortieren. Eine Liste aus dem Modell wäre
 * eine andere Antwort als die, die der Benutzer sieht.
 */

/** Die Modifikatoren eines Klicks. Ein `MouseEvent` passt darauf. */
export interface Klicklage {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface Auswahlzug {
  /** Die neue Auswahl. */
  selected: Set<string>;
  /** Der neue Anker für den nächsten Umschalt-Klick. */
  anker: string;
}

/**
 * Was ein Klick auf `id` aus der bisherigen Auswahl macht.
 *
 * @param sichtbar Die Kennungen in der Reihenfolge, in der sie dastehen.
 * @param anker Die zuletzt angeklickte Kennung, oder `null`.
 */
export function auswahlKlick(
  selected: ReadonlySet<string>,
  id: string,
  e: Klicklage,
  sichtbar: readonly string[],
  anker: string | null,
): Auswahlzug {
  const next = new Set(selected);

  if (e.shiftKey && anker !== null) {
    const von = sichtbar.indexOf(anker);
    const bis = sichtbar.indexOf(id);
    if (von >= 0 && bis >= 0) {
      for (let i = Math.min(von, bis); i <= Math.max(von, bis); i++) next.add(sichtbar[i]!);
    }
  } else if (e.metaKey || e.ctrlKey) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  } else {
    // Ein schlichter Klick ersetzt die Auswahl. Sonst sammelte sich beim
    // Durchsehen unbemerkt an, was man längst nicht mehr meint.
    next.clear();
    next.add(id);
  }

  return { selected: next, anker: id };
}

/**
 * Was ein Zug bewegt: die Auswahl, wenn das angefasste Bild darin liegt, sonst
 * nur dieses eine.
 *
 * Der Griff an ein Bild außerhalb der Auswahl ist keine Erweiterung, sondern
 * ein Themenwechsel – zwanzig ausgewählte Bilder mitzuziehen, weil man ein
 * einundzwanzigstes anfasst, wäre die teuerste denkbare Fehlbedienung.
 */
export function zugMenge(selected: ReadonlySet<string>, angefasst: string): string[] {
  return selected.has(angefasst) ? [...selected] : [angefasst];
}
