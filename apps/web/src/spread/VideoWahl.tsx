/**
 * Das Standbild eines eingeworfenen Videos wählen.
 *
 * Der Zwischenschritt, den ein Bild nicht hat: Ein Film ist noch kein Foto. Er
 * liegt aufgenommen im Zwischenspeicher, und hier entscheidet sich, welche
 * Sekunde daraus ins Buch kommt. Bis dahin ist am Buch nichts geändert —
 * Abbrechen kostet nichts.
 *
 * **Auf der Bühne und nicht im Rahmen**, wie die Frage nach dem Neuanordnen: Die
 * Wahl gehört zu dem Film, der gerade gefallen ist, und gilt damit in allen drei
 * Fassungen gleich (`.claude/rules/web.md`).
 *
 * **Der Schieber lädt nicht bei jeder Bewegung.** Jedes Vorschaubild ist ein
 * `ffmpeg`-Aufruf; beim Ziehen über eine Minute wären das Hunderte. Die Zahl
 * folgt dem Zeiger sofort, das Bild nach einer kurzen Ruhe — dieselbe
 * Verzögerung wie an den Reglern der Bildanpassung, und der einzige Grund, dass
 * dieses kleine Bauteil einen Zustand hat.
 *
 * **Der Hinweis auf das Hosting steht hier und nicht im Kleingedruckten.** Wir
 * legen kein Video ab, die Adresse gibt der Benutzer an; zieht sie um, ist der
 * gedruckte Code toter Buchstabe. Das ist die bewusste Entscheidung dieses
 * Projekts (`model/video.ts` im Kern), und wer ein Buch drucken lässt, soll sie
 * vorher gelesen haben.
 */
import { useEffect, useState } from 'react';
import { videoStandbildAdresse } from '../api.js';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

/** Ruhe vor dem Nachladen des Vorschaubildes. */
const RUHE_MS = 180;

/** Eine Sekundenangabe mit Dezimalkomma – die Oberfläche ist deutsch. */
function komma(sekunden: number): string {
  return sekunden.toFixed(1).replace('.', ',');
}

export function VideoWahl({ model }: { model: SpreadEditorModel }) {
  const wahl = model.videoWahl;
  // Die Mitte als Vorgabe: Der Anfang eines Films ist oft schwarz oder verwackelt,
  // das Ende zeigt meist, wie die Kamera weggelegt wird.
  const [sekunde, setSekunde] = useState(0);
  const [gezeigt, setGezeigt] = useState(0);

  useEffect(() => {
    const mitte = wahl ? wahl.dauerSek / 2 : 0;
    setSekunde(mitte);
    setGezeigt(mitte);
  }, [wahl?.kennung, wahl?.dauerSek]);

  useEffect(() => {
    const timer = setTimeout(() => setGezeigt(sekunde), RUHE_MS);
    return () => clearTimeout(timer);
  }, [sekunde]);

  if (!wahl) return null;

  return (
    <div style={S.karte}>
      <img
        src={videoStandbildAdresse(wahl.kennung, gezeigt)}
        alt={`Standbild bei ${gezeigt.toFixed(1)} Sekunden`}
        style={S.bild}
      />

      <div style={S.spalte}>
        <span style={S.titel}>Standbild aus „{wahl.name}"</span>

        {wahl.dauerSek > 0 ? (
          <label style={S.zeile}>
            <input
              type="range"
              min={0}
              max={wahl.dauerSek}
              step={0.1}
              value={sekunde}
              onChange={(e) => setSekunde(Number(e.target.value))}
              style={S.schieber}
            />
            <span style={S.zeit}>
              {komma(sekunde)} s von {komma(wahl.dauerSek)}
            </span>
          </label>
        ) : (
          // Manche Container tragen keine Dauer. Dann gibt es nichts zu schieben,
          // und das erste Bild ist die einzige Wahl – gesagt statt versteckt.
          <span style={S.hinweis}>Die Länge dieses Films steht nicht in der Datei.</span>
        )}

        <span style={S.hinweis}>
          Das Video selbst kommt nicht ins Buch und wird von uns nicht abgelegt. Ins Buch kommt
          dieses Standbild, daneben ein QR-Code auf eine Adresse, die du hinterlegst
          {wahl.adresse ? ' – für diesen Film ist schon eine hinterlegt' : ''}. Zieht sie später um,
          zeigt der gedruckte Code ins Leere.
        </span>

        <span style={S.knoepfe}>
          <button
            type="button"
            onClick={() => void model.videoStandbildNehmen(sekunde)}
            style={B.knopfPrimaer}
            disabled={model.einwurfLaeuft}
            title="Dieses Bild als Foto ins Buch legen, an die Fallstelle"
          >
            Dieses Bild nehmen
          </button>
          <button
            type="button"
            onClick={model.videoWahlAbbrechen}
            style={B.knopf}
            title="Nichts einsetzen – am Buch ändert sich nichts"
          >
            Abbrechen
          </button>
        </span>
      </div>
    </div>
  );
}

const S = {
  /** Wie die Einwurffrage unten mittig, aber höher: Sie trägt ein Bild. */
  karte: {
    position: 'absolute' as const,
    left: '50%',
    bottom: 16,
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 14,
    padding: '12px 14px',
    borderRadius: T.rMd,
    background: T.bg1,
    border: `1px solid ${T.line2}`,
    boxShadow: T.schattenBuehne,
    maxWidth: '86%',
  },
  /** Feste Höhe, damit die Karte beim Schieben nicht springt. */
  bild: {
    height: 132,
    width: 'auto',
    maxWidth: 240,
    objectFit: 'contain' as const,
    borderRadius: T.rSm,
    background: T.bg2,
    flexShrink: 0,
  },
  spalte: { display: 'flex', flexDirection: 'column' as const, gap: 8, minWidth: 300 },
  titel: { fontSize: 13, fontWeight: 600, color: T.fg1 },
  zeile: { display: 'flex', alignItems: 'center', gap: 10 },
  schieber: { flex: 1 },
  zeit: { fontSize: 12, color: T.fg2, fontVariantNumeric: 'tabular-nums' as const, flexShrink: 0 },
  hinweis: { fontSize: 12, color: T.fg2, lineHeight: 1.4, maxWidth: 420 },
  knoepfe: { display: 'flex', gap: 8, marginTop: 2 },
};
