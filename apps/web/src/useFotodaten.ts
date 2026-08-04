/**
 * Zustand und Serverzugriff der Fotodaten-Ansicht.
 *
 * Der Kern dieser Ansicht ist eine **geordnete** Auswahl und kein Set: Beim
 * Verteilen über einen Zeitraum bekommt das erste Foto den frühesten Zeitpunkt,
 * also trägt die Reihenfolge eine Aussage. Vorgabe ist der Dateiname — bei
 * Kameradateien und Scans (`IMG_0341` vor `IMG_0342`) fast immer die richtige
 * Folge, und für Fotos ohne Datum die einzige, die es überhaupt gibt.
 *
 * Sobald von Hand umsortiert wurde, sortiert nichts mehr automatisch nach:
 * Ein weiteres Foto würde die Handordnung sonst still zerwerfen. Es kommt
 * hinten an, und `nachDateinamen()` stellt die Vorgabe wieder her.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Datumskorrektur,
  type FotoInfo,
  type Korrekturergebnis,
  type Ort,
  datumKorrigieren,
  fehlertext,
  fotosLaden,
  ortSetzen,
  ortsListeLaden,
} from './api.js';

/** Welche Fotos die Liste zeigt. */
export type Filter = 'zweifelhaft' | 'geschaetzt' | 'alle';

/** Natürliche Sortierung, damit `IMG_9` vor `IMG_10` steht. */
const NACH_NAMEN = new Intl.Collator('de', { numeric: true });

export interface FotodatenModell {
  fotos: FotoInfo[] | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  /** Die Auswahl in Verteilreihenfolge. */
  auswahl: string[];
  /** Die gewählten Fotos, in derselben Reihenfolge. */
  gewaehlt: FotoInfo[];
  umschalten: (id: string, bereichBis?: boolean) => void;
  alleWaehlen: () => void;
  auswahlLeeren: () => void;
  /** Verschiebt ein gewähltes Foto in der Verteilreihenfolge. */
  umordnen: (von: number, nach: number) => void;
  handOrdnung: boolean;
  nachDateinamen: () => void;
  anwenden: (korrektur: Datumskorrektur) => void;
  /** Die Orte des Bestands, häufigste zuerst – für die Vervollständigung. */
  orte: Ort[];
  /** Setzt den Ort der Auswahl; `null` gibt ihn an die Automatik zurück. */
  ortAnwenden: (ort: { label: string; key?: string } | null) => void;
  busy: boolean;
  note: string | null;
  fehler: string | null;
}

