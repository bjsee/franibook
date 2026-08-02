/**
 * Doppelseitenvorschau.
 *
 * Projiziert ein RenderedSpread auf den Bildschirm. Enthält bewusst keine
 * Layoutlogik – jede Position stammt aus dem Modell, umgerechnet über genau
 * einen Skalierungsfaktor.
 *
 * Die Buchschrift muss die Anwendung selbst laden (`apps/web/src/fonts.css`);
 * eine Komponente hat keinen Ort, an dem sie ein `@font-face` unterbringen
 * könnte. Fehlt es, zeigt die Vorschau eine Systemschrift – auffällig genug,
 * und der Parity-Test schlägt an.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  BOOK_FONT_FAMILY,
  CSS_FONT_WEIGHT,
  type Crop,
  type Guide,
  type ImageBox,
  type RenderBox,
  type RenderedSpread,
  ptToMm,
  textBaselineOffsetMm,
} from '@franibook/core';

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

      /**
       * Text steckt in einem SVG, weil dort die Grundlinie eine Koordinate ist.
       *
       * Vorher war es ein `div` mit `align-items: center` und `line-height: 1`.
       * Das sieht harmlos aus, verlegt die Entscheidung über die Höhe der Zeile
       * aber in den Halbdurchschuss der CSS-Zeilenbox – und der leitet sich je
       * nach Plattform aus hhea oder den OS/2-Typo-Metriken ab. Im SVG steht
       * schlicht `y = Grundlinie`, genau wie im PDF `baseline: 'alphabetic'`.
       */
      case 'text': {
        // Die Grundlinie kommt aus dem Modell; hier wird sie nur getroffen.
        const baselineMm = textBaselineOffsetMm(box.hMm, box.fontSizePt);
        const anchor = box.align === 'center' ? 'middle' : box.align === 'right' ? 'end' : 'start';
        const xMm = box.align === 'center' ? box.wMm / 2 : box.align === 'right' ? box.wMm : 0;
        return (
          <svg
            key={box.slotId}
            // Die Größe steht wie bei jeder anderen Box in `rect`; der viewBox
            // macht daraus Millimeter als Zeichenkoordinaten.
            viewBox={`0 0 ${box.wMm} ${box.hMm}`}
            // Ober- und Unterlängen dürfen über den Kasten hinausreichen; ein
            // SVG beschneidet am viewBox, wenn man es nicht abstellt.
            style={{ ...rect(box), overflow: 'visible' }}
          >
            <text
              x={xMm}
              y={baselineMm}
              textAnchor={anchor}
              // Alle vier Werte stammen aus dem RSM. Die Größe steht in Punkt,
              // im viewBox sind die Einheiten Millimeter.
              fontFamily={BOOK_FONT_FAMILY}
              fontWeight={CSS_FONT_WEIGHT[box.weight]}
              fontSize={ptToMm(box.fontSizePt)}
              fill={box.color}
            >
              {box.content}
            </text>
          </svg>
        );
      }

      case 'rect':
        return <div key={`rect-${i}`} style={{ ...rect(box), background: box.fill }} />;

      case 'polygon': {
        if (box.pointsMm.length === 0) return null;
        // Die viewBox ist in Millimetern aufgespannt, deshalb wandern die Punkte
        // unverändert aus dem Modell in das SVG – keine zweite Umrechnung, die
        // von der des PDF-Renderers abweichen könnte. Über CSS clip-path wäre
        // dieselbe Form möglich, rundet aber anders als pdfkit.
        return (
          <svg
            key={`poly-${i}`}
            aria-hidden
            viewBox={`0 0 ${spread.widthMm} ${spread.heightMm}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: mm(spread.widthMm),
              height: mm(spread.heightMm),
              pointerEvents: 'none',
            }}
          >
            <polygon
              points={box.pointsMm.map((p) => `${p.xMm},${p.yMm}`).join(' ')}
              fill={box.fill}
            />
          </svg>
        );
      }
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
