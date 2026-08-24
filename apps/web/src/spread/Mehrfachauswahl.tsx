/**
 * Werkzeuge für die Mehrfachauswahl auf der Doppelseite.
 *
 * Steht anstelle des Bildpanels, sobald mehr als ein Bild gewählt ist – dieselbe
 * Naht in allen drei Rahmen (`Inspektor`, `Werkbank`, `Lesetisch`). Verschieben
 * und Skalieren laufen über die Griffe auf der Bühne (`Griffe.tsx`,
 * `useSpreadEditor.gruppeZiehen`/`gruppeSkalieren`); hier stehen nur die beiden
 * Griffe, die eine Fläche im Panel brauchen und keine auf dem Papier.
 *
 * Bewusst nicht dabei: gemeinsames Drehen (siehe `gruppeSkalieren`), Ausschnitt,
 * Rahmen, Unterschrift — die bleiben Sache des einzelnen Bildes.
 */
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

export function Mehrfachauswahl({ model }: { model: SpreadEditorModel }) {
  const n = model.auswahlMenge.size;

  return (
    <div style={{ ...B.abschnitt, borderBottom: 'none' }}>
      <div style={S.kopfzeile}>
        <strong style={B.titel}>{n} Bilder ausgewählt</strong>
        <button onClick={model.auswahlAufheben} style={S.esc} title="Auswahl aufheben">
          Esc
        </button>
      </div>
      <p style={{ ...B.leiser, marginTop: 6 }}>
        Am Rand eines der Bilder ziehen verschiebt alle zusammen; an der Hülle darum ziehen skaliert
        sie gemeinsam.
      </p>
      <div style={S.knoepfe}>
        <button onClick={() => void model.gruppeInsRaster()} style={B.knopf}>
          Auf Raster zurücksetzen
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                `${n} Bilder aus dem Buch nehmen?\n\nSie wandern in den Fotopool, verloren ist keines.`,
              )
            ) {
              void model.gruppeAusDemBuch();
            }
          }}
          style={S.gefahr}
        >
          Aus dem Buch entfernen
        </button>
      </div>
    </div>
  );
}

const S = {
  kopfzeile: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  esc: {
    font: 'inherit',
    fontSize: 12,
    color: T.fg3,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  knoepfe: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 10 },
  gefahr: {
    font: 'inherit',
    fontSize: 13,
    padding: '7px 10px',
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fehler,
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
