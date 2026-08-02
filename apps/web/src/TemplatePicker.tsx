/**
 * Anordnung einer Doppelseite von Hand wählen.
 *
 * Die Engine sucht die Vorlage nach Passung: Auflösung, Ausrichtung, Gewicht.
 * Das trifft es meistens und manchmal eben nicht – ein Bild soll groß stehen,
 * weil es das wichtigere ist, nicht weil es die meisten Pixel hat. Dann will
 * man die Aufteilung selbst bestimmen.
 *
 * Gezeigt werden Skizzen, keine Namen: `spread.4up.grid` sagt niemandem, wie
 * die Seite aussieht. Die Skizze kommt aus derselben Slotgeometrie, aus der
 * auch das Layout entsteht – sie kann deshalb nicht von der Vorlage abweichen.
 */
import { useCallback, useEffect, useState } from 'react';

interface Vorlage {
  id: string;
  name: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  current: boolean;
}

interface Props {
  index: number;
  /** Wie viele Bilder gerade auf der Seite liegen – für die Warnung beim Verkleinern. */
  photoCount: number;
  /** Zählt hoch, wenn sich die Doppelseite geändert hat. */
  version: number;
  onApplied: (ergebnis: { spread: unknown; leftover: string[] }) => void;
  onFehler: (text: string) => void;
}

/** Seitenverhältnis der Skizze: eine Doppelseite ist zwei Quadrate breit. */
const SKIZZE_BREITE = 120;
const SKIZZE_HOEHE = 60;

export function TemplatePicker({ index, photoCount, version, onApplied, onFehler }: Props) {
  const [offen, setOffen] = useState(false);
  const [vorlagen, setVorlagen] = useState<Vorlage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const laden = useCallback(() => {
    if (!offen) return;
    fetch(`/api/spreads/${index}/templates`)
      .then((r) => r.json())
      .then((d: { templates: Vorlage[] }) => setVorlagen(d.templates))
      .catch(() => setVorlagen([]));
  }, [index, offen, version]);

  useEffect(laden, [laden]);

  async function waehlen(v: Vorlage) {
    if (v.current) return;
    // Beim Verkleinern gehen Bilder in den Pool. Das ist umkehrbar, aber nicht
    // offensichtlich – deshalb vorher gefragt.
    if (v.slotCount < photoCount) {
      const zuviel = photoCount - v.slotCount;
      const ok = window.confirm(
        `Diese Anordnung hat ${v.slotCount} Plätze, auf der Doppelseite liegen ${photoCount} Bilder. ` +
          `${zuviel === 1 ? 'Ein Bild wandert' : `${zuviel} Bilder wandern`} in den Fotopool.`,
      );
      if (!ok) return;
    }

    setBusy(v.id);
    try {
      const res = await fetch(`/api/spreads/${index}/template`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: v.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onFehler(data.error ?? 'Die Anordnung ließ sich nicht ändern');
        return;
      }
      onApplied({ spread: data.spread, leftover: data.leftover ?? [] });
    } catch (e) {
      onFehler(`Die Anordnung ließ sich nicht ändern: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={S.bereich}>
      <div style={S.kopf}>
        <button onClick={() => setOffen((o) => !o)} style={S.button}>
          {offen ? 'Anordnung schließen' : 'Anordnung ändern'}
        </button>
        {offen && (
          <span style={S.hint}>
            Die Bilder werden den neuen Plätzen nach Passung zugeordnet; Ausschnitte entstehen dabei
            neu.
          </span>
        )}
      </div>

      {offen && (
        <div style={S.gitter}>
          {vorlagen === null ? (
            <span style={S.hint}>lade …</span>
          ) : (
            vorlagen.map((v) => (
              <button
                key={v.id}
                onClick={() => void waehlen(v)}
                disabled={busy !== null}
                title={`${v.name} · ${v.slotCount} ${v.slotCount === 1 ? 'Bild' : 'Bilder'}`}
                style={{ ...S.kachel, ...(v.current ? S.kachelAktiv : {}) }}
              >
                <Skizze slots={v.slots} />
                <span style={S.zahl}>
                  {v.slotCount}
                  {v.slotCount !== photoCount && (
                    <span style={S.abweichung}>
                      {v.slotCount > photoCount
                        ? ` (+${v.slotCount - photoCount} leer)`
                        : ` (−${photoCount - v.slotCount})`}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Die Anordnung als Rechteckskizze.
 *
 * Randabfallende Slots ragen absichtlich über 0..1 hinaus; das Beschneiden
 * übernimmt das SVG, damit die Kachel nicht ausfranst.
 */
function Skizze({ slots }: { slots: Vorlage['slots'] }) {
  return (
    <svg
      width={SKIZZE_BREITE}
      height={SKIZZE_HOEHE}
      viewBox={`0 0 ${SKIZZE_BREITE} ${SKIZZE_HOEHE}`}
      style={S.svg}
    >
      <rect x={0} y={0} width={SKIZZE_BREITE} height={SKIZZE_HOEHE} fill="#f9fafb" />
      {slots.map((s, i) => (
        <rect
          key={i}
          x={s.x * SKIZZE_BREITE}
          y={s.y * SKIZZE_HOEHE}
          width={s.w * SKIZZE_BREITE}
          height={s.h * SKIZZE_HOEHE}
          fill={s.bleed ? '#c7d2fe' : '#d1d5db'}
        />
      ))}
      {/* Die Falzachse: Sie entscheidet mit, ob eine Anordnung taugt. */}
      <line
        x1={SKIZZE_BREITE / 2}
        y1={0}
        x2={SKIZZE_BREITE / 2}
        y2={SKIZZE_HOEHE}
        stroke="#fff"
        strokeWidth={1}
      />
    </svg>
  );
}

const S = {
  bereich: { marginTop: '0.75rem' },
  kopf: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  button: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
  hint: { fontSize: '0.72rem', color: '#9ca3af' },
  gitter: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.4rem',
    marginTop: '0.5rem',
    maxHeight: '40vh',
    overflowY: 'auto' as const,
  },
  kachel: {
    padding: '3px',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'pointer',
    lineHeight: 0,
  },
  kachelAktiv: { borderColor: '#1d4ed8', boxShadow: '0 0 0 2px #dbeafe' },
  svg: { display: 'block', borderRadius: '2px' },
  zahl: {
    display: 'block',
    fontSize: '0.68rem',
    color: '#6b7280',
    lineHeight: 1.6,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  abweichung: { color: '#b45309' },
} satisfies Record<string, React.CSSProperties>;
