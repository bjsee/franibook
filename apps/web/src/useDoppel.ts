/**
 * Zustand und Serverzugriff der Doppel-Ansicht.
 *
 * Zwei Ladevorgänge, weil zwei Fragen zu beantworten sind: Welche Aufnahmen
 * gehören zusammen (`/api/photos/doppel`) und wie heißen sie (`/api/photos`).
 * Der Vorschlag trägt nur Kennungen — Dateiname, Datum und Schärfe stehen in
 * der Fotoliste, die die Oberfläche ohnehin für jede andere Ansicht braucht.
 *
 * **Nach dem Aussortieren wird nicht neu geladen.** Ein Doppel, an dem man
 * gerade gearbeitet hat, verschwände sonst unter dem Zeiger, und die Liste
 * spränge. Es bleibt stehen und trägt einen Vermerk; wer den frischen Stand
 * will, lädt neu — der Knopf steht im Kopf.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  type DoppelBericht,
  type DoppelVorschlag,
  type FotoInfo,
  doppelBehalten,
  doppelBehaltenZurueck,
  doppelLaden,
  fehlertext,
  fotosLaden,
} from './api.js';
import { fotosLoeschen } from './deletePhoto.js';

/** Ein Doppel mit den Fotos, die es meint — und was daran schon getan ist. */
export interface DoppelZeile extends DoppelVorschlag {
  fotos: FotoInfo[];
  /** Kennungen, die in diesem Lauf aussortiert wurden. */
  entfernt: string[];
}

export function useDoppel({
  onChanged,
  standVersion,
}: {
  /** Aussortieren ändert das Projekt — Kennzahlen und Verlauf ziehen nach. */
  onChanged?: () => void;
  standVersion?: number;
}) {
  const [bericht, setBericht] = useState<DoppelBericht | null>(null);
  const [zeilen, setZeilen] = useState<DoppelZeile[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLaedt(true);
    setFehler(null);
    try {
      // Nebenläufig: Die beiden Anfragen wissen nichts voneinander, und die
      // Doppelrechnung ist die langsamere von beiden (rund eine Sekunde).
      const [d, f] = await Promise.all([doppelLaden(), fotosLaden()]);
      const nachId = new Map(f.photos.map((p) => [p.id, p]));
      setBericht(d);
      setZeilen(
        d.doppel.map((v) => ({
          ...v,
          fotos: v.photoIds
            .map((id) => nachId.get(id))
            .filter((p): p is FotoInfo => p !== undefined),
          entfernt: [],
        })),
      );
    } catch (e: unknown) {
      setFehler(fehlertext(e));
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden, standVersion]);

  /**
   * Behält ein Foto und sortiert die übrigen des Doppels aus.
   *
   * Die schon entfernten bleiben außen vor: Wer zweimal klickt, soll nicht
   * zweimal dasselbe löschen wollen.
   */
  const behalten = useCallback(
    async (index: number, photoId: string) => {
      const zeile = zeilen[index];
      if (!zeile) return;
      const weg = zeile.fotos.filter((f) => f.id !== photoId && !zeile.entfernt.includes(f.id));
      if (weg.length === 0) return;

      const name = zeile.fotos.find((f) => f.id === photoId)?.fileName ?? photoId;
      setLaeuft(photoId);
      setFehler(null);
      setMeldung(null);
      const ergebnis = await fotosLoeschen(
        weg.map((f) => f.id),
        { behalten: name },
      );
      setLaeuft(null);
      if (!ergebnis) return;
      if (!ergebnis.ok) {
        setFehler(ergebnis.fehler);
        // Auch ein abgebrochener Stapel hat womöglich Fotos entfernt — der
        // Verlauf und die Kennzahlen müssen das erfahren.
        onChanged?.();
        return;
      }

      const raus = new Set(ergebnis.entfernt.map((e) => e.id));
      setZeilen((alt) =>
        alt.map((z, i) => (i === index ? { ...z, entfernt: [...z.entfernt, ...raus] } : z)),
      );
      const imBuch = ergebnis.entfernt.reduce((n, e) => n + e.ergebnis.imBuch, 0);
      setMeldung(
        `„${name}" behalten · ${String(raus.size)} aussortiert` +
          (imBuch > 0
            ? ` · ${imBuch === 1 ? 'ein Platz im Buch bleibt' : `${String(imBuch)} Plätze im Buch bleiben`} leer`
            : ''),
      );
      onChanged?.();
    },
    [zeilen, onChanged],
  );

  /**
   * „Beide behalten" — merkt das Doppel als erledigt, ohne etwas zu löschen.
   *
   * Ohne Bestätigungsdialog: Es löscht nichts, und ein Cmd+Z nimmt es zurück.
   * Nachgefragt wird, wo etwas verschwindet.
   */
  const alleBehalten = useCallback(
    async (index: number) => {
      const zeile = zeilen[index];
      if (!zeile || zeile.behaltenSeit) return;

      setLaeuft(zeile.schluessel);
      setFehler(null);
      setMeldung(null);
      try {
        await doppelBehalten(zeile.schluessel);
        setZeilen((alt) =>
          alt.map((z, i) => (i === index ? { ...z, behaltenSeit: new Date().toISOString() } : z)),
        );
        setMeldung(`${String(zeile.fotos.length)} Bilder behalten · Doppel erledigt`);
        onChanged?.();
      } catch (e: unknown) {
        setFehler(fehlertext(e));
      } finally {
        setLaeuft(null);
      }
    },
    [zeilen, onChanged],
  );

  /** Nimmt ein „beide behalten" zurück — einzeln oder alle auf einmal. */
  const wiederOeffnen = useCallback(
    async (schluessel?: string) => {
      setLaeuft(schluessel ?? 'alle');
      setFehler(null);
      setMeldung(null);
      try {
        const { anzahl } = await doppelBehaltenZurueck(schluessel);
        setZeilen((alt) =>
          alt.map((z) => {
            if (schluessel !== undefined && z.schluessel !== schluessel) return z;
            const { behaltenSeit: _weg, ...rest } = z;
            return rest;
          }),
        );
        setMeldung(anzahl === 1 ? 'Doppel wieder offen' : `${String(anzahl)} Doppel wieder offen`);
        onChanged?.();
      } catch (e: unknown) {
        setFehler(fehlertext(e));
      } finally {
        setLaeuft(null);
      }
    },
    [onChanged],
  );

  return {
    bericht,
    zeilen,
    laedt,
    laeuft,
    fehler,
    meldung,
    laden,
    behalten,
    alleBehalten,
    wiederOeffnen,
  };
}