export function useFotodaten(opts: {
  /** Nach jeder Korrektur: Projektinfo und Buchvorschau neu holen. */
  onChanged: () => void;
  standVersion?: number | undefined;
}): FotodatenModell {
  const { onChanged, standVersion } = opts;

  const [alle, setAlle] = useState<FotoInfo[] | null>(null);
  const [orte, setOrte] = useState<Ort[]>([]);
  const [filter, setFilter] = useState<Filter>('zweifelhaft');
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [handOrdnung, setHandOrdnung] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  // Immer den ganzen Bestand holen und im Browser filtern: `?problems` liefert
  // nur die zweifelhaften, und ein Filterwechsel wäre sonst ein Rundgang zum
  // Server. Achthundert Zeilen sind für die Liste kein Gewicht.
  const laden = useCallback(() => {
    fotosLaden()
      .then((d) => setAlle(d.photos))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }, []);

  useEffect(laden, [laden, standVersion]);

  /**
   * Die Ortsliste kommt vom Server und wird nicht aus den geladenen Fotos
   * abgeleitet.
   *
   * Ableiten wäre eine Anfrage weniger und eine zweite Fassung derselben
   * Rechnung — dort entscheidet sich, welche Kennung ein gewählter Ort bekommt,
   * und davon hängt ab, ob das Foto mit den GPS-aufgelösten in *einen*
   * Gruppenvorschlag fällt. Diese Regel gehört an eine Stelle, und die hat einen
   * Test (`project/fotodaten.test.ts`).
   */
  const orteLaden = useCallback(() => {
    ortsListeLaden()
      .then((d) => setOrte(d.places))
      .catch(() => setOrte([]));
  }, []);

  useEffect(orteLaden, [orteLaden, standVersion]);

  const fotos = useMemo(() => {
    if (!alle) return null;
    switch (filter) {
      case 'zweifelhaft':
        // Dieselbe Schwelle wie `needsAttention` im Kern – nur eben hier, weil
        // die Liste zwischen den Filtern wechseln soll, ohne neu zu laden.
        return alle.filter((f) => f.dateConfidence === 'none' || f.dateConfidence === 'low');
      case 'geschaetzt':
        return alle.filter((f) => f.dateSource === 'interpolated');
      case 'alle':
        return alle;
    }
  }, [alle, filter]);

  const nachIndex = useMemo(() => {
    const map = new Map<string, FotoInfo>();
    for (const f of alle ?? []) map.set(f.id, f);
    return map;
  }, [alle]);

  const gewaehlt = useMemo(
    () => auswahl.map((id) => nachIndex.get(id)).filter((f): f is FotoInfo => f !== undefined),
    [auswahl, nachIndex],
  );

  /** Sortiert eine Auswahl nach Dateiname, solange nicht von Hand geordnet wurde. */
  const geordnet = useCallback(
    (ids: string[]): string[] => {
      if (handOrdnung) return ids;
      return [...ids].sort((a, b) =>
        NACH_NAMEN.compare(nachIndex.get(a)?.fileName ?? a, nachIndex.get(b)?.fileName ?? b),
      );
    },
    [handOrdnung, nachIndex],
  );

  const umschalten = useCallback(
    (id: string, bereichBis = false) => {
      setAuswahl((bestand) => {
        // Umschalt-Klick wählt von der letzten Wahl bis hierher – bei vierzig
        // Bildern eines Kamera-Resets der Unterschied zwischen einem Griff und
        // vierzig.
        if (bereichBis && bestand.length > 0 && fotos) {
          const letzte = bestand[bestand.length - 1]!;
          const von = fotos.findIndex((f) => f.id === letzte);
          const bis = fotos.findIndex((f) => f.id === id);
          if (von >= 0 && bis >= 0) {
            const [a, b] = von <= bis ? [von, bis] : [bis, von];
            const spanne = fotos.slice(a, b + 1).map((f) => f.id);
            return geordnet([...new Set([...bestand, ...spanne])]);
          }
        }
        return bestand.includes(id) ? bestand.filter((x) => x !== id) : geordnet([...bestand, id]);
      });
    },
    [fotos, geordnet],
  );

  const alleWaehlen = useCallback(() => {
    setAuswahl(geordnet((fotos ?? []).map((f) => f.id)));
  }, [fotos, geordnet]);

  const auswahlLeeren = useCallback(() => {
    setAuswahl([]);
    setHandOrdnung(false);
  }, []);

  const umordnen = useCallback((von: number, nach: number) => {
    setHandOrdnung(true);
    setAuswahl((bestand) => {
      if (von === nach || von < 0 || von >= bestand.length) return bestand;
      const kopie = [...bestand];
      const [griff] = kopie.splice(von, 1);
      if (!griff) return bestand;
      kopie.splice(Math.max(0, Math.min(kopie.length, nach)), 0, griff);
      return kopie;
    });
  }, []);

  const nachDateinamen = useCallback(() => {
    setHandOrdnung(false);
    setAuswahl((bestand) =>
      [...bestand].sort((a, b) =>
        NACH_NAMEN.compare(nachIndex.get(a)?.fileName ?? a, nachIndex.get(b)?.fileName ?? b),
      ),
    );
  }, [nachIndex]);

  /** Was eine Korrektur bewirkt hat, in einem Satz. */
  function meldung(e: Korrekturergebnis): string {
    const teile = [`${e.geaendert} ${e.geaendert === 1 ? 'Foto' : 'Fotos'} korrigiert`];
    if (e.uebersprungen.length > 0) {
      // Der Grund steht am ersten – bei einem Stapel ist er für alle derselbe.
      teile.push(`${e.uebersprungen.length} übersprungen (${e.uebersprungen[0]!.grund})`);
    }
    if (e.structurePending) teile.push('das Buch würde nach einem Neuaufbau anders aussehen');
    return `${teile.join(', ')}.`;
  }

  /**
   * Führt eine Korrektur aus und zieht die Ansicht nach.
   *
   * Nimmt den Aufruf als Funktion und nicht als Feldnamen: So behält das
   * Ergebnis seinen Typ, und Datum und Ort teilen den ganzen Umgang mit
   * Wartezustand, Meldung und Auswahl — die Unterschiede zwischen beiden sind
   * genau eine Zeile.
   */
  const ausfuehren = useCallback(
    (aufruf: (ids: string[]) => Promise<Korrekturergebnis>, ortBetroffen = false) => {
      if (auswahl.length === 0) return;
      setBusy(true);
      setFehler(null);
      setNote(null);
      aufruf(auswahl)
        .then((e) => {
          // Die zurückgegebenen Sichten einsetzen statt alles neu zu laden: Der
          // Filter und der Scrollstand bleiben damit stehen, und ein korrigiertes
          // Foto verlässt die Liste *zweifelhaft* von selbst.
          setAlle(
            (bestand) =>
              bestand?.map((f) => e.photos.find((neu) => neu.id === f.id) ?? f) ?? bestand,
          );
          // Die Auswahl ist abgearbeitet. Sie stehen zu lassen wäre gefährlicher
          // als bequem: Ein zweiter Klick auf ein anderes Werkzeug träfe dann
          // dieselben, schon korrigierten Bilder – und die sind aus der Liste
          // verschwunden, der Fehlgriff also unsichtbar.
          setAuswahl([]);
          setHandOrdnung(false);
          setNote(meldung(e));
          // Ein neuer Ortsname gehört ab jetzt in die Vervollständigung.
          if (ortBetroffen) orteLaden();
          onChanged();
        })
        .catch((err: unknown) => setFehler(fehlertext(err)))
        .finally(() => setBusy(false));
    },
    [auswahl, onChanged, orteLaden],
  );

  const anwenden = useCallback(
    (korrektur: Datumskorrektur) => ausfuehren((ids) => datumKorrigieren(ids, korrektur)),
    [ausfuehren],
  );

  const ortAnwenden = useCallback(
    (ort: { label: string; key?: string } | null) => ausfuehren((ids) => ortSetzen(ids, ort), true),
    [ausfuehren],
  );

  return {
    fotos,
    filter,
    setFilter,
    auswahl,
    gewaehlt,
    umschalten,
    alleWaehlen,
    auswahlLeeren,
    umordnen,
    handOrdnung,
    nachDateinamen,
    anwenden,
    orte,
    ortAnwenden,
    busy,
    note,
    fehler,
  };
}
