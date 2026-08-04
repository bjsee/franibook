/**
 * Datum, Ort und Ausrichtung am gewählten Bild korrigieren.
 *
 * Eine eigene Komponente und nicht drei Fassungen in Inspektor, Werkbank und
 * Lesetisch: Eine Funktion, die nur in einem Rahmen erreichbar ist, macht den
 * Vergleich der drei Anordnungen wertlos — man wechselt dann nicht, weil eine
 * besser liegt, sondern weil man etwas braucht. Die Wirkung liegt ohnehin in
 * `useSpreadEditor`; hier steht nur die Form.
 *
 * Zugeklappt ein Knopf, denn die häufige Handlung an dieser Stelle ist
 * *nachsehen*, nicht *ändern*. Aufgeklappt stehen die Felder **im Fluss** und
 * schweben nicht: Inspektor und Werkbank ordnen ihren Inhalt als Spalte, dort
 * bekommen sie ohnehin eine eigene Zeile — und die Pillenleiste des Lesetischs
 * bricht um (`flexWrap`), sodass dieselbe Form auch dort passt. Eine schwebende
 * Karte bräuchte je Rahmen eine Richtung und stieße am Fensterrand an: Beide
 * Rahmen, die eine Leiste haben, halten sie oben.
 *
 * **Kein Stapel hier.** Ein Kamera-Reset trifft dutzende Bilder, und ein Ort gilt
 * meist für eine ganze Serie; dafür ist der Reiter „Fotodaten" gebaut, mit
 * Mehrfachauswahl und Vervollständigung aus dem Bestand. Hier geht es um den
 * anderen Fall: Man bemerkt den Fehler, *weil* das Bild an der falschen Stelle im
 * Buch steht. Darauf weist der Text am Fuß hin, statt eine zweite Mengenmechanik
 * zu bauen.
 */
import { useEffect, useState } from 'react';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

export function Bilddaten({ model }: { model: SpreadEditorModel }) {
  const info = model.gewaehlteBox ? model.infoVon(model.gewaehlteBox.photoId) : undefined;
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState('');
  const [ort, setOrt] = useState('');

  // Beim Bildwechsel zuklappen: Ein offenes Feld mit den Werten des vorigen
  // Bildes wäre ein Fehlgriff mit Ansage.
  useEffect(() => setOffen(false), [info?.id]);

  // Die Felder folgen den geltenden Werten — **ohne** zuzuklappen. Beides in
  // einem Effekt hieße: Wer das Datum setzt, muss zum Ort erneut aufklappen,
  // weil das eigene Setzen den Wert ändert und damit den Kasten schließt.
  useEffect(() => {
    setWert(info?.effectiveDate?.slice(0, 19) ?? '');
    setOrt(info?.place?.label ?? '');
  }, [info?.id, info?.effectiveDate, info?.place?.label]);

  if (!info) return null;

  const datumKorrigiert = info.dateSource === 'manual' || info.dateSource === 'interpolated';

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
        title="Aufnahmedatum und Ort dieses Bildes korrigieren"
      >
        Daten ändern
      </button>

      {offen && (
        <div style={S.karte}>
          <span style={S.marke}>Aufnahmezeit</span>
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
          {datumKorrigiert && (
            <button
              type="button"
              style={B.knopfKlein}
              onClick={() => void model.datumSetzen(null)}
              title="Wieder das Datum aus der Datei gelten lassen"
            >
              Datumskorrektur verwerfen
            </button>
          )}

          <span style={S.marke}>Ort</span>
          <div style={S.zeile}>
            <input
              value={ort}
              placeholder="Ortsname"
              onChange={(e) => setOrt(e.target.value)}
              style={{ ...B.feld, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              style={B.knopfPrimaer}
              disabled={ort.trim() === ''}
              onClick={() => void model.ortSetzen(ort.trim())}
            >
              setzen
            </button>
          </div>
          {info.placeManual && (
            <button
              type="button"
              style={B.knopfKlein}
              onClick={() => void model.ortSetzen(null)}
              title="Wieder den aus den Koordinaten aufgelösten Ort gelten lassen"
            >
              Ort an die Automatik zurückgeben
            </button>
          )}

          {/*
            Kippen und nicht drehen: Der Drehgriff am Bild ist eine
            Gestaltungsaussage im Platz, dies korrigiert, wie das Bild überhaupt
            liegt — und tauscht dabei Breite und Höhe. Beides an derselben Stelle
            anzubieten wäre eine Einladung zum Verwechseln, deshalb steht das
            Kippen hier bei den Daten und nicht bei der Neigung.
          */}
          <span style={S.marke}>Ausrichtung</span>
          <div style={S.zeile}>
            <button
              type="button"
              style={{ ...B.knopfKlein, flex: 1 }}
              onClick={() => void model.ausrichtungKippen(3)}
              title="Eine Vierteldrehung gegen den Uhrzeigersinn"
            >
              ↺ links
            </button>
            <button
              type="button"
              style={{ ...B.knopfKlein, flex: 1 }}
              onClick={() => void model.ausrichtungKippen(1)}
              title="Eine Vierteldrehung im Uhrzeigersinn"
            >
              ↻ rechts
            </button>
            {info.quarterTurns !== undefined && (
              <button
                type="button"
                style={B.knopfKlein}
                onClick={() => void model.ausrichtungKippen(null)}
                title="Wieder die Ausrichtung aus der Datei gelten lassen"
              >
                zurück
              </button>
            )}
          </div>
          <p style={S.hinweis}>
            {info.quarterTurns === undefined
              ? 'Für Scans und Bilder, deren EXIF-Ausrichtung fehlt. Die Vorlage folgt beim Neuanordnen.'
              : `Um ${info.quarterTurns * 90}° gekippt. Die Vorlage folgt beim Neuanordnen.`}
          </p>

          <div style={S.zeile}>
            <div style={B.dehner} />
            <button type="button" style={B.knopfKlein} onClick={() => setOffen(false)}>
              schließen
            </button>
          </div>

          <p style={S.hinweis}>
            Mehrere Bilder auf einmal – ein Kamera-Reset, ein Urlaubsort – gehen im Reiter
            „Fotodaten". Dort stehen auch die Ortsnamen des Bestands zur Wahl.
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
  marke: { ...B.marke, marginTop: 2 },
  zeile: { display: 'flex', alignItems: 'center', gap: 4 },
  hinweis: { ...B.leiser, margin: 0 },
};
