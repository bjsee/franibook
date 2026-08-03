/**
 * Doppelseite bearbeiten.
 *
 * Diese Datei entscheidet nur noch, welcher Rahmen um die Bühne steht. Das
 * Verhalten liegt in `spread/useSpreadEditor.ts`, die Bühne in
 * `spread/SpreadStage.tsx`, die drei Rahmen in `Inspektor`, `Werkbank` und
 * `Lesetisch`. Vorher war beides eine Datei von 1400 Zeilen, in der Ausschnitts-
 * rechnung und Knopfreihenfolge zwischeneinander standen; ein zweiter Rahmen wäre
 * darin nur als Kopie möglich gewesen.
 */
import type { RenderedSpread } from '@franibook/core';
import { T } from './theme.js';
import type { TextBlockData } from './TextBlocks.js';
import { Inspektor } from './spread/Inspektor.js';
import { Lesetisch } from './spread/Lesetisch.js';
import { Werkbank } from './spread/Werkbank.js';
import { useSpreadEditor } from './spread/useSpreadEditor.js';
import type { SpreadAussen } from './spread/types.js';
import type { Variante } from './spread/varianten.js';

interface Props {
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  onSpread: (spread: RenderedSpread) => void;
  imageSrc: (photoId: string) => string;
  selectedSlotId: string | null;
  onSelect: (slotId: string | null) => void;
  variante: Variante;
  aussen: SpreadAussen;
}

export function SpreadEditor({
  spread,
  onSpread,
  imageSrc,
  selectedSlotId,
  onSelect,
  variante,
  aussen,
}: Props) {
  const model = useSpreadEditor({
    index: aussen.index,
    spread,
    onSpread,
    minDpi: aussen.minDpi,
    targetDpi: aussen.targetDpi,
    selectedSlotId,
    onSelect,
    onChanged: aussen.onGeaendert,
  });

  const Rahmen = variante === 'b' ? Werkbank : variante === 'c' ? Lesetisch : Inspektor;

  return (
    <>
      <Rahmen model={model} aussen={aussen} spread={spread} imageSrc={imageSrc} />
      {/*
        Meldungen des Editors schweben über der Ansicht, statt eine Zeile zu
        belegen: Sie sind kurzlebig („3 Bilder liegen jetzt im Fotopool"), und
        eine dauerhaft freigehaltene Zeile dafür kostet in einer Ansicht, die
        nicht scrollt, genau die Höhe, die der Bühne fehlt.
      */}
      {model.note && (
        <div style={S.toast} role="status">
          {model.note}
          <button onClick={() => model.setNote(null)} style={S.zu} title="Ausblenden">
            ×
          </button>
        </div>
      )}
    </>
  );
}

const S = {
  toast: {
    position: 'fixed' as const,
    left: '50%',
    bottom: 20,
    transform: 'translateX(-50%)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    maxWidth: 'min(640px, calc(100vw - 32px))',
    padding: '10px 12px 10px 16px',
    background: 'var(--warm-900)',
    color: 'var(--warm-50)',
    borderRadius: T.rLg,
    boxShadow: '0 12px 32px rgba(84,76,70,0.32)',
    fontSize: 13,
    lineHeight: 1.5,
  },
  zu: {
    font: 'inherit',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'var(--warm-400)',
    cursor: 'pointer',
    flexShrink: 0,
  },
} satisfies Record<string, React.CSSProperties>;
