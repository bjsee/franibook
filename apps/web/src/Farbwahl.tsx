/**
 * Eine Farbe, die auch **nicht gesetzt** sein darf.
 *
 * Ein `<input type="color">` kennt kein „leer" — es zeigt immer eine Farbe, und
 * sobald man es anfasst, hat man eine gewählt. Genau das ist am Umschlag die
 * falsche Vorgabe: Fast jede Farbe dort darf offen bleiben und heißt dann „wie
 * das Buch es vorgibt". Deshalb steht der Wähler neben einem Griff, der die
 * Angabe zurücknimmt, und er zeigt die geltende Vorgabe, solange nichts gewählt
 * ist — sie ist die Auskunft, die man beim Aufziehen sucht.
 *
 * **Gesendet wird beim Verlassen, nicht bei jedem `onChange`.** Das Farbrad
 * feuert fortlaufend, während man darin zieht; jeder Zwischenwert wäre ein
 * eigener PATCH und ein eigener Verlaufsschritt.
 *
 * Eine eigene Datei, weil beide Umschlagpanels sie brauchen — die Textfarben in
 * `CoverTexte.tsx`, die Flächenfarben in `Cover.tsx`. Zwei Fassungen wären zwei
 * Antworten auf die Frage, was „keine Farbe" heißt.
 */
import { useEffect, useState } from 'react';
import { B, T } from './theme.js';

export function Farbwahl({
  wert,
  vorgabe,
  gesperrt = false,
  onSetzen,
}: {
  /** Die gesetzte Farbe, oder `undefined` für „keine eigene". */
  wert: string | undefined;
  /** Was gilt, solange nichts gesetzt ist. Wird angezeigt, nicht gesendet. */
  vorgabe: string;
  gesperrt?: boolean;
  /** Der leere Text nimmt die Angabe zurück. */
  onSetzen: (farbe: string | '') => void;
}) {
  const [entwurf, setEntwurf] = useState<string | null>(null);
  // Ein Zurücknehmen am Server wirft den Entwurf weg — sonst zeigte der Wähler
  // weiter eine Farbe, die nicht mehr gespeichert ist.
  useEffect(() => setEntwurf(null), [wert]);
  const angezeigt = entwurf ?? wert ?? vorgabe;

  return (
    <span style={S.reihe}>
      <input
        type="color"
        value={angezeigt}
        disabled={gesperrt}
        onChange={(e) => setEntwurf(e.target.value)}
        onBlur={() => {
          if (entwurf !== null && entwurf !== wert) onSetzen(entwurf);
        }}
        style={S.waehler}
      />
      {wert !== undefined ? (
        <button
          onClick={() => onSetzen('')}
          disabled={gesperrt}
          title="Zurück zur Vorgabe"
          style={S.zurueck}
        >
          ×
        </button>
      ) : (
        <span style={{ ...B.leiser, fontSize: 11 }}>Vorgabe</span>
      )}
    </span>
  );
}

const S = {
  reihe: { display: 'flex', alignItems: 'center', gap: 6 },
  waehler: {
    width: 34,
    height: 26,
    padding: 0,
    border: `1px solid ${T.line}`,
    borderRadius: T.rSm,
    background: 'none',
    cursor: 'pointer',
  },
  zurueck: {
    border: 'none',
    background: 'none',
    color: T.fg3,
    cursor: 'pointer',
    fontSize: 15,
    lineHeight: 1,
    padding: 2,
  },
} satisfies Record<string, React.CSSProperties>;
