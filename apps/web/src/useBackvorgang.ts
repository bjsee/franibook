/**
 * Der wiederkehrende Rahmen um einen Backvorgang, der einen Fortschritt meldet.
 *
 * `Cover.tsx` (Mosaikregler) und `CoverMosaik.tsx` (Poster-Export) teilen sich
 * dieselbe Form: ein laufender Zähler gegen überholte Antworten, ein Takt, der
 * abfragt, solange gewartet wird, und das Aufräumen danach, gleich ob Erfolg
 * oder Fehler. Verschieden ist nur, wonach gefragt wird und was am Ende
 * geschieht — beides bleibt beim Aufrufer.
 */
import { useRef } from 'react';
import { fehlertext, type Mosaikfortschritt } from './api.js';

export function useBackvorgang() {
  /** Laufende Nummer des jüngsten Vorgangs — überholte Antworten schreiben nichts mehr. */
  const lauf = useRef(0);

  /**
   * Startet einen Vorgang: setzt `busy`, fragt im Takt `fortschrittLaden` ab,
   * führt `aktion` aus und räumt danach auf. `aktion` bekommt zwei Werkzeuge
   * mit: `istAktuell`, um eigene Erfolgsmeldungen gegen einen zwischenzeitlich
   * erneut gestarteten Vorgang abzusichern (dieselbe Absicherung, die dieser
   * Haken für Fehler und Aufräumen schon selbst übernimmt), und `stoppeTakt`
   * für den Fall, dass die Arbeit, über die der Server Auskunft gibt, schon
   * fertig ist, `aktion` selbst aber noch weitermacht (Poster-Export: das Bild
   * ist gebacken, der Download läuft noch) — ohne sie fragte der Takt bis zum
   * Ende von `aktion` weiter nach einem Fortschritt, den es nicht mehr gibt.
   */
  async function starte(optionen: {
    fortschrittLaden: () => Promise<{ fortschritt: Mosaikfortschritt | null }>;
    taktMs: number;
    setArbeit: (a: Mosaikfortschritt | null) => void;
    setBusy: (b: string | null) => void;
    setNote: (n: string | null) => void;
    busyText: string;
    aktion: (werkzeug: { istAktuell: () => boolean; stoppeTakt: () => void }) => Promise<void>;
  }): Promise<void> {
    const eigener = ++lauf.current;
    const istAktuell = () => eigener === lauf.current;

    optionen.setBusy(optionen.busyText);
    optionen.setNote(null);
    optionen.setArbeit(null);
    let takt: number | undefined = window.setInterval(() => {
      optionen
        .fortschrittLaden()
        .then((f) => {
          if (istAktuell()) optionen.setArbeit(f.fortschritt);
        })
        .catch(() => undefined);
    }, optionen.taktMs);
    const stoppeTakt = () => {
      if (takt === undefined) return;
      window.clearInterval(takt);
      takt = undefined;
    };

    try {
      await optionen.aktion({ istAktuell, stoppeTakt });
    } catch (e) {
      if (istAktuell()) optionen.setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      stoppeTakt();
      if (istAktuell()) {
        optionen.setArbeit(null);
        optionen.setBusy(null);
      }
    }
  }

  return starte;
}
