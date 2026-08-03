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
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  CSS_FONT_WEIGHT,
  type Crop,
  type Guide,
  type ImageBox,
  type RenderBox,
  type RenderedSpread,
  fontFamily,
  ptToMm,
  resolveWeight,
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

/**
 * Foto von Slot zu Slot ziehen.
 *
 * Absichtlich nur Ereignisse, keine Bibliothek: `dnd-kit` (im Issue
 * vorgesehen) hätte dieses Paket von einer UI-Abhängigkeit abhängig gemacht,
 * obwohl der Renderer nichts weiter braucht als „hier begann es, hier endet
 * es". Was ein Zug bedeutet, entscheidet allein der Aufrufer – der Renderer
 * trifft weder eine Layout- noch eine Modellentscheidung. Die
 * Tastaturbedienung läuft entsprechend über die Slotauswahl und den Fotopool,
 * nicht über den Ziehvorgang.
 */
export interface SlotDragHandlers {
  onDragStart: (slotId: string) => void;
  onDrop: (slotId: string) => void;
  onDragEnd?: () => void;
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
  /**
   * Beginn eines Ziehvorgangs im Slot – für den Ausschnitt-Editor.
   *
   * Der Aufrufer rechnet die Mausbewegung in eine Ausschnittsänderung um und
   * schickt das Ergebnis als geändertes Modell zurück in diese Ansicht. Damit
   * bleibt auch beim Ziehen jede Position eine Position aus dem RSM.
   */
  onSlotPointerDown?: (slotId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  slotDrag?: SlotDragHandlers;
  /**
   * Zusätzliche Einblendung über einem Slot, etwa die Auflösung, die ein
   * gezogenes Foto hier erreichen würde. Rein darstellend; der Renderer
   * bestimmt nur das Rechteck, den Inhalt der Aufrufer.
   */
  slotOverlay?: (slot: { slotId: string; kind: 'image' | 'empty' }) => ReactNode;
}

/**
 * Die Hilfslinien.
 *
 * Warme Töne statt Blau, und zwar aus einem inhaltlichen Grund: Diese Linien
 * liegen über Fotos, und ein gesättigtes Blau daneben verschiebt, wie man deren
 * Farbstich einschätzt. Nur die Beschnittkante bleibt rot – sie ist die eine
 * Grenze, hinter der Fläche verloren geht.
 *
 * Der PDF-Renderer kennt Hilfslinien nicht; sie sind reine Bildschirmsache und
 * damit keine Parity-Frage.
 */
const GUIDE_STYLES: Record<Guide['kind'], CSSProperties> = {
  bleed: { outline: '1px solid rgba(185, 68, 43, 0.5)' },
  trim: { outline: '1px solid rgba(136, 124, 114, 0.9)' },
  safety: { outline: '1px dashed rgba(136, 124, 114, 0.55)' },
  'gutter-zone': { background: 'rgba(84, 76, 70, 0.07)' },
  gutter: { borderLeft: '1px dashed rgba(84, 76, 70, 0.45)' },
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

/**
 * Das Zeichen, das beim Ziehen am Zeiger hängt.
 *
 * Der Browser nimmt sonst ein halbdurchsichtiges Abbild des gezogenen Elements –
 * bei einem Bild von 120 mm Kantenlänge ist das ein Schatten, der genau die
 * Stelle verdeckt, an der man das Ziel sucht. Ein kleines Quadrat am Zeiger
 * lässt die Doppelseite frei.
 *
 * Der Knoten wird einmal erzeugt und behalten: `setDragImage` braucht ein
 * Element, das im Dokument steht und beim Aufruf schon gezeichnet ist. Er sitzt
 * außerhalb des sichtbaren Bereichs statt auf `display: none` – ein
 * ausgeblendetes Element nimmt der Browser nicht an.
 */
let DRAG_BILD: HTMLElement | undefined;

export function dragBild(): HTMLElement {
  if (DRAG_BILD?.isConnected) return DRAG_BILD;

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    top: '-100px',
    left: '-100px',
    width: '28px',
    height: '28px',
    borderRadius: '5px',
    background: '#00afcb',
    boxShadow: '0 2px 6px rgba(84,76,70,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  // Ein Bildsymbol: Rahmen mit Horizont und Sonne, in Weiß auf dem Türkis.
  el.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
    '<circle cx="8.5" cy="9.5" r="1.5"/>' +
    '<path d="M21 16l-5-5-4 4-2-2-4 4"/></svg>';

  document.body.appendChild(el);
  DRAG_BILD = el;
  return el;
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
  onSlotPointerDown,
  slotDrag,
  slotOverlay,
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

  /**
   * Ereignisse für das Ziehen eines Fotos an einem Slot.
   *
   * Der ausgewählte Slot ist bewusst nicht ziehbar: Dort zieht die Maus den
   * Ausschnitt. Ohne diese Trennung bräuchte es eine Zusatztaste, um zwischen
   * „Bild verschieben" und „Ausschnitt verschieben" zu unterscheiden – ein
   * Klick als Umschalter ist ohne Erklärung verständlich.
   */
  function dragProps(slotId: string, hasPhoto: boolean) {
    if (!slotDrag) return {};
    return {
      draggable: hasPhoto && selectedSlotId !== slotId,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.effectAllowed = 'move';
        // Ohne Nutzlast bricht Firefox den Zug sofort ab.
        e.dataTransfer.setData('text/plain', slotId);
        // Statt des halbdurchsichtigen Abbilds des ganzen Slots ein kleines
        // Zeichen am Zeiger: Ein 120-mm-Bild als Schatten verdeckt beim Ziehen
        // genau die Stelle, an der man das Ziel sucht.
        e.dataTransfer.setDragImage(dragBild(), 14, 14);
        slotDrag.onDragStart(slotId);
      },
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        slotDrag.onDrop(slotId);
      },
      onDragEnd: () => slotDrag.onDragEnd?.(),
    };
  }

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
            onPointerDown={onSlotPointerDown ? (e) => onSlotPointerDown(box.slotId, e) : undefined}
            {...dragProps(box.slotId, true)}
            style={{
              ...rect(box),
              overflow: 'hidden',
              // Drehung um den Mittelpunkt – dieselbe Festlegung wie im PDF.
              // CSS dreht ohne `transform-origin` genau darum, und der Kasten
              // nimmt das Bild samt Ausschnitt mit.
              ...(box.rotateDeg ? { transform: `rotate(${box.rotateDeg}deg)` } : {}),
              cursor: selectedSlotId === box.slotId ? 'grab' : onSlotClick ? 'pointer' : undefined,
              // Beim Ziehen des Ausschnitts darf der Browser nicht anfangen,
              // Text zu markieren – sonst reißt die Bewegung ab.
              userSelect: onSlotPointerDown ? 'none' : undefined,
              touchAction: onSlotPointerDown ? 'none' : undefined,
              background: missing
                ? 'repeating-linear-gradient(45deg,#fbf1ee,#fbf1ee 6px,#f3ded8 6px,#f3ded8 12px)'
                : undefined,
              outline:
                selectedSlotId === box.slotId
                  ? '2px solid #00afcb'
                  : guides.diagnostics && severity !== 'none'
                    ? `2px solid ${severity === 'error' ? '#b9442b' : '#c98a14'}`
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
                      ? '#b9442b'
                      : severity === 'warn'
                        ? '#c98a14'
                        : 'rgba(84,76,70,0.7)',
                }}
              >
                {box.slotId} · {Math.round(box.effectiveDpi)} dpi
              </span>
            )}
            {slotOverlay?.({ slotId: box.slotId, kind: 'image' })}
          </div>
        );
      }

      case 'empty':
        return (
          <div
            key={box.slotId}
            data-testid={`slot-${box.slotId}`}
            onClick={onSlotClick ? () => onSlotClick(box.slotId) : undefined}
            {...dragProps(box.slotId, false)}
            style={{
              ...rect(box),
              border: '1px dashed rgba(84,76,70,0.25)',
              cursor: onSlotClick ? 'pointer' : undefined,
              outline: selectedSlotId === box.slotId ? '2px solid #00afcb' : undefined,
              outlineOffset: '-2px',
            }}
          >
            {slotOverlay?.({ slotId: box.slotId, kind: 'empty' })}
          </div>
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
        const baselineMm = textBaselineOffsetMm(box.hMm, box.fontSizePt, box.family ?? 'sans');
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
            style={{
              ...rect(box),
              overflow: 'visible',
              // Der Drehpunkt kommt aus dem Modell: Bei mehrzeiligem Text ist
              // es der Mittelpunkt des ganzen Blocks, nicht der dieser Zeile.
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
              // Alle vier Werte stammen aus dem RSM. Die Größe steht in Punkt,
              // im viewBox sind die Einheiten Millimeter.
              fontFamily={fontFamily(box.family ?? 'sans').cssName}
              fontWeight={CSS_FONT_WEIGHT[resolveWeight(box.family ?? 'sans', box.weight)]}
              fontSize={ptToMm(box.fontSizePt)}
              fill={box.color}
              // Im viewBox sind die Einheiten Millimeter, die Zahl wandert also
              // unverändert aus dem Modell. Im PDF steht dieselbe Zahl in Punkt.
              {...(box.letterSpacingMm ? { letterSpacing: box.letterSpacingMm } : {})}
            >
              {box.content}
            </text>
          </svg>
        );
      }

      case 'rect':
        return (
          <div
            key={`rect-${i}`}
            style={{
              ...rect(box),
              background: box.fill,
              // Der Radius kommt aus dem Modell und wird nur in die
              // Längeneinheit der Vorschau übersetzt.
              ...(box.rxMm ? { borderRadius: mm(box.rxMm) } : {}),
            }}
          />
        );

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
