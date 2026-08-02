/**
 * Die Nachbarn der offenen Doppelseite, als Ablagefläche.
 *
 * Ein Bild von einer Seite auf die andere zu ziehen braucht ein Ziel, das man
 * sehen kann. Der Umweg über den Fotopool – Bild herausnehmen, blättern, wieder
 * hineinziehen – geht zwar, verlangt aber drei Handgriffe und ein gutes
 * Gedächtnis dafür, welches der 830 Bilder gerade gemeint war.
 *
 * Gezeigt werden zwei Seiten in jede Richtung. Weiter zu springen ist selten:
 * Ein Bild sitzt fast immer auf der falschen von zwei benachbarten Seiten, weil
 * die Seitenverteilung an einer Tagesgrenze anders gefallen ist, als man es
 * erzählen würde. Wer wirklich zwanzig Seiten weit umhängen will, nimmt den
 * Pool.
 *
 * Die Miniaturen ziehen ihre Bilder aus den 320-px-Vorschauen und nicht aus
 * denen, die die Bühne zeigt: Fünf Doppelseiten in voller Vorschauauflösung
 * wären ein Vielfaches an Daten für eine Kachel von 150 Pixeln Breite.
 */
import { useEffect, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';

/** So viele Seiten in jede Richtung. */
const REICHWEITE = 2;

/** Breite einer Kachel in Pixeln. */
const KACHEL_PX = 150;

/**
 * Verzögerung, bis die Nachbarn geladen werden.
 *
 * Beim Durchblättern mit den Pfeiltasten wechselt der Index im Sekundentakt;
 * ohne die Pause liefe für jede übersprungene Seite ein Satz Anfragen.
 */
const LADE_VERZOEGERUNG_MS = 250;

interface Props {
  index: number;
  spreadCount: number;
  /** Ob gerade ein Bild gezogen wird – dann werden die Kacheln zu Zielen. */
  zieht: boolean;
  /** Ein Bild wurde auf diese Doppelseite fallengelassen. */
  onDrop: (spreadIndex: number) => void;
  /** Klick auf eine Kachel blättert dorthin. */
  onOpen: (spreadIndex: number) => void;
  /**
   * Zählt hoch, wenn sich am Buch etwas geändert hat.
   *
   * Nach einem Umzug stimmt die Miniatur der Zielseite nicht mehr – sie hat ein
   * Bild mehr und eine andere Vorlage.
   */
  version: number;
}

export function SpreadNeighbors({ index, spreadCount, zieht, onDrop, onOpen, version }: Props) {
  const [geladen, setGeladen] = useState<Map<number, RenderedSpread>>(new Map());
  const [ueber, setUeber] = useState<number | null>(null);

  const nachbarn: number[] = [];
  for (let i = index - REICHWEITE; i <= index + REICHWEITE; i++) {
    if (i >= 0 && i < spreadCount) nachbarn.push(i);
  }
  const schluessel = nachbarn.join(',');

  useEffect(() => {
    let abgebrochen = false;
    const timer = setTimeout(() => {
      void (async () => {
        const eintraege = await Promise.all(
          schluessel
            .split(',')
            .filter(Boolean)
            .map(async (s) => {
              const i = Number(s);
              try {
                const res = await fetch(`/api/spreads/${i}`);
                if (!res.ok) return undefined;
                return [i, (await res.json()) as RenderedSpread] as const;
              } catch {
                return undefined;
              }
            }),
        );
        if (abgebrochen) return;
        setGeladen(new Map(eintraege.filter((e): e is [number, RenderedSpread] => !!e)));
      })();
    }, LADE_VERZOEGERUNG_MS);

    return () => {
      abgebrochen = true;
      clearTimeout(timer);
    };
  }, [schluessel, version]);

  if (spreadCount <= 1) return null;

  return (
    <section style={S.streifen}>
      <span style={S.label}>
        {zieht ? 'Auf eine Doppelseite ziehen — sie wird neu angeordnet' : 'Nachbarseiten'}
      </span>
      <div style={S.reihe}>
        {nachbarn.map((i) => {
          const spread = geladen.get(i);
          const hier = i === index;
          const zielAktiv = zieht && !hier;
          return (
            <div
              key={i}
              onClick={() => !hier && onOpen(i)}
              onDragOver={(e) => {
                if (!zielAktiv) return;
                // Ohne preventDefault lehnt der Browser das Fallenlassen ab.
                e.preventDefault();
                setUeber(i);
              }}
              onDragLeave={() => setUeber((v) => (v === i ? null : v))}
              onDrop={(e) => {
                if (!zielAktiv) return;
                e.preventDefault();
                setUeber(null);
                onDrop(i);
              }}
              title={hier ? 'Diese Doppelseite' : `Doppelseite ${i + 1} aufschlagen`}
              style={{
                ...S.kachel,
                ...(hier ? S.kachelHier : {}),
                ...(zielAktiv ? S.kachelZiel : {}),
                ...(ueber === i ? S.kachelUeber : {}),
              }}
            >
              <div style={S.bild}>
                {spread ? (
                  <SpreadView
                    spread={spread}
                    widthPx={KACHEL_PX}
                    imageSrc={(photoId) => `/api/photos/${photoId}/preview?size=thumb`}
                    guides={{}}
                  />
                ) : (
                  <div style={S.platzhalter} />
                )}
                {/*
                  Eine durchsichtige Fläche über der Miniatur: Sonst schluckt
                  das SVG der Vorschau die Zeigerereignisse, und die Kachel
                  bekäme weder Klick noch Fallenlassen zu sehen.
                */}
                <div style={S.deckel} />
              </div>
              <span style={S.nummer}>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const S = {
  streifen: { marginTop: '0.75rem' },
  label: { fontSize: '0.72rem', color: '#9ca3af' },
  reihe: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.3rem' },
  kachel: {
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    padding: '2px',
    background: '#fff',
    cursor: 'pointer',
    lineHeight: 0,
    textAlign: 'center' as const,
  },
  kachelHier: { borderColor: '#111827', cursor: 'default' },
  kachelZiel: { borderColor: '#93c5fd', background: '#eff6ff' },
  kachelUeber: { borderColor: '#1d4ed8', background: '#dbeafe', boxShadow: '0 0 0 2px #bfdbfe' },
  bild: { position: 'relative' as const, width: KACHEL_PX },
  deckel: { position: 'absolute' as const, inset: 0 },
  platzhalter: { width: KACHEL_PX, height: KACHEL_PX / 2, background: '#f3f4f6' },
  nummer: {
    display: 'block',
    fontSize: '0.7rem',
    color: '#6b7280',
    lineHeight: 1.6,
    fontVariantNumeric: 'tabular-nums' as const,
  },
} satisfies Record<string, React.CSSProperties>;
