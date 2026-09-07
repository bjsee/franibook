/**
 * Editor für die Buchaufteilung.
 *
 * Zwei Hälften: links das JSON zum Bearbeiten, rechts die Doppelseite, in der
 * gerade der Cursor steht, samt Metadaten der Bilder. Die Vorschau folgt dem
 * Cursor – ohne sie wäre das Umhängen ein Blindflug durch Dateinamen.
 *
 * Die Textfläche füllt die Höhe des Fensters, statt eine feste Zahl von
 * Bildschirmhöhen zu belegen: Wer hier arbeitet, arbeitet an einer Datei von
 * einigen Tausend Zeilen, und jede Zeile, die stattdessen an Rahmen geht, ist
 * eine Zeile weniger Übersicht.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';
import {
  blobHerunterladen,
  doppelseiteLaden,
  fehlertext,
  type LayoutErgebnis as ApplyResult,
  layoutAnwenden,
  layoutLaden,
} from './api.js';
import { Link, type Route } from './router.js';
import { B, T } from './theme.js';

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
  onNavigieren: (ziel: Route) => void;
}

/** Breite der Vorschau in der Seitenspalte. */
const VORSCHAU_PX = 418;

export function LayoutEditor({ imageSrc, onApplied, onNavigieren }: Props) {
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
    layoutLaden()
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
    doppelseiteLaden(cursorSpread)
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
      const data = await layoutAnwenden(text);
      setResult(data);
      if (data.ok) onApplied();
    } catch (e) {
      setResult({
        ok: false,
        issues: [{ severity: 'error', message: fehlertext(e) }],
        problems: [],
        spreadCount: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    blobHerunterladen(new Blob([text], { type: 'application/json' }), 'franibook-layout.json');
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
      <div style={S.leiste}>
        {/*
          Der Rückweg gehört hierher und nicht nur an den Reiter: Wer im Text
          steht, hat den Baum verlassen und soll ihn ohne Umweg über die
          Reiterzeile wiederfinden.
        */}
        <Link route={{ view: 'edit' }} onNavigieren={onNavigieren} style={B.knopf}>
          ← Baum
        </Link>
        <button onClick={load} disabled={busy} style={B.knopf}>
          Neu laden
        </button>
        <button onClick={download} style={B.knopf}>
          Als Datei speichern
        </button>
        <label style={{ ...B.knopf, cursor: 'pointer' }}>
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
        <span style={B.dehner} />
        {parseError ? (
          <span style={S.parseFehler}>JSON ungültig: {parseError}</span>
        ) : (
          doc?.summary && (
            <span style={B.leise}>
              {doc.spreads?.length ?? 0} Doppelseiten ·{' '}
              {doc.spreads?.reduce((n, s) => n + s.photos.length, 0) ?? 0} Bilder
              {doc.unplaced?.length ? ` · ${doc.unplaced.length} außen vor` : ''}
            </span>
          )
        )}
        <button onClick={() => void apply()} disabled={busy || !!parseError} style={B.knopfPrimaer}>
          {busy ? 'Übernehme …' : 'Übernehmen'}
        </button>
      </div>

      {result && (
        <div style={result.ok ? S.ergebnisOk : S.ergebnisSchlecht}>
          {result.ok ? (
            <strong>Übernommen: {result.spreadCount} Doppelseiten.</strong>
          ) : (
            <strong>Nicht übernommen.</strong>
          )}
          {result.problems.length > 0 && (
            <ul style={S.liste}>
              {result.problems.map((p) => (
                <li key={p.index}>
                  Doppelseite {p.index}: {p.message}
                </li>
              ))}
            </ul>
          )}
          {fehler.length > 0 && (
            <ul style={S.liste}>
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
              <summary style={{ ...B.leise, cursor: 'pointer' }}>
                {warnungen.length} Hinweise
              </summary>
              <ul style={S.liste}>
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

      <div style={S.teilung}>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyUp={updateCursor}
          onClick={updateCursor}
          spellCheck={false}
          style={S.editor}
        />

        <aside style={S.spalte}>
          <strong style={{ ...B.titel, fontSize: 15 }}>
            Doppelseite {cursorSpread + 1}
            {aktuelleSeite?.text ? ` · ${aktuelleSeite.text}` : ''}
          </strong>
          <div style={S.vorschau}>
            {preview ? (
              <SpreadView spread={preview} widthPx={VORSCHAU_PX} imageSrc={imageSrc} guides={{}} />
            ) : (
              <div style={{ background: T.bg3, height: VORSCHAU_PX / 2 }} />
            )}
          </div>
          <p style={{ ...B.leiser, margin: '8px 0 16px' }}>
            Die Vorschau zeigt den <em>gespeicherten</em> Stand. Nach „Übernehmen" folgt sie den
            Änderungen.
          </p>

          {aktuelleSeite && (
            <>
              <div style={S.metaKopf}>
                {aktuelleSeite.photos.length}{' '}
                {aktuelleSeite.photos.length === 1 ? 'Bild' : 'Bilder'}
                {aktuelleSeite.template && (
                  <span style={S.vorlage}>{aktuelleSeite.template.replace('spread.', '')}</span>
                )}
              </div>
              {aktuelleSeite.photos.map((p) => (
                <div key={p.file} style={S.metaZeile}>
                  <div style={B.dateiname}>{p.file}</div>
                  <div style={S.metaWerte}>
                    {p.date && <span>{p.date}</span>}
                    {p.px && <span>{p.px}</span>}
                    {p.dpi !== undefined && (
                      <span style={{ color: p.warn ? T.fehler : T.fg3 }}>{p.dpi} dpi</span>
                    )}
                  </div>
                  {p.camera && <div style={S.metaWerte}>{p.camera}</div>}
                  {p.gps && (
                    <div style={S.metaWerte}>
                      <a
                        href={p.map}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: T.cyanTief }}
                      >
                        {p.gps}
                      </a>
                    </div>
                  )}
                  {p.warn && <div style={{ fontSize: 12, color: T.fehler }}>{p.warn}</div>}
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const S = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0 },
  leiste: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 20px',
    borderBottom: `1px solid ${T.line}`,
    background: T.bg1,
    flexWrap: 'wrap' as const,
    flexShrink: 0,
  },
  parseFehler: { color: T.fehler, fontSize: 13, fontFamily: T.mono },
  ergebnisOk: {
    padding: '10px 20px',
    background: T.bg1,
    borderBottom: `1px solid ${T.line}`,
    fontSize: 13,
    flexShrink: 0,
  },
  ergebnisSchlecht: {
    padding: '10px 20px',
    background: T.warnBg,
    borderBottom: `1px solid ${T.warnRand}`,
    color: T.warnText,
    fontSize: 13,
    flexShrink: 0,
    maxHeight: '30vh',
    overflowY: 'auto' as const,
  },
  liste: { margin: '6px 0 0', paddingLeft: 18 },
  teilung: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 460px',
    minHeight: 0,
  },
  editor: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box' as const,
    padding: '16px 20px',
    border: 'none',
    background: T.bg2,
    fontFamily: T.mono,
    fontSize: 12,
    lineHeight: 1.6,
    resize: 'none' as const,
    color: T.fg1,
    tabSize: 2,
  },
  spalte: {
    borderLeft: `1px solid ${T.line}`,
    background: T.bg1,
    overflowY: 'auto' as const,
    padding: '18px 20px',
    minWidth: 0,
  },
  vorschau: { border: `1px solid ${T.line}`, lineHeight: 0, marginTop: 10 },
  metaKopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: T.fg3,
    marginBottom: 6,
  },
  vorlage: {
    padding: '2px 8px',
    background: T.bg3,
    borderRadius: T.rPill,
    fontFamily: T.mono,
  },
  metaZeile: { padding: '10px 0', borderTop: `1px solid ${T.bg3}` },
  metaWerte: { display: 'flex', gap: 12, fontSize: 12, color: T.fg3, marginTop: 2 },
} satisfies Record<string, React.CSSProperties>;
