import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';

interface ProjectInfo {
  sourceRoot: string;
  photoCount: number;
  spreadCount: number;
  skippedVideos: string[];
  failed: { file: string; reason: string }[];
}

/**
 * Bildquelle der Vorschau.
 *
 * Standardmäßig das gecachte Vorschaubild. Der Parity-Test schaltet über
 * `?original=1` auf die Originaldatei um – sonst würde er WebP-Kompression
 * gegen JPEG-Kompression messen statt Geometrie gegen Geometrie.
 */
function useImageSrc() {
  const useOriginal = new URLSearchParams(location.search).has('original');
  return useCallback(
    (photoId: string) =>
      useOriginal ? `/api/photos/${photoId}/original` : `/api/photos/${photoId}/preview`,
    [useOriginal],
  );
}

export function App() {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [spread, setSpread] = useState<RenderedSpread | null>(null);
  const [index, setIndex] = useState(() => {
    const p = new URLSearchParams(location.search).get('spread');
    return p ? Number(p) : 0;
  });
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  const bare = new URLSearchParams(location.search).has('bare');
  const [guides, setGuides] = useState<GuideVisibility>(() =>
    bare ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
  );

  const imageSrc = useImageSrc();
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1200);

  useEffect(() => {
    fetch('/api/project')
      .then((r) => r.json())
      .then(setInfo)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    setSpread(null);
    fetch(`/api/spreads/${index}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpread)
      .catch((e: unknown) => setError(String(e)));
  }, [index]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spread]);

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, (info?.spreadCount ?? 1) - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'g')
        setGuides((g) =>
          g.trim ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
        );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bare, info?.spreadCount]);

  async function exportPdf() {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spreadIndex: index }),
      });
      const data = await res.json();
      setExportResult(data.outputPath ?? JSON.stringify(data));
    } catch (e) {
      setExportResult(`Fehler: ${String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <main style={S.page}>
        <p style={{ color: '#b91c1c' }}>Fehler: {error}</p>
        <p style={S.muted}>Läuft der Server? `pnpm --filter @franibook/server dev`</p>
      </main>
    );
  }

  // Der Parity-Test rendert die Doppelseite ohne jedes Beiwerk, in exakt der
  // Pixelgröße, die er mit dem gerasterten PDF vergleicht.
  if (bare) {
    return spread ? (
      <SpreadView
        spread={spread}
        widthPx={Number(new URLSearchParams(location.search).get('width') ?? 1200)}
        imageSrc={imageSrc}
        guides={{}}
      />
    ) : null;
  }

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.title}>Franibook</h1>
        {info && (
          <span style={S.muted}>
            {info.photoCount} Fotos · {info.spreadCount} Doppelseiten
            {info.skippedVideos.length > 0 && ` · ${info.skippedVideos.length} Videos übersprungen`}
          </span>
        )}
      </header>

      <div style={S.toolbar}>
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          style={S.button}
        >
          ←
        </button>
        <span style={S.counter}>
          {index + 1} / {info?.spreadCount ?? '…'}
        </span>
        <button
          onClick={() => setIndex((i) => Math.min(i + 1, (info?.spreadCount ?? 1) - 1))}
          disabled={!info || index >= info.spreadCount - 1}
          style={S.button}
        >
          →
        </button>

        <span style={S.spacer} />

        {(['trim', 'safety', 'gutter', 'diagnostics'] as const).map((k) => (
          <label key={k} style={S.check}>
            <input
              type="checkbox"
              checked={guides[k] ?? false}
              onChange={(e) => setGuides((g) => ({ ...g, [k]: e.target.checked }))}
            />
            {LABELS[k]}
          </label>
        ))}

        <span style={S.spacer} />

        <button onClick={exportPdf} disabled={exporting} style={S.buttonPrimary}>
          {exporting ? 'Exportiere …' : 'Diese Doppelseite als PDF'}
        </button>
      </div>

      {exportResult && <p style={S.result}>{exportResult}</p>}

      <div ref={stageRef} style={S.stage}>
        {spread ? (
          <SpreadView spread={spread} widthPx={stageWidth} imageSrc={imageSrc} guides={guides} />
        ) : (
          <p style={S.muted}>Lade Doppelseite …</p>
        )}
      </div>

      <p style={S.muted}>
        Pfeiltasten blättern, <kbd>g</kbd> schaltet die Hilfslinien.
      </p>
    </main>
  );
}

const LABELS = {
  trim: 'Endformat',
  safety: 'Sicherheit',
  gutter: 'Falz',
  diagnostics: 'Diagnose',
} as const;

const S = {
  page: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '1.5rem 2rem',
    maxWidth: '1400px',
    margin: '0 auto',
    color: '#111827',
  },
  header: { display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem' },
  title: { fontSize: '1.25rem', fontWeight: 600, margin: 0 },
  muted: { color: '#6b7280', fontSize: '0.875rem' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 0',
    borderTop: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  },
  spacer: { flex: 1 },
  button: {
    padding: '0.35rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
  },
  buttonPrimary: {
    padding: '0.35rem 0.9rem',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  },
  counter: {
    fontVariantNumeric: 'tabular-nums',
    fontSize: '0.875rem',
    minWidth: '5rem',
    textAlign: 'center' as const,
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.8125rem',
    color: '#374151',
  },
  result: { fontSize: '0.8125rem', color: '#065f46', fontFamily: 'ui-monospace, monospace' },
  stage: {
    margin: '1.5rem 0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
    lineHeight: 0,
  },
} satisfies Record<string, React.CSSProperties>;
