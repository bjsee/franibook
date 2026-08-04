/**
 * Buchübersicht.
 *
 * Zeigt alle Doppelseiten als Kacheln. Das ist die Ansicht, in der sich das
 * UX-Ziel überhaupt erst beurteilen lässt: Ob der automatische Entwurf
 * brauchbar ist, sieht man nicht an einer einzelnen Doppelseite, sondern am
 * Rhythmus über das ganze Buch.
 *
 * Über jeder Kachel steht, was sie im Buch gliedert – links der Jahrgang, wenn
 * er hier anfängt, daneben die Fotogruppe. Unter ihr steht, was an ihr auffällt:
 * die Zahl der Bilder, ob sie festgehalten ist, und wie viele Bilder für ihren
 * Platz zu klein sind. Die letzte Zahl ist der Grund, warum diese Ansicht mehr
 * ist als eine Galerie: Sie zeigt, wo im Buch nachzuarbeiten ist.
 */
import { useMemo, useState } from 'react';
import { SpreadView } from '@franibook/render-dom';
import { B, T } from './theme.js';
import { Link } from './router.js';
import { useSpreadTiles } from './spread/useSpreadTiles.js';

interface OverviewProps {
  spreadCount: number;
  chapters: { year: number; photoCount: number; firstSpreadIndex: number }[];
  /** Erste Doppelseite jeder aktiven Fotogruppe. */
  groupMarks?: { spreadIndex: number; title: string }[];
  imageSrc: (photoId: string) => string;
  onOpen: (index: number) => void;
  /**
   * Eine eigene Doppelseite an dieser Stelle einfügen.
   *
   * Die Stelle ist hier zu wählen und nicht in der Doppelseitenansicht: Wo eine
   * selbst gebaute Seite hingehört, sieht man am Rhythmus der Nachbarn, nicht an
   * einer einzelnen Seite.
   */
  onInsert?: (at: number) => void;
}

const KACHEL_PX = 248;

