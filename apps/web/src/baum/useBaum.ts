/**
 * Zustand und Serverzugriff des Baums.
 *
 * Drei Quellen, ein Zustand: die Gliederung (`/api/book/tree`), die Bilddaten
 * (`/api/photos`) und der Fotopool (`/api/book/unplaced`). Sie werden zusammen
 * geladen und zusammen erneuert, denn jeder Zug verändert alle drei — ein Bild
 * wechselt die Seite, verlässt den Pool oder kommt aus ihm zurück.
 *
 * Nach einem Zug wird **neu geladen statt fortgeschrieben.** Die Alternative
 * hieße, die Anordnung des Servers in der Oberfläche nachzurechnen: Welche
 * Bilder nach dem Umhängen in welcher Reihenfolge auf der Seite stehen,
 * entscheidet `layoutSpread`, und eine zweite Meinung darüber wäre genau die
 * Sorte Fehler, die man erst drei Züge später sieht. Die Antwort des Servers
 * nennt die berührten Seiten, geladen wird trotzdem der ganze Baum: Er ist eine
 * Liste aus Zahlen und Kennungen, keine Bilder.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoMove } from '@franibook/core';
import {
  type BaumSeite,
  type FotoInfo,
  type PoolFoto,
  baumLaden,
  bildEinwerfen,
  fehlertext,
  fotopoolLaden,
  fotosLaden,
  fotosVerschieben,
  gruppeErstellen,
} from '../api.js';
import { auswahlKlick, zugMenge, type Klicklage } from '../auswahl.js';

/** Woher ein gezogenes Bild kommt – der Pool ist keine Doppelseite. */
export type Herkunft = { kind: 'spread'; spreadIndex: number } | { kind: 'pool' };

export interface BaumModell {
  seiten: BaumSeite[];
  pool: PoolFoto[];
  /** Bilddaten je Kennung, für Beschriftung und Datum. */
  infos: Map<string, FotoInfo>;
  geladen: boolean;
  busy: boolean;
  note: string | null;
  setNote: (satz: string | null) => void;

  selected: Set<string>;
  /** Klick auf ein Bild: schlicht, mit Umschalt oder mit Cmd. */
  waehlen: (photoId: string, e: Klicklage) => void;
  auswahlLoeschen: () => void;

  /** Bilder, die gerade gezogen werden. Leer heißt: kein Zug unterwegs. */
  zug: string[];
  zugBeginnen: (photoId: string, von: Herkunft) => void;
  zugBeenden: () => void;

  /** Legt die gezogenen Bilder auf eine Doppelseite oder in den Pool. */
  fallenlassen: (ziel: Herkunft) => Promise<void>;
  /** Nimmt die ausgewählten Bilder aus dem Buch. */
  auswahlInDenPool: () => Promise<void>;

  /**
   * Fasst die ausgewählten Bilder zu einer neuen Gruppe zusammen.
   *
   * Bilder aus dem Fotopool dürfen dabei sein: Eine Gruppe sagt, was
   * zusammengehört, und nicht, was im Buch steht — die Verteilung folgt beim
   * Neuanordnen und holt sie dann mit.
   */
  gruppeAusAuswahl: (titel: string) => Promise<void>;

  /**
   * Wirft eine Datei aus dem Dateisystem ins Buch.
   *
   * **Auf eine Zeile geworfen wird die Seite neu angeordnet** – anders als in der
   * Doppelseitenansicht, wo das Bild an der Fallstelle liegen bleibt. Der
   * Unterschied ist keine Inkonsequenz, sondern die Arbeitshöhe: Eine Zeile im
   * Baum hat keine Stelle im Millimeterraster, auf die man zielen könnte, und wer
   * hier arbeitet, verteilt Bilder auf Seiten. Es ist damit derselbe Zug wie
   * jeder andere in dieser Ansicht, nur mit einer Datei als Quelle.
   */
  dateiEinwerfen: (datei: File, ziel: Herkunft) => Promise<void>;
}

/** Ob das Nachladen nach einer Änderung geklappt hat. */
type Ladestand = { ok: true } | { ok: false; fehler: string };

/**
 * Der Satz zu einer geglückten Handlung – mit Zusatz, wenn das Nachladen
 * danach scheiterte.
 *
 * Die Handlung ist dann durch, der angezeigte Stand aber veraltet: Beides muss
 * dastehen, sonst hält man das eine für das andere. Als eine Funktion, weil
 * inzwischen drei Griffe denselben Nachsatz brauchen und drei Fassungen davon
 * dreimal die Gelegenheit wären, ihn auseinanderlaufen zu lassen.
 */
function mitStand(satz: string, stand: Ladestand): string {
  return stand.ok
    ? satz
    : `${satz} Aber: Der Baum ließ sich danach nicht neu laden (${stand.fehler}) — der angezeigte Stand ist veraltet.`;
}

/**
 * @param standVersion Zählt hoch, wenn ein Zurücknehmen den Stand getauscht hat.
 */
