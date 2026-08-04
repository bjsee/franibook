/**
 * Coveransicht.
 *
 * Der Umschlag als flach liegender Bogen, dazu die Zahlen, die man beim Cover
 * wirklich braucht: Rückenbreite, Bogenmaß und die Seitenzahl, aus der beides
 * folgt. Die Gelenkzonen sind standardmäßig eingeblendet – sie sind der eine
 * Ort, an dem der Bildschirm nicht zeigt, was der Druck macht.
 *
 * Jetzt ein Reiter neben „Übersicht" und „Doppelseite"; `?cover` wählt ihn nur
 * noch aus. Vorher war es ein eigener Einstiegspunkt in `main.tsx`, weil die
 * Hauptansicht nicht angefasst werden sollte — der Grund ist mit dem Umbau der
 * Kopfzeile weggefallen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverDesign } from '@franibook/core';
import { CoverView, type CoverGuideVisibility } from '@franibook/render-dom';
import {
  fehlertext,
  type Umschlag as CoverAntwort,
  umschlagAendern,
  umschlagExportieren,
  umschlagLaden,
} from './api.js';
import { B, T } from './theme.js';

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

export function Cover({
  imageSrc,
  standVersion,
}: {
  imageSrc: (photoId: string) => string;
  /** Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat. */
  standVersion?: number;
}) {
  const [data, setData] = useState<CoverAntwort | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [guides, setGuides] = useState<CoverGuideVisibility>({ hinge: true, diagnostics: true });

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1000);

  const load = useCallback(() => {
    umschlagLaden()
      .then(setData)
      .catch((e: unknown) => setError(fehlertext(e)));
  }, []);

  useEffect(load, [load, standVersion]);

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
      setData(await umschlagAendern({ [feld]: wert }));
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    }
  }

  async function exportCover() {
    setBusy('Exportiere Umschlag …');
    setNote(null);
    try {
      const r = await umschlagExportieren();
      setNote(
        `${r.outputPath} — ${r.widthMm.toFixed(1)} × ${r.heightMm.toFixed(1)} mm, ` +
          `Rücken ${r.spineMm.toFixed(1)} mm bei ${r.pageCount} Seiten`,
      );
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div style={S.flaeche}>
        <p style={B.fehlerfeld}>Fehler: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={S.flaeche}>
        <p style={B.leise}>Lade Umschlag …</p>
      </div>
    );
  }

  const geo = data.cover.geometry;

  return (
    <div style={S.flaeche}>
      <div style={S.kopf}>
        <Kennzahl label="Buchrücken" wert={`${geo.spineMm.toFixed(1)} mm`} />
        <Kennzahl label="Seiten" wert={String(geo.pageCount)} />
        <Kennzahl
          label="Bogen"
          wert={`${geo.widthMm.toFixed(1)} × ${geo.heightMm.toFixed(1)} mm`}
        />
        <Kennzahl label="Gelenkzone" wert={`${geo.hingeMm} mm je Seite`} />
        <Kennzahl label="Umschlag" wert={`${geo.wrapMm} mm`} />
        <span style={B.dehner} />
        <button onClick={() => void exportCover()} disabled={!!busy} style={B.knopfPrimaer}>
          Umschlag als PDF
        </button>
      </div>

      {/*
        Die Hinweise des Servers sind fast immer derselbe: Die Maße dieses
        Druckprofils sind Annahmen. Das gehört gelesen, bevor jemand einen
        Druckauftrag auslöst, also steht es hier und nicht in einem Tooltip.
      */}
      {data.hints.length > 0 && (
        <ul style={S.hinweise}>
          {data.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      {(busy || note) && <p style={S.status}>{busy ?? note}</p>}

      <div style={S.schalter}>
        {SCHALTER.map((s) => (
          <label key={s.key} style={B.haken}>
            <input
              type="checkbox"
              checked={guides[s.key] ?? false}
              onChange={(e) => setGuides((g) => ({ ...g, [s.key]: e.target.checked }))}
            />
            {s.label}
          </label>
        ))}
      </div>

      <div ref={stageRef} style={S.buehne}>
        <CoverView cover={data.cover} widthPx={stageWidth} imageSrc={imageSrc} guides={guides} />
      </div>
      <p style={{ ...B.leiser, marginTop: 10 }}>
        Links die Rückseite, in der Mitte der Buchrücken, rechts die Vorderseite. Die roten Bänder
        sind die Gelenkzonen — dort verschwindet beim Binden Fläche.
      </p>

      <div style={S.felder}>
        {FELDER.map((f) => (
          <label key={f.key} style={S.feldWrap}>
            <span style={B.marke}>{f.label}</span>
            <input
              defaultValue={data.design[f.key] ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (data.design[f.key] ?? ''))
                  void patch(f.key, e.target.value);
              }}
              style={{ ...B.feld, fontSize: 14 }}
            />
          </label>
        ))}
      </div>

      <strong style={{ ...B.titel, display: 'block', fontSize: 15, margin: '26px 0 10px' }}>
        Titelbild
      </strong>
      <div style={S.kandidaten}>
        {data.candidates.map((c) => (
          <button
            key={c.photoId}
            onClick={() => void patch('frontPhotoId', c.photoId)}
            title={c.label}
            style={{
              ...S.kandidat,
              borderColor: c.photoId === data.design.frontPhotoId ? T.cyan : T.line,
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

function Kennzahl({ label, wert }: { label: string; wert: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={B.marke}>{label}</span>
      <span style={{ ...B.zahl, fontSize: 19 }}>{wert}</span>
    </div>
  );
}

const S = {
  flaeche: { flex: 1, overflowY: 'auto' as const, padding: '24px 32px 48px', minHeight: 0 },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    flexWrap: 'wrap' as const,
    paddingBottom: 18,
    borderBottom: `1px solid ${T.line}`,
  },
  hinweise: {
    margin: '14px 0 0',
    paddingLeft: 18,
    fontSize: 13,
    color: T.warn,
    lineHeight: 1.55,
    maxWidth: '70ch',
  },
  status: {
    margin: '14px 0 0',
    padding: '6px 10px',
    fontSize: 13,
    color: T.fg2,
    background: T.bg3,
    borderRadius: T.rMd,
    fontFamily: T.mono,
  },
  schalter: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap' as const,
    margin: '18px 0',
  },
  buehne: { border: `1px solid ${T.line}`, lineHeight: 0, background: T.bg1 },
  felder: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
    gap: 14,
    marginTop: 24,
    maxWidth: 900,
  },
  feldWrap: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  kandidaten: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  kandidat: {
    padding: 3,
    border: `2px solid ${T.line}`,
    borderRadius: 6,
    background: T.bg1,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    width: '7rem',
  },
  thumb: {
    width: '100%',
    height: '4.5rem',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: T.rSm,
  },
  thumbLabel: {
    fontSize: 11,
    color: T.fg3,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
} satisfies Record<string, React.CSSProperties>;
