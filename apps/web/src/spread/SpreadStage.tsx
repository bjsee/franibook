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
 *
 * Auch ihre Breite bringt die Bühne mit (`model.stageBreite`) und nimmt sie nicht
 * vom Rahmen entgegen: Papier und Griffe müssen mit demselben `pxPerMm` rechnen,
 * und ein Rahmen, der die eine Zahl liefern darf, kann die andere verfehlen. Aus
 * demselben Grund kommen die beweglichen Texte aus `model.texte`: Griffkästen und
 * Griffe müssen über derselben Liste liegen.
 */
import type { ReactNode } from 'react';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import { dpiInSlot } from '@franibook/core';
import { T, dpiFarbe } from '../theme.js';
import { ABSICHT_WORT, absichtVon } from './absicht.js';
import { textName } from './bewegtext.js';
import { Bildgriffe } from './Bildgriffe.js';
import { Griffe } from './Griffe.js';
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
}

export function SpreadStage({ model, imageSrc, guides }: Props) {
  const {
    index,
    stageRef,
    stageBreite,
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
    ueberSlot,
    infosSichtbar,
    infoVon,
    textId,
    pendingText,
    texte,
  } = model;

  /**
   * Ob der Platz unter dem Zeiger belegt ist – für die Marke am Ausgangsplatz.
   *
   * Der Ausgangsplatz muss wissen, was am *anderen* Ende geschieht: Wird
   * getauscht, kommt das dortige Bild hierher, und das gehört gezeigt. Sonst
   * sähe man nur ein Bild wandern und müsste raten, wohin das andere gerät.
   */
  const ueberBelegt =
    ueberSlot !== null && angezeigt.boxes.some((b) => b.kind === 'image' && b.slotId === ueberSlot);

  /**
   * Was über einem Slot liegt.
   *
   * Drei Dinge in einer Rangfolge, weil alle drei denselben Platz beanspruchen:
   * Beim Ziehen zählt, was das Fallenlassen hier bedeutet und welche Auflösung
   * dabei herauskäme. Sonst die Aufnahmedaten, wenn sie eingeschaltet sind.
   * Die Marke „zu klein" steht immer, unabhängig von den Hilfslinien: Ein Bild,
   * das für seinen Platz nicht reicht, soll man sehen, ohne erst etwas
   * einschalten zu müssen.
   */
  function overlay({ slotId, kind }: { slotId: string; kind: 'image' | 'empty' }): ReactNode {
    if (zug) {
      const rect = slotRect(slotId);
      if (!rect || !zug.photo) return null;
      const dpi = dpiInSlot(zug.photo, rect);
      const absicht = absichtVon(zug.source, {
        spreadIndex: index,
        slotId,
        belegt: kind === 'image',
      });
      const ueber = slotId === ueberSlot;
      const quelle = absicht === 'nichts';

      /*
       * Am Ausgangsplatz steht kein zweites Mal die Auflösung – das Bild liegt
       * ja schon dort. Beim Tausch steht dafür, was hierher kommt: dieselbe
       * Marke wie am Ziel, nur blass. Zwei gleiche Zeichen an beiden Enden
       * sagen „diese beiden" deutlicher als jeder Text.
       */
      if (quelle) {
        return (
          <div style={S.dropZiel}>
            {ueberBelegt && (
              <span style={{ ...S.dropAbsicht, ...S.dropAbsichtBlass }}>
                <Tauschzeichen /> hierher
              </span>
            )}
          </div>
        );
      }

      return (
        <div style={{ ...S.dropZiel, ...(ueber ? S.dropZielUeber : {}) }}>
          {ueber && (
            <span style={S.dropAbsicht}>
              {absicht === 'tauschen' ? <Tauschzeichen /> : <Einsetzzeichen />}
              {ABSICHT_WORT[absicht]}
            </span>
          )}
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
        {/*
          Die Zeigerflächen liegen über dem Ring und unter den Marken: Sie
          fangen das Ziehen ab, und was sie sagen (Rand oder Inneres), soll die
          Auflösungsmarke nicht verdecken.
        */}
        {slotId === selectedSlotId && box?.kind === 'image' && (
          <Bildgriffe
            model={model}
            slotId={slotId}
            breitePx={box.wMm * pxPerMm}
            hoehePx={box.hMm * pxPerMm}
          />
        )}
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
        widthPx={stageBreite}
        imageSrc={imageSrc}
        guides={guides}
        onSlotClick={model.slotClick}
        {...(selectedSlotId ? { selectedSlotId } : {})}
        slotDrag={{
          onDragStart: model.slotDragStart,
          onDrop: model.slotDrop,
          onDragEnd: model.zugBeenden,
          onDragOverSlot: model.slotDragOver,
        }}
        slotOverlay={overlay}
      />

      {texte.map((text) => {
        const stand = pendingText?.id === text.id ? pendingText : undefined;
        const r = stand?.rect ?? text.rect;
        const drehung = stand?.rotateDeg ?? text.rotateDeg;
        const gewaehlt = text.id === textId;
        return (
          <div
            key={text.id}
            onPointerDown={(e) => model.textZiehen(text, e)}
            // Wie am Bild: Der Klick auf den schon gewählten Text schaltet
            // zwischen Größen- und Drehgriffen um. Das Verschieben liegt auf dem
            // Ziehen und stört sich daran nicht.
            onClick={() => model.textClick(text)}
            title={`„${textName(text)}" verschieben`}
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
              ...(drehung ? { transform: `rotate(${drehung}deg)` } : {}),
            }}
          />
        );
      })}

      {/*
        Zuletzt und damit obenauf: Die Griffe müssen auch über einem Text
        liegen, der zufällig auf dem gewählten Bild sitzt – sonst greift man ins
        Leere, wo man eine Ecke sieht.
      */}
      <Griffe model={model} />
    </div>
  );
}

