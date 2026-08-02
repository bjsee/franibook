/**
 * Editor für die Buchaufteilung.
 *
 * Zwei Hälften: links das JSON zum Bearbeiten, rechts die Doppelseite, in der
 * gerade der Cursor steht, samt Metadaten der Bilder. Die Vorschau folgt dem
 * Cursor – ohne sie wäre das Umhängen ein Blindflug durch Dateinamen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';

interface LayoutIssue {
  severity: 'error' | 'warning';
  spread?: number;
  message: string;
}

interface ApplyResult {
  ok: boolean;
  issues: LayoutIssue[];
  problems: { index: number; photoCount: number; message: string }[];
  spreadCount: number;
}

interface PhotoEntry {
  file: string;
  date?: string;
  gps?: string;
  map?: string;
  camera?: string;
  px?: string;
  dpi?: number;
  warn?: string;
}

interface LayoutDoc {
  summary?: { spreads: number; pages: number; photos: number; photosPerSpread: number };
  spreads?: { n: number; template?: string; text?: string; photos: PhotoEntry[] }[];
  unplaced?: PhotoEntry[];
}

interface Props {
  imageSrc: (photoId: string) => string;
  onApplied: () => void;
}

export function LayoutEditor({ imageSrc, onApplied }: Props) {
  const [text, setText] = useState('');
  const [doc, setDoc] = useState<LayoutDoc | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursorSpread, setCursorSpread] = useState(0);
  const [preview, setPreview] = useState<RenderedSpread | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    setBusy(true);
    fetch('/api/book/layout')
      .then((r) => r.json())
      .then((d) => {
        setText(JSON.stringify(d, null, 2));
        setDoc(d);
        setResult(null);
        setParseError(null);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(load, [load]);

  // Bei jeder Änderung neu einlesen, damit die rechte Seite mitläuft.
  useEffect(() => {
    if (!text) return;
    try {
      setDoc(JSON.parse(text));
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }, [text]);

  useEffect(() => {
    fetch(`/api/spreads/${cursorSpread}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [cursorSpread]);

  /**
   * Welche Doppelseite steht unter dem Cursor?
   *
   * Ausgewertet wird die Zahl im nächstgelegenen `"n":`-Feld oberhalb der
   * Cursorposition. Das ist grob, kommt aber ohne einen vollwertigen Parser
   * mit Positionsangaben aus.
   */
  function updateCursor() {
    const area = areaRef.current;
    if (!area) return;
    const bisCursor = area.value.slice(0, area.selectionStart);
    const treffer = [...bisCursor.matchAll(/"n":\s*(\d+)/g)];
    const letzte = treffer.at(-1);
    if (letzte) setCursorSpread(Math.max(0, Number(letzte[1]) - 1));
  }

  async function apply() {
    if (parseError) return;
    setBusy(true);
    try {
      const res = await fetch('/api/book/layout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
      });
      const data: ApplyResult = await res.json();
      setResult(data);
      if (data.ok) onApplied();
    } catch (e) {
      setResult({
        ok: false,
        issues: [{ severity: 'error', message: String(e) }],
        problems: [],
        spreadCount: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'franibook-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadFile(file: File) {
    setText(await file.text());
  }

  const aktuelleSeite = useMemo(
    () => doc?.spreads?.find((s) => s.n === cursorSpread + 1),
    [doc, cursorSpread],
  );

  const fehler = result?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnungen = result?.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <div style={S.wrap}>
      <div style={S.toolbar}>
        <button onClick={load} disabled={busy} style={S.button}>
          Neu laden
        </button>
        <button onClick={download} style={S.button}>
          Als Datei speichern
        </button>
        <label style={{ ...S.button, cursor: 'pointer' }}>
          Datei öffnen
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
          />
        </label>
        <span style={S.spacer} />
        {parseError ? (
          <span style={S.parseError}>JSON ungültig: {parseError}</span>
        ) : (
          doc?.summary && (
            <span style={S.muted}>
              {doc.spreads?.length ?? 0} Doppelseiten ·{' '}
              {doc.spreads?.reduce((n, s) => n + s.photos.length, 0) ?? 0} Bilder
              {doc.unplaced?.length ? ` · ${doc.unplaced.length} außen vor` : ''}
            </span>
          )
        )}
        <button
          onClick={() => void apply()}
          disabled={busy || !!parseError}
          style={S.buttonPrimary}
        >
          {busy ? 'Übernehme …' : 'Übernehmen'}
        </button>
      </div>

      {result && (
        <div style={result.ok ? S.resultOk : S.resultBad}>
          {result.ok ? (
            <strong>Übernommen: {result.spreadCount} Doppelseiten.</strong>
          ) : (
            <strong>Nicht übernommen.</strong>
          )}
          {result.problems.length > 0 && (
            <ul style={S.list}>
              {result.problems.map((p) => (
                <li key={p.index}>
                  Doppelseite {p.index}: {p.message}
                </li>
              ))}
            </ul>
          )}
          {fehler.length > 0 && (
            <ul style={S.list}>
              {fehler.slice(0, 12).map((i, k) => (
                <li key={k}>
                  {i.spread ? `Doppelseite ${i.spread}: ` : ''}
                  {i.message}
                </li>
              ))}
              {fehler.length > 12 && <li>… und {fehler.length - 12} weitere</li>}
            </ul>
          )}
          {warnungen.length > 0 && (
            <details>
              <summary style={S.muted}>{warnungen.length} Hinweise</summary>
              <ul style={S.list}>
                {warnungen.slice(0, 12).map((i, k) => (
                  <li key={k}>
                    {i.spread ? `Doppelseite ${i.spread}: ` : ''}
                    {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div style={S.split}>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyUp={updateCursor}
          onClick={updateCursor}
          spellCheck={false}
          style={S.editor}
        />

        <aside style={S.side}>
          <h3 style={S.sideTitle}>
            Doppelseite {cursorSpread + 1}
            {aktuelleSeite?.text ? ` · ${aktuelleSeite.text}` : ''}
          </h3>
          <div style={S.previewBox}>
            {preview ? (
              <SpreadView spread={preview} widthPx={420} imageSrc={imageSrc} guides={{}} />
            ) : (
              <div style={{ ...S.placeholder, height: 212 }} />
            )}
          </div>
          <p style={S.hint}>
            Die Vorschau zeigt den <em>gespeicherten</em> Stand. Nach „Übernehmen“ folgt sie den
            Änderungen.
          </p>

          {aktuelleSeite && (
            <>
              <div style={S.metaHead}>
                {aktuelleSeite.photos.length} Bilder
                {aktuelleSeite.template && (
                  <span style={S.templateTag}>{aktuelleSeite.template.replace('spread.', '')}</span>
                )}
              </div>
              <ul style={S.metaList}>
                {aktuelleSeite.photos.map((p) => (
                  <li key={p.file} style={S.metaItem}>
                    <div style={S.metaFile}>{p.file}</div>
                    <div style={S.metaRow}>
                      {p.date && <span>{p.date}</span>}
                      {p.px && <span>{p.px}</span>}
                      {p.dpi !== undefined && (
                        <span style={{ color: p.warn ? '#b91c1c' : '#6b7280' }}>{p.dpi} dpi</span>
                      )}
                    </div>
                    {p.camera && <div style={S.metaRow}>{p.camera}</div>}
                    {p.gps && (
                      <div style={S.metaRow}>
                        <a href={p.map} target="_blank" rel="noreferrer" style={S.link}>
                          {p.gps}
                        </a>
                      </div>
                    )}
                    {p.warn && <div style={S.metaWarn}>{p.warn}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const S = {
  wrap: { marginTop: '1rem' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    paddingBottom: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  spacer: { flex: 1 },
  muted: { color: '#6b7280', fontSize: '0.8125rem' },
  parseError: { color: '#b91c1c', fontSize: '0.8125rem', fontFamily: 'ui-monospace, monospace' },
  button: {
    padding: '0.35rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  buttonPrimary: {
    padding: '0.35rem 0.9rem',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  resultOk: {
    padding: '0.6rem 0.9rem',
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: '6px',
    fontSize: '0.8125rem',
    marginBottom: '0.75rem',
  },
  resultBad: {
    padding: '0.6rem 0.9rem',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.8125rem',
    marginBottom: '0.75rem',
  },
  list: { margin: '0.4rem 0 0', paddingLeft: '1.1rem' },
  split: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 460px', gap: '1rem' },
  editor: {
    width: '100%',
    // Ohne border-box addieren sich Polsterung und Rahmen auf die 100 % und
    // die Textfläche schiebt sich unter die Seitenleiste.
    boxSizing: 'border-box' as const,
    height: '70vh',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.5,
    resize: 'vertical' as const,
    tabSize: 2,
  },
  side: { minWidth: 0 },
  sideTitle: { margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600 },
  previewBox: { border: '1px solid #e5e7eb', lineHeight: 0, background: '#fff' },
  placeholder: { background: '#f3f4f6' },
  hint: { fontSize: '0.75rem', color: '#9ca3af', margin: '0.4rem 0 0.8rem' },
  metaHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.4rem',
  },
  templateTag: {
    padding: '0.1rem 0.4rem',
    background: '#f3f4f6',
    borderRadius: '4px',
    fontFamily: 'ui-monospace, monospace',
  },
  metaList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    maxHeight: '38vh',
    overflowY: 'auto' as const,
  },
  metaItem: { padding: '0.4rem 0', borderTop: '1px solid #f3f4f6' },
  metaFile: { fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#111827' },
  metaRow: { display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: '#6b7280' },
  metaWarn: { fontSize: '0.7rem', color: '#b91c1c' },
  link: { color: '#2563eb' },
} satisfies Record<string, React.CSSProperties>;
