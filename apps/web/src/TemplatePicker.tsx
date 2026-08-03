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
 *
 * Ohne eigenen Aufklapper: Die Komponente ist der Inhalt eines Abschnitts, den
 * die Spalte bzw. das schwebende Panel um sie herum setzt. Vorher stand hier ein
 * „Anordnung ändern"-Knopf, hinter dem dieselbe Liste lag — zwei Klicks für
 * etwas, das in der Spalte ohnehin sichtbar sein kann.
 */
import { useCallback, useEffect, useState } from 'react';
import { B, T } from './theme.js';

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
const SKIZZE_BREITE = 76;
const SKIZZE_HOEHE = 38;

export function TemplatePicker({ index, photoCount, version, onApplied, onFehler }: Props) {
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
    fetch(`/api/spreads/${index}/templates`)
      .then((r) => r.json())
      .then((d: Antwort) => setDaten(d))
      .catch(() => setDaten(null));
  }, [index, version]);

  useEffect(laden, [laden]);

  /**
   * Setzt eine Anordnung für eine einzelne Seite; die andere bleibt stehen.
   *
   * Die Paarkennung baut der Server. Hier stand sie einmal – zusammengesetzt aus
   * der gewählten und der bekannten Gegenseite –, und wenn die Gegenseite keine
   * bekannte Halbseite war, blieb nur eine Fehlermeldung. Das traf jede justierte
   * Doppelseite, und dort will man die Anordnung besonders oft ändern.
   */
  async function halbseiteWaehlen(seite: 'left' | 'right', halb: Halbseite) {
    const bisher = seite === 'left' ? daten?.counts.left : daten?.counts.right;
    if (bisher !== undefined && halb.slotCount < bisher) {
      const zuviel = bisher - halb.slotCount;
      const ok = window.confirm(
        `Diese Anordnung hat ${halb.slotCount} Plätze, auf der Seite liegen ${bisher} Bilder. ` +
          `${zuviel === 1 ? 'Ein Bild wandert' : `${zuviel} Bilder wandern`} in den Fotopool.`,
      );
      if (!ok) return;
    }

    setBusy(halb.id);
    try {
      const res = await fetch(`/api/spreads/${index}/half`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ side: seite, halfId: halb.id }),
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

  if (daten === null) return <span style={B.leiser}>lade …</span>;

  return (
    <>
      <div style={B.segRahmen}>
        {(
          [
            ['seiten', 'einzelne Seite'],
            ['doppelseite', 'ganze Doppelseite'],
          ] as const
        ).map(([wert, text]) => (
          <button
            key={wert}
            onClick={() => setModus(wert)}
            style={{ ...(modus === wert ? B.segAn : B.segAus), flex: 1, fontSize: 12 }}
          >
            {text}
          </button>
        ))}
      </div>

      {modus === 'doppelseite' ? (
        <div style={S.gitter}>
          {daten.templates.map((v) => (
            <button
              key={v.id}
              onClick={() => void waehlen(v)}
              disabled={busy !== null}
              title={`${v.name} · ${v.slotCount} ${v.slotCount === 1 ? 'Bild' : 'Bilder'}`}
              style={{ ...S.kachel, ...(v.current ? S.kachelAn : {}) }}
            >
              <Skizze slots={v.slots} />
              <span style={S.zahl}>
                {v.slotCount}
                {v.slotCount !== photoCount && (
                  <span style={S.abweichung}>
                    {v.slotCount > photoCount
                      ? ` +${v.slotCount - photoCount}`
                      : ` −${photoCount - v.slotCount}`}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        (['left', 'right'] as const).map((seite) => {
          const bisher = seite === 'left' ? daten.counts.left : daten.counts.right;
          return (
            <div key={seite}>
              <p style={S.seitenTitel}>
                {seite === 'left' ? 'Linke Seite' : 'Rechte Seite'}
                <span style={S.seitenZahl}>
                  {bisher} {bisher === 1 ? 'Bild' : 'Bilder'}
                </span>
              </p>
              <div style={S.gitter}>
                {daten.halves.map((h) => {
                  const aktiv =
                    (seite === 'left' ? daten.current.left : daten.current.right) === h.id;
                  return (
                    <button
                      key={`${seite}-${h.id}`}
                      onClick={() => void halbseiteWaehlen(seite, h)}
                      disabled={busy !== null}
                      title={`${h.slotCount} ${h.slotCount === 1 ? 'Bild' : 'Bilder'} auf dieser Seite`}
                      style={{ ...S.kachel, ...(aktiv ? S.kachelAn : {}) }}
                    >
                      {/* Für die rechte Seite gespiegelt – so wie die Engine sie einsetzt. */}
                      <Skizze slots={h.slots} halb={seite} />
                      <span style={S.zahl}>
                        {h.slotCount}
                        {h.slotCount !== bisher && (
                          <span style={S.abweichung}>
                            {h.slotCount > bisher
                              ? ` +${h.slotCount - bisher}`
                              : ` −${bisher - h.slotCount}`}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <span style={B.leiser}>
        Erst die linke, dann die rechte Seite — oder die ganze Doppelseite. Die Bilder werden den
        neuen Plätzen nach Passung zugeordnet; Ausschnitte entstehen dabei neu.
      </span>
    </>
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
      <rect x={0} y={0} width={SKIZZE_BREITE} height={SKIZZE_HOEHE} fill="var(--bg-3)" />
      {gezeigt.map((s, i) => (
        <rect
          key={i}
          x={s.x * SKIZZE_BREITE}
          y={s.y * SKIZZE_HOEHE}
          width={s.w * SKIZZE_BREITE}
          height={s.h * SKIZZE_HOEHE}
          fill={s.bleed ? 'var(--cyan-100)' : 'var(--warm-300)'}
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
          stroke="var(--warm-500)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
    </svg>
  );
}

const S = {
  /**
   * Eigener Scrollbereich, und zwar aus einer gemessenen Not: Die Bibliothek hat
   * über vierzig Halbseiten, und in einer Spalte von 336 Pixeln sind das rund
   * zwanzig Reihen Skizzen. Ohne diese Grenze stünden Hintergrund und Text zwei
   * Bildschirmhöhen weiter unten, und die Anordnung — der Griff, den man am
   * seltensten braucht — hätte die Spalte für sich.
   */
  gitter: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 2,
    maxHeight: 156,
    overflowY: 'auto' as const,
    alignContent: 'flex-start' as const,
  },
  kachel: {
    padding: 3,
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
    background: T.bg1,
    cursor: 'pointer',
    lineHeight: 0,
  },
  kachelAn: { borderColor: T.cyan },
  svg: { display: 'block', borderRadius: T.rSm },
  zahl: {
    display: 'block',
    fontSize: 11,
    color: T.fg3,
    lineHeight: 1.7,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  abweichung: { color: T.warn },
  seitenTitel: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    fontSize: 12,
    fontWeight: 600,
    margin: '8px 0 4px',
    color: T.fg2,
  },
  seitenZahl: { fontWeight: 400, color: T.fg4, fontSize: 11 },
} satisfies Record<string, React.CSSProperties>;
