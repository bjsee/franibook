/**
 * Zustand und Serverzugriff der Anordnungsvorschau.
 *
 * Zwei Dinge, die nichts miteinander zu tun haben, außer dass dieselbe Ansicht
 * sie braucht: die **Probe** (rechnen, übernehmen, verwerfen) und die
 * **Miniaturen** dazu, von denen es doppelt so viele gibt wie Doppelseiten –
 * jede Zeile zeigt ein Vorher und ein Nachher.
 *
 * Geladen wird deshalb nach, was in Sichtweite kommt, wie in der Übersicht
 * (`spread/useSpreadTiles.ts`). Ein eigener Haken und nicht jener: Dort ist der
 * Gegenstand eine Doppelseite des Buches, hier eine Zeile mit zwei
 * Doppelseiten aus zwei verschiedenen Quellen – der bestehende Haken müsste
 * dafür seinen Gegenstand wechseln, und das ist eine Verallgemeinerung ohne
 * dritten Fall.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Probe,
  type Probeseite,
  type SpreadResponse,
  doppelseiteLaden,
  fehlertext,
  probeDoppelseiteLaden,
  probeLaden,
  probeRechnen,
  probeUebernehmen,
  probeVerwerfen,
} from './api.js';

export type { Probe, Probeseite };

export interface Probenstand {
  probe: Probe | null;
  /** Was gerade läuft, als deutscher Satz – oder `null`. */
  busy: string | null;
  fehler: string | null;
  /** Wie oft schon gewürfelt wurde: 0 heißt „ohne zusätzlichen Wurf". */
  wurf: number;
  /** Rechnet neu. `wurf > 0` heißt: zusätzlich ein anderer Seed. */
  rechnen: (wurf: number) => void;
  /**
   * Lässt eine Doppelseite, wie sie ist – oder gibt sie wieder frei.
   *
   * Rechnet danach neu, und zwar das ganze Buch: Eine behaltene Seite nimmt
   * ihre Bilder aus dem Fluss und zwei Seiten aus dem Budget, also fällt alles
   * andere anders. Etwas anderes zu zeigen als das, was übernommen würde, wäre
   * genau der Fehler, gegen den diese Ansicht gebaut ist. Bei 33 ms für das
   * ganze Buch ist das kein Preis.
   */
  behalte: (altIndex: number, behalten: boolean) => void;
  uebernehmen: () => Promise<boolean>;
  verwerfen: () => Promise<void>;
}

/**
 * Die Probe: beim Öffnen rechnen, was gefragt ist – oder die liegende zeigen.
 *
 * Die liegende wird nur ohne eigenen Wunsch übernommen: Wer die Ansicht
 * verlässt und zurückkommt, soll dieselbe Vorschau sehen. Wer dagegen aus dem
 * Buchpanel kommt, bringt eine Frage mit („180 Seiten statt 160"), und die
 * beantwortet keine Probe, die schon dalag.
 *
 * @param seed der Seed des Projekts. Ein Wurf zählt von ihm aus hoch, damit
 * zweimal „andere Anordnung" auch zwei verschiedene ergibt.
 * @param patch die Einstellungen, mit denen gerechnet werden soll. Sie kommen
 * ins Projekt erst mit dem Übernehmen.
 */
