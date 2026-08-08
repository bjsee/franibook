/**
 * Was die Abnahme über das gewählte Bild sagt — und der Weg, es abzunicken.
 *
 * Der Reiter „Abnahme" beantwortet „ist noch etwas übrig?" über das ganze Buch.
 * Diese Zeile beantwortet dieselbe Frage dort, wo man arbeitet: Wer einen
 * Ausschnitt zieht, soll sofort sehen, was das für den Druck bedeutet, statt es
 * später in einer Liste wiederzufinden.
 *
 * **Eine eigene Komponente und nicht drei Fassungen** in Inspektor, Werkbank und
 * Lesetisch — dieselbe Begründung wie bei `Bilddaten`: Eine Funktion, die nur in
 * einem Rahmen erreichbar ist, macht den Vergleich der drei Anordnungen wertlos.
 *
 * **Der Wortlaut kommt aus dem Kern** (`Befund.text`) und wird hier nicht neu
 * geschrieben: Dieselbe Ursache soll in der Liste und am Bild denselben Satz
 * bekommen, sonst sucht man zwei Fehler. Die zwei Befunde, für die das Bildpanel
 * einen eigenen, ausführlicheren Text samt Handgriff hat — Lage und Gesicht am
 * Rand —, stehen deshalb dort und nicht hier; sie lassen sich hier aber
 * abnicken, denn das gilt für jeden Fund gleich.
 */
import { useState } from 'react';
import { istSchwer, type Befund } from '@franibook/core';
import { fehlertext } from '../api.js';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

export function Bildbefunde({
  model,
  ausser = [],
}: {
  model: SpreadEditorModel;
  /**
   * Arten, die der Rahmen selbst ausführlicher erklärt.
   *
   * Der Inspektor hat für Lage und Gesicht am Rand einen eigenen Kasten samt
   * Handgriff; dieselbe Ursache zweimal untereinander ließe den Benutzer zwei
   * Fehler suchen. Die übrigen Rahmen haben diesen Kasten nicht und zeigen
   * alles.
   */
  ausser?: readonly Befund['art'][];
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const befunde = model.befundeVon(model.selectedSlotId).filter((b) => !ausser.includes(b.art));
  if (befunde.length === 0) return null;

  const griff = (schluessel: string, zurueck: boolean) => {
    setLaeuft(true);
    model
      .abnicken(schluessel, zurueck)
      .then(() => setFehler(null))
      .catch((e: unknown) => setFehler(fehlertext(e)))
      .finally(() => setLaeuft(false));
  };

  return (
    <div style={S.block}>
      {befunde.map((fund) => (
        <span key={fund.schluessel} style={{ ...S.zeile, ...(fund.abgenommen ? S.leise : {}) }}>
          <span style={punktStil(fund)} />
          <span style={S.text}>{fund.text}</span>
          <button
            onClick={() => griff(fund.schluessel, fund.abgenommen === true)}
            disabled={laeuft}
            style={B.knopfText}
            title={
              fund.abgenommen
                ? 'Diesen Befund wieder melden'
                : 'Gesehen und in Ordnung – nicht mehr melden'
            }
          >
            {fund.abgenommen ? 'wieder melden' : 'ist ok'}
          </button>
        </span>
      ))}
      {fehler && <span style={B.leiser}>{fehler}</span>}
    </div>
  );
}

/**
 * Der Abnickknopf allein — für die Kästen, die einen Fund selbst erklären.
 *
 * Lage und Gesicht am Rand haben im Inspektor einen eigenen Text mit
 * Handgriff; abnicken lässt sich trotzdem beides, denn das gilt für jeden Fund
 * gleich. `null`, wenn es zu dieser Art gerade keinen Fund gibt — dann steht
 * auch kein Kasten da.
 */
export function AbnickKnopf({ model, art }: { model: SpreadEditorModel; art: Befund['art'] }) {
  const [laeuft, setLaeuft] = useState(false);
  const fund = model.befundeVon(model.selectedSlotId).find((b) => b.art === art);
  if (!fund) return null;

  return (
    <button
      onClick={() => {
        setLaeuft(true);
        void model
          .abnicken(fund.schluessel, fund.abgenommen === true)
          .finally(() => setLaeuft(false));
      }}
      disabled={laeuft}
      style={B.knopfText}
      title={
        fund.abgenommen
          ? 'Diesen Befund wieder melden'
          : 'Gesehen und in Ordnung – nicht mehr melden'
      }
    >
      {fund.abgenommen ? 'wieder melden' : 'ist ok'}
    </button>
  );
}

/**
 * Der Punkt vor dem Satz: rot, solange der Fund offen und schwer ist.
 *
 * Farbe trägt hier eine Aussage über das Buch und nicht über die Bedienung —
 * dieselbe Regel wie an den Auflösungsmarken der Bühne.
 */
function punktStil(fund: Befund): React.CSSProperties {
  return {
    ...S.punkt,
    background: fund.abgenommen ? T.fg4 : istSchwer(fund.art) ? T.fehler : T.warn,
  };
}

const S = {
  block: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  zeile: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, lineHeight: 1.5 },
  leise: { opacity: 0.55 },
  punkt: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0, alignSelf: 'center' },
  text: { color: T.fg1 },
} satisfies Record<string, React.CSSProperties>;