export function useBaum(standVersion: number, onChanged: () => void): BaumModell {
  const [seiten, setSeiten] = useState<BaumSeite[]>([]);
  const [pool, setPool] = useState<PoolFoto[]>([]);
  const [fotos, setFotos] = useState<FotoInfo[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zug, setZug] = useState<string[]>([]);
  const anker = useRef<string | null>(null);
  /** Woher der laufende Zug kommt – ohne das wäre jedes Ziel dasselbe. */
  const herkunft = useRef<Herkunft | null>(null);

  /**
   * Lädt Gliederung, Bilddaten und Fotopool neu und meldet, ob es geklappt hat.
   *
   * Das Ergebnis geht an den Aufrufer zurück, statt hier selbst eine Meldung zu
   * setzen: `schicken` unten braucht es, um seine eigene Erfolgsmeldung nicht
   * blind über einen Ladefehler zu schreiben – „Zug erfolgreich" und „Nachladen
   * fehlgeschlagen" sind zwei verschiedene Sätze, und nur einer passt.
   */
  const laden = useCallback(async (): Promise<Ladestand> => {
    try {
      const [baum, alle, frei] = await Promise.all([baumLaden(), fotosLaden(), fotopoolLaden()]);
      setSeiten(baum.spreads);
      setFotos(alle.photos);
      setPool(frei.photos);
      setGeladen(true);
      return { ok: true };
    } catch (e: unknown) {
      // Auch ein Fehlschlag gilt als „geladen": Sonst bliebe „Lade Baum …"
      // stehen, während daneben schon die Fehlermeldung steht.
      setGeladen(true);
      return { ok: false, fehler: fehlertext(e) };
    }
  }, []);

  useEffect(() => {
    void laden().then((stand) => {
      if (!stand.ok) setNote(`Der Baum ließ sich nicht laden: ${stand.fehler}`);
    });
  }, [laden, standVersion]);

  const infos = useMemo(() => new Map(fotos.map((f) => [f.id, f])), [fotos]);

  /** Die Bilder in der Reihenfolge, in der sie dastehen – der Anker für Umschalt. */
  const reihenfolge = useMemo(
    () => [...seiten.flatMap((s) => s.bilder.map((b) => b.photoId)), ...pool.map((p) => p.id)],
    [seiten, pool],
  );

  const waehlen = useCallback(
    (photoId: string, e: Klicklage) => {
      const naechste = auswahlKlick(selected, photoId, e, reihenfolge, anker.current);
      anker.current = naechste.anker;
      setSelected(naechste.selected);
    },
    [selected, reihenfolge],
  );

  const auswahlLoeschen = useCallback(() => {
    anker.current = null;
    setSelected(new Set());
  }, []);

  const zugBeginnen = useCallback(
    (photoId: string, von: Herkunft) => {
      herkunft.current = von;
      setZug(zugMenge(selected, photoId));
    },
    [selected],
  );

  const zugBeenden = useCallback(() => {
    herkunft.current = null;
    setZug([]);
  }, []);

  /**
   * Schickt einen Stapel und lädt danach neu.
   *
   * Ein Aufruf für beliebig viele Bilder: Der Server ordnet jede berührte Seite
   * einmal an, und im Verlauf steht eine Handlung.
   */
  const schicken = useCallback(
    async (moves: PhotoMove[], erfolg: (n: number) => string) => {
      if (moves.length === 0) return;
      setBusy(true);
      try {
        const ergebnis = await fotosVerschieben(moves);
        const stand = await laden();
        onChanged();
        const leer = ergebnis.leer.map((i) => i + 1);
        const zugText =
          leer.length === 0
            ? erfolg(moves.length)
            : `${erfolg(moves.length)} — Doppelseite ${leer.join(', ')} steht jetzt leer.`;
        // Der Zug selbst ist durch, auch wenn das Nachladen scheitert – eine
        // Erfolgsmeldung darf das dann nicht verdecken, sonst hält man den
        // angezeigten (veralteten) Stand für den aktuellen.
        setNote(mitStand(zugText, stand));
      } catch (e: unknown) {
        setNote(fehlertext(e));
      } finally {
        setBusy(false);
      }
    },
    [laden, onChanged],
  );

  /** Wo ein Bild gerade liegt – aus dem Baum, nicht aus dem Zug. */
  const platzVon = useMemo(() => {
    const map = new Map<string, PhotoMove['source']>();
    for (const seite of seiten) {
      for (const b of seite.bilder) {
        map.set(b.photoId, { kind: 'slot', spreadIndex: seite.index, slotId: b.slotId });
      }
    }
    return map;
  }, [seiten]);

  const quelleVon = useCallback(
    (photoId: string): PhotoMove['source'] => platzVon.get(photoId) ?? { kind: 'pool', photoId },
    [platzVon],
  );

  const fallenlassen = useCallback(
    async (ziel: Herkunft) => {
      const bilder = zug;
      const von = herkunft.current;
      zugBeenden();
      if (bilder.length === 0) return;
      if (von && von.kind === ziel.kind && von.kind === 'pool') return;

      const moves: PhotoMove[] = bilder.map((photoId) => ({
        source: quelleVon(photoId),
        target: ziel,
      }));

      await schicken(moves, (n) =>
        ziel.kind === 'pool'
          ? `${n === 1 ? 'Ein Bild' : `${n} Bilder`} aus dem Buch genommen.`
          : `${n === 1 ? 'Ein Bild' : `${n} Bilder`} auf Doppelseite ${ziel.spreadIndex + 1}.`,
      );
    },
    [zug, zugBeenden, quelleVon, schicken],
  );

  const dateiEinwerfen = useCallback(
    async (datei: File, ziel: Herkunft) => {
      setBusy(true);
      try {
        const ergebnis = await bildEinwerfen(
          datei,
          ziel.kind === 'pool' ? { kind: 'pool' } : { kind: 'spread', index: ziel.spreadIndex },
        );
        const stand = await laden();
        onChanged();
        const wohin =
          ziel.kind === 'pool'
            ? 'liegt außerhalb des Buches'
            : `liegt auf Doppelseite ${ziel.spreadIndex + 1}`;
        const satz = ergebnis.dupliziert
          ? `„${datei.name}" lag inhaltlich schon im Bestand und ${wohin} – es wurde keine Datei angelegt.`
          : `„${datei.name}" ${wohin}.`;
        setNote(mitStand(satz, stand));
      } catch (e: unknown) {
        setNote(`„${datei.name}" ließ sich nicht einwerfen: ${fehlertext(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [laden, onChanged],
  );

  const auswahlInDenPool = useCallback(async () => {
    // Nur was im Buch liegt: Ein Bild aus dem Pool in den Pool zu ziehen wäre
    // kein Zug, und der Server lehnte den ganzen Stapel dafür ab.
    const moves = [...selected]
      .map((photoId) => quelleVon(photoId))
      .filter((source) => source.kind === 'slot')
      .map((source): PhotoMove => ({ source, target: { kind: 'pool' } }));

    await schicken(moves, (n) => `${n === 1 ? 'Ein Bild' : `${n} Bilder`} aus dem Buch genommen.`);
  }, [selected, quelleVon, schicken]);

  /**
   * Legt aus der Auswahl eine Gruppe an.
   *
   * Nicht über `schicken`: Das ist der Weg für Züge und rechnet mit
   * `PhotoMove`s, leergezogenen Seiten und berührten Doppelseiten. Hier bewegt
   * sich kein Bild – die Aufteilung bleibt Zeile für Zeile dieselbe, es kommt
   * eine Marke dazu. Neu geladen wird trotzdem, denn `groupTitle` steht am
   * Baum und nicht in dieser Antwort.
   */
  const gruppeAusAuswahl = useCallback(
    async (titel: string) => {
      // In Buchreihenfolge und nicht in Klickreihenfolge: Ohne gesetztes
      // Hauptbild wird das **erste** Foto einer Gruppe ihr Auftaktbild
      // (`layout/generate.ts`). Welches das ist, darf nicht davon abhängen, ob
      // man von hinten nach vorn geklickt oder einen Bereich aufgezogen hat –
      // `selected` ist ein Set in Klickreihenfolge. Nebenbei fallen dabei
      // Kennungen heraus, die es nicht mehr gibt.
      const bilder = reihenfolge.filter((id) => selected.has(id));
      if (bilder.length === 0) return;
      setBusy(true);
      try {
        await gruppeErstellen(titel, bilder);
        const stand = await laden();
        onChanged();
        // Die Auswahl ist mit dem Anlegen erledigt; stehenbliebe sie, wäre der
        // nächste Griff versehentlich auf denselben Bildern.
        auswahlLoeschen();
        // Was die Gruppe sofort tut (Zeitstrahl beschriften) und was erst beim
        // Neuanordnen folgt (Verteilung, Auftaktseite), sagt der Hinweis in den
        // Kennzahlen – hier steht nur, was geschehen ist.
        setNote(
          mitStand(
            `Gruppe „${titel}" aus ${bilder.length === 1 ? 'einem Bild' : `${bilder.length} Bildern`} angelegt.`,
            stand,
          ),
        );
      } catch (e: unknown) {
        setNote(`Die Gruppe „${titel}" ließ sich nicht anlegen: ${fehlertext(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [selected, reihenfolge, auswahlLoeschen, laden, onChanged],
  );

  return {
    seiten,
    pool,
    infos,
    geladen,
    busy,
    note,
    setNote,
    selected,
    waehlen,
    auswahlLoeschen,
    zug,
    zugBeginnen,
    zugBeenden,
    fallenlassen,
    auswahlInDenPool,
    gruppeAusAuswahl,
    dateiEinwerfen,
  };
}
