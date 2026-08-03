/**
 * Die Bühne — in allen drei Varianten dieselbe.
 *
 * Was sich zwischen Inspektor, Werkbank und Lesetisch unterscheidet, ist die
 * Anordnung der Griffe darum herum; das Papier selbst und alles, was auf ihm
 * geschieht, gehört hierher. Die Vorschau bleibt dabei eine reine Projektion des
 * Modells: Die Griffe der Textblöcke liegen als eigene Ebene *über* ihr und
 * nicht in ihr, sonst müsste `render-dom` wissen, was ein ausgewählter Block ist
 * — eine Bedienungsentscheidung im Renderer, und genau die soll es dort nicht
 * geben.
 */
import type { ReactNode } from 'react';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import { dpiInSlot } from '@franibook/core';
import { T, dpiFarbe } from '../theme.js';
import type { TextBlockData } from '../TextBlocks.js';
import type { PhotoInfo, SpreadEditorModel } from './useSpreadEditor.js';

/** Wortlaut der Datumsquellen aus `model/date.ts`, für die Anzeige. */
export const DATUMSQUELLE: Record<string, string> = {
  manual: 'von Hand',
  exif: 'EXIF',
  exifSecondary: 'EXIF (Nebenfeld)',
  filename: 'aus dem Dateinamen',
  file: 'Dateidatum',
  interpolated: 'geschätzt',
  unknown: 'unbekannt',
};

/** `2015-06-12T14:12:33` → `12.06.2015, 14:12 Uhr`. Ohne Datum: `undefined`. */
export function zeitpunkt(info: PhotoInfo): string | undefined {
  const wert = info.effectiveDate;
  if (!wert) return undefined;
  const [tag, zeit] = wert.split('T');
  const [j, m, t] = (tag ?? '').split('-');
  if (!j || !m || !t) return wert;
  // Die Uhrzeit nur, wenn sie etwas aussagt: Ein aus dem Dateinamen geratenes
  // Datum trägt oft 00:00:00, und das ist keine Aufnahmezeit.
  const uhr = zeit && zeit !== '00:00:00' ? `, ${zeit.slice(0, 5)} Uhr` : '';
  return `${t}.${m}.${j}${uhr}`;
}

interface Props {
  model: SpreadEditorModel;
  imageSrc: (photoId: string) => string;
  guides: GuideVisibility;
  blocks: readonly TextBlockData[];
  /** Breite der Bühne in Pixeln, falls der Rahmen sie selbst bestimmt. */
  breite?: number | undefined;
}

