/**
 * Coveransicht.
 *
 * Projiziert ein RenderedCover auf den Bildschirm – Rückseite, Buchrücken und
 * Vorderseite als ein flach liegender Bogen. Wie die Doppelseitenvorschau
 * enthält sie keine Layoutlogik: jede Position stammt aus dem Modell,
 * umgerechnet über genau einen Skalierungsfaktor.
 *
 * Die Gelenkzonen werden standardmäßig eingeblendet. Sie sind der eine Ort, an
 * dem man am Bildschirm nicht sieht, was im Druck passiert: Dort verschwindet
 * bei der Bindung real Fläche.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { CoverBox, CoverGuide, ImageBox, RenderedCover } from '@franibook/core';

export interface CoverGuideVisibility {
  bleed?: boolean;
  /** Sichtbare Kante, an der der Umschlag um den Deckel gefalzt wird. */
  wrap?: boolean;
  safety?: boolean;
  hinge?: boolean;
  fold?: boolean;
  /** Auflösung, Feldnamen und Rückenbreite einblenden. */
  diagnostics?: boolean;
}

export interface CoverViewProps {
  cover: RenderedCover;
  /** Darstellungsbreite in Pixeln. Bestimmt den Maßstab. */
  widthPx: number;
  imageSrc: (photoId: string) => string;
  guides?: CoverGuideVisibility;
  onSlotClick?: (slotId: string) => void;
}

const GUIDE_STYLES: Record<CoverGuide['kind'], CSSProperties> = {
  bleed: { outline: '1px solid rgba(220, 38, 38, 0.5)' },
  wrap: { outline: '1px solid rgba(37, 99, 235, 0.9)' },
  safety: { outline: '1px dashed rgba(37, 99, 235, 0.45)' },
  hinge: { background: 'rgba(220, 38, 38, 0.16)' },
  spine: { outline: '1px dashed rgba(255, 255, 255, 0.5)' },
  fold: { borderLeft: '1px dashed rgba(0, 0, 0, 0.55)' },
};

/** Wie in der Doppelseitenvorschau: Skalierung steckt in width/height. */
function cropStyle(box: ImageBox): CSSProperties {
  const { crop } = box;
  return {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x * 100) / crop.w}%`,
    top: `${(-crop.y * 100) / crop.h}%`,
    display: 'block',
    objectFit: 'fill',
  };
}

export function CoverView({
  cover,
  widthPx,
  imageSrc,
  guides = { hinge: true },
  onSlotClick,
}: CoverViewProps) {
  // Der einzige Maßstab der gesamten Ansicht.
  const pxPerMm = widthPx / cover.widthMm;
  const mm = (v: number) => `${v * pxPerMm}px`;

  const rect = (b: { xMm: number; yMm: number; wMm: number; hMm: number }): CSSProperties => ({
    position: 'absolute',
    left: mm(b.xMm),
    top: mm(b.yMm),
    width: mm(b.wMm),
    height: mm(b.hMm),
  });

  return (
    <div
      data-testid="cover"
      style={{
        position: 'relative',
        width: mm(cover.widthMm),
        height: mm(cover.heightMm),
        background: cover.background,
        overflow: 'hidden',
      }}
    >
      {cover.boxes.map((box, i) => renderBox(box, i))}

      {cover.guides.map((guide, i) => {
        if (!isGuideVisible(guide, guides)) return null;
        return (
          <div
            key={`guide-${i}`}
            aria-hidden
            style={{ ...rect(guide), ...GUIDE_STYLES[guide.kind], pointerEvents: 'none' }}
          />
        );
      })}

      {guides.diagnostics && (
        <span style={{ ...rect(cover.geometry.panels.spine), ...LABEL_SPINE }}>
          {cover.geometry.spineMm.toFixed(1)} mm · {cover.geometry.pageCount} S.
        </span>
      )}
    </div>
  );

  function renderBox(box: CoverBox, i: number): ReactNode {
    switch (box.kind) {
      case 'image': {
        const fehlt = box.warnings.some((w) => w.code === 'photo-missing');
        const schlecht = box.warnings.some((w) => w.code === 'below-min-dpi');
        return (
          <div
            key={box.slotId}
            data-testid={`slot-${box.slotId}`}
            data-dpi={Math.round(box.effectiveDpi)}
            onClick={onSlotClick ? () => onSlotClick(box.slotId) : undefined}
            style={{
              ...rect(box),
              overflow: 'hidden',
              cursor: onSlotClick ? 'pointer' : undefined,
              background: fehlt
                ? 'repeating-linear-gradient(45deg,#fee,#fee 6px,#fdd 6px,#fdd 12px)'
                : undefined,
              outline: guides.diagnostics && (schlecht || fehlt) ? '2px solid #dc2626' : undefined,
              outlineOffset: '-2px',
            }}
          >
            {!fehlt && (
              <img src={imageSrc(box.photoId)} alt="" style={cropStyle(box)} draggable={false} />
            )}
            {guides.diagnostics && (
              <span style={{ ...LABEL, background: schlecht ? '#dc2626' : 'rgba(0,0,0,0.6)' }}>
                {box.slotId} · {Math.round(box.effectiveDpi)} dpi
              </span>
            )}
          </div>
        );
      }

      case 'empty':
        return (
          <div
            key={box.slotId}
            data-testid={`slot-${box.slotId}`}
            onClick={onSlotClick ? () => onSlotClick(box.slotId) : undefined}
            style={{
              ...rect(box),
              border: '1px dashed rgba(0,0,0,0.25)',
              cursor: onSlotClick ? 'pointer' : undefined,
            }}
          />
        );

      case 'text':
        return (
          <div
            key={box.slotId}
            data-testid={`slot-${box.slotId}`}
            style={{
              ...rect(box),
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                box.align === 'center'
                  ? 'center'
                  : box.align === 'right'
                    ? 'flex-end'
                    : 'flex-start',
              fontSize: `${(box.fontSizePt / 72) * 25.4 * pxPerMm}px`,
              color: box.color,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              // Drehung um den Mittelpunkt – dieselbe Festlegung wie im PDF.
              // CSS dreht ohne `transform-origin` genau darum.
              ...(box.rotateDeg ? { transform: `rotate(${box.rotateDeg}deg)` } : {}),
            }}
          >
            {box.content}
          </div>
        );

      case 'rect':
        return <div key={`rect-${i}`} style={{ ...rect(box), background: box.fill }} />;
    }
  }
}

function isGuideVisible(guide: CoverGuide, v: CoverGuideVisibility): boolean {
  switch (guide.kind) {
    case 'bleed':
      return v.bleed ?? false;
    case 'wrap':
      return v.wrap ?? false;
    case 'safety':
      return v.safety ?? false;
    case 'hinge':
    case 'spine':
      return v.hinge ?? false;
    case 'fold':
      return v.fold ?? false;
  }
}

const LABEL: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 0,
  padding: '1px 4px',
  fontSize: '10px',
  fontFamily: 'ui-monospace, monospace',
  color: '#fff',
};

const LABEL_SPINE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: '2px',
  fontSize: '9px',
  fontFamily: 'ui-monospace, monospace',
  color: '#fff',
  writingMode: 'vertical-rl',
  pointerEvents: 'none',
};
