/**
 * Nachladen, was ein anderes Fenster geändert hat – aber nicht mitten im Griff.
 *
 * Der Server meldet jeden wirksamen Griff an alle übrigen Fenster
 * (`apps/server/src/ereignisse.ts`). Was hier entschieden wird, ist allein der
 * **Zeitpunkt**: Eine Meldung, die während einer Zeigergeste eintrifft, darf
 * nicht sofort nachladen.
 *
 * Der Grund ist handfest. Nachladen heißt in dieser Oberfläche `setSpread(null)`
 * und ein neues RSM (`neuRendern` in `App.tsx`) — die Doppelseite verschwindet
 * für einen Augenblick und kommt als neues Objekt zurück. Geschieht das,
 * während jemand einen Ausschnitt zieht, verliert der Griff das Bild unter dem
 * Zeiger: Die Bewegung läuft weiter, das Ziel ist ein anderes, und was am Ende
 * gespeichert wird, hat niemand so gemeint. Deshalb sammelt der Haken die
 * Meldungen, solange ein Zeiger unten ist, und arbeitet sie beim Loslassen ab.
 *
 * **Vor dem Nachladen geht raus, was noch aussteht** (`ausstehendSenden`) —
 * dieselbe Reihenfolge wie beim Zurücknehmen und aus demselben Grund: Ausschnitt
 * und Neigung gehen verzögert zum Server, und ein PATCH, der nach dem Nachladen
 * einträfe, überschriebe die eben geholte Fassung mit einem Wert von vorhin.
 *
 * **Mehrere Meldungen sind eine Neuladung.** Wer im anderen Fenster einen Regler
 * zieht, erzeugt eine Meldung je Zwischenstellung; nachzuladen ist trotzdem nur
 * der Stand danach. Gezählt werden sie dennoch — die Oberfläche sagt lieber
 * „3 Änderungen aus einem anderen Fenster" als dreimal denselben Satz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ereignisseHoeren, type FremdeAenderung } from './api.js';
import { ausstehendSenden } from './ausstehend.js';

/**
 * Wie lange nach dem Loslassen gewartet wird, ehe nachgeladen wird.
 *
 * **Nicht sofort, und das ist der Kern der Sache.** Beim Loslassen ist die
 * Änderung noch nicht abgeschickt: Die Zieh-Handler des Editors hängen ihre
 * `pointerup`-Hörer erst **beim Drag-Start** ans Fenster
 * (`spread/useSpreadEditor.ts`), also später als dieser Haken — bei gleicher
 * Phase kommt der ältere zuerst dran, und mit `capture` sowieso. Ihr `onUp`
 * speichert außerdem aus einem React-Updater heraus (`setPendingRect(…)`), läuft
 * also nicht einmal synchron im Ereignis.
 *
 * Ein `ausstehendSenden()` unmittelbar im Loslassen fände darum **nichts** vor
 * und wäre sofort fertig; das anschließende Nachladen träfe auf einen `PATCH`,
 * der erst danach hinausgeht, und die Doppelseite zeigte den Stand von vor dem
 * Zug. Genau der Fall, den dieses Modul verhindern soll.
 *
 * Der Nachlauf gibt dem Ereignisumlauf und einem React-Render Zeit, den Sender
 * anzumelden (`planeSofort`) — danach zieht `ausstehendSenden()` ihn vor. Eine
 * Phasenumstellung allein hätte nicht genügt, ein Zählen von Handlern wäre eine
 * Absprache über fremden Code. 150 ms sind reichlich für beides und liegen weit
 * unter dem, was man als Verzögerung beim Nachladen bemerkt.
 */
const NACHLAUF_MS = 150;

/**
 * Warum nachgeladen wird.
 *
 * Zwei Fälle, und die Oberfläche sagt sie verschieden an: Eine **Änderung** kam
 * aus einem anderen Fenster und weiß, was sie war. Eine **Lücke** ist eine
 * Verbindung, die weg war — was in ihr geschah, weiß niemand, und „aus einem
 * anderen Fenster: Verbindung war unterbrochen" wäre ein Satz, der über seine
 * eigene Herkunft lügt.
 */
export type Nachladegrund =
  { grund: 'aenderung'; letzte: FremdeAenderung; anzahl: number } | { grund: 'luecke' };

export interface EreignisOptionen {
  /**
   * Ob überhaupt gehört wird.
   *
   * `false` in der nackten Ansicht (`?bare`): Sie ist ein Standbild für den
   * Parity-Test und den Druckvergleich, und eine Leitung, die sie nachladen
   * lässt, macht aus einem Vergleich ein bewegliches Ziel.
   */
  aktiv: boolean;
  /** Was zu tun ist, wenn der eigene Stand nicht mehr der des Servers ist. */
  onNachladen(grund: Nachladegrund): void;
}

