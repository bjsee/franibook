/**
 * Der Nachbarstreifen als Ablagefläche.
 *
 * Warum es ihn gibt und warum zwei Seiten in jede Richtung reichen, steht in
 * `useNachbarn.ts`. Hier steht nur, wie er aussieht: fünf Kacheln, die aufgeschlagene
 * mit türkisem Rahmen, beim Ziehen werden die anderen vier zu Zielen.
 */
import { useState } from 'react';
import { SpreadView } from '@franibook/render-dom';
import { T } from '../theme.js';
import { miniaturSrc, useNachbarn } from './useNachbarn.js';

/** Breite einer Kachel in Pixeln. */
const KACHEL_PX = 132;

interface Props {
  index: number;
  spreadCount: number;
  /** Ob gerade ein Bild gezogen wird – dann werden die Kacheln zu Zielen. */
  zieht: boolean;
  /** Zählt hoch, wenn sich am Buch etwas geändert hat. */
  version: number;
  onOpen: (spreadIndex: number) => void;
  onDrop: (spreadIndex: number) => void;
}

export function Nachbarn({ index, spreadCount, zieht, version, onOpen, onDrop }: Props) {
  const { nachbarn, geladen } = useNachbarn(index, spreadCount, 2, version);
  const [ueber, setUeber] = useState<number | null>(null);

  if (spreadCount <= 1) return null;

  return (
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
                  imageSrc={miniaturSrc}
                  guides={{}}
                />
              ) : (
                <div style={S.platzhalter} />
              )}
              {/*
                Eine durchsichtige Fläche über der Miniatur: Sonst schluckt das
                SVG der Vorschau die Zeigerereignisse, und die Kachel bekäme
                weder Klick noch Fallenlassen zu sehen.
              */}
              <div style={S.deckel} />
            </div>
            <span style={S.nummer}>{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

const S = {
  reihe: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  kachel: {
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
    padding: 2,
    background: T.bg1,
    cursor: 'pointer',
    lineHeight: 0,
    textAlign: 'center' as const,
  },
  kachelHier: { borderColor: T.cyan, cursor: 'default' },
  kachelZiel: { borderColor: T.cyanRand, background: T.cyanZart },
  kachelUeber: {
    borderColor: T.cyan,
    background: T.cyanZart,
    boxShadow: `0 0 0 2px ${T.cyanZart}`,
  },
  bild: { position: 'relative' as const, width: KACHEL_PX },
  deckel: { position: 'absolute' as const, inset: 0 },
  platzhalter: { width: KACHEL_PX, height: KACHEL_PX / 2, background: T.bg3 },
  nummer: {
    display: 'block',
    fontSize: 11,
    color: T.fg3,
    lineHeight: 1.8,
    fontVariantNumeric: 'tabular-nums' as const,
  },
} satisfies Record<string, React.CSSProperties>;
