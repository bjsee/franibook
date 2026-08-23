/**
 * Ein Foto aus dem Bestand als Hintergrund einer Doppelseite wählen.
 *
 * Vorher standen hier acht Kacheln: die vom Server nach Auflösung sortierten
 * besten Kandidaten. Das beantwortet die Frage „welches Bild taugt?" und keine
 * andere — wer ein **bestimmtes** Bild hinter eine Seite legen will, fand es
 * dort nie. Deshalb der ganze Bestand, und zwar so, wie man ihn durchsieht:
 * nach Jahr, mit dem Jahrgang der Doppelseite als Vorgabe.
 *
 * **Die Buchseite steht über den Bildern und nicht darunter**, weil sie die
 * Zahlen ändert: Über eine halbe Doppelseite gerechnet ist dasselbe Foto fast
 * doppelt so scharf. Am Bestand vom 21.8.2026 (962 Fotos) besteht über beide
 * Seiten **ein** Bild die Prüfung, über eine Buchseite vierzehn — und der
 * Median steigt von 71 auf 141 dpi. Wer die Seite wechselt, sieht deshalb sofort
 * andere Zahlen an denselben Kacheln; das ist die Auskunft, um die es hier geht.
 *
 * **Gerechnet wird mit `backgroundFit` aus dem Kern**, derselben Funktion, mit
 * der der Server beim Setzen warnt und der Renderer die Box beurteilt. Eine
 * eigene Formel in der Oberfläche wäre eine zweite Wahrheit über dieselbe Zahl —
 * und die fiele erst auf, wenn der Dialog „taugt" sagt und der Export warnt.
 *
 * Der Klick auf eine Kachel wählt und zeigt groß; gesetzt wird erst mit dem
 * Knopf. Zwei Gesten, weil die Miniatur die Frage nicht beantwortet, für die man
 * den Dialog öffnet: Bei 84 px sieht man nicht, ob das Motiv hinter Bildern und
 * Text trägt.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { backgroundFit, BACKGROUND_MIN_DPI } from '@franibook/core';
import { fehlertext, type FotoInfo, fotosLaden, hintergrundSetzen } from './api.js';
import { useBildSrc } from './bildadresse.js';
import { B, T } from './theme.js';

/** Buchseite oder ganze Doppelseite – `null` ist beides zugleich. */
type Seite = 'left' | 'right' | null;

/** So viel vom Druckprofil braucht die Rechnung; `/api/info` liefert genau das. */
type Seitenmasse = { page: { trimWidthMm: number; trimHeightMm: number; bleedMm: number } };

interface Props {
  spreadIndex: number;
  /** Jahrgang der Doppelseite – die Vorgabe des Filters. */
  jahr?: number | undefined;
  profil: Seitenmasse;
  /** Was gerade hinter der Doppelseite liegt. */
  aktuell?: { photoId: string; side: Seite } | null;
  /** Meldung des Servers, etwa die Warnung zu einem groben Bild. */
  onGesetzt: (hinweis: string | null) => void;
  onSchliessen: () => void;
}