export function useProbe(seed: number, patch: Record<string, unknown>): Probenstand {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState<string | null>('Rechne das Buch …');
  const [fehler, setFehler] = useState<string | null>(null);
  const [wurf, setWurf] = useState(0);
  /** Was zuletzt angefordert wurde – eine späte Antwort darf keine neue überschreiben. */
  const laufend = useRef(0);
  /**
   * Die Seiten, die bleiben sollen – als Referenz und nicht als Zustand.
   *
   * Sie steuert keine Darstellung: Was gezeigt wird, steht in der Probe, die
   * der Server zurückgibt (`Probeseite.behalten`). Zwei Wahrheiten darüber,
   * welche Seiten bleiben, wären genau die Sorte Abweichung, die man erst
   * bemerkt, wenn das Übernehmen etwas anderes einsetzt als die Liste zeigte.
   */
  const bleiben = useRef<number[]>([]);

  const rechnen = useCallback(
    (neuerWurf: number, satz = 'Rechne das Buch …') => {
      const meins = ++laufend.current;
      setWurf(neuerWurf);
      setBusy(neuerWurf > 0 ? 'Würfle eine andere Anordnung …' : satz);
      setFehler(null);
      void probeRechnen(
        { ...patch, ...(neuerWurf > 0 ? { seed: seed + neuerWurf } : {}) },
        bleiben.current,
      )
        .then(({ probe: neu }) => {
          if (laufend.current !== meins) return;
          setProbe(neu);
        })
        .catch((e: unknown) => {
          if (laufend.current !== meins) return;
          setFehler(fehlertext(e));
        })
        .finally(() => {
          if (laufend.current === meins) setBusy(null);
        });
    },
    // Der Inhalt des Patches und nicht das Objekt: Als Literal wäre es bei
    // jedem Rendern ein neues, und `rechnen` damit auch.
    [seed, JSON.stringify(patch)],
  );

  useEffect(() => {
    // Mit einer Frage im Gepäck wird gerechnet, ohne erst zu fragen, was dalag.
    if (Object.keys(patch).length > 0) {
      rechnen(0);
      return;
    }
    let abgebrochen = false;
    void probeLaden()
      .then((antwort) => {
        if (abgebrochen) return;
        // Eine veraltete Probe zeigt ein Buch, das das Übernehmen gar nicht
        // einsetzen dürfte – also gleich neu rechnen statt sie anzubieten.
        if (antwort.auskunft && !antwort.veraltet) {
          // Auch die Seiten, die schon „so lassen" tragen: Sonst wäre der
          // nächste Klick eine Rechnung ohne sie.
          bleiben.current = antwort.auskunft.behalten;
          setProbe(antwort.auskunft);
          setBusy(null);
          return;
        }
        rechnen(0);
      })
      .catch(() => {
        if (!abgebrochen) rechnen(0);
      });
    return () => {
      abgebrochen = true;
    };
    // Bewusst ohne Abhängigkeiten: Dieser Effekt ist das Öffnen der Ansicht.
    // Jede weitere Rechnung geht über `rechnen`, und `rechnen` in die Liste zu
    // nehmen hieße, dass ein übernommener Seed sofort eine neue Probe rechnet –
    // für ein Buch, das dann schon steht.
  }, []);

  const behalte = useCallback(
    (altIndex: number, behalten: boolean) => {
      const ohne = bleiben.current.filter((i) => i !== altIndex);
      bleiben.current = behalten ? [...ohne, altIndex].sort((a, b) => a - b) : ohne;
      rechnen(wurf, behalten ? 'Rechne das Buch um diese Seite herum …' : 'Rechne das Buch …');
    },
    [rechnen, wurf],
  );

  const uebernehmen = useCallback(async () => {
    if (!probe) return false;
    setBusy('Setze die Anordnung ein …');
    setFehler(null);
    try {
      await probeUebernehmen(probe.id);
      return true;
    } catch (e) {
      setFehler(fehlertext(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, [probe]);

  const verwerfen = useCallback(async () => {
    bleiben.current = [];
    setProbe(null);
    try {
      await probeVerwerfen();
    } catch {
      // Eine Probe, die der Server ohnehin nicht mehr hat, ist kein Fehlschlag,
      // den jemand lesen müsste – sie ist genau das gewünschte Ergebnis.
    }
  }, []);

  return { probe, busy, fehler, wurf, rechnen, behalte, uebernehmen, verwerfen };
}

/** Schlüssel einer Miniatur: `a3` ist Doppelseite 4 von vorher, `n3` die von nachher. */
export type Kachelschluessel = `a${number}` | `n${number}`;

/**
 * Die Miniaturen, nachgeladen, sobald ihre Zeile in Sichtweite kommt.
 *
 * Der Beobachter hängt an `[data-zeile]`, und die Zeile sagt in `data-kacheln`
 * selbst, welche Miniaturen sie braucht – damit muss dieser Haken nichts über
 * die Anordnung der Liste wissen.
 */
export function useProbekacheln(version: string): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  kacheln: Map<string, SpreadResponse>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [kacheln, setKacheln] = useState<Map<string, SpreadResponse>>(new Map());
  const [sichtbar, setSichtbar] = useState<Set<string>>(new Set());

  // Eine neu gerechnete Probe macht jede geladene Miniatur ungültig: Dieselbe
  // Nummer zeigt danach andere Bilder.
  useEffect(() => {
    setKacheln(new Map());
    setSichtbar(new Set());
  }, [version]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setSichtbar((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const liste = (entry.target as HTMLElement).dataset['kacheln'] ?? '';
            for (const schluessel of liste.split(',')) if (schluessel) next.add(schluessel);
          }
          return next;
        });
      },
      { root: null, rootMargin: '400px' },
    );

    for (const zeile of el.querySelectorAll('[data-zeile]')) observer.observe(zeile);
    return () => observer.disconnect();
  }, [version]);

  useEffect(() => {
    const fehlend = [...sichtbar].filter((s) => !kacheln.has(s));
    if (fehlend.length === 0) return;

    let abgebrochen = false;
    void Promise.all(
      fehlend.map((s) => {
        const index = Number(s.slice(1));
        const laden = s.startsWith('a') ? doppelseiteLaden : probeDoppelseiteLaden;
        return laden(index)
          .then((data) => [s, data] as const)
          .catch(() => [s, null] as const);
      }),
    ).then((paare) => {
      if (abgebrochen) return;
      setKacheln((prev) => {
        const next = new Map(prev);
        for (const [s, data] of paare) if (data) next.set(s, data);
        return next;
      });
    });

    return () => {
      abgebrochen = true;
    };
  }, [sichtbar, kacheln]);

  return { containerRef, kacheln };
}
