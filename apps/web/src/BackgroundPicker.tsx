/**
 * Hintergrund wählen: Farbe für diese Seite oder für alle, wahlweise ein Foto.
 *
 * Die Farben kommen aus dem Kern (`render/background.ts`) und nicht aus einem
 * Farbwähler: Freie Farbwahl hinter Fotos geht in einem Fotobuch fast immer
 * schief, und eine Palette macht den Fehler unmöglich, statt ihn zu erlauben.
 *
 * Vorher war das ein Aufklapper über der Bühne. Jetzt ist es der Inhalt eines
 * Abschnitts: Die neun Farbfelder sind klein genug, um dauernd zu stehen, und
 * der Griff, den man selten braucht — Farbe für alle Seiten, Foto dahinter —
 * liegt hinter einem Klapper darunter.
 *
 * **Das Bild wählt ein eigener Dialog** (`HintergrundBild.tsx`). Hier standen
 * acht Kacheln, und zwar die vom Server nach Auflösung sortierten besten des
 * ganzen Bestands — eine Antwort auf „welches Bild taugt überhaupt?", aber nicht
 * auf „ich will *dieses* Bild". Was bleibt, ist die Auskunft, was gerade liegt,
 * und der Weg dorthin.
 */
import { useEffect, useState } from 'react';
import {
  einstellungenAendern,
  fehlertext,
  hintergrundOptionenLaden,
  hintergrundSetzen,
} from './api.js';
import { B, T } from './theme.js';
import { useBildSrc } from './bildadresse.js';
import { HintergrundBild } from './HintergrundBild.js';

type Farbe = { id: string; name: string; hex: string };

/** So viel vom Druckprofil braucht der Bildwähler; `/api/info` liefert genau das. */
type Seitenmasse = { page: { trimWidthMm: number; trimHeightMm: number; bleedMm: number } };

interface BackgroundPickerProps {
  /** Doppelseite, die geändert wird. */
  spreadIndex: number;
  /** Farbe, die gerade global gilt. */
  global: string;
  /** Farbe, die auf dieser Doppelseite liegt – sie wird markiert. */
  aktuell?: string | undefined;
  /** Bild, das hinter dieser Doppelseite liegt, samt Buchseite. */
  bild?: { photoId: string; side: 'left' | 'right' | null } | null;
  /** Jahrgang der Doppelseite – Vorgabe des Jahresfilters im Bildwähler. */
  jahr?: number | undefined;
  profil: Seitenmasse;
  onChanged: () => void;
}

export function BackgroundPicker({
  spreadIndex,
  global,
  aktuell,
  bild,
  jahr,
  profil,
  onChanged,
}: BackgroundPickerProps) {
  const bildSrc = useBildSrc();
  const [farben, setFarben] = useState<Farbe[]>([]);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [wahlOffen, setWahlOffen] = useState(false);

  useEffect(() => {
    hintergrundOptionenLaden()
      .then((d) => setFarben(d.colors))
      .catch((e: unknown) => setHinweis(fehlertext(e)));
  }, []);

  async function setzeSeite(patch: { color?: string | null; photoId?: string | null }) {
    try {
      const d = await hintergrundSetzen(spreadIndex, patch);
      setHinweis(d.hinweis ?? null);
    } catch (e) {
      setHinweis(fehlertext(e));
    }
    onChanged();
  }

  async function setzeGlobal(hex: string) {
    try {
      await einstellungenAendern({ background: hex });
      setHinweis(null);
    } catch (e) {
      setHinweis(fehlertext(e));
    }
    onChanged();
  }

  const gleich = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

  return (
    <>
      <div style={S.reihe}>
        {farben.map((f) => (
          <button
            key={f.id}
            title={f.name}
            // Die Farbe löst das Bild ab: Ein Bild schlägt die Farbe, ein
            // Farbklick bliebe darunter sonst folgenlos.
            onClick={() => void setzeSeite({ color: f.hex, photoId: null })}
            style={{
              ...S.feld,
              background: f.hex,
              ...(gleich(aktuell, f.hex) ? S.gewaehlt : {}),
            }}
          />
        ))}
        <button
          onClick={() => void setzeSeite({ color: null })}
          style={B.knopfKlein}
          title="Wieder die Farbe nehmen, die für alle Seiten gilt"
        >
          wie Vorgabe
        </button>
      </div>

      <details>
        <summary style={S.summary}>Für alle Seiten · Foto dahinter</summary>

        <p style={{ ...B.leiser, margin: '10px 0 4px' }}>Farbe für alle Seiten</p>
        <div style={S.reihe}>
          {farben.map((f) => (
            <button
              key={f.id}
              title={f.name}
              onClick={() => void setzeGlobal(f.hex)}
              style={{
                ...S.feld,
                background: f.hex,
                ...(gleich(global, f.hex) ? S.gewaehlt : {}),
              }}
            />
          ))}
        </div>

        <p style={{ ...B.leiser, margin: '12px 0 4px' }}>Foto als Hintergrund</p>
        <div style={S.bildzeile}>
          {bild && <img src={bildSrc(bild.photoId, 'thumb')} alt="" style={S.thumb} />}
          <span style={B.leiser}>
            {bild ? SEITE_TEXT[bild.side ?? 'both'] : 'kein Bild — nur der farbige Grund'}
          </span>
        </div>
        <button onClick={() => setWahlOffen(true)} style={B.knopfKlein}>
          {bild ? 'Anderes Bild wählen …' : 'Bild wählen …'}
        </button>
      </details>

      {hinweis && <p style={B.warnung}>{hinweis}</p>}

      {wahlOffen && (
        <HintergrundBild
          spreadIndex={spreadIndex}
          jahr={jahr}
          profil={profil}
          aktuell={bild ?? null}
          onGesetzt={(satz) => {
            setHinweis(satz);
            onChanged();
          }}
          onSchliessen={() => setWahlOffen(false)}
        />
      )}
    </>
  );
}

/** Wie die Lage des Bildes im Abschnitt heißt. */
const SEITE_TEXT = {
  left: 'liegt auf der linken Buchseite',
  right: 'liegt auf der rechten Buchseite',
  both: 'liegt über beide Seiten',
} as const;

const S = {
  reihe: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  feld: {
    width: 26,
    height: 26,
    padding: 0,
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    cursor: 'pointer',
  },
  gewaehlt: { borderColor: T.cyan, boxShadow: `0 0 0 2px ${T.cyanZart}` },
  summary: { fontSize: 12, color: T.fg3, cursor: 'pointer' },
  bildzeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 0 8px',
  },
  thumb: {
    width: 42,
    height: 32,
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: T.rSm,
    border: `1px solid ${T.line}`,
  },
} satisfies Record<string, React.CSSProperties>;
