/**
 * Die Kennzahlenzeile unter der Kopfzeile.
 *
 * Vorher war das ein Kasten mit vier Kennzahlen und einer Liste von Problemen
 * darunter — je nach Lage zwei bis fünf Zeilen hoch, was in einer Ansicht, die
 * nicht scrollt, direkt von der Bühne abgeht. Jetzt eine Zeile von 44 Pixeln, in
 * der jede Zahl neben ihrer Einheit steht.
 *
 * Die Zahlen sind nach Nutzen geordnet, nicht nach Kategorie: Erst der Umfang
 * (Fotos, Seiten, Dichte), dann die Auflösung — die häufigste Ursache für eine
 * Änderung am Buch —, dann die Fotos, die außen vor bleiben. Was zu klein ist,
 * trägt einen Griff dahin: eine Zahl ohne Weg zu ihr ist eine Zahl, mit der man
 * nichts machen kann.
 *
 * Die Zeile steht auch ohne Prüfbericht. Den rechnet der Server beim Erzeugen des
 * Buches, ein geladenes Projekt hat also keinen — und weil die Zeile jetzt Teil
 * des Gerüsts ist, hätte ihr Fehlen nach jedem Serverstart wie „keine Probleme"
 * gelesen. Ohne Bericht steht deshalb, was das Projekt selbst weiß, und an der
 * Stelle der Auflösungszahlen ein ausdrückliches „ungeprüft".
 */
import { B, T } from './theme.js';

export interface Report {
  photoCount: number;
  placedCount: number;
  spreadCount: number;
  pageCount: number;
  targetPages: number;
  photosPerSpread: number;
  worstDpi: number;
  belowTargetDpi: number;
  belowMinDpi: { photoId: string; spreadIndex: number; slotId: string; dpi: number }[];
  feasibility: { achievable: boolean; minimumPages: number; maxPerSpread: number; hint?: string };
}

interface Props {
  /** Fehlt, solange das Buch in dieser Sitzung nicht erzeugt wurde. */
  report: Report | null;
  /** Fotos im Projekt – auch die, die nicht im Buch stehen. */
  photoCount: number;
  spreadCount: number;
  /** Fotos ohne Datum – sie kommen nicht ins Buch. */
  undated: number;
  /** Ob sich die Gruppen geändert haben, seit das Buch gebaut wurde. */
  groupsPending: boolean;
  /** Ob die Kalendergliederung abweicht – Datumskorrekturen, aussortierte Fotos. */
  structurePending: boolean;
  onZeigeSpread: (index: number) => void;
  onNeuAnordnen: () => void;
  busy: boolean;
}

export function Kennzahlen({
  report,
  photoCount,
  spreadCount,
  undated,
  groupsPending,
  structurePending,
  onZeigeSpread,
  onNeuAnordnen,
  busy,
}: Props) {
  if (!report) {
    return (
      <div style={S.zeile}>
        <Paar zahl={String(photoCount)} einheit={`Fotos · ${spreadCount * 2} Seiten`} />
        <span style={B.trenner} />
        <span
          style={S.leise}
          title="Die Auflösung jedes Bildes prüft der Server beim Erzeugen des Buches. Dieser Stand ist geladen, nicht erzeugt — die Zahlen stehen nach dem nächsten Neuanordnen."
        >
          Auflösung ungeprüft
        </span>
        {undated > 0 && (
          <>
            <span style={B.trenner} />
            <span style={S.leise} title="Ohne Datum lässt sich ein Foto nicht einordnen">
              {undated} ohne Datum
            </span>
          </>
        )}
        <span style={B.dehner} />
        {(groupsPending || structurePending) && (
          <PendingHinweis
            gruppen={groupsPending}
            gliederung={structurePending}
            onNeuAnordnen={onNeuAnordnen}
            busy={busy}
          />
        )}
      </div>
    );
  }

  const zuKlein = report.belowMinDpi.length;
  // `belowTargetDpi` zählt alles unter der Zielauflösung, die zu kleinen
  // eingeschlossen. „Knapp" ist, was dazwischen liegt.
  const knapp = Math.max(0, report.belowTargetDpi - zuKlein);
  const nichtPlatziert = report.photoCount - report.placedCount - undated;
  const zielVerfehlt = Math.abs(report.pageCount - report.targetPages) > report.targetPages * 0.15;

  return (
    <div style={S.zeile}>
      <Paar
        zahl={String(report.placedCount)}
        einheit={`Fotos · ${report.pageCount} Seiten`}
        warn={zielVerfehlt}
        title={
          zielVerfehlt
            ? `Ziel sind ${report.targetPages} Seiten — erreicht sind ${report.pageCount}.`
            : `${report.pageCount} von ${report.targetPages} Zielseiten`
        }
      />
      <span style={B.trenner} />
      <Paar zahl={report.photosPerSpread.toFixed(1).replace('.', ',')} einheit="je Doppelseite" />

      {zuKlein > 0 && (
        <>
          <span style={B.trenner} />
          <span style={S.gruppe}>
            <span style={{ ...B.zahl, fontSize: 16, color: T.fehler }}>{zuKlein}</span>
            <span style={{ fontSize: 13, color: T.fehler }}>zu klein</span>
            <button
              onClick={() => onZeigeSpread(report.belowMinDpi[0]?.spreadIndex ?? 0)}
              style={S.ansehen}
              title={`Erste betroffene Doppelseite aufschlagen (schlechtestes Bild ${Math.round(report.worstDpi)} dpi)`}
            >
              ansehen
            </button>
          </span>
        </>
      )}

      {knapp > 0 && (
        <>
          <span style={B.trenner} />
          <span
            style={S.leise}
            title="Reicht für den Druck, bleibt aber unter der Zielauflösung von 300 dpi"
          >
            {knapp} knapp
          </span>
        </>
      )}

      {undated > 0 && (
        <>
          <span style={B.trenner} />
          <span style={S.leise} title="Ohne Datum lässt sich ein Foto nicht einordnen">
            {undated} ohne Datum
          </span>
        </>
      )}

      {nichtPlatziert > 0 && (
        <>
          <span style={B.trenner} />
          <span style={S.leise} title="Im Fotopool, nicht im Buch">
            {nichtPlatziert} nicht platziert
          </span>
        </>
      )}

      <span style={B.dehner} />

      {!report.feasibility.achievable && report.feasibility.hint && (
        <span style={{ ...B.warnung, whiteSpace: 'nowrap' }} title={report.feasibility.hint}>
          Seitenzahl nicht erreichbar
        </span>
      )}

      {(groupsPending || structurePending) && (
        <PendingHinweis
          gruppen={groupsPending}
          gliederung={structurePending}
          onNeuAnordnen={onNeuAnordnen}
          busy={busy}
        />
      )}
    </div>
  );
}

