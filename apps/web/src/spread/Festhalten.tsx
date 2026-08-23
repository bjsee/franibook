/**
 * Das Schloss an der Doppelseite — für das ganze Blatt oder eine Buchseite.
 *
 * Das Häkchen sagt **ob**, die Segmente daneben **was**. Erst festhalten, dann
 * die Fläche wählen: Umgekehrt stünde eine Wahl da, die noch nichts bewirkt, und
 * bei vier gleichrangigen Segmenten („frei | Blatt | links | rechts") müsste man
 * lesen, statt zu sehen, ob überhaupt etwas geschützt ist.
 *
 * **Die Segmente stehen nur an einem Blatt, das sich trennen lässt.** Ein
 * Auftakt, eine justierte Zeile, ein Blatt mit Hintergrundbild über beide Seiten
 * bleibt ganz — dieselbe Bedingung wie beim seitenweisen Anordnen (`teilbar`),
 * und die Oberfläche weiß sie schon: `aussen.splittable`. Der Server lehnt den
 * Griff dort mit 409 und einem Satz ab; ein Knopf, den man drückt und der dann
 * widerspricht, wäre die schlechtere Auskunft.
 *
 * Warum das halbe Schloss überhaupt: Eine eingefügte oder von Hand gestellte
 * Buchseite fror bis hierher auch ihre Nachbarin ein, die die Automatik gebaut
 * hatte. Beim halben Schloss bleibt nur die eine Seite, die andere fließt weiter
 * mit und füllt sich neu (`layout/keep.ts`, `insertKeptHalves`).
 */
import { B, T } from '../theme.js';
import type { SpreadAussen } from './types.js';

interface Props {
  aussen: SpreadAussen;
  /** Abweichender Stil des Kästchens — der Lesetisch steht auf dunklem Grund. */
  style?: React.CSSProperties;
}

export function Festhalten({ aussen, style }: Props) {
  const an = aussen.locked || aussen.lockedSide !== null;

  return (
    <>
      <label
        style={{ ...B.haken, ...style }}
        title="Diese Doppelseite beim Neuanordnen unverändert lassen"
      >
        <input
          type="checkbox"
          checked={an}
          // Beim Anhaken das ganze Blatt: die vorsichtige Richtung. Wer nur eine
          // Seite meint, sagt es im nächsten Griff — wer nur eine Seite bekäme,
          // ohne es zu wollen, verlöre die andere beim nächsten Neuanordnen.
          onChange={(e) => aussen.onLocked(e.target.checked, null)}
        />
        festgehalten
      </label>

      {an && aussen.splittable && (
        <div style={S.segmente}>
          {(
            [
              [null, 'Blatt'],
              ['left', 'links'],
              ['right', 'rechts'],
            ] as const
          ).map(([wert, text]) => (
            <button
              key={text}
              onClick={() => aussen.onLocked(true, wert)}
              style={aussen.lockedSide === wert ? B.segAn : B.segAus}
              title={
                wert === null
                  ? 'Beide Buchseiten bleiben, wie sie sind'
                  : `Nur die ${text}e Buchseite bleibt — die andere ordnet der Neuaufbau neu`
              }
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const S = {
  /**
   * Schmaler als der übliche Segmentschalter: Er steht in einer Leiste neben
   * Häkchen und Knöpfen, und drei Segmente in voller Größe wögen dort schwerer
   * als die Entscheidung, die sie tragen.
   */
  segmente: {
    display: 'flex',
    gap: 2,
    background: T.bg3,
    padding: 2,
    borderRadius: 6,
    fontSize: 12,
  },
} satisfies Record<string, React.CSSProperties>;