export function HintergrundBild({
  spreadIndex,
  jahr,
  profil,
  aktuell,
  onGesetzt,
  onSchliessen,
}: Props) {
  const bildSrc = useBildSrc();
  const [fotos, setFotos] = useState<FotoInfo[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Die Vorgaben kommen von der Doppelseite: ihr Jahrgang und die Seite, auf der
  // schon etwas liegt. Wer den Dialog öffnet, um ein Bild zu tauschen, soll
  // nicht erst wieder einstellen, was er vorhin entschieden hat.
  const [jahrFilter, setJahrFilter] = useState<number | null | typeof ALLE>(jahr ?? ALLE);
  // `aktuell ? … : …` und nicht `?? 'left'`: Bei einem Bild über beide Seiten
  // ist `side` **null**, und das ist eine Aussage, kein fehlender Wert. Mit `??`
  // stand der Schalter auf „linke Seite", und wer nur ein anderes Bild wählte,
  // machte aus dem doppelseitigen Grund unversehens einen halbseitigen.
  const [seite, setSeite] = useState<Seite>(aktuell ? aktuell.side : 'left');
  const [gewaehlt, setGewaehlt] = useState<string | null>(aktuell?.photoId ?? null);

  useEffect(() => {
    fotosLaden()
      .then((d) => setFotos(d.photos))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }, []);

  // Escape schließt: derselbe Griff wie überall sonst in der Oberfläche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSchliessen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSchliessen]);

  const jahre = useMemo(
    () =>
      [...new Set((fotos ?? []).map(jahrVon).filter((j): j is number => j !== null))].sort(
        (a, b) => a - b,
      ),
    [fotos],
  );
  const ohneDatum = (fotos ?? []).some((f) => jahrVon(f) === null);
  const sichtbar = (fotos ?? []).filter((f) => {
    if (jahrFilter === ALLE) return true;
    return jahrVon(f) === jahrFilter;
  });

  const eignung = (f: FotoInfo) => backgroundFit(f, profil, seite ?? undefined);
  const gewaehltesFoto = (fotos ?? []).find((f) => f.id === gewaehlt);

  async function setzen(patch: { photoId?: string | null; side?: Seite }) {
    setBusy(true);
    try {
      const d = await hintergrundSetzen(spreadIndex, patch);
      onGesetzt(d.hinweis ?? null);
      onSchliessen();
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  /*
   * Der Dialog hängt am `body` und nicht dort, wo er steht.
   *
   * In der Werkbank öffnet ihn eine schwebende Karte, und die trägt
   * `transform: translateX(-50%)`. Ein transformierter Vorfahr wird zum
   * Bezugsrahmen für `position: fixed` — das Overlay lag dann in der Karte statt
   * über der Seite, und ihr `overflow` schnitt es auf 360 × 170 px zurecht.
   */
  return createPortal(
    <div style={S.hintergrund} onClick={onSchliessen}>
      <div style={S.karte} onClick={(e) => e.stopPropagation()}>
        <div style={S.kopf}>
          <div>
            <h2 style={S.titel}>Hintergrundbild</h2>
            <p style={S.hinweis}>
              Das Bild liegt randabfallend hinter allem anderen. Die Zahl an der Kachel sagt, mit
              wie viel dpi es die gewählte Fläche deckt — empfohlen sind {BACKGROUND_MIN_DPI}.
            </p>
          </div>
          <span style={B.dehner} />
          <button onClick={onSchliessen} style={B.knopfKlein}>
            Schließen
          </button>
        </div>

        <div style={S.zeile}>
          <span style={B.marke}>Fläche</span>
          <div style={B.segRahmen}>
            {(
              [
                ['left', 'linke Seite'],
                ['right', 'rechte Seite'],
                [null, 'ganze Doppelseite'],
              ] as const
            ).map(([wert, text]) => (
              <button
                key={text}
                onClick={() => setSeite(wert)}
                style={seite === wert ? B.segAn : B.segAus}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <div style={S.zeile}>
          <span style={B.marke}>Jahr</span>
          <div style={S.jahre}>
            {jahre.map((j) => (
              <button
                key={j}
                onClick={() => setJahrFilter(j)}
                style={jahrFilter === j ? B.pilleAn : B.pilleAus}
              >
                {j}
              </button>
            ))}
            {ohneDatum && (
              <button
                onClick={() => setJahrFilter(null)}
                style={jahrFilter === null ? B.pilleAn : B.pilleAus}
              >
                ohne Datum
              </button>
            )}
            <button
              onClick={() => setJahrFilter(ALLE)}
              style={jahrFilter === ALLE ? B.pilleAn : B.pilleAus}
            >
              alle Jahre
            </button>
          </div>
        </div>

        {fehler && <p style={B.fehlerfeld}>Fehler: {fehler}</p>}
        {!fotos && !fehler && <p style={B.leise}>Lade den Bestand …</p>}

        {fotos && (
          <div style={S.mitte}>
            <div style={S.gitter}>
              {sichtbar.map((f) => {
                const fit = eignung(f);
                return (
                  <button
                    key={f.id}
                    onClick={() => setGewaehlt(f.id)}
                    title={`${f.fileName}${f.effectiveDate ? ` · ${f.effectiveDate.slice(0, 10)}` : ''}`}
                    style={{
                      ...S.zelle,
                      ...(f.id === gewaehlt ? S.zelleAn : {}),
                    }}
                  >
                    {/*
                      `loading="lazy"`: Ein Jahr sind schnell zweihundert Bilder,
                      und der Browser soll nur laden, was zu sehen ist.
                    */}
                    <img
                      src={bildSrc(f.id, 'thumb')}
                      alt={f.fileName}
                      loading="lazy"
                      style={S.mini}
                    />
                    <span style={{ ...S.dpi, color: fit.taugt ? T.ok : T.warn }}>
                      {Math.round(fit.dpi)} dpi
                    </span>
                  </button>
                );
              })}
              {sichtbar.length === 0 && <p style={B.leise}>Keine Bilder in dieser Auswahl.</p>}
            </div>

            <div style={S.vorschau}>
              {gewaehltesFoto ? (
                <>
                  <img
                    src={bildSrc(gewaehltesFoto.id)}
                    alt={gewaehltesFoto.fileName}
                    style={S.gross}
                  />
                  <strong style={B.dateiname}>{gewaehltesFoto.fileName}</strong>
                  <p style={B.leiser}>
                    {gewaehltesFoto.effectiveDate?.slice(0, 10) ?? 'ohne Datum'} ·{' '}
                    {gewaehltesFoto.width}×{gewaehltesFoto.height} px
                  </p>
                  <p style={eignung(gewaehltesFoto).taugt ? B.leise : B.warnung}>
                    Deckt {FLAECHE[seite ?? 'both']} mit {Math.round(eignung(gewaehltesFoto).dpi)}{' '}
                    dpi ab.
                    {!eignung(gewaehltesFoto).taugt &&
                      ` Für ${BACKGROUND_MIN_DPI} dpi bräuchte es ${eignung(gewaehltesFoto).benoetigtPx} px` +
                        ` an der knappen Kante, es hat dort ${eignung(gewaehltesFoto).vorhandenPx} px.`}
                  </p>
                </>
              ) : (
                <p style={B.leise}>
                  Ein Bild anklicken, um es hier groß zu sehen. Bei 84 px erkennt man nicht, ob ein
                  Motiv hinter Bildern und Text trägt.
                </p>
              )}
            </div>
          </div>
        )}

        <div style={S.fuss}>
          {aktuell && (
            <button
              onClick={() => void setzen({ photoId: null })}
              disabled={busy}
              style={B.knopf}
              title="Die Doppelseite bekommt wieder ihren farbigen Grund"
            >
              Bild entfernen
            </button>
          )}
          <span style={B.dehner} />
          <button onClick={onSchliessen} style={B.knopf}>
            Abbrechen
          </button>
          <button
            onClick={() => gewaehlt && void setzen({ photoId: gewaehlt, side: seite })}
            disabled={!gewaehlt || busy}
            style={B.knopfPrimaer}
          >
            Als Hintergrund setzen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Kein Jahresfilter. Ein eigener Wert, weil `null` schon „ohne Datum" heißt. */
const ALLE = 'alle' as const;

const FLAECHE = {
  left: 'die linke Buchseite',
  right: 'die rechte Buchseite',
  both: 'die Doppelseite',
} as const;

/**
 * Der Jahrgang eines Fotos, oder `null` ohne Datum.
 *
 * Aus dem **effektiven** Datum, also nach allen Korrekturen — wie in
 * `Bildwahl.tsx`, und aus demselben Grund: Ein Bild, dessen Datum von Hand
 * geradegerückt wurde, gehört in das Jahr seiner Aufnahme.
 */
function jahrVon(f: FotoInfo): number | null {
  if (!f.effectiveDate) return null;
  const j = Number(f.effectiveDate.slice(0, 4));
  return Number.isFinite(j) ? j : null;
}

const S = {
  hintergrund: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(51, 46, 42, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 24,
  },
  karte: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: '0 16px 48px rgba(84,76,70,0.28)',
    padding: 24,
    width: '64rem',
    maxWidth: '100%',
    maxHeight: '86vh',
    // Der Kasten scrollt nicht als Ganzes: Fläche, Jahr und der Fuß mit dem
    // Setzen-Knopf sollen stehen bleiben, während das Gitter läuft.
    minHeight: 0,
  },
  kopf: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  titel: { margin: '0 0 6px', fontSize: 20 },
  hinweis: { margin: 0, fontSize: 13, color: T.fg2, lineHeight: 1.55, maxWidth: '44rem' },
  zeile: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const },
  jahre: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  /**
   * Gitter und Vorschau nebeneinander, und die Zeile ist ausdrücklich
   * `minmax(0, 1fr)`: Eine automatische Rasterzeile wächst mit dem höchsten Kind,
   * und dann scrollt das Gitter nicht, sondern läuft aus dem Kasten.
   */
  mitte: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 20rem',
    gridTemplateRows: 'minmax(0, 1fr)',
    gap: 16,
    minHeight: 0,
  },
  gitter: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
    gap: 6,
    alignContent: 'start',
    overflowY: 'auto' as const,
  },
  zelle: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
    padding: 2,
    border: `2px solid transparent`,
    borderRadius: 4,
    background: 'none',
    font: 'inherit',
    cursor: 'pointer',
    lineHeight: 0,
  },
  zelleAn: { borderColor: T.cyan, background: T.cyanZart },
  mini: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' as const, borderRadius: 2 },
  dpi: { fontSize: 10, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' as const },
  vorschau: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    overflowY: 'auto' as const,
  },
  gross: {
    width: '100%',
    borderRadius: T.rMd,
    border: `1px solid ${T.line}`,
    background: T.bg3,
  },
  fuss: { display: 'flex', alignItems: 'center', gap: 8 },
} satisfies Record<string, React.CSSProperties>;