/**
 * Was an einer Änderung sofort wirkt, wirkt schon: Der Zeitstrahl liest Gruppen
 * und Daten beim Rendern. Wie die Fotos verteilt sind und wo Auftakte stehen,
 * entsteht dagegen beim Erzeugen – und das verwirft Handarbeit. Deshalb der
 * Hinweis statt eines stillen Neuaufbaus.
 *
 * Eine Pille für beide Quellen und nicht zwei nebeneinander: Der Griff ist
 * derselbe, und zwei Knöpfe „neu anordnen" in einer 44 Pixel hohen Zeile lesen
 * sich wie zwei verschiedene Handlungen.
 */
function PendingHinweis({
  gruppen,
  gliederung,
  onNeuAnordnen,
  busy,
}: {
  gruppen: boolean;
  gliederung: boolean;
  onNeuAnordnen: () => void;
  busy: boolean;
}) {
  const was =
    gruppen && gliederung
      ? 'Gruppen und Gliederung geändert'
      : gruppen
        ? 'Gruppen geändert'
        : 'Gliederung geändert';
  return (
    <span style={S.pending}>
      {was}
      <button
        onClick={onNeuAnordnen}
        disabled={busy}
        style={B.knopfText}
        title={
          gliederung
            ? 'Ein Foto gehört jetzt an eine andere Stelle im Buch. Die Verteilung folgt erst beim Neuanordnen — das verwirft Handarbeit'
            : 'Die Aufteilung der Fotos und die Auftaktseiten folgen erst beim Neuanordnen — das verwirft Handarbeit'
        }
      >
        neu anordnen
      </button>
    </span>
  );
}

function Paar({
  zahl,
  einheit,
  warn,
  title,
}: {
  zahl: string;
  einheit: string;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span style={S.gruppe} title={title}>
      <span style={{ ...B.zahl, fontSize: 16, ...(warn ? { color: T.warn } : {}) }}>{zahl}</span>
      <span style={S.einheit}>{einheit}</span>
    </span>
  );
}

const S = {
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '0 20px',
    height: 44,
    background: T.bg1,
    borderBottom: `1px solid ${T.line}`,
    flexShrink: 0,
    overflowX: 'auto' as const,
  },
  gruppe: { display: 'flex', alignItems: 'baseline', gap: 7, flexShrink: 0 },
  einheit: { fontSize: 12, color: T.fg3, whiteSpace: 'nowrap' as const },
  leise: { fontSize: 13, color: T.fg2, whiteSpace: 'nowrap' as const, flexShrink: 0 },
  ansehen: {
    font: 'inherit',
    fontSize: 12,
    padding: '3px 9px',
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: T.rPill,
    background: T.bg1,
    color: T.fehler,
    cursor: 'pointer',
  },
  pending: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    fontSize: 12,
    color: T.warn,
    background: T.warnBg,
    border: `1px solid ${T.warnRand}`,
    borderRadius: T.rMd,
    padding: '4px 10px',
    whiteSpace: 'nowrap' as const,
  },
} satisfies Record<string, React.CSSProperties>;
