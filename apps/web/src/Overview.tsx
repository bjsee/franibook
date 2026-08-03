/**
 * Buchübersicht.
 *
 * Zeigt alle Doppelseiten als Kacheln. Das ist die Ansicht, in der sich das
 * UX-Ziel überhaupt erst beurteilen lässt: Ob der automatische Entwurf
 * brauchbar ist, sieht man nicht an einer einzelnen Doppelseite, sondern am
 * Rhythmus über das ganze Buch.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';

/** Die Antwort auf `/api/spreads/:index`, soweit die Übersicht sie braucht. */
type Kachel = RenderedSpread & { locked?: boolean };

interface OverviewProps {
  spreadCount: number;
  chapters: { year: number; photoCount: number; firstSpreadIndex: number }[];
  /** Erste Doppelseite jeder aktiven Fotogruppe. */
  groupMarks?: { spreadIndex: number; title: string }[];
  imageSrc: (photoId: string) => string;
  onOpen: (index: number) => void;
  /**
   * Eine eigene Doppelseite an dieser Stelle einfügen.
   *
   * Die Stelle ist hier zu wählen und nicht in der Doppelseitenansicht: Wo eine
   * selbst gebaute Seite hingehört, sieht man am Rhythmus der Nachbarn, nicht an
   * einer einzelnen Seite.
   */
  onInsert?: (at: number) => void;
}

const TILE_WIDTH = 260;

export function Overview({
  spreadCount,
  chapters,
  groupMarks = [],
  imageSrc,
  onOpen,
  onInsert,
}: OverviewProps) {
  const [loaded, setLoaded] = useState<Map<number, Kachel>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  /** Kachel unter dem Zeiger – nur damit ihr Einfügeknopf hervortritt. */
  const [beruehrt, setBeruehrt] = useState<number | null>(null);

  const chapterAt = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of chapters) map.set(c.firstSpreadIndex, c.year);
    return map;
  }, [chapters]);

  const groupAt = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of groupMarks) map.set(g.spreadIndex, g.title);
    return map;
  }, [groupMarks]);

  // Nur sichtbare Kacheln laden. Bei über hundert Doppelseiten mit je bis zu
  // zwölf Bildern wäre alles auf einmal weder für den Speicher noch für das
  // Netz sinnvoll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset['index']);
            if (entry.isIntersecting) next.add(idx);
          }
          return next;
        });
      },
      { root: null, rootMargin: '400px' },
    );

    for (const tile of el.querySelectorAll('[data-index]')) observer.observe(tile);
    return () => observer.disconnect();
  }, [spreadCount]);

  useEffect(() => {
    const fehlend = [...visible].filter((i) => !loaded.has(i));
    if (fehlend.length === 0) return;

    let abgebrochen = false;
    void Promise.all(
      fehlend.map((i) =>
        fetch(`/api/spreads/${i}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => [i, data] as const),
      ),
    ).then((paare) => {
      if (abgebrochen) return;
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const [i, data] of paare) if (data) next.set(i, data);
        return next;
      });
    });

    return () => {
      abgebrochen = true;
    };
  }, [visible, loaded]);

  return (
    <div ref={containerRef}>
      <div style={S.grid}>
        {Array.from({ length: spreadCount }, (_, i) => {
          const spread = loaded.get(i);
          const jahr = chapterAt.get(i);
          const gruppe = groupAt.get(i);
          return (
            <div
              key={i}
              data-index={i}
              style={S.cell}
              onMouseEnter={() => setBeruehrt(i)}
              onMouseLeave={() => setBeruehrt((b) => (b === i ? null : b))}
            >
              {jahr !== undefined && <div style={S.yearMark}>{jahr}</div>}
              {gruppe && (
                <div style={{ ...S.groupMark, ...(jahr !== undefined ? S.groupMarkShifted : {}) }}>
                  {gruppe}
                </div>
              )}
              {/*
                Der Einfügeknopf sitzt an der linken Kante der Kachel, weil er
                die Stelle *vor* dieser Seite meint. Er tritt erst beim
                Überfahren hervor – über achtzig Doppelseiten wären achtzig
                gleich laute Knöpfe nur Lärm.
              */}
              {onInsert && (
                <button
                  onClick={() => onInsert(i)}
                  style={{ ...S.insert, opacity: beruehrt === i ? 1 : 0.25 }}
                  title={`Eigene Doppelseite vor Seite ${i + 1} einfügen`}
                >
                  ＋
                </button>
              )}
              <button
                onClick={() => onOpen(i)}
                style={{ ...S.tile, ...(spread?.locked ? S.tileLocked : {}) }}
                title={`Doppelseite ${i + 1} öffnen`}
              >
                {spread ? (
                  <SpreadView
                    spread={spread}
                    widthPx={TILE_WIDTH}
                    imageSrc={imageSrc}
                    guides={{}}
                  />
                ) : (
                  <div style={{ ...S.placeholder, width: TILE_WIDTH, height: TILE_WIDTH / 2 }} />
                )}
              </button>
              <span style={S.caption}>
                {/* Das Schloss sagt: Diese Seite übersteht ein Neuanordnen. */}
                {spread?.locked && <span title="Festgehalten — selbst gebaut">🔒 </span>}
                {i + 1}
                {spread && ` · ${spread.boxes.filter((b) => b.kind === 'image').length} Fotos`}
              </span>
            </div>
          );
        })}
        {/*
          Die letzte Stelle hat keine Kachel, an deren Kante sie sitzen könnte –
          deshalb eine eigene Zelle am Ende des Gitters.
        */}
        {onInsert && spreadCount > 0 && (
          <div style={S.cell}>
            <button
              onClick={() => onInsert(spreadCount)}
              style={{ ...S.tile, ...S.endTile, height: TILE_WIDTH / 2 }}
              title="Eigene Doppelseite am Ende des Buches einfügen"
            >
              ＋ eigene Seite
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_WIDTH}px, 1fr))`,
    gap: '1.5rem 1rem',
    alignItems: 'start',
  },
  cell: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.3rem',
  },
  groupMark: {
    position: 'absolute' as const,
    top: '-0.9rem',
    left: 0,
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#0369a1',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  /** Steht ein Jahr daneben, rückt die Gruppe nach rechts. */
  groupMarkShifted: { left: '2.6rem' },
  yearMark: {
    position: 'absolute' as const,
    top: '-0.9rem',
    left: 0,
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#2563eb',
  },
  tile: {
    padding: 0,
    border: '1px solid #e5e7eb',
    background: '#fff',
    cursor: 'pointer',
    lineHeight: 0,
    overflow: 'hidden',
    width: TILE_WIDTH,
  },
  /** Festgehaltene Seiten stehen sichtbar für sich – sie sind Handarbeit. */
  tileLocked: { borderColor: '#0369a1', boxShadow: '0 0 0 2px #e0f2fe' },
  insert: {
    position: 'absolute' as const,
    left: -13,
    top: '38%',
    width: 22,
    height: 22,
    padding: 0,
    lineHeight: '18px',
    borderRadius: '50%',
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#0369a1',
    cursor: 'pointer',
    fontSize: '0.75rem',
    zIndex: 1,
  },
  endTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    color: '#0369a1',
    fontSize: '0.8125rem',
    lineHeight: 1.4,
  },
  placeholder: { background: '#f3f4f6' },
  caption: { fontSize: '0.7rem', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' as const },
};
