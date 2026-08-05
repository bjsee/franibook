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
  fehlertext,
  fotopoolLaden,
  fotosLaden,
  fotosVerschieben,
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

  const laden = useCallback(() => {
    return Promise.all([baumLaden(), fotosLaden(), fotopoolLaden()])
      .then(([baum, alle, frei]) => {
        setSeiten(baum.spreads);
        setFotos(alle.photos);
        setPool(frei.photos);
        setGeladen(true);
      })
      .catch((e: unknown) => setNote(`Der Baum ließ sich nicht laden: ${fehlertext(e)}`));
  }, []);

  useEffect(() => {
    void laden();
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
        await laden();
        onChanged();
        const leer = ergebnis.leer.map((i) => i + 1);
        setNote(
          leer.length === 0
            ? erfolg(moves.length)
            : `${erfolg(moves.length)} — Doppelseite ${leer.join(', ')} steht jetzt leer.`,
        );
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

  const auswahlInDenPool = useCallback(async () => {
    // Nur was im Buch liegt: Ein Bild aus dem Pool in den Pool zu ziehen wäre
    // kein Zug, und der Server lehnte den ganzen Stapel dafür ab.
    const moves = [...selected]
      .map((photoId) => quelleVon(photoId))
      .filter((source) => source.kind === 'slot')
      .map((source): PhotoMove => ({ source, target: { kind: 'pool' } }));

    await schicken(moves, (n) => `${n === 1 ? 'Ein Bild' : `${n} Bilder`} aus dem Buch genommen.`);
  }, [selected, quelleVon, schicken]);

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
  };
}
