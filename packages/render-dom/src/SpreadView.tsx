/**
 * Doppelseitenvorschau.
 *
 * Projiziert ein RenderedSpread auf den Bildschirm. Enthält bewusst keine
 * Layoutlogik – jede Position stammt aus dem Modell, umgerechnet über genau
 * einen Skalierungsfaktor.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Crop, Guide, ImageBox, RenderBox, RenderedSpread } from '@franibook/core';

export interface GuideVisibility {
  bleed?: boolean;
  trim?: boolean;
  safety?: boolean;
  gutter?: boolean;
  /** Auflösung, Slotkennungen und Warnungen einblenden. */
  diagnostics?: boolean;
}

export interface SpreadViewProps {
  spread: RenderedSpread;
  /** Darstellungsbreite in Pixeln. Bestimmt den Maßstab. */
  widthPx: number;
  /** Liefert die Bildquelle zu einer Foto-Kennung. */
  imageSrc: (photoId: string) => string;
  guides?: GuideVisibility;
  onSlotClick?: (slotId: string) => void;
  /** Kennzeichnet den ausgewählten Slot. */
  selectedSlotId?: string;
}

const GUIDE_STYLES: Record<Guide['kind'], CSSProperties> = {
  bleed: { outline: '1px solid rgba(220, 38, 38, 0.5)' },
  trim: { outline: '1px solid rgba(37, 99, 235, 0.9)' },
  safety: { outline: '1px dashed rgba(37, 99, 235, 0.45)' },
  'gutter-zone': { background: 'rgba(120, 120, 120, 0.12)' },
  gutter: { borderLeft: '1px dashed rgba(0, 0, 0, 0.5)' },
};

/**
 * Setzt den Bildausschnitt exakt so um, wie ihn der PDF-Renderer interpretiert.
 *
 * Das Bild wird auf `1/crop.w` der Containerbreite skaliert und so verschoben,
 * dass genau der gespeicherte Bereich sichtbar ist. Der naive Weg über
 * `object-fit: cover` mit `object-position: center` liefert für zentrierte
 * Ausschnitte zufällig dasselbe Ergebnis und weicht ab, sobald jemand den
 * Ausschnitt von Hand verschiebt – genau die Klasse Fehler, die der
 * Parity-Test aufdecken soll.
 */
function cropStyle(crop: Crop): CSSProperties {
  return {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x * 100) / crop.w}%`,
    top: `${(-crop.y * 100) / crop.h}%`,
    display: 'block',
    // Kein object-fit: Die Skalierung steckt bereits in width/height, und die
    // Ausschnittsberechnung garantiert, dass das Seitenverhältnis passt.
    objectFit: 'fill',
  };
}

function severityOf(box: ImageBox): 'none' | 'warn' | 'error' {
  if (box.warnings.some((w) => w.code === 'below-min-dpi' || w.code === 'photo-missing')) {
    return 'error';
  }
  if (box.warnings.length > 0) return 'warn';
  return 'none';
}

export function SpreadView({
  spread,
  widthPx,
  imageSrc,
  guides = {},
  onSlotClick,
  selectedSlotId,
}: SpreadViewProps) {
  // Der einzige Maßstab der gesamten Vorschau.
  const pxPerMm = widthPx / spread.widthMm;
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
      data-testid="spread"
      data-spread-id={spread.spreadId}
      style={{
        position: 'relative',
        width: mm(spread.widthMm),
        height: mm(spread.heightMm),
        background: spread.background,
        overflow: 'hidden',
      }}
    >
      {spread.boxes.map((box, i) => renderBox(box, i))}

      {spread.guides.map((guide, i) => {
        if (!isGuideVisible(guide, guides)) return null;
        return (
          <div
            key={`guide-${i}`}
            aria-hidden
            style={{ ...rect(guide), ...GUIDE_STYLES[guide.kind], pointerEvents: 'none' }}
          />
        );
      })}
    </div>
  );

  function renderBox(box: RenderBox, i: number): ReactNode {
    switch (box.kind) {
      case 'image': {
        const severity = severityOf(box);
        const missing = box.warnings.some((w) => w.code === 'photo-missing');
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
              background: missing
                ? 'repeating-linear-gradient(45deg,#fee,#fee 6px,#fdd 6px,#fdd 12px)'
                : undefined,
              outline:
                selectedSlotId === box.slotId
                  ? '2px solid #2563eb'
                  : guides.diagnostics && severity !== 'none'
                    ? `2px solid ${severity === 'error' ? '#dc2626' : '#f59e0b'}`
                    : undefined,
              outlineOffset: '-2px',
            }}
          >
            {!missing && (
              <img
                src={imageSrc(box.photoId)}
                alt=""
                style={cropStyle(box.crop)}
                draggable={false}
              />
            )}
            {guides.diagnostics && (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 0,
                  padding: '1px 4px',
                  fontSize: '10px',
                  fontFamily: 'ui-monospace, monospace',
                  color: '#fff',
                  background:
                    severity === 'error'
                      ? '#dc2626'
                      : severity === 'warn'
                        ? '#f59e0b'
                        : 'rgba(0,0,0,0.6)',
                }}
              >
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

function isGuideVisible(guide: Guide, v: GuideVisibility): boolean {
  switch (guide.kind) {
    case 'bleed':
      return v.bleed ?? false;
    case 'trim':
      return v.trim ?? false;
    case 'safety':
      return v.safety ?? false;
    case 'gutter':
    case 'gutter-zone':
      return v.gutter ?? false;
  }
}
