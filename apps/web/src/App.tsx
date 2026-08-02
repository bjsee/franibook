import { useCallback, useEffect, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import { Overview } from './Overview.js';
import { LayoutEditor } from './LayoutEditor.js';
import { PhotoGroups } from './PhotoGroups.js';
import { SpreadEditor } from './SpreadEditor.js';

interface Report {
  photoCount: number;
  placedCount: number;
  spreadCount: number;
  pageCount: number;
  targetPages: number;
  photosPerSpread: number;
  worstDpi: number;
  belowTargetDpi: number;
  belowMinDpi: { photoId: string; spreadIndex: number; slotId: string; dpi: number }[];
  feasibility: { achievable: boolean; minimumPages: number; maxPerSpread: number; hint?: string };
}

interface ProjectInfo {
  sourceRoot: string;
  /** Nur die Auflösungsschwellen: Der Editor bewertet damit jede Änderung sofort. */
  profile: { resolution: { minDpi: number; targetDpi: number } };
  settings: {
    targetPages: number;
    chapterOpeners: boolean;
    groupOpeners: boolean;
    seed: number;
    birthDate?: string;
  };
  photoCount: number;
  spreadCount: number;
  skippedVideos: string[];
  failed: { file: string; reason: string }[];
  report: Report | null;
  chapters: { year: number; photoCount: number; firstSpreadIndex: number }[];
  groupMarks: { spreadIndex: number; title: string }[];
  undatedCount: number;
}

type View = 'overview' | 'spread' | 'groups' | 'edit';

/**
 * Bildquelle. Der Parity-Test schaltet über `?original=1` auf die Originale
 * um – sonst würde er WebP-Kompression gegen JPEG-Kompression messen statt
 * Geometrie gegen Geometrie.
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
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).has('spread') ? 'spread' : 'overview',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Ausgewählter Slot. Liegt hier und nicht im Editor, weil er die
   * Tastenbelegung umschaltet: Solange ein Slot gewählt ist, justieren die
   * Pfeiltasten den Ausschnitt statt zu blättern.
   */
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const bare = new URLSearchParams(location.search).has('bare');
  const [guides, setGuides] = useState<GuideVisibility>(() =>
    bare ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
  );

  const imageSrc = useImageSrc();

  const loadInfo = useCallback(() => {
    fetch('/api/project')
      .then((r) => r.json())
      .then(setInfo)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(loadInfo, [loadInfo]);

  useEffect(() => {
    if (view !== 'spread' && !bare) return;
    setSpread(null);
    fetch(`/api/spreads/${index}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpread)
      .catch((e: unknown) => setError(String(e)));
  }, [index, view, bare]);

  // Beim Blättern gilt die Auswahl nicht weiter: Slotkennungen wiederholen
  // sich zwar von Doppelseite zu Doppelseite, gemeint war aber dieses Bild.
  useEffect(() => setSelectedSlotId(null), [index]);

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      if (view === 'spread') {
        // Ist ein Slot gewählt, gehören die Pfeiltasten dem Ausschnitt-Editor.
        if (!selectedSlotId) {
          if (e.key === 'ArrowRight')
            setIndex((i) => Math.min(i + 1, (info?.spreadCount ?? 1) - 1));
          if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
        }
        if (e.key === 'Escape') {
          if (selectedSlotId) setSelectedSlotId(null);
          else setView('overview');
        }
      }
      if (e.key === 'g') {
        setGuides((g) =>
          g.trim ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bare, info?.spreadCount, view, selectedSlotId]);

  async function regenerate(patch: Record<string, unknown>) {
    setBusy('Erzeuge Buch neu …');
    setNote(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      loadInfo();
      setSpread(null);
      const r: Report = data.report;
      setNote(
        `${r.spreadCount} Doppelseiten, ${r.pageCount} Seiten, ` +
          `${r.photosPerSpread.toFixed(1)} Fotos je Doppelseite`,
      );
    } catch (e) {
      setNote(`Fehler: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function exportPdf(all: boolean) {
    setBusy(all ? 'Exportiere ganzes Buch …' : 'Exportiere Doppelseite …');
    setNote(null);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(all ? {} : { spreadIndex: index }),
      });
      const data = await res.json();
      setNote(`${data.outputPath} — ${data.pages} Seiten, ${data.images} Bilder`);
    } catch (e) {
      setNote(`Fehler: ${String(e)}`);
    } finally {
      setBusy(null);
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

  // Der Parity-Test rendert die Doppelseite ohne jedes Beiwerk.
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

  const report = info?.report;

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.title}>Franibook</h1>
        {info && (
          <span style={S.muted}>
            {info.photoCount} Fotos · {info.spreadCount} Doppelseiten
            {report && ` · ${report.pageCount} Seiten`}
          </span>
        )}
        <span style={S.spacer} />
        <div style={S.tabs}>
          <button
            onClick={() => setView('overview')}
            style={view === 'overview' ? S.tabActive : S.tab}
          >
            Übersicht
          </button>
          <button onClick={() => setView('spread')} style={view === 'spread' ? S.tabActive : S.tab}>
            Doppelseite
          </button>
          <button onClick={() => setView('groups')} style={view === 'groups' ? S.tabActive : S.tab}>
            Gruppen
          </button>
          <button onClick={() => setView('edit')} style={view === 'edit' ? S.tabActive : S.tab}>
            Aufteilung (JSON)
          </button>
        </div>
      </header>

      {report && <ReportBar report={report} undated={info?.undatedCount ?? 0} />}

      {view === 'groups' ? (
        <PhotoGroups onChanged={loadInfo} />
      ) : view === 'edit' ? (
        <LayoutEditor
          imageSrc={imageSrc}
          onApplied={() => {
            loadInfo();
            setSpread(null);
          }}
        />
      ) : (
        <>
          <div style={S.toolbar}>
            {view === 'spread' && (
              <>
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
              </>
            )}

            {view === 'overview' && info && (
              <>
                <label style={S.check}>
                  Seiten
                  <input
                    type="number"
                    min={24}
                    max={400}
                    step={2}
                    defaultValue={info.settings.targetPages}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== info.settings.targetPages) void regenerate({ targetPages: v });
                    }}
                    style={S.number}
                  />
                </label>
                <label style={S.check}>
                  <input
                    type="checkbox"
                    checked={info.settings.chapterOpeners}
                    onChange={(e) => void regenerate({ chapterOpeners: e.target.checked })}
                  />
                  Jahresauftakte
                </label>
                <button
                  onClick={() => void regenerate({ seed: info.settings.seed + 1 })}
                  style={S.button}
                >
                  Anders anordnen
                </button>
              </>
            )}

            <span style={S.spacer} />

            <button
              onClick={() => void exportPdf(view === 'overview')}
              disabled={!!busy}
              style={S.buttonPrimary}
            >
              {view === 'overview' ? 'Ganzes Buch als PDF' : 'Diese Doppelseite als PDF'}
            </button>
          </div>

          {(busy || note) && <p style={S.note}>{busy ?? note}</p>}

          {view === 'overview' && info ? (
            <div style={{ marginTop: '1.5rem' }}>
              <Overview
                spreadCount={info.spreadCount}
                chapters={info.chapters}
                imageSrc={imageSrc}
                onOpen={(i) => {
                  setIndex(i);
                  setView('spread');
                }}
              />
            </div>
          ) : (
            <>
              {spread && info ? (
                <SpreadEditor
                  index={index}
                  spread={spread}
                  onSpread={setSpread}
                  imageSrc={imageSrc}
                  guides={guides}
                  minDpi={info.profile.resolution.minDpi}
                  targetDpi={info.profile.resolution.targetDpi}
                  selectedSlotId={selectedSlotId}
                  onSelect={setSelectedSlotId}
                  onChanged={loadInfo}
                />
              ) : (
                <div style={S.stage}>
                  <p style={S.muted}>Lade Doppelseite …</p>
                </div>
              )}
              <p style={S.muted}>
                Pfeiltasten blättern, <kbd>g</kbd> schaltet die Hilfslinien, <kbd>Esc</kbd> zur
                Übersicht.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}

function ReportBar({ report, undated }: { report: Report; undated: number }) {
  const probleme: string[] = [];
  if (!report.feasibility.achievable) probleme.push(report.feasibility.hint ?? '');
  if (report.belowMinDpi.length > 0) {
    probleme.push(
      `${report.belowMinDpi.length} Bilder unter der Mindestauflösung ` +
        `(schlechtestes ${Math.round(report.worstDpi)} dpi) — für den Druck zu klein`,
    );
  }
  if (undated > 0) probleme.push(`${undated} Fotos ohne Datum, nicht im Buch`);
  const nichtPlatziert = report.photoCount - report.placedCount - undated;
  if (nichtPlatziert > 0) probleme.push(`${nichtPlatziert} Fotos nicht platziert`);

  return (
    <div style={S.reportBar}>
      <Stat label="Fotos im Buch" value={String(report.placedCount)} />
      <Stat label="je Doppelseite" value={report.photosPerSpread.toFixed(1)} />
      <Stat
        label="Ziel"
        value={`${report.pageCount} / ${report.targetPages} S.`}
        warn={Math.abs(report.pageCount - report.targetPages) > report.targetPages * 0.15}
      />
      <Stat
        label="schlechteste Auflösung"
        value={`${Math.round(report.worstDpi)} dpi`}
        warn={report.belowMinDpi.length > 0}
      />
      {probleme.length > 0 && (
        <ul style={S.problems}>
          {probleme.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={S.stat}>
      <span style={S.statLabel}>{label}</span>
      <span style={{ ...S.statValue, color: warn ? '#b45309' : '#111827' }}>{value}</span>
    </div>
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
    padding: '1.5rem 2rem 4rem',
    maxWidth: '1500px',
    margin: '0 auto',
    color: '#111827',
  },
  header: { display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem' },
  title: { fontSize: '1.25rem', fontWeight: 600, margin: 0 },
  muted: { color: '#6b7280', fontSize: '0.875rem' },
  spacer: { flex: 1 },
  tabs: { display: 'flex', gap: '0.25rem' },
  tab: {
    padding: '0.3rem 0.8rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  tabActive: {
    padding: '0.3rem 0.8rem',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    fontWeight: 600,
  },
  reportBar: {
    display: 'flex',
    gap: '2rem',
    alignItems: 'flex-start',
    padding: '0.75rem 1rem',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    flexWrap: 'wrap' as const,
    marginBottom: '0.75rem',
  },
  stat: { display: 'flex', flexDirection: 'column' as const, gap: '0.1rem' },
  statLabel: {
    fontSize: '0.6875rem',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  statValue: { fontSize: '1.05rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const },
  problems: {
    margin: 0,
    paddingLeft: '1.1rem',
    fontSize: '0.8125rem',
    color: '#b45309',
    flex: 1,
    minWidth: '18rem',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 0',
    borderTop: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  },
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
  number: {
    width: '4.5rem',
    padding: '0.2rem 0.35rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
  },
  counter: {
    fontVariantNumeric: 'tabular-nums' as const,
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
  note: { fontSize: '0.8125rem', color: '#065f46', fontFamily: 'ui-monospace, monospace' },
  stage: {
    margin: '1.5rem 0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
    lineHeight: 0,
  },
} satisfies Record<string, React.CSSProperties>;
