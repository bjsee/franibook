/**
 * Dichter setzen: Bilder größer, zwei Doppelseiten zu einer.
 *
 * Der Anlass ist der leere Rand, und die beiden Griffe sind zwei Antworten
 * darauf — dieselben Bilder größer, oder mehr Bilder auf eine Seite. Sie stehen
 * zusammen, weil man sie an derselben Stelle sucht: wenn eine Seite zu luftig
 * aussieht.
 *
 * **Die Knöpfe tragen ihre Wirkung im Text**, nicht nur ihren Namen: „+7 %"
 * statt „größer", „14 Bilder" statt „packen". Der Grund ist gemessen — am echten
 * Buch bringt das proportionale Vergrößern im Mittel sieben Prozent, das
 * Einpassen ein Vielfaches davon, und ohne die Zahl daneben drückt man den
 * falschen. Was nicht geht, ist abgeblendet und nennt im `title` den Grund; die
 * Sätze kommen unverändert vom Server, damit Knopf und Absage nicht
 * auseinanderlaufen.
 */
import { useCallback, useEffect, useState } from 'react';
import { imageBoxes } from '@franibook/core';
import type { RenderedSpread } from '@franibook/core';
import {
  type Packbarkeit,
  type Vergroesserungsauskunft,
  bilderVergroessern,
  buchseitenPacken,
  fehlertext,
  packbarLaden,
  seitenPacken,
  vergroesserungLaden,
} from '../api.js';
import { T } from '../theme.js';
import { lohntEinpassen, lohntProportional } from './verdichtung.js';

interface Props {
  index: number;
  /** Zählt hoch, wenn sich am Buch etwas geändert hat – dann neu fragen. */
  version: number;
  spreadCount: number;
  onSpread: (spread: RenderedSpread) => void;
  /** Nach dem Packen: Das Buch ist kürzer, die Nachbarschaft eine andere. */
  onGepackt: () => void;
  onNote: (satz: string | null) => void;
}

type Auskunft = { left: Vergroesserungsauskunft | string; right: Vergroesserungsauskunft | string };

/**
 * Was das Vergrößern die Auflösung gekostet hat.
 *
 * Ein Bild in einem größeren Kasten hat weniger Pixel je Millimeter – das ist
 * die eine Nebenwirkung dieses Griffs, und sie steht sonst nur als kleine Marke
 * im Bild und im Abnahmebericht. Gezählt wird auf dem RSM, das die Antwort schon
 * mitbringt: dieselben Warnungen, die die Bühne zeichnet.
 */
function aufloesung(spread: RenderedSpread): string {
  const bilder = imageBoxes(spread);
  const unterMin = bilder.filter((b) => b.warnings.some((w) => w.code === 'below-min-dpi')).length;
  const unterZiel = bilder.filter((b) =>
    b.warnings.some((w) => w.code === 'below-target-dpi'),
  ).length;
  if (unterMin > 0) {
    return ` · ${unterMin} ${unterMin === 1 ? 'Bild' : 'Bilder'} unter der Mindestauflösung`;
  }
  if (unterZiel > 0) {
    return ` · ${unterZiel} ${unterZiel === 1 ? 'Bild' : 'Bilder'} unter der Zielauflösung`;
  }
  return '';
}

/** „1 Bild", „5 Bilder" – die Zahl mit dem Wort, das zu ihr passt. */
function bilderWort(anzahl: number | undefined): string {
  return anzahl === 1 ? '1 Bild' : `${anzahl ?? '?'} Bilder`;
}

/** „+7 %" – ein Faktor als Zuwachs, wie man ihn liest. */
function prozent(faktor: number): string {
  return `+${Math.round((faktor - 1) * 100)} %`;
}