/**
 * Zwei gegenläufige Pfeile: Die beiden Bilder nehmen die Plätze des anderen ein.
 *
 * Als Inline-SVG und nicht als Zeichen „⇄": Ein Glyph hinge an der Schrift des
 * Systems, und die Marke steht auf einem Foto – dort zählt, dass die Form in
 * jeder Umgebung gleich dick und gleich groß ist.
 */
function Tauschzeichen() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9h15" />
      <path d="M15 5l4 4-4 4" />
      <path d="M20 15H5" />
      <path d="M9 11l-4 4 4 4" />
    </svg>
  );
}

/** Ein Pfeil in den leeren Platz hinein. */
function Einsetzzeichen() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 20h14" />
    </svg>
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
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    // Blasser als vorher: Alle Plätze sind Ziel, aber nur einer ist gemeint.
    // Färbte man sie gleich, wäre die Fläche eine Aufzählung und keine Antwort.
    background: 'rgba(0, 175, 203, 0.10)',
    outline: `2px dashed ${T.cyan}`,
    outlineOffset: '-3px',
    pointerEvents: 'none' as const,
  },
  /** Der Platz unter dem Zeiger – der eine, auf den es ankommt. */
  dropZielUeber: {
    background: 'rgba(0, 175, 203, 0.26)',
    outline: `3px solid ${T.cyan}`,
  },
  /**
   * Was das Fallenlassen hier bedeutet – Zeichen und Wort in einer Marke.
   *
   * Beides zusammen, weil keins allein trägt: Der Pfeil sagt es schneller, das
   * Wort sagt es eindeutig, und die Marke liegt über einem Foto, dessen Farbe
   * niemand kennt.
   */
  dropAbsicht: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 9px',
    borderRadius: T.rMd,
    background: T.cyan,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
  },
  /** Am Ausgangsplatz: dieselbe Marke, nur zurückgenommen. */
  dropAbsichtBlass: {
    background: 'rgba(0, 175, 203, 0.75)',
    fontWeight: 500,
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