export interface Ereignisstand {
  /**
   * Offene Fenster, dieses mitgezählt.
   *
   * `1`, solange man allein ist — und `0`, solange keine Leitung steht. Die
   * Unterscheidung trägt die Anzeige: „allein" ist etwas anderes als „weiß
   * gerade nichts".
   */
  fenster: number;
}

export function useEreignisse({ aktiv, onNachladen }: EreignisOptionen): Ereignisstand {
  const [fenster, setFenster] = useState(0);
  /** Solange ein Zeiger unten ist, wird gesammelt statt nachgeladen. */
  const zieht = useRef(false);
  /** Der Nachlauf nach dem Loslassen – siehe `NACHLAUF_MS`. */
  const nachlauf = useRef<number | undefined>(undefined);
  const wartend = useRef<FremdeAenderung[]>([]);
  /** Ob die Leitung zwischendurch weg war – dann fehlt mehr als das Gesammelte. */
  const luecke = useRef(false);
  /**
   * Der Rückruf als Ref, damit die Leitung nicht an ihm hängt.
   *
   * `onNachladen` entsteht in `App.tsx` bei jedem Rendern neu; stünde er in den
   * Abhängigkeiten des Effekts, ginge die Verbindung bei jedem Rendern zu und
   * neu auf — der Server zählte Fenster, die es längst nicht mehr gibt, und in
   * jeder Lücke ginge eine Meldung verloren.
   */
  const melden = useRef(onNachladen);
  melden.current = onNachladen;

  const abarbeiten = useCallback(() => {
    const gesammelt = wartend.current;
    const warLuecke = luecke.current;
    if (gesammelt.length === 0 && !warLuecke) return;
    wartend.current = [];
    luecke.current = false;
    const letzte = gesammelt[gesammelt.length - 1];
    // Die Lücke schlägt die Einzelmeldung: In ihr kann mehr geschehen sein als
    // das, was danach noch hereinkam, und das ehrlichere Wort dafür ist „weg
    // gewesen" und nicht der Name des letzten Griffs.
    const grund: Nachladegrund =
      warLuecke || !letzte
        ? { grund: 'luecke' }
        : { grund: 'aenderung', letzte, anzahl: gesammelt.length };
    // Erst alles Ausstehende zum Server, dann nachladen. Ein Fehlschlag dabei
    // darf das Nachladen nicht verhindern: Der fremde Stand ist trotzdem da.
    void ausstehendSenden()
      .catch(() => undefined)
      .then(() => melden.current(grund));
  }, []);

  useEffect(() => {
    if (!aktiv) return;

    const zu = ereignisseHoeren({
      onAenderung: (a) => {
        wartend.current.push(a);
        if (!zieht.current) abarbeiten();
      },
      onFenster: setFenster,
      onWiederVerbunden: () => {
        // In der Lücke kann etwas geschehen sein, das dieses Fenster nie erfahren
        // hat. Ein Nachladen ohne Meldung wäre stumm richtig – aber dann stünde
        // eine Seite plötzlich anders da, ohne dass jemand weiß, warum.
        luecke.current = true;
        if (!zieht.current) abarbeiten();
      },
    });

    // Am Fenster und in der Erfassungsphase: Ein `pointerdown` auf der Bühne
    // wird dort mit `stopPropagation` behandelt, und in der Blasenphase käme es
    // hier nie an — also gerade bei den Griffen nicht, für die das gedacht ist.
    const runter = () => {
      zieht.current = true;
      // Eine neue Geste hebt den Nachlauf der vorigen auf: Wer zweimal kurz
      // hintereinander zieht, soll nicht mitten im zweiten Zug nachladen.
      if (nachlauf.current !== undefined) window.clearTimeout(nachlauf.current);
      nachlauf.current = undefined;
    };
    const hoch = () => {
      zieht.current = false;
      if (nachlauf.current !== undefined) window.clearTimeout(nachlauf.current);
      nachlauf.current = window.setTimeout(() => {
        nachlauf.current = undefined;
        abarbeiten();
      }, NACHLAUF_MS);
    };
    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('pointercancel', hoch, true);

    return () => {
      zu();
      window.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', hoch, true);
      if (nachlauf.current !== undefined) window.clearTimeout(nachlauf.current);
      nachlauf.current = undefined;
      setFenster(0);
    };
  }, [aktiv, abarbeiten]);

  return { fenster };
}
