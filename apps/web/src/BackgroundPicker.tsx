/**
 * Hintergrund wählen: Farbe für diese Seite oder für alle, wahlweise ein Foto.
 *
 * Die Farben kommen aus dem Kern (`render/background.ts`) und nicht aus einem
 * Farbwähler: Freie Farbwahl hinter Fotos geht in einem Fotobuch fast immer
 * schief, und eine Palette macht den Fehler unmöglich, statt ihn zu erlauben.
 *
 * Beim Bild steht die Auflösung dabei, mit der es die Doppelseite abdecken
 * würde. Bei diesem Bestand reicht sie praktisch nie – deshalb ist die Zahl
 * sichtbar und nicht in einer Warnung versteckt, die erst nach dem Klick kommt.
 *
 * Vorher war das ein Aufklapper über der Bühne. Jetzt ist es der Inhalt eines
 * Abschnitts: Die neun Farbfelder sind klein genug, um dauernd zu stehen, und
 * der Griff, den man selten braucht — Farbe für alle Seiten, Foto dahinter —
 * liegt hinter einem Klapper darunter.
 */
import { useEffect, useState } from 'react';
import { B, T } from './theme.js';

interface Farbe {
  id: string;
  name: string;
  hex: string;
}

interface Kandidat {
  photoId: string;
  fileName: string;
  dpi: number;
  taugt: boolean;
}

interface BackgroundPickerProps {
  /** Doppelseite, die geändert wird. */
  spreadIndex: number;
  /** Farbe, die gerade global gilt. */
  global: string;
  /** Farbe, die auf dieser Doppelseite liegt – sie wird markiert. */
  aktuell?: string | undefined;
  onChanged: () => void;
}

export function BackgroundPicker({
  spreadIndex,
  global,
  aktuell,
  onChanged,
}: BackgroundPickerProps) {
  const [farben, setFarben] = useState<Farbe[]>([]);
  const [kandidaten, setKandidaten] = useState<Kandidat[]>([]);
  const [minDpi, setMinDpi] = useState(150);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/background')
      .then((r) => r.json())
      .then((d: { colors: Farbe[]; candidates: Kandidat[]; minDpi: number }) => {
        setFarben(d.colors);
        setKandidaten(d.candidates);
        setMinDpi(d.minDpi);
      })
      .catch((e: unknown) => setHinweis(String(e)));
  }, []);

  async function setzeSeite(patch: { color?: string | null; photoId?: string | null }) {
    const res = await fetch(`/api/spreads/${spreadIndex}/background`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = (await res.json()) as { hinweis?: string };
    setHinweis(d.hinweis ?? null);
    onChanged();
  }

  async function setzeGlobal(hex: string) {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ background: hex }),
    });
    setHinweis(null);
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
        {kandidaten.length === 0 ? (
          <p style={B.leiser}>keine Fotos vorhanden</p>
        ) : (
          <>
            <p style={B.leiser}>
              Die Doppelseite braucht {minDpi} dpi. Was der Bestand hergibt, steht dahinter — die
              besten zuerst.
            </p>
            <div style={S.liste}>
              {kandidaten.slice(0, 8).map((k) => (
                <button
                  key={k.photoId}
                  onClick={() => void setzeSeite({ photoId: k.photoId })}
                  title={k.fileName}
                  style={S.kandidat}
                >
                  <img src={`/api/photos/${k.photoId}/preview?size=thumb`} alt="" style={S.thumb} />
                  <span style={{ fontSize: 10, color: k.taugt ? T.ok : T.warn }}>{k.dpi} dpi</span>
                </button>
              ))}
            </div>
            <button onClick={() => void setzeSeite({ photoId: null })} style={B.knopfKlein}>
              kein Bild
            </button>
          </>
        )}
      </details>

      {hinweis && <p style={B.warnung}>{hinweis}</p>}
    </>
  );
}

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
  liste: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, margin: '4px 0 8px' },
  kandidat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
    border: `1px solid ${T.line}`,
    borderRadius: T.rSm,
    background: T.bg1,
    padding: 2,
    cursor: 'pointer',
  },
  thumb: { width: 42, height: 32, objectFit: 'cover' as const, display: 'block' },
} satisfies Record<string, React.CSSProperties>;
