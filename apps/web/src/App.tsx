import { useCallback, useEffect, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { MAX_TILT_DEG } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import { Overview } from './Overview.js';
import { LayoutEditor } from './LayoutEditor.js';
import { PhotoGroups } from './PhotoGroups.js';
import { PhotoSources } from './PhotoSources.js';
import { YearEvents } from './YearEvents.js';
import { BackgroundPicker } from './BackgroundPicker.js';
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

/**
 * Antwort auf `/api/spreads/:index`.
 *
 * `timelineOverride` gehört nicht zum Rendered Spread Model – es ist die
 * Entscheidung des Benutzers zu dieser Doppelseite und stellt nur den Schalter.
 */
type SpreadResponse = RenderedSpread & { timelineOverride?: boolean | null };

interface ProjectInfo {
  /** Die Ordner, aus denen das Buch gespeist wird. */
  sources: { id: string; label: string; root: string; erreichbar: boolean }[];
  /** Nur die Auflösungsschwellen: Der Editor bewertet damit jede Änderung sofort. */
  profile: { resolution: { minDpi: number; targetDpi: number } };
  settings: {
    targetPages: number;
    chapterOpeners: boolean;
    groupOpeners: boolean | 'auto';
    timeline: boolean;
    background: string;
    chapterColors: boolean;
    /** Stärkste Neigung der Bilder in Grad; 0 stellt alles gerade. */
    tilt: number;
    seed: number;
    birthDate?: string;
  };
  photoCount: number;
  spreadCount: number;
  skippedVideos: string[];
  failed: { file: string; reason: string }[];
  report: Report | null;
  /** Was ein Neuanordnen verwerfen würde. */
  handwork: { crops: number; neigungen: number; hintergruende: number; zeitstrahl: number };
  chapters: { year: number; photoCount: number; firstSpreadIndex: number }[];
  groupMarks: { spreadIndex: number; title: string }[];
  undatedCount: number;
}

type View = 'overview' | 'spread' | 'groups' | 'years' | 'sources' | 'edit';

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
  const [spread, setSpread] = useState<SpreadResponse | null>(null);
  // Zählt hoch, wenn sich am Rendern etwas ändert, ohne dass das Buch neu
  // erzeugt wurde. Die Übersicht hält geladene Doppelseiten selbst vor und
  // wird darüber verworfen.
  const [renderVersion, setRenderVersion] = useState(0);
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

  const hatZeitstrahl = spread?.timelineOverride !== false;

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
  }, [index, view, bare, renderVersion]);

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

  /**
   * Ändert eine Darstellungseinstellung.
   *
   * Anders als `regenerate` bleibt die Fotoverteilung unangetastet – es wird
   * nur neu gezeichnet. Für den Zeitstrahl ist das der Unterschied zwischen
   * einer Linie ein- und ausblenden und dem Verwerfen aller Korrekturen.
   */
  async function setSetting(patch: { timeline?: boolean; tilt?: number }) {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    loadInfo();
    setSpread(null);
    setRenderVersion((v) => v + 1);
  }

  /**
   * Liest alle Bildquellen erneut ein.
   *
   * Das Buch bleibt stehen – neue Fotos stehen danach im Fotopool. Ein
   * Neuanordnen ist ausdrücklich nicht Teil davon.
   */
  async function reimport() {
    setBusy('Lese Bilder neu ein …');
    setNote(null);
    try {
      const res = await fetch('/api/import', { method: 'POST' });
      const d = (await res.json()) as {
        neu: string[];
        verschwunden: string[];
        unveraendert: number;
        imBuchVerschwunden: string[];
        offline: { label: string; photoCount: number }[];
        photoCount: number;
      };
      loadInfo();
      setSpread(null);
      setRenderVersion((v) => v + 1);
      const teile = [
        `${d.photoCount} Fotos`,
        `${d.neu.length} neu`,
        `${d.unveraendert} unverändert`,
      ];
      if (d.verschwunden.length > 0) teile.push(`${d.verschwunden.length} verschwunden`);
      if (d.imBuchVerschwunden.length > 0) {
        teile.push(
          `davon ${d.imBuchVerschwunden.length} noch im Buch – dort bleibt der Platz leer`,
        );
      }
      // Eine übersprungene Quelle muss dranstehen, sonst liest sich „0 neu" wie
      // „nichts dazugekommen" statt wie „gar nicht nachgesehen".
      for (const q of d.offline ?? []) {
        teile.push(`„${q.label}" nicht erreichbar, ${q.photoCount} Fotos daraus unberührt`);
      }
      setNote(teile.join(', '));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Zeitstrahl dieser einen Doppelseite, abweichend von der Vorgabe. */
  async function setSpreadTimeline(value: boolean | null) {
    await fetch(`/api/spreads/${index}/timeline`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeline: value }),
    });
    setSpread(null);
    setRenderVersion((v) => v + 1);
  }

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
        {/*
          Eine nicht eingehängte Quelle fällt sonst erst auf, wenn Bilder im
          PDF fehlen – der Grundbestand liegt auf einem Netzlaufwerk.
        */}
        {info && info.sources.some((q) => !q.erreichbar) && (
          <button onClick={() => setView('sources')} style={S.warnung}>
            {info.sources.filter((q) => !q.erreichbar).length} Bildquelle(n) nicht erreichbar
          </button>
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
          <button onClick={() => setView('years')} style={view === 'years' ? S.tabActive : S.tab}>
            Jahre
          </button>
          <button
            onClick={() => setView('sources')}
            style={view === 'sources' ? S.tabActive : S.tab}
          >
            Bildquellen
          </button>
          <button onClick={() => setView('edit')} style={view === 'edit' ? S.tabActive : S.tab}>
            Aufteilung (JSON)
          </button>
        </div>
      </header>

      {report && <ReportBar report={report} undated={info?.undatedCount ?? 0} />}

      {view === 'years' && info ? (
        <YearEvents
          chapters={info.chapters}
          onOpen={(i) => {
            setIndex(i);
            setView('spread');
            // Die Auftaktseite hat sich geändert, also neu holen.
            setSpread(null);
            setRenderVersion((v) => v + 1);
          }}
        />
      ) : view === 'groups' ? (
        <PhotoGroups onChanged={loadInfo} />
      ) : view === 'sources' ? (
        <PhotoSources
          onChanged={() => {
            loadInfo();
            // Fotos können hinzugekommen oder weggefallen sein – die
            // gerenderte Doppelseite im Speicher gilt nicht weiter.
            setSpread(null);
            setRenderVersion((v) => v + 1);
          }}
        />
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

                {info && (
                  <BackgroundPicker
                    spreadIndex={index}
                    global={info.settings.background}
                    onChanged={() => {
                      loadInfo();
                      setSpread(null);
                      setRenderVersion((v) => v + 1);
                    }}
                  />
                )}

                {info?.settings.timeline && (
                  <label style={S.check} title="Nur diese Doppelseite">
                    <input
                      type="checkbox"
                      checked={hatZeitstrahl}
                      onChange={(e) => void setSpreadTimeline(e.target.checked ? null : false)}
                    />
                    Zeitstrahl
                  </label>
                )}

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
                <label style={S.check} title="Jeder Jahrgang bekommt eine eigene Hintergrundfarbe">
                  <input
                    type="checkbox"
                    checked={info.settings.chapterColors}
                    onChange={(e) => void regenerate({ chapterColors: e.target.checked })}
                  />
                  Jahresfarben
                </label>
                <label style={S.check}>
                  <input
                    type="checkbox"
                    checked={info.settings.timeline}
                    onChange={(e) => void setSetting({ timeline: e.target.checked })}
                  />
                  Zeitstrahl
                </label>
                {/*
                  Wie der Zeitstrahl eine reine Darstellungssache: Die Neigung
                  entsteht beim Rendern und rührt die Fotoverteilung nicht an.
                  Deshalb `setSetting` und nicht `regenerate` – sonst kostete
                  ein Dreh am Regler jede handgemachte Korrektur im Buch.
                */}
                <label style={S.check} title="Wie schief die Bilder auf den Seiten liegen">
                  Neigung
                  <input
                    type="range"
                    min={0}
                    max={MAX_TILT_DEG}
                    step={0.1}
                    value={info.settings.tilt}
                    onChange={(e) => void setSetting({ tilt: Number(e.target.value) })}
                    style={S.regler}
                  />
                  <span style={S.reglerWert}>
                    {info.settings.tilt === 0 ? 'aus' : `${info.settings.tilt.toFixed(1)}°`}
                  </span>
                </label>
                {/*
                  Dreiwertig: „wie Zeitstrahl" ist die Vorgabe und bedeutet das
                  Gegenteil von ihm – trägt der Zeitstrahl den Gruppentitel auf
                  jeder Doppelseite, kostet ein eigener Auftakt nur zwei Seiten,
                  ohne etwas hinzuzufügen. Anders als beim Zeitstrahl ändert
                  sich hier die Fotoverteilung, also wird neu erzeugt.
                */}
                <label style={S.check}>
                  Gruppenauftakte
                  <select
                    value={String(info.settings.groupOpeners)}
                    onChange={(e) =>
                      void regenerate({
                        groupOpeners:
                          e.target.value === 'auto' ? 'auto' : e.target.value === 'true',
                      })
                    }
                  >
                    <option value="auto">wie Zeitstrahl</option>
                    <option value="true">immer</option>
                    <option value="false">nie</option>
                  </select>
                </label>
                {/*
                  Der Knopf hieß „Anders anordnen", was zu harmlos klang: Er baut
                  das ganze Buch neu und verwirft dabei jede Handarbeit an den
                  Doppelseiten. Was verloren geht, steht jetzt daneben.
                */}
                <button
                  onClick={() => {
                    const h = info.handwork;
                    const verlust = [
                      h.crops > 0 ? `${h.crops} Ausschnitte` : null,
                      h.neigungen > 0 ? `${h.neigungen} von Hand gesetzte Neigungen` : null,
                      h.hintergruende > 0 ? `${h.hintergruende} Hintergründe` : null,
                      h.zeitstrahl > 0 ? `${h.zeitstrahl} Zeitstrahl-Ausnahmen` : null,
                    ].filter(Boolean);
                    if (
                      verlust.length > 0 &&
                      !window.confirm(
                        `Das Buch wird komplett neu gebaut. Verworfen werden: ${verlust.join(', ')}.\n\n` +
                          'Fotos, Datumskorrekturen, Gruppen und Jahresereignisse bleiben erhalten.',
                      )
                    ) {
                      return;
                    }
                    void regenerate({ seed: info.settings.seed + 1 });
                  }}
                  title="Baut das Buch neu und wählt andere Vorlagen. Bilder werden nicht neu eingelesen."
                  style={S.button}
                >
                  Buch neu anordnen
                  {info.handwork.crops +
                    info.handwork.neigungen +
                    info.handwork.hintergruende +
                    info.handwork.zeitstrahl >
                    0 && ' ⚠'}
                </button>
                <button
                  onClick={() => void reimport()}
                  disabled={!!busy}
                  title="Liest den Quellordner erneut ein. Das Buch bleibt stehen, neue Fotos landen im Fotopool."
                  style={S.button}
                >
                  Bilder neu einlesen
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
                key={renderVersion}
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
  warnung: {
    font: 'inherit',
    fontSize: '0.8rem',
    color: '#b45309',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: 4,
    padding: '0.2rem 0.5rem',
    cursor: 'pointer',
  },
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
  regler: { width: '80px' },
  reglerWert: {
    fontVariantNumeric: 'tabular-nums' as const,
    color: '#6b7280',
    minWidth: '2.4rem',
  },
  note: { fontSize: '0.8125rem', color: '#065f46', fontFamily: 'ui-monospace, monospace' },
  stage: {
    margin: '1.5rem 0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
    lineHeight: 0,
  },
} satisfies Record<string, React.CSSProperties>;
