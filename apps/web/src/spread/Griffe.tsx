/**
 * Die Griffe am gewählten Element — Größe ziehen und drehen, ohne Schaltfläche.
 *
 * Die Geste ist die aus Inkscape und Illustrator, und sie ist es bewusst: Wer ein
 * Bild oder einen Text anfasst, hat sie schon in der Hand. **Am Bild sind es drei
 * Stufen** (`griffmodus.ts`): Der erste Klick wählt nur — verschieben und
 * Ausschnitt gehen dort schon, ohne Griff (`Bildgriffe`) —, der zweite legt acht
 * Größengriffe an, der dritte vier Drehgriffe, der vierte schließt den Kreis. Am
 * Text sind es zwei: Er hat keinen Ausschnitt und kann ohne Griffe nichts.
 * Umschalt hält beim Aufziehen das Seitenverhältnis (am Bild) und rastet beim
 * Drehen auf 15°-Schritte.
 *
 * **Bild und Textblock teilen den Rahmen.** Was sie unterscheidet, steht in
 * `useSpreadEditor`: Am Bild folgt der Ausschnitt der neuen Form, am Text wächst
 * an den Ecken die Schrift mit. Zwei Sätze Griffe zu zeichnen, die gleich
 * aussehen und sich um ein Pixel unterscheiden, wäre genau der Fehler, den
 * `theme.ts` für Knöpfe schon verhindert.
 *
 * Die Griffe liegen als eigene Ebene **über** der Vorschau und nicht in ihr —
 * dieselbe Trennung wie bei den Textblöcken selbst: `render-dom` soll nicht
 * wissen, was ein ausgewähltes Element ist, sonst stünde eine
 * Bedienungsentscheidung im Renderer. Was hier gezogen wird, endet als Rechteck,
 * Schriftgröße oder Winkel im Modell; die Vorschau zeigt es, weil sie das Modell
 * zeichnet.
 *
 * Der Rahmen wird mitgedreht, damit die Griffe auf den Kanten sitzen. Die
 * Rechnung dazu steht in `griffZiehen` bzw. `textGriffZiehen` — hier steht nur,
 * wo etwas zu sehen ist.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

/** Ecken und Kantenmitten, in Vorzeichen des Kastens. */
const GROESSE_GRIFFE: { sx: -1 | 0 | 1; sy: -1 | 0 | 1; cursor: string }[] = [
  { sx: -1, sy: -1, cursor: 'nwse-resize' },
  { sx: 0, sy: -1, cursor: 'ns-resize' },
  { sx: 1, sy: -1, cursor: 'nesw-resize' },
  { sx: 1, sy: 0, cursor: 'ew-resize' },
  { sx: 1, sy: 1, cursor: 'nwse-resize' },
  { sx: 0, sy: 1, cursor: 'ns-resize' },
  { sx: -1, sy: 1, cursor: 'nesw-resize' },
  { sx: -1, sy: 0, cursor: 'ew-resize' },
];

/** Nur die Ecken drehen. Kanten wären in Inkscape das Scheren – das kennt das Modell nicht. */
const DREH_GRIFFE: { sx: -1 | 1; sy: -1 | 1; cursor: string }[] = [
  { sx: -1, sy: -1, cursor: 'grab' },
  { sx: 1, sy: -1, cursor: 'grab' },
  { sx: 1, sy: 1, cursor: 'grab' },
  { sx: -1, sy: 1, cursor: 'grab' },
];

const HINWEIS = {
  bildGroesse:
    'Ziehen ändert die Größe · Umschalt hält das Seitenverhältnis · Klick aufs Bild schaltet aufs Drehen',
  bildDrehen:
    'Ziehen dreht das Bild · Umschalt rastet auf 15° · Klick aufs Bild nimmt die Griffe wieder weg',
  textGroesse:
    'Ecke zieht Kasten und Schrift, Kante nur den Kasten · Klick auf den Text schaltet aufs Drehen',
  // Am Vorlagentext ist die Kastenhöhe die Schriftgröße, es gibt dort keine
  // eigene Punktzahl – also sagt der Hinweis auch etwas anderes als am Block.
  platzGroesse:
    'Höhe ändert die Schriftgröße, Breite nur den Kasten · Klick auf den Text schaltet aufs Drehen',
  textDrehen:
    'Ziehen dreht den Text · Umschalt rastet auf 15° · Klick auf den Text schaltet zurück',
};