export function Overview({
  spreadCount,
  chapters,
  groupMarks = [],
  imageSrc,
  onOpen,
  onInsert,
}: OverviewProps) {
  const { containerRef, geladen } = useSpreadTiles(spreadCount);
  /** Kachel unter dem Zeiger – nur damit ihr Einfügeknopf hervortritt. */
  const [beruehrt, setBeruehrt] = useState<number | null>(null);

  const jahrAn = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of chapters) map.set(c.firstSpreadIndex, c.year);
    return map;
  }, [chapters]);

  const gruppeAn = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of groupMarks) map.set(g.spreadIndex, g.title);
    return map;
  }, [groupMarks]);

  return (
    <div ref={containerRef} style={S.gitter}>
      {Array.from({ length: spreadCount }, (_, i) => {
        const spread = geladen.get(i);
        const jahr = jahrAn.get(i);
        const gruppe = gruppeAn.get(i);
        const bilder = spread?.boxes.filter((b) => b.kind === 'image').length;
        const zuKlein = spread?.boxes.filter(
          (b) => b.kind === 'image' && b.warnings.some((w) => w.code === 'below-min-dpi'),
        ).length;

        return (
          <div
            key={i}
            data-index={i}
            style={S.zelle}
            onMouseEnter={() => setBeruehrt(i)}
            onMouseLeave={() => setBeruehrt((b) => (b === i ? null : b))}
          >
            <div style={S.marken}>
              {jahr !== undefined && <span style={S.jahr}>{jahr}</span>}
              {gruppe && <span style={S.gruppe}>{gruppe}</span>}
            </div>

            {/*
              Der Einfügeknopf sitzt an der linken Kante der Kachel, weil er die
              Stelle *vor* dieser Seite meint. Er tritt erst beim Überfahren
              hervor – über achtzig Doppelseiten wären achtzig gleich laute
              Knöpfe nur Lärm.
            */}
            {onInsert && (
              <button
                onClick={() => onInsert(i)}
                style={{ ...S.einfuegen, opacity: beruehrt === i ? 1 : 0.2 }}
                title={`Eigene Doppelseite vor Seite ${i + 1} einfügen`}
              >
                ＋
              </button>
            )}

            {/*
              Die Kachel ist ein Link und kein Knopf, damit ⌘-Klick die
              Doppelseite in einem neuen Tab öffnet – beim Durchsehen von achtzig
              Seiten der Handgriff, der zwei Stellen vergleichbar macht. Was beim
              Klick geschieht, entscheidet weiterhin `onOpen`.
            */}
            <Link
              route={{ view: 'spread', index: i }}
              onNavigieren={() => onOpen(i)}
              style={{ ...B.kachel, width: KACHEL_PX, ...(spread?.locked ? S.fest : {}) }}
              title={`Doppelseite ${i + 1} öffnen`}
            >
              {spread ? (
                <SpreadView spread={spread} widthPx={KACHEL_PX} imageSrc={imageSrc} guides={{}} />
              ) : (
                <div style={{ ...S.platzhalter, width: KACHEL_PX, height: KACHEL_PX / 2 }} />
              )}
            </Link>

            <span style={S.fuss}>
              {/* Das Schloss sagt: Diese Seite übersteht ein Neuanordnen. */}
              {spread?.locked && <span title="Festgehalten — selbst gebaut">🔒</span>}
              <span>
                {i + 1}
                {bilder !== undefined && ` · ${bilder} ${bilder === 1 ? 'Foto' : 'Fotos'}`}
              </span>
              {zuKlein !== undefined && zuKlein > 0 && (
                <span style={S.warn}>
                  {zuKlein === 1 ? '1 Bild' : `${zuKlein} Bilder`} zu klein
                </span>
              )}
            </span>
          </div>
        );
      })}

      {/*
        Die letzte Stelle hat keine Kachel, an deren Kante sie sitzen könnte –
        deshalb eine eigene Zelle am Ende des Gitters.
      */}
      {onInsert && spreadCount > 0 && (
        <div style={S.zelle}>
          <button
            onClick={() => onInsert(spreadCount)}
            style={{ ...S.endKachel, width: KACHEL_PX, height: KACHEL_PX / 2 }}
            title="Eigene Doppelseite am Ende des Buches einfügen"
          >
            ＋ eigene Seite
          </button>
        </div>
      )}
    </div>
  );
}

const S = {
  gitter: {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${KACHEL_PX}px, 1fr))`,
    gap: '26px 16px',
    alignItems: 'start',
  },
  zelle: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  /** Die Zeile über der Kachel: Jahrgang und Gruppe, in dieser Reihenfolge. */
  marken: {
    position: 'absolute' as const,
    top: -19,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    minWidth: 0,
  },
  jahr: {
    fontFamily: T.display,
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
    color: T.fg1,
    flexShrink: 0,
  },
  gruppe: {
    fontSize: 12,
    color: T.cyanTief,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  /** Festgehaltene Seiten stehen sichtbar für sich – sie sind Handarbeit. */
  fest: { borderColor: T.cyan, boxShadow: `0 0 0 2px ${T.cyanZart}` },
  einfuegen: {
    position: 'absolute' as const,
    left: -13,
    top: '38%',
    width: 22,
    height: 22,
    padding: 0,
    lineHeight: '18px',
    borderRadius: '50%',
    border: `1px solid ${T.line2}`,
    background: T.bg1,
    color: T.cyanTief,
    cursor: 'pointer',
    fontSize: 12,
    zIndex: 1,
  },
  endKachel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px dashed ${T.line2}`,
    background: T.bg1,
    color: T.cyanTief,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
  },
  platzhalter: { background: T.bg3 },
  fuss: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: T.fg3,
    fontVariantNumeric: 'tabular-nums' as const,
    whiteSpace: 'nowrap' as const,
  },
  warn: { color: T.fehler },
} satisfies Record<string, React.CSSProperties>;
