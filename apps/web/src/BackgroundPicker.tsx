/**
 * Hintergrund wählen: Farbe für alle Seiten oder für diese eine, wahlweise ein
 * Foto.
 *
 * Die Farben kommen aus dem Kern (`render/background.ts`) und nicht aus einem
 * Farbwähler: Freie Farbwahl hinter Fotos geht in einem Fotobuch fast immer
 * schief, und eine Palette macht den Fehler unmöglich, statt ihn zu erlauben.
 *
 * Beim Bild steht die Auflösung dabei, mit der es die Doppelseite abdecken
 * würde. Bei diesem Bestand reicht sie praktisch nie – deshalb ist die Zahl
 * sichtbar und nicht in einer Warnung versteckt, die erst nach dem Klick kommt.
 */
import { useEffect, useState } from 'react';

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
  onChanged: () => void;
}

export function BackgroundPicker({ spreadIndex, global, onChanged }: BackgroundPickerProps) {
  const [farben, setFarben] = useState<Farbe[]>([]);
  const [kandidaten, setKandidaten] = useState<Kandidat[]>([]);
  const [minDpi, setMinDpi] = useState(150);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    if (!offen) return;
    fetch('/api/background')
      .then((r) => r.json())
      .then((d: { colors: Farbe[]; candidates: Kandidat[]; minDpi: number }) => {
        setFarben(d.colors);
        setKandidaten(d.candidates);
        setMinDpi(d.minDpi);
      })
      .catch((e: unknown) => setHinweis(String(e)));
  }, [offen]);

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

  if (!offen) {
    return (
      <button onClick={() => setOffen(true)} style={S.knopf}>
        Hintergrund …
      </button>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.kopf}>
        <strong style={S.titel}>Hintergrund</strong>
        <button onClick={() => setOffen(false)} style={S.schliessen}>
          ×
        </button>
      </div>

      <p style={S.label}>Farbe für diese Doppelseite</p>
      <div style={S.reihe}>
        {farben.map((f) => (
          <button
            key={f.id}
            title={f.name}
            onClick={() => void setzeSeite({ color: f.hex, photoId: null })}
            style={{ ...S.feld, background: f.hex }}
          />
        ))}
        <button onClick={() => void setzeSeite({ color: null })} style={S.zurueck}>
          wie Vorgabe
        </button>
      </div>

      <p style={S.label}>Für alle Seiten</p>
      <div style={S.reihe}>
        {farben.map((f) => (
          <button
            key={f.id}
            title={f.name}
            onClick={() => void setzeGlobal(f.hex)}
            style={{
              ...S.feld,
              background: f.hex,
              ...(f.hex.toLowerCase() === global.toLowerCase() ? S.gewaehlt : {}),
            }}
          />
        ))}
      </div>

      <p style={S.label}>Foto als Hintergrund</p>
      {kandidaten.length === 0 ? (
        <p style={S.hinweis}>keine Fotos vorhanden</p>
      ) : (
        <>
          <p style={S.hinweis}>
            Die Doppelseite braucht {minDpi} dpi. Was der Bestand hergibt, steht dahinter — die
            besten zuerst.
          </p>
          <div style={S.liste}>
            {kandidaten.slice(0, 8).map((k) => (
              <button
                key={k.photoId}
                onClick={() => void setzeSeite({ photoId: k.photoId })}
                style={S.kandidat}
              >
                <img src={`/api/photos/${k.photoId}/preview?size=thumb`} alt="" style={S.thumb} />
                <span style={k.taugt ? S.dpiOk : S.dpiSchwach}>{k.dpi} dpi</span>
              </button>
            ))}
          </div>
          <button onClick={() => void setzeSeite({ photoId: null })} style={S.zurueck}>
            kein Bild
          </button>
        </>
      )}

      {hinweis && <p style={S.warnung}>{hinweis}</p>}
    </div>
  );
}

const S = {
  knopf: {
    font: 'inherit',
    fontSize: '0.85rem',
    padding: '0.25rem 0.6rem',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
  },
  wrap: {
    position: 'absolute' as const,
    zIndex: 20,
    top: '2.5rem',
    right: '1rem',
    width: '21rem',
    padding: '0.75rem 0.9rem',
    background: '#fff',
    border: '1px solid #d4d4d8',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  },
  kopf: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  titel: { fontSize: '0.9rem' },
  schliessen: {
    border: 'none',
    background: 'none',
    fontSize: '1.1rem',
    cursor: 'pointer',
    lineHeight: 1,
  },
  label: { margin: '0.7rem 0 0.3rem', fontSize: '0.78rem', color: '#52525b' },
  reihe: { display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' as const },
  feld: {
    width: '1.5rem',
    height: '1.5rem',
    border: '1px solid #a1a1aa',
    borderRadius: 3,
    cursor: 'pointer',
    padding: 0,
  },
  gewaehlt: { outline: '2px solid #2563eb', outlineOffset: 1 },
  zurueck: {
    font: 'inherit',
    fontSize: '0.75rem',
    padding: '0.15rem 0.45rem',
    border: '1px solid #d4d4d8',
    borderRadius: 3,
    background: '#fff',
    cursor: 'pointer',
  },
  liste: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap' as const, marginBottom: '0.4rem' },
  kandidat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
    border: '1px solid #e4e4e7',
    borderRadius: 3,
    background: '#fff',
    padding: 2,
    cursor: 'pointer',
  },
  thumb: { width: '2.6rem', height: '2rem', objectFit: 'cover' as const, display: 'block' },
  dpiOk: { fontSize: '0.65rem', color: '#166534' },
  dpiSchwach: { fontSize: '0.65rem', color: '#b45309' },
  hinweis: { margin: '0 0 0.4rem', fontSize: '0.75rem', color: '#71717a' },
  warnung: {
    margin: '0.6rem 0 0',
    fontSize: '0.75rem',
    color: '#92400e',
    background: '#fffbeb',
    padding: '0.35rem 0.5rem',
    borderRadius: 4,
  },
} satisfies Record<string, React.CSSProperties>;
