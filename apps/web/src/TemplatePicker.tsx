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

/** Eine Anordnung für eine einzelne Buchseite, immer in Linksform. */
interface Halbseite {
  id: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number }[];
}

interface Antwort {
  templates: Vorlage[];
  halves: Halbseite[];
  current: { left?: string; right?: string };
  counts: { left: number; right: number };
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
  /**
   * Ganze Doppelseite oder einzelne Seiten.
   *
   * Die Seiten sind die Vorgabe: Wer die Anordnung von Hand anfasst, meint fast
   * immer die eine Seite, auf der das Bild falsch steht – die andere soll
   * bleiben, wie sie ist.
   */
  const [modus, setModus] = useState<'seiten' | 'doppelseite'>('seiten');
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const laden = useCallback(() => {
    if (!offen) return;
    fetch(`/api/spreads/${index}/templates`)
      .then((r) => r.json())
      .then((d: Antwort) => setDaten(d))
      .catch(() => setDaten(null));
  }, [index, offen, version]);

  useEffect(laden, [laden]);

  const vorlagen = daten?.templates ?? null;

  /** Setzt eine Anordnung für eine einzelne Seite; die andere bleibt stehen. */
  async function halbseiteWaehlen(seite: 'left' | 'right', halb: Halbseite) {
    const jetzt = daten?.current;
    const gegenueber = seite === 'left' ? jetzt?.right : jetzt?.left;
    if (!gegenueber) {
      onFehler(
        'Die gegenüberliegende Seite lässt sich nicht einzeln fassen — ' +
          'diese Doppelseite hat eine Vorlage, die über den Falz reicht.',
      );
      return;
    }

    const bisher = seite === 'left' ? daten?.counts.left : daten?.counts.right;
    if (bisher !== undefined && halb.slotCount < bisher) {
      const zuviel = bisher - halb.slotCount;
      const ok = window.confirm(
        `Diese Anordnung hat ${halb.slotCount} Plätze, auf der Seite liegen ${bisher} Bilder. ` +
          `${zuviel === 1 ? 'Ein Bild wandert' : `${zuviel} Bilder wandern`} in den Fotopool.`,
      );
      if (!ok) return;
    }

    const links = seite === 'left' ? halb.id : gegenueber;
    const rechts = seite === 'right' ? halb.id : gegenueber;
    await anwenden(`paar:${links}+${rechts}`, halb.id);
  }

  async function anwenden(templateId: string, busyId: string) {
    setBusy(busyId);
    try {
      const res = await fetch(`/api/spreads/${index}/template`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId }),
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

    await anwenden(v.id, v.id);
  }

