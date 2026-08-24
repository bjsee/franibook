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
import { imageBoxes } from '@franibook/core';
import { dragBild, SpreadView } from '@franibook/render-dom';
import { B, T } from './theme.js';
import { Link } from './router.js';
import { useSpreadTiles } from './spread/useSpreadTiles.js';

/** Die eigenen MIME-Typen der beiden Züge, damit ein Datei- oder Fotozug sie nicht trifft. */
const SPREAD_ZUG = 'application/x-franibook-spread';
const SEITE_ZUG = 'application/x-franibook-seite';

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
  /**
   * Verschiebt die Doppelseite `von` an die Lücke `nach` – dieselbe Zählung wie
   * bei `onInsert`: `0` ganz vorn, `spreadCount` ganz hinten.
   */
  onSpreadVerschoben?: (von: number, nach: number) => void;
  /**
   * Verschiebt die einzelne Buchseite `atPage` an die Lücke `nach` – beide in
   * Buchseiten gezählt, `atPage` nullbasiert wie bei `buchseiteEinfuegen`.
   */
  onSeiteVerschoben?: (atPage: number, nach: number) => void;
}

const KACHEL_PX = 248;

export function Overview({
  spreadCount,
  chapters,
  groupMarks = [],
  imageSrc,
  onOpen,
  onInsert,
  onSpreadVerschoben,
  onSeiteVerschoben,
}: OverviewProps) {
  const { containerRef, geladen } = useSpreadTiles(spreadCount);
  /** Kachel unter dem Zeiger – nur damit ihr Einfügeknopf hervortritt. */
  const [beruehrt, setBeruehrt] = useState<number | null>(null);
  /** Was gerade gezogen wird – die ganze Doppelseite oder eine ihrer Seiten. */
  const [gezogen, setGezogen] = useState<{ index: number } | { atPage: number } | null>(null);
  /** Die Lücke unter dem Zeiger, während etwas darüber gezogen wird. */
  const [zielLuecke, setZielLuecke] = useState<number | null>(null);

  /**
   * Ob die Lücke `i` beim Loslassen eine Doppelseite bewegen würde.
   *
   * Direkt davor oder direkt danach ist dieselbe Stelle, an der sie schon
   * steht – die Marke soll dort nicht aufblitzen, als gäbe es etwas zu tun.
   */
  const wirksameLuecke = (i: number) =>
    !(gezogen && 'index' in gezogen) || (i !== gezogen.index && i !== gezogen.index + 1);

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
        const bilder = spread ? imageBoxes(spread).length : undefined;
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
            // Ziehbar ist die ganze Kachel – der Link darin verzichtet über
            // `WebkitUserDrag` auf sein eigenes Standard-Ziehen (Browser bieten
            // für Verweise sonst „als Lesezeichen ablegen" an), sonst griffe der
            // Zeiger den Link statt der Kachel.
            draggable={!!onSpreadVerschoben}
            onDragStart={(e) => {
              if (!onSpreadVerschoben) return;
              e.dataTransfer.setData(SPREAD_ZUG, String(i));
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setDragImage(dragBild(), 14, 14);
              setGezogen({ index: i });
            }}
            onDragEnd={() => {
              setGezogen(null);
              setZielLuecke(null);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(SPREAD_ZUG)) {
                if (!onSpreadVerschoben) return;
                e.preventDefault();
                if (wirksameLuecke(i)) setZielLuecke(i);
              } else if (e.dataTransfer.types.includes(SEITE_ZUG)) {
                if (!onSeiteVerschoben) return;
                e.preventDefault();
                setZielLuecke(i);
              }
            }}
            onDragLeave={() => setZielLuecke((v) => (v === i ? null : v))}
            onDrop={(e) => {
              if (onSpreadVerschoben && e.dataTransfer.types.includes(SPREAD_ZUG)) {
                e.preventDefault();
                const von = Number(e.dataTransfer.getData(SPREAD_ZUG));
                setZielLuecke(null);
                setGezogen(null);
                if (Number.isFinite(von)) onSpreadVerschoben(von, i);
              } else if (onSeiteVerschoben && e.dataTransfer.types.includes(SEITE_ZUG)) {
                e.preventDefault();
                const atPage = Number(e.dataTransfer.getData(SEITE_ZUG));
                setZielLuecke(null);
                setGezogen(null);
                if (Number.isFinite(atPage)) onSeiteVerschoben(atPage, i * 2);
              }
            }}
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
              Zwei schmale Ziehgriffe am oberen Rand, je zur Hälfte – nur wenn
              sich das Blatt an der Falzachse trennen lässt (`splittable`).
              Getrennt vom Zug der ganzen Kachel: ein eigener MIME-Typ, damit
              `onDrop` weiß, was gemeint ist, und `stopPropagation`, damit der
              Griff nicht zugleich die ganze Doppelseite mitzieht.
            */}
            {spread?.splittable && onSeiteVerschoben && (
              <>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData(SEITE_ZUG, String(i * 2));
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setDragImage(dragBild(), 14, 14);
                    setGezogen({ atPage: i * 2 });
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    setGezogen(null);
                    setZielLuecke(null);
                  }}
                  style={{ ...S.seitengriff, left: 0, opacity: beruehrt === i ? 1 : 0 }}
                  title={`Linke Seite von Doppelseite ${i + 1} ziehen, um nur sie zu verschieben`}
                />
                <div
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData(SEITE_ZUG, String(i * 2 + 1));
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setDragImage(dragBild(), 14, 14);
                    setGezogen({ atPage: i * 2 + 1 });
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    setGezogen(null);
                    setZielLuecke(null);
                  }}
                  style={{ ...S.seitengriff, right: 0, opacity: beruehrt === i ? 1 : 0 }}
                  title={`Rechte Seite von Doppelseite ${i + 1} ziehen, um nur sie zu verschieben`}
                />
              </>
            )}

            {/*
              Dieselbe Kante zeigt beim Ziehen einer anderen Doppelseite, wo sie
              landen würde – die Zahl der Lücke ist dieselbe wie beim
              Einfügeknopf, nur als Antwort auf einen Zug statt auf einen Klick.
            */}
            {zielLuecke === i && <div style={S.zielmarke} />}

            {/*
              Die Kachel ist ein Link und kein Knopf, damit ⌘-Klick die
              Doppelseite in einem neuen Tab öffnet – beim Durchsehen von achtzig
              Seiten der Handgriff, der zwei Stellen vergleichbar macht. Was beim
              Klick geschieht, entscheidet weiterhin `onOpen`.
            */}
            <Link
              route={{ view: 'spread', index: i }}
              onNavigieren={() => onOpen(i)}
              style={{
                ...B.kachel,
                width: KACHEL_PX,
                ...(spread?.locked ? S.fest : {}),
                ...(onSpreadVerschoben ? S.keinLinkZug : {}),
              }}
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
        deshalb eine eigene Zelle am Ende des Gitters. Sie steht auch, wenn das
        Buch noch leer ist: Ohne eine einzige Doppelseite gäbe es sonst gar
        keinen Weg, eine erste einzufügen.
      */}
      {(onInsert || onSpreadVerschoben || onSeiteVerschoben) && (
        <div
          style={S.zelle}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(SPREAD_ZUG)) {
              if (!onSpreadVerschoben) return;
              e.preventDefault();
              if (wirksameLuecke(spreadCount)) setZielLuecke(spreadCount);
            } else if (e.dataTransfer.types.includes(SEITE_ZUG)) {
              if (!onSeiteVerschoben) return;
              e.preventDefault();
              setZielLuecke(spreadCount);
            }
          }}
          onDragLeave={() => setZielLuecke((v) => (v === spreadCount ? null : v))}
          onDrop={(e) => {
            if (onSpreadVerschoben && e.dataTransfer.types.includes(SPREAD_ZUG)) {
              e.preventDefault();
              const von = Number(e.dataTransfer.getData(SPREAD_ZUG));
              setZielLuecke(null);
              setGezogen(null);
              if (Number.isFinite(von)) onSpreadVerschoben(von, spreadCount);
            } else if (onSeiteVerschoben && e.dataTransfer.types.includes(SEITE_ZUG)) {
              e.preventDefault();
              const atPage = Number(e.dataTransfer.getData(SEITE_ZUG));
              setZielLuecke(null);
              setGezogen(null);
              if (Number.isFinite(atPage)) onSeiteVerschoben(atPage, spreadCount * 2);
            }
          }}
        >
          {zielLuecke === spreadCount && <div style={{ ...S.zielmarke, left: -8 }} />}
          {onInsert && (
            <button
              onClick={() => onInsert(spreadCount)}
              style={{ ...S.endKachel, width: KACHEL_PX, height: KACHEL_PX / 2 }}
              title={
                spreadCount === 0
                  ? 'Erste eigene Doppelseite einfügen'
                  : 'Eigene Doppelseite am Ende des Buches einfügen'
              }
            >
              {spreadCount === 0 ? '＋ erste Seite' : '＋ eigene Seite'}
            </button>
          )}
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
  /**
   * Der Link verzichtet auf sein eigenes Standard-Ziehen, wenn die Kachel
   * selbst ziehbar ist – sonst griffe der Browser den Verweis statt der
   * Kachel. Als Feld und nicht am `Link` selbst: Die Komponente kennt keinen
   * Zug, nur diese eine Ansicht braucht ihn.
   */
  keinLinkZug: { WebkitUserDrag: 'none' } as React.CSSProperties,
  /**
   * Ein Ziehgriff für eine einzelne Buchseite – die Hälfte der oberen Kante.
   *
   * Erst beim Überfahren der Kachel sichtbar, wie der Einfügeknopf: Zwei
   * dauerhaft sichtbare Streifen über jeder Kachel wären mehr Lärm als
   * Auskunft.
   */
  seitengriff: {
    position: 'absolute' as const,
    top: 0,
    width: '50%',
    height: 8,
    background: T.cyanZart,
    cursor: 'grab',
    zIndex: 3,
    transition: 'opacity 0.1s',
  },
  /** Zeigt beim Ziehen einer Doppelseite, wo sie landen würde. */
  zielmarke: {
    position: 'absolute' as const,
    left: -9,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 2,
    background: T.cyan,
    zIndex: 2,
  },
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
