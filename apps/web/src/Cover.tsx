/**
 * Coveransicht.
 *
 * Der Umschlag als flach liegender Bogen, dazu die Zahlen, die man beim Cover
 * wirklich braucht: Rückenbreite, Bogenmaß und die Seitenzahl, aus der beides
 * folgt. Die Gelenkzonen sind standardmäßig eingeblendet – sie sind der eine
 * Ort, an dem der Bildschirm nicht zeigt, was der Druck macht.
 *
 * Erreichbar über `?cover` (siehe `main.tsx`). Ein eigener Reiter neben
 * „Übersicht" und „Doppelseite" gehört in `App.tsx`, sobald dort nicht
 * parallel gearbeitet wird – Modell, Renderer und Endpunkte sind davon
 * unabhängig.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverDesign, RenderedCover } from '@franibook/core';
import { CoverView, type CoverGuideVisibility } from '@franibook/render-dom';

interface CoverAntwort {
  design: CoverDesign;
  cover: RenderedCover;
  candidates: { photoId: string; label: string }[];
  hints: string[];
  profileVerified: boolean;
}

const FELDER = [
  { key: 'title', label: 'Titel (Vorderseite)' },
  { key: 'subtitle', label: 'Untertitel' },
  { key: 'spineText', label: 'Buchrücken' },
  { key: 'backText', label: 'Rückseite' },
] as const;

const SCHALTER = [
  { key: 'hinge', label: 'Gelenk & Rücken' },
  { key: 'fold', label: 'Falzlinien' },
  { key: 'wrap', label: 'Sichtbare Kante' },
  { key: 'safety', label: 'Sicherheit' },
  { key: 'bleed', label: 'Beschnitt' },
  { key: 'diagnostics', label: 'Diagnose' },
] as const;

export function Cover({ imageSrc }: { imageSrc: (photoId: string) => string }) {
  const [data, setData] = useState<CoverAntwort | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [guides, setGuides] = useState<CoverGuideVisibility>({ hinge: true, diagnostics: true });

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1200);

  const load = useCallback(() => {
    fetch('/api/cover')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  async function patch(feld: keyof CoverDesign, wert: string) {
    try {
      const res = await fetch('/api/cover', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [feld]: wert }),
      });
      setData(await res.json());
    } catch (e) {
      setNote(`Fehler: ${String(e)}`);
    }
  }

  async function exportCover() {
    setBusy('Exportiere Umschlag …');
    setNote(null);
    try {
      const res = await fetch('/api/export/cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const r = await res.json();
      setNote(
        `${r.outputPath} — ${r.widthMm.toFixed(1)} × ${r.heightMm.toFixed(1)} mm, ` +
          `Rücken ${r.spineMm.toFixed(1)} mm bei ${r.pageCount} Seiten`,
      );
    } catch (e) {
      setNote(`Fehler: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p style={{ color: '#b91c1c' }}>Fehler: {error}</p>;
  if (!data) return <p style={S.muted}>Lade Umschlag …</p>;

  const geo = data.cover.geometry;

  return (
    <div>
      <div style={S.stats}>
        <Stat label="Buchrücken" value={`${geo.spineMm.toFixed(1)} mm`} />
        <Stat label="Seiten" value={String(geo.pageCount)} />
        <Stat label="Bogen" value={`${geo.widthMm.toFixed(1)} × ${geo.heightMm.toFixed(1)} mm`} />
        <Stat label="Gelenkzone" value={`${geo.hingeMm} mm je Seite`} />
        <Stat label="Umschlag" value={`${geo.wrapMm} mm`} />
      </div>

      {data.hints.length > 0 && (
        <ul style={S.hints}>
          {data.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      <div style={S.toolbar}>
        {SCHALTER.map((s) => (
          <label key={s.key} style={S.check}>
            <input
              type="checkbox"
              checked={guides[s.key] ?? false}
              onChange={(e) => setGuides((g) => ({ ...g, [s.key]: e.target.checked }))}
            />
            {s.label}
          </label>
        ))}
        <span style={S.spacer} />
        <button onClick={() => void exportCover()} disabled={!!busy} style={S.buttonPrimary}>
          Umschlag als PDF
        </button>
      </div>

      {(busy || note) && <p style={S.note}>{busy ?? note}</p>}

      <div ref={stageRef} style={S.stage}>
        <CoverView cover={data.cover} widthPx={stageWidth} imageSrc={imageSrc} guides={guides} />
      </div>
      <p style={S.muted}>
        Links die Rückseite, in der Mitte der Buchrücken, rechts die Vorderseite. Die roten Bänder
        sind die Gelenkzonen.
      </p>

      <div style={S.editor}>
        {FELDER.map((f) => (
          <label key={f.key} style={S.field}>
            <span style={S.fieldLabel}>{f.label}</span>
            <input
              defaultValue={data.design[f.key] ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (data.design[f.key] ?? ''))
                  void patch(f.key, e.target.value);
              }}
              style={S.input}
            />
          </label>
        ))}
      </div>

      <h2 style={S.h2}>Titelbild</h2>
      <div style={S.candidates}>
        {data.candidates.map((c) => (
          <button
            key={c.photoId}
            onClick={() => void patch('frontPhotoId', c.photoId)}
            title={c.label}
            style={{
              ...S.candidate,
              borderColor: c.photoId === data.design.frontPhotoId ? '#2563eb' : '#e5e7eb',
            }}
          >
            <img src={imageSrc(c.photoId)} alt={c.label} style={S.thumb} />
            <span style={S.thumbLabel}>{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.stat}>
      <span style={S.statLabel}>{label}</span>
      <span style={S.statValue}>{value}</span>
    </div>
  );
}

const S = {
  muted: { color: '#6b7280', fontSize: '0.875rem' },
  spacer: { flex: 1 },
  stats: {
    display: 'flex',
    gap: '2rem',
    padding: '0.75rem 1rem',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    flexWrap: 'wrap' as const,
  },
  stat: { display: 'flex', flexDirection: 'column' as const, gap: '0.1rem' },
  statLabel: {
    fontSize: '0.6875rem',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  statValue: { fontSize: '1.05rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const },
  hints: {
    margin: '0.75rem 0 0',
    paddingLeft: '1.1rem',
    fontSize: '0.8125rem',
    color: '#b45309',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 0',
    marginTop: '0.75rem',
    borderTop: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.8125rem',
    color: '#374151',
  },
  buttonPrimary: {
    padding: '0.35rem 0.9rem',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  },
  note: { fontSize: '0.8125rem', color: '#065f46', fontFamily: 'ui-monospace, monospace' },
  stage: {
    margin: '1.5rem 0 0.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
    lineHeight: 0,
  },
  editor: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
    gap: '0.75rem',
    marginTop: '1.5rem',
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '0.2rem' },
  fieldLabel: { fontSize: '0.6875rem', color: '#6b7280' },
  input: {
    padding: '0.3rem 0.45rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.875rem',
  },
  h2: { fontSize: '0.9rem', fontWeight: 600, margin: '1.5rem 0 0.5rem' },
  candidates: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const },
  candidate: {
    padding: '2px',
    border: '2px solid #e5e7eb',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.15rem',
    width: '6.5rem',
  },
  thumb: { width: '100%', height: '4.5rem', objectFit: 'cover' as const, display: 'block' },
  thumbLabel: {
    fontSize: '0.625rem',
    color: '#6b7280',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};