export function Verdichten({ index, version, spreadCount, onSpread, onGepackt, onNote }: Props) {
  const [auskunft, setAuskunft] = useState<Auskunft | null>(null);
  const [packen, setPacken] = useState<{ seiten: Packbarkeit; buchseiten: Packbarkeit } | null>(
    null,
  );
  const [laeuft, setLaeuft] = useState(false);

  const fragen = useCallback(async () => {
    // Beide Auskünfte in einem Anlauf: Sie beschreiben denselben Zustand, und
    // getrennt geladen zeigte die eine kurz die Lage von vorher. Aber **getrennt
    // gefangen**: `allSettled` statt `all`, denn die eine kann fehlschlagen
    // (`/vergroesserung` antwortet 404 bei unbekannter Vorlage), und dann
    // stünden sonst auch die beiden Pack-Knöpfe für immer abgeblendet da,
    // obwohl ihre Auskunft angekommen ist.
    const [gross, dazu] = await Promise.allSettled([
      vergroesserungLaden(index),
      packbarLaden(index),
    ]);
    setAuskunft(gross.status === 'fulfilled' ? gross.value : null);
    setPacken(dazu.status === 'fulfilled' ? dazu.value : null);
  }, [index]);

  useEffect(() => {
    void fragen();
  }, [fragen, version]);

  async function groesser(seite: 'left' | 'right', wunsch: number | 'max' | 'einpassen') {
    setLaeuft(true);
    onNote(null);
    try {
      const daten = await bilderVergroessern(index, seite, wunsch);
      onSpread(daten.spread as RenderedSpread);
      const wie =
        Math.abs(daten.faktorX - daten.faktorY) < 0.005
          ? prozent(daten.faktorX)
          : `${prozent(daten.faktorX)} breit, ${prozent(daten.faktorY)} hoch`;
      onNote(
        `${seite === 'left' ? 'Linke' : 'Rechte'} Buchseite: Bilder ${wie}` +
          // Verworfene Handarbeit gehört in den Satz und nicht in die Zahl.
          (daten.ausschnitte > 0
            ? ` · ${daten.ausschnitte} ${daten.ausschnitte === 1 ? 'Ausschnitt' : 'Ausschnitte'} auf automatisch zurückgestellt`
            : '') +
          aufloesung(daten.spread as RenderedSpread),
      );
      void fragen();
    } catch (e) {
      onNote(`Nicht vergrößert: ${fehlertext(e)}`);
    } finally {
      setLaeuft(false);
    }
  }

  /** Zwei Doppelseiten zu einer: das Buch wird ein ganzes Blatt kürzer. */
  async function blaetterPacken() {
    if (
      !window.confirm(
        `Doppelseite ${index + 1} und ${index + 2} zu einer packen?\n\n` +
          `${packen?.seiten.bilder ?? '?'} Bilder liegen danach auf einem Blatt, ` +
          `das Buch wird zwei Seiten kürzer.`,
      )
    ) {
      return;
    }
    setLaeuft(true);
    onNote(null);
    try {
      const daten = await seitenPacken(index);
      onNote(
        `Zusammengepackt: ${daten.bilder} Bilder auf Doppelseite ${index + 1}, ` +
          `das Buch hat jetzt ${daten.spreadCount} Doppelseiten` +
          (daten.hintergrundVerworfen ? ' · ein Hintergrundbild liegt jetzt im Fotopool' : '') +
          (daten.texteVerworfen ? ` · ${daten.texteVerworfen} Titel fand keinen Platz` : ''),
      );
      onGepackt();
      // Selbst nachfragen: `onGepackt` lädt Buchdaten und rendert neu, zählt
      // aber `buchVersion` nicht hoch — die Knöpfe stünden sonst mit der
      // Bilderzahl von vorher da.
      void fragen();
    } catch (e) {
      onNote(`Nicht gepackt: ${fehlertext(e)}`);
    } finally {
      setLaeuft(false);
    }
  }

  /**
   * Die beiden Buchseiten dieses Blattes zu einer: das Buch wird **eine** Seite
   * kürzer, und jedes Blatt dahinter besteht danach aus anderen zwei Seiten. Das
   * gehört in die Rückfrage — es ist der weiter reichende der beiden Griffe,
   * obwohl er der kleinere aussieht.
   */
  async function haelftenPacken() {
    if (
      !window.confirm(
        `Linke und rechte Seite von Doppelseite ${index + 1} zu einer packen?\n\n` +
          `${bilderWort(packen?.buchseiten.bilder)} liegen danach auf einer Buchseite. ` +
          `Jedes Blatt dahinter besteht dann aus anderen zwei Seiten. Ob das Buch dabei ` +
          `kürzer wird, sagt die Blattaufteilung: Geht die Parität nicht auf, füllt eine ` +
          `leere Halbseite auf.`,
      )
    ) {
      return;
    }
    setLaeuft(true);
    onNote(null);
    try {
      const daten = await buchseitenPacken(index);
      const bericht = daten.bericht;
      onNote(
        `Zusammengepackt: ${bilderWort(daten.bilder)} auf einer Buchseite` +
          // Die Blattaufteilung kann eine leere Halbseite verlangen, damit die
          // Parität wieder aufgeht – dann ist das Buch **nicht** kürzer geworden.
          // Verschwiegen sähe der Griff wirkungslos aus, obwohl er gewirkt hat.
          (bericht && bericht.leerseiten > 0
            ? ` · eine leere Halbseite füllt die Parität auf, das Buch bleibt gleich lang`
            : ` · das Buch ist eine Seite kürzer`) +
          (bericht && bericht.neuGepaart > 0
            ? ` · ${bericht.neuGepaart} ${bericht.neuGepaart === 1 ? 'Blatt' : 'Blätter'} neu zusammengesetzt`
            : '') +
          (daten.leftover.length > 0
            ? ` · ${daten.leftover.length} ${daten.leftover.length === 1 ? 'Bild liegt' : 'Bilder liegen'} jetzt im Fotopool`
            : ''),
      );
      onGepackt();
      // Und hier ist es keine Vorsorge, sondern nötig: Die Blattzahl bleibt
      // meist gleich (die Parität füllt mit einer leeren Halbseite auf), also
      // änderte sich keine Abhängigkeit — der Knopf blieb aktiv und ein zweiter
      // Klick packte ungefragt die *neuen* zwei Hälften desselben Blattes.
      void fragen();
    } catch (e) {
      onNote(`Nicht gepackt: ${fehlertext(e)}`);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div style={S.spalte}>
      {(['left', 'right'] as const).map((seite) => {
        const wert = auskunft?.[seite];
        const name = seite === 'left' ? 'links' : 'rechts';
        // Kein Wert heißt: noch nicht gefragt. Ein Satz heißt: geht hier nicht.
        const grund = typeof wert === 'string' ? wert : undefined;
        const zahlen = typeof wert === 'object' ? wert : undefined;
        // Beide Prüfungen stehen in `verdichtung.ts` und sind dort getestet:
        // Der Vergleich war einmal falsch geschrieben, und die Oberfläche hat es
        // nicht gezeigt — der Knopf war einfach aus.
        const lohnt = lohntProportional(wert);
        const passtBesser = lohntEinpassen(wert);

        return (
          <div key={seite} style={S.zeile}>
            <span style={S.name}>{name}</span>
            <button
              onClick={() => void groesser(seite, 'max')}
              disabled={laeuft || !lohnt}
              style={S.knopf}
              title={
                grund ??
                (lohnt
                  ? `Alle Bilder der ${name === 'links' ? 'linken' : 'rechten'} Buchseite um ${prozent(zahlen!.max)} größer. Die Kästen behalten ihre Form, jeder Ausschnitt gilt weiter.`
                  : 'Diese Buchseite füllt ihren Satzspiegel schon aus')
              }
            >
              {zahlen && lohnt ? prozent(zahlen.max) : '±0 %'}
            </button>
            <button
              onClick={() => void groesser(seite, 'einpassen')}
              disabled={laeuft || !passtBesser}
              style={S.knopf}
              title={
                grund ??
                (passtBesser
                  ? `Bis an den Satzspiegel: ${prozent(zahlen!.maxX)} breit, ${prozent(zahlen!.maxY)} hoch. ` +
                    `Die Kästen ändern dabei ihre Form, es wird also stärker beschnitten` +
                    (zahlen!.ausschnitte > 0
                      ? ` – und ${zahlen!.ausschnitte} von Hand gesetzte Ausschnitte gehen auf automatisch zurück.`
                      : '.')
                  : 'Hier bringt das Einpassen nicht mehr als das proportionale Vergrößern')
              }
            >
              füllen
            </button>
          </div>
        );
      })}

      <button
        onClick={() => void haelftenPacken()}
        disabled={laeuft || !packen?.buchseiten.ok}
        style={S.breit}
        title={
          packen?.buchseiten.ok
            ? `Linke und rechte Seite werden eine: ${bilderWort(packen.buchseiten.bilder)} auf einer Buchseite. ` +
              `Das Buch wird eine Seite kürzer, jedes Blatt dahinter paart sich neu.`
            : (packen?.buchseiten.error ?? 'Wird geprüft …')
        }
      >
        ⇤⇥ Linke und rechte Seite packen
        {packen?.buchseiten.ok ? ` · ${bilderWort(packen.buchseiten.bilder)}` : ''}
      </button>

      <button
        onClick={() => void blaetterPacken()}
        disabled={laeuft || index + 1 >= spreadCount || !packen?.seiten.ok}
        style={S.breit}
        title={
          packen?.seiten.ok
            ? `Beide Doppelseiten werden eine: ${bilderWort(packen.seiten.bilder)} gemeinsam neu angeordnet, das Buch wird ein Blatt kürzer.`
            : (packen?.seiten.error ?? 'Wird geprüft …')
        }
      >
        ⇥ Mit Doppelseite {index + 2} packen
        {packen?.seiten.ok ? ` · ${bilderWort(packen.seiten.bilder)}` : ''}
      </button>
    </div>
  );
}

const S = {
  spalte: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  zeile: { display: 'flex', gap: 6, alignItems: 'center' },
  name: { fontSize: 12, color: T.fg3, width: 42 },
  knopf: {
    flex: 1,
    font: 'inherit',
    fontSize: 12,
    padding: '6px 0',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg2,
    cursor: 'pointer',
  },
  breit: {
    font: 'inherit',
    fontSize: 12,
    padding: '7px 0',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg2,
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
