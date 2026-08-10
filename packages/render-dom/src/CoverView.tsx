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
import { type CSSProperties, type ReactNode, useId } from 'react';
import {
  CSS_FONT_WEIGHT,
  type CoverBox,
  type CoverGuide,
  type ImageBox,
  type RenderedCover,
  fontFamily,
  ptToMm,
  resolveWeight,
  textBaselineOffsetMm,
} from '@franibook/core';
import { Farbfilter, farbfilterStil, filterPraefix } from './farbfilter.js';

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
  // Wie in der Doppelseitenvorschau: Die Filterkennungen müssen im Dokument
  // eindeutig sein, auch wenn Umschlag und Innenteil nebeneinanderstehen.
  const filterId = filterPraefix(useId());
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
      <Farbfilter praefix={filterId} boxes={cover.boxes} />

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
              <img
                src={imageSrc(box.photoId)}
                alt=""
                style={{ ...cropStyle(box), ...farbfilterStil(filterId, box) }}
                draggable={false}
              />
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

      // Wie im Innenteil (`SpreadView.tsx`): Text steckt in einem SVG, weil
      // dort die Grundlinie eine Koordinate ist. Eine `div` mit
      // `align-items: center; line-height: 1` verlegt die Zeilenhöhe in den
      // Halbdurchschuss der CSS-Zeilenbox – plattformabhängig und, wichtiger,
      // eine zweite Rechnung über dieselbe Grundlinie, die der Kern längst
      // festgelegt hat (`textBaselineOffsetMm`). Im SVG steht schlicht
      // `y = Grundlinie`, genau wie im PDF `baseline: 'alphabetic'`.
      case 'text': {
        const baselineMm = textBaselineOffsetMm(box.hMm, box.fontSizePt, box.family ?? 'sans');
        const anchor = box.align === 'center' ? 'middle' : box.align === 'right' ? 'end' : 'start';
        const xMm = box.align === 'center' ? box.wMm / 2 : box.align === 'right' ? box.wMm : 0;
        return (
          <svg
            key={box.slotId}
            data-testid={`slot-${box.slotId}`}
            viewBox={`0 0 ${box.wMm} ${box.hMm}`}
            // Ober- und Unterlängen dürfen über den Kasten hinausreichen; ein
            // SVG beschneidet am viewBox, wenn man es nicht abstellt.
            style={{
              ...rect(box),
              overflow: 'visible',
              // Drehung um den Mittelpunkt der Box – dieselbe Festlegung, die
              // die Vorschau des Innenteils und das PDF beide treffen.
              ...(box.rotateDeg
                ? {
                    transform: `rotate(${box.rotateDeg}deg)`,
                    transformOrigin: box.rotateAboutMm
                      ? `${mm(box.rotateAboutMm.xMm - box.xMm)} ${mm(box.rotateAboutMm.yMm - box.yMm)}`
                      : 'center',
                  }
                : {}),
            }}
          >
            <text
              x={xMm}
              y={baselineMm}
              textAnchor={anchor}
              // Alle vier Werte stammen aus dem RCM. Die Größe steht in Punkt,
              // im viewBox sind die Einheiten Millimeter.
              fontFamily={fontFamily(box.family ?? 'sans').cssName}
              fontWeight={CSS_FONT_WEIGHT[resolveWeight(box.family ?? 'sans', box.weight)]}
              fontSize={ptToMm(box.fontSizePt)}
              fill={box.color}
              {...(box.letterSpacingMm ? { letterSpacing: box.letterSpacingMm } : {})}
            >
              {box.content}
            </text>
          </svg>
        );
      }

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
