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

interface OverviewProps {
  spreadCount: number;
  chapters: { year: number; photoCount: number; firstSpreadIndex: number }[];
  imageSrc: (photoId: string) => string;
  onOpen: (index: number) => void;
}

const TILE_WIDTH = 260;

export function Overview({ spreadCount, chapters, imageSrc, onOpen }: OverviewProps) {
  const [loaded, setLoaded] = useState<Map<number, RenderedSpread>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set());

  const chapterAt = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of chapters) map.set(c.firstSpreadIndex, c.year);
    return map;
  }, [chapters]);

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
          return (
            <div key={i} data-index={i} style={S.cell}>
              {jahr !== undefined && <div style={S.yearMark}>{jahr}</div>}
              <button
                onClick={() => onOpen(i)}
                style={S.tile}
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
                {i + 1}
                {spread && ` · ${spread.boxes.filter((b) => b.kind === 'image').length} Fotos`}
              </span>
            </div>
          );
        })}
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
  placeholder: { background: '#f3f4f6' },
  caption: { fontSize: '0.7rem', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' as const },
};