interface RahmenProps {
  /** Lage in Pixeln der Bühne. */
  links: number;
  oben: number;
  breite: number;
  hoehe: number;
  rotateDeg: number;
  drehen: boolean;
  titel: string;
  onGriff: (sx: -1 | 0 | 1, sy: -1 | 0 | 1, e: ReactPointerEvent<HTMLDivElement>) => void;
  onDreh: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function GriffRahmen({
  links,
  oben,
  breite,
  hoehe,
  rotateDeg,
  drehen,
  titel,
  onGriff,
  onDreh,
}: RahmenProps) {
  /** Vorzeichen → Prozentlage im Rahmen. */
  const anteil = (s: -1 | 0 | 1) => `${(s + 1) * 50}%`;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${links}px`,
        top: `${oben}px`,
        width: `${breite}px`,
        height: `${hoehe}px`,
        // Der Rahmen selbst fängt nichts ab: Im Element bleibt das Ziehen, was es
        // war – Ausschnitt beim Bild, Verschieben beim Text –, und nur die Griffe
        // sind Griffe.
        pointerEvents: 'none',
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
      }}
    >
      {(drehen ? DREH_GRIFFE : GROESSE_GRIFFE).map((g) => (
        <div
          key={`${g.sx},${g.sy}`}
          title={titel}
          onPointerDown={(e) => (drehen ? onDreh(e) : onGriff(g.sx, g.sy, e))}
          // Der Klick gehört zum Ziehen und darf das Element darunter nicht
          // erreichen – sonst schaltete jedes Aufziehen die Griffe um.
          onClick={(e) => e.stopPropagation()}
          style={{
            ...S.griff,
            ...(drehen ? S.dreh : {}),
            cursor: g.cursor,
            left: anteil(g.sx),
            top: anteil(g.sy),
          }}
        />
      ))}

      {/* Der Drehpunkt: die Mitte, um die es geht. Klein und stumm. */}
      {drehen && <div style={S.achse} />}
    </div>
  );
}

export function Griffe({ model }: { model: SpreadEditorModel }) {
  const { gewaehlteBox, pxPerMm, griffModus, griffAnzeige, neigungGesperrt } = model;

  /** Der Text, an dem gerade gearbeitet wird – Block oder Vorlagentext. */
  const text = model.textId ? model.texte.find((t) => t.id === model.textId) : undefined;

  // Beides gleichzeitig gibt es nicht: Ein Griff an einem Text hebt die
  // Bildauswahl auf und umgekehrt.
  let rahmen: RahmenProps | undefined;

  if (gewaehlteBox) {
    // Erste Stufe: nur gewählt. Der blaue Rand steht, die Hand kann schieben und
    // den Ausschnitt fassen – Griffe hätte man dabei nur im Weg.
    if (griffModus === 'keine') return null;
    const drehen = griffModus === 'drehen' && !neigungGesperrt;
    rahmen = {
      links: gewaehlteBox.xMm * pxPerMm,
      oben: gewaehlteBox.yMm * pxPerMm,
      breite: gewaehlteBox.wMm * pxPerMm,
      hoehe: gewaehlteBox.hMm * pxPerMm,
      rotateDeg: gewaehlteBox.rotateDeg ?? 0,
      drehen,
      titel: drehen ? HINWEIS.bildDrehen : HINWEIS.bildGroesse,
      onGriff: model.griffZiehen,
      onDreh: model.drehZiehen,
    };
  } else if (text) {
    const stand = model.pendingText?.id === text.id ? model.pendingText : undefined;
    const r = stand?.rect ?? text.rect;
    const drehen = griffModus === 'drehen';
    rahmen = {
      links: (model.beschnittMm + r.x * model.trimBreiteMm) * pxPerMm,
      oben: (model.beschnittMm + r.y * model.trimHoeheMm) * pxPerMm,
      breite: r.w * model.trimBreiteMm * pxPerMm,
      hoehe: r.h * model.trimHoeheMm * pxPerMm,
      rotateDeg: stand?.rotateDeg ?? text.rotateDeg ?? 0,
      drehen,
      titel: drehen
        ? HINWEIS.textDrehen
        : text.art === 'platz'
          ? HINWEIS.platzGroesse
          : HINWEIS.textGroesse,
      onGriff: (sx, sy, e) => model.textGriffZiehen(text, sx, sy, e),
      onDreh: (e) => model.textDrehZiehen(text, e),
    };
  }

  if (!rahmen) return null;

  return (
    <>
      <GriffRahmen {...rahmen} />

      {/*
        Das Maß beim Ziehen, ungedreht über der Mitte: Die Zahl soll man lesen
        können, auch wenn das Element um 40° liegt.
      */}
      {griffAnzeige && (
        <span
          style={{
            ...S.anzeige,
            left: `${rahmen.links + rahmen.breite / 2}px`,
            top: `${rahmen.oben + rahmen.hoehe / 2}px`,
          }}
        >
          {griffAnzeige}
        </span>
      )}
    </>
  );
}

const S = {
  /**
   * Weißes Quadrat mit dunklem Rand.
   *
   * Nicht türkis: Türkis markiert in dieser Oberfläche Auswahl und Aktion, und
   * der Auswahlring darunter tut das schon. Ein zweites Türkis an derselben
   * Stelle wäre eine Farbe ohne Aussage — der Griff muss nur auf jedem Foto zu
   * sehen sein, hell wie dunkel.
   */
  griff: {
    position: 'absolute' as const,
    width: 11,
    height: 11,
    marginLeft: -6,
    marginTop: -6,
    background: '#fff',
    border: '1px solid #3f3f46',
    boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
    pointerEvents: 'auto' as const,
    touchAction: 'none' as const,
  },
  /** Rund und türkis umrandet: die Form sagt „dreht" statt „schiebt". */
  dreh: {
    borderRadius: '50%',
    width: 13,
    height: 13,
    marginLeft: -7,
    marginTop: -7,
    border: `2px solid ${T.cyan}`,
  },
  achse: {
    position: 'absolute' as const,
    left: '50%',
    top: '50%',
    width: 7,
    height: 7,
    marginLeft: -4,
    marginTop: -4,
    borderRadius: '50%',
    border: `1px solid ${T.cyan}`,
    background: 'rgba(255,255,255,0.85)',
    pointerEvents: 'none' as const,
  },
  anzeige: {
    position: 'absolute' as const,
    transform: 'translate(-50%, -50%)',
    padding: '2px 7px',
    borderRadius: T.rMd,
    background: 'rgba(84, 76, 70, 0.88)',
    color: 'var(--warm-50)',
    fontSize: 12,
    fontFamily: T.mono,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const,
  },
} satisfies Record<string, React.CSSProperties>;
