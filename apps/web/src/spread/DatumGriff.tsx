/**
 * Das Aufnahmedatum am gewählten Bild korrigieren.
 *
 * Eine eigene Komponente und nicht drei Fassungen in Inspektor, Werkbank und
 * Lesetisch: Eine Funktion, die nur in einem Rahmen erreichbar ist, macht den
 * Vergleich der drei Anordnungen wertlos — man wechselt dann nicht, weil eine
 * besser liegt, sondern weil man etwas braucht. Die Wirkung liegt ohnehin in
 * `useSpreadEditor.datumSetzen`; hier steht nur die Form.
 *
 * Zugeklappt ein Textknopf, denn die häufige Handlung an dieser Stelle ist
 * *nachsehen*, nicht *ändern*. Aufgeklappt steht das Feld **im Fluss** und
 * schwebt nicht: Inspektor und Werkbank ordnen ihren Inhalt als Spalte, dort
 * bekommt es ohnehin eine eigene Zeile — und die Pillenleiste des Lesetischs
 * bricht um (`flexWrap`), sodass dieselbe Form auch dort passt. Eine schwebende
 * Karte bräuchte je Rahmen eine Richtung und stieße am Fensterrand an: Beide
 * Rahmen, die eine Leiste haben, halten sie oben.
 *
 * Für einen Stapel (ein Kamera-Reset trifft dutzende Bilder) ist die
 * Fotodaten-Ansicht der Ort; darauf weist der Text hin, statt hier eine zweite
 * Mengenmechanik zu bauen.
 */
import { useEffect, useState } from 'react';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

export function DatumGriff({ model }: { model: SpreadEditorModel }) {
  const info = model.gewaehlteBox ? model.infoVon(model.gewaehlteBox.photoId) : undefined;
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState('');

  // Beim Bildwechsel zuklappen und das Feld mit dem geltenden Datum füllen: Ein
  // offenes Feld mit dem Wert des vorigen Bildes wäre ein Fehlgriff mit Ansage.
  useEffect(() => {
    setOffen(false);
    setWert(info?.effectiveDate?.slice(0, 19) ?? '');
  }, [info?.id, info?.effectiveDate]);

  if (!info) return null;

  const korrigiert = info.dateSource === 'manual' || info.dateSource === 'interpolated';

  return (
    <>
      {/*
        `B.knopfKlein` und nicht `B.knopfText`: Der Textknopf ist rot, und Rot
        trägt in dieser Oberfläche ausschließlich Zustände der Auflösung und der
        Bildquellen — niemals eine Bedienung.
      */}
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        style={B.knopfKlein}
        title="Aufnahmedatum dieses Bildes korrigieren"
      >
        Datum ändern
      </button>

      {offen && (
        <div style={S.karte}>
          <div style={S.zeile}>
            <input
              type="datetime-local"
              step={1}
              value={wert}
              onChange={(e) => setWert(e.target.value)}
              style={{ ...B.feld, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              style={B.knopfPrimaer}
              disabled={wert === ''}
              // `datetime-local` liefert Sekunden nur, wenn welche getippt wurden.
              onClick={() => void model.datumSetzen(wert.length === 16 ? `${wert}:00` : wert)}
            >
              setzen
            </button>
          </div>

          <div style={S.zeile}>
            {korrigiert && (
              <button
                type="button"
                style={B.knopfKlein}
                onClick={() => void model.datumSetzen(null)}
                title="Wieder das Datum aus der Datei gelten lassen"
              >
                Korrektur verwerfen
              </button>
            )}
            <div style={B.dehner} />
            <button type="button" style={B.knopfKlein} onClick={() => setOffen(false)}>
              schließen
            </button>
          </div>

          <p style={S.hinweis}>
            Mehrere Bilder auf einmal – etwa nach einem Kamera-Reset – gehen im Reiter „Fotodaten".
          </p>
        </div>
      )}
    </>
  );
}

const S = {
  karte: {
    // Eine eigene Zeile, auch in einer waagerechten Leiste mit `flexWrap`.
    flexBasis: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: 8,
    borderRadius: T.rMd,
    background: T.cyanZart,
    border: `1px solid ${T.cyanRand}`,
  },
  zeile: { display: 'flex', alignItems: 'center', gap: 4 },
  hinweis: { ...B.leiser, margin: 0 },
};