  return (
    <section style={S.bereich}>
      <div style={S.kopf}>
        <button onClick={() => setOffen((o) => !o)} style={S.button}>
          {offen ? 'Anordnung schließen' : 'Anordnung ändern'}
        </button>
        {offen && (
          <>
            {(
              [
                ['seiten', 'einzelne Seite'],
                ['doppelseite', 'ganze Doppelseite'],
              ] as const
            ).map(([wert, text]) => (
              <button
                key={wert}
                onClick={() => setModus(wert)}
                style={modus === wert ? S.modusAktiv : S.modus}
              >
                {text}
              </button>
            ))}
            <span style={S.hint}>
              Die Bilder werden den neuen Plätzen nach Passung zugeordnet; Ausschnitte entstehen
              dabei neu.
            </span>
          </>
        )}
      </div>

      {offen && daten === null && <span style={S.hint}>lade …</span>}

      {offen && daten && modus === 'doppelseite' && (
        <div style={S.gitter}>
          {(vorlagen ?? []).map((v) => (
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
          ))}
        </div>
      )}

      {offen &&
        daten &&
        modus === 'seiten' &&
        (['left', 'right'] as const).map((seite) => (
          <div key={seite}>
            <p style={S.seitenTitel}>
              {seite === 'left' ? 'Linke Seite' : 'Rechte Seite'}
              <span style={S.seitenZahl}>
                {(() => {
                  const n = seite === 'left' ? daten.counts.left : daten.counts.right;
                  return `${n} ${n === 1 ? 'Bild' : 'Bilder'}`;
                })()}
              </span>
            </p>
            <div style={S.gitter}>
              {daten.halves.map((h) => {
                const aktiv =
                  (seite === 'left' ? daten.current.left : daten.current.right) === h.id;
                const bisher = seite === 'left' ? daten.counts.left : daten.counts.right;
                return (
                  <button
                    key={`${seite}-${h.id}`}
                    onClick={() => void halbseiteWaehlen(seite, h)}
                    disabled={busy !== null}
                    title={`${h.slotCount} ${h.slotCount === 1 ? 'Bild' : 'Bilder'} auf dieser Seite`}
                    style={{ ...S.kachel, ...(aktiv ? S.kachelAktiv : {}) }}
                  >
                    {/* Für die rechte Seite gespiegelt – so wie die Engine sie einsetzt. */}
                    <Skizze slots={h.slots} halb={seite} />
                    <span style={S.zahl}>
                      {h.slotCount}
                      {h.slotCount !== bisher && (
                        <span style={S.abweichung}>
                          {h.slotCount > bisher
                            ? ` (+${h.slotCount - bisher} leer)`
                            : ` (−${bisher - h.slotCount})`}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </section>
  );
}

/**
 * Die Anordnung als Rechteckskizze.
 *
 * Randabfallende Slots ragen absichtlich über 0..1 hinaus; das Beschneiden
 * übernimmt das SVG, damit die Kachel nicht ausfranst.
 */
function Skizze({ slots, halb }: { slots: Vorlage['slots']; halb?: 'left' | 'right' }) {
  // Eine Halbseite ist halb so breit; die rechte wird gespiegelt gezeichnet,
  // weil eine Seite außen mehr Rand hat als am Falz.
  const breite = halb ? SKIZZE_BREITE / 2 : SKIZZE_BREITE;
  const gezeigt = halb === 'right' ? slots.map((s) => ({ ...s, x: 0.5 - s.x - s.w })) : slots;

  return (
    <svg
      width={breite}
      height={SKIZZE_HOEHE}
      viewBox={
        halb ? `0 0 ${SKIZZE_BREITE / 2} ${SKIZZE_HOEHE}` : `0 0 ${SKIZZE_BREITE} ${SKIZZE_HOEHE}`
      }
      style={S.svg}
    >
      <rect x={0} y={0} width={SKIZZE_BREITE} height={SKIZZE_HOEHE} fill="#f9fafb" />
      {gezeigt.map((s, i) => (
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
      {!halb && (
        <line
          x1={SKIZZE_BREITE / 2}
          y1={0}
          x2={SKIZZE_BREITE / 2}
          y2={SKIZZE_HOEHE}
          stroke="#fff"
          strokeWidth={1}
        />
      )}
      {/* Bei der Halbseite steht der Falz an der Kante, die zur Buchmitte zeigt. */}
      {halb && (
        <line
          x1={halb === 'left' ? SKIZZE_BREITE / 2 - 0.5 : 0.5}
          y1={0}
          x2={halb === 'left' ? SKIZZE_BREITE / 2 - 0.5 : 0.5}
          y2={SKIZZE_HOEHE}
          stroke="#9ca3af"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
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
  modus: {
    padding: '0.15rem 0.45rem',
    border: '1px solid transparent',
    borderRadius: '4px',
    background: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '0.74rem',
  },
  modusAktiv: {
    padding: '0.15rem 0.45rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: '#f9fafb',
    color: '#111827',
    cursor: 'pointer',
    fontSize: '0.74rem',
    fontWeight: 600,
  },
  seitenTitel: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'baseline',
    fontSize: '0.78rem',
    fontWeight: 600,
    margin: '0.7rem 0 0',
  },
  seitenZahl: { fontWeight: 400, color: '#9ca3af', fontSize: '0.72rem' },
} satisfies Record<string, React.CSSProperties>;