export function SpreadStage({ model, imageSrc, guides, blocks, breite }: Props) {
  const {
    stageRef,
    stageWidth,
    pxPerMm,
    angezeigt,
    beschnittMm,
    trimBreiteMm,
    trimHoeheMm,
    slotRect,
    minDpi,
    targetDpi,
    selectedSlotId,
    zug,
    infosSichtbar,
    infoVon,
    textId,
    pendingText,
  } = model;

  const breitePx = breite ?? stageWidth;

  /**
   * Was über einem Slot liegt.
   *
   * Drei Dinge in einer Rangfolge, weil alle drei denselben Platz beanspruchen:
   * Beim Ziehen zählt die Auflösung des Ziels — sie entscheidet, ob das Foto hier
   * überhaupt hingehört. Sonst die Aufnahmedaten, wenn sie eingeschaltet sind.
   * Die Marke „zu klein" steht immer, unabhängig von den Hilfslinien: Ein Bild,
   * das für seinen Platz nicht reicht, soll man sehen, ohne erst etwas
   * einschalten zu müssen.
   */
  function overlay({ slotId }: { slotId: string; kind: 'image' | 'empty' }): ReactNode {
    if (zug) {
      const rect = slotRect(slotId);
      if (!rect || !zug.photo) return null;
      const dpi = dpiInSlot(zug.photo, rect);
      return (
        <div style={S.dropZiel}>
          <span style={{ ...S.dropDpi, background: dpiFarbe(dpi, minDpi, targetDpi) }}>
            {Math.round(dpi)} dpi
          </span>
        </div>
      );
    }

    const box = angezeigt.boxes.find((b) => b.kind === 'image' && b.slotId === slotId);
    const zuKlein =
      box?.kind === 'image' &&
      box.warnings.some((w) => w.code === 'below-min-dpi' || w.code === 'photo-missing');

    const info = box?.kind === 'image' ? infoVon(box.photoId) : undefined;

    return (
      <>
        {/*
          Der Auswahlring liegt als Ebene über dem Bild und nicht als `outline`
          am Slot: Ein CSS-Umriss wird in derselben Ebene wie der Rahmen
          gezeichnet, also *unter* den Kindelementen — und das Bild deckt den
          Slot vollständig ab. Am leeren Platz fiel das nicht auf, am belegten
          war die Auswahl unsichtbar.
        */}
        {slotId === selectedSlotId && <span style={S.ring} />}
        {zuKlein && box.kind === 'image' && (
          <span style={S.zuKlein}>zu klein · {Math.round(box.effectiveDpi)} dpi</span>
        )}
        {infosSichtbar && info && (
          <div style={S.infoOverlay}>
            <span style={S.infoZeile}>
              {zeitpunkt(info) ?? 'ohne Datum'}
              {info.dateSource !== 'exif' && info.effectiveDate && (
                <span style={S.infoQuelle}>{DATUMSQUELLE[info.dateSource] ?? info.dateSource}</span>
              )}
            </span>
            {info.place && <span style={S.infoZeile}>{info.place.label}</span>}
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={stageRef} style={S.wrap}>
      <SpreadView
        spread={angezeigt}
        widthPx={breitePx}
        imageSrc={imageSrc}
        guides={guides}
        onSlotClick={model.slotClick}
        {...(selectedSlotId ? { selectedSlotId } : {})}
        onSlotPointerDown={model.slotPointerDown}
        slotDrag={{
          onDragStart: model.slotDragStart,
          onDrop: model.slotDrop,
          onDragEnd: model.zugBeenden,
        }}
        slotOverlay={overlay}
      />

      {blocks.map((block) => {
        const r = pendingText?.id === block.id ? pendingText.rect : block.rect;
        const gewaehlt = block.id === textId;
        return (
          <div
            key={block.id}
            onPointerDown={(e) => model.textZiehen(block, e)}
            title={`„${block.content.split('\n')[0] ?? ''}" verschieben`}
            style={{
              position: 'absolute',
              left: `${(beschnittMm + r.x * trimBreiteMm) * pxPerMm}px`,
              top: `${(beschnittMm + r.y * trimHoeheMm) * pxPerMm}px`,
              width: `${r.w * trimBreiteMm * pxPerMm}px`,
              height: `${r.h * trimHoeheMm * pxPerMm}px`,
              border: gewaehlt ? `1px solid ${T.cyan}` : `1px dashed ${T.cyanRand}`,
              background: gewaehlt ? 'rgba(0,175,203,0.08)' : 'transparent',
              cursor: 'move',
              touchAction: 'none',
              ...(block.rotateDeg ? { transform: `rotate(${block.rotateDeg}deg)` } : {}),
            }}
          />
        );
      })}
    </div>
  );
}

const S = {
  wrap: { position: 'relative' as const, boxShadow: T.schattenBuehne, lineHeight: 0 },
  /**
   * Beim Ziehen: das Ziel färben und die Auflösung nennen.
   *
   * `pointerEvents: none`, sonst fängt die Einblendung das Ablegen ab, statt es
   * an den Slot zu geben.
   */
  dropZiel: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 175, 203, 0.16)',
    outline: `2px dashed ${T.cyan}`,
    outlineOffset: '-3px',
    pointerEvents: 'none' as const,
  },
  dropDpi: {
    padding: '2px 7px',
    borderRadius: T.rMd,
    color: '#fff',
    fontSize: 12,
    fontFamily: T.mono,
  },
  ring: {
    position: 'absolute' as const,
    inset: 0,
    display: 'block',
    outline: `2px solid ${T.cyan}`,
    outlineOffset: -2,
    pointerEvents: 'none' as const,
  },
  /** Unten links, weil oben links die Aufnahmedaten stehen. */
  zuKlein: {
    position: 'absolute' as const,
    left: 0,
    bottom: 0,
    padding: '2px 6px',
    fontSize: 10,
    fontFamily: T.mono,
    color: '#fff',
    background: T.fehler,
    pointerEvents: 'none' as const,
  },
  /** Kompakt über dem Bild: nur, was man im Vorbeisehen liest. */
  infoOverlay: {
    position: 'absolute' as const,
    left: 6,
    top: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    pointerEvents: 'none' as const,
  },
  infoZeile: {
    background: 'rgba(84, 76, 70, 0.82)',
    color: 'var(--warm-50)',
    fontSize: 11,
    lineHeight: 1.4,
    padding: '3px 7px',
    borderRadius: T.rSm,
    alignSelf: 'flex-start' as const,
  },
  infoQuelle: { opacity: 0.75, marginLeft: 6 },
} satisfies Record<string, React.CSSProperties>;
