/**
 * Anordnung einer Doppelseite von Hand wählen.
 *
 * Die Engine sucht die Vorlage nach Passung: Auflösung, Ausrichtung, Gewicht.
 * Das trifft es meistens und manchmal eben nicht – ein Bild soll groß stehen,
 * weil es das wichtigere ist, nicht weil es die meisten Pixel hat. Dann will
 * man die Aufteilung selbst bestimmen.
 *
 * Gezeigt werden Skizzen, keine Namen: `spread.4up.grid` sagt niemandem, wie
 * die Seite aussieht. Die Skizze kommt aus derselben Slotgeometrie, aus der
 * auch das Layout entsteht – sie kann deshalb nicht von der Vorlage abweichen.
 *
 * Ohne eigenen Aufklapper: Die Komponente ist der Inhalt eines Abschnitts, den
 * die Spalte bzw. das schwebende Panel um sie herum setzt. Vorher stand hier ein
 * „Anordnung ändern"-Knopf, hinter dem dieselbe Liste lag — zwei Klicks für
 * etwas, das in der Spalte ohnehin sichtbar sein kann.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Anordnungen as Antwort,
  anordnungenLaden,
  fehlertext,
  type Halbseite,
  halbseiteSetzen,
  type Vorlage,
  vorlageSetzen,
} from './api.js';
import { B, T } from './theme.js';

interface Props {
  index: number;
  /** Wie viele Bilder gerade auf der Seite liegen – für die Warnung beim Verkleinern. */
  photoCount: number;
  /** Zählt hoch, wenn sich die Doppelseite geändert hat. */
  version: number;
  onApplied: (ergebnis: { spread: unknown; leftover: string[] }) => void;
  onFehler: (text: string) => void;
}

/** Seitenverhältnis der Skizze: eine Doppelseite ist zwei Quadrate breit. */
const SKIZZE_BREITE = 76;
const SKIZZE_HOEHE = 38;

export function TemplatePicker({ index, photoCount, version, onApplied, onFehler }: Props) {
  /**
   * Ganze Doppelseite oder einzelne Seiten.
   *
   * Die Seiten sind die Vorgabe: Wer die Anordnung von Hand anfasst, meint fast
   * immer die eine Seite, auf der das Bild falsch steht – die andere soll
   * bleiben, wie sie ist.
   */
  const [modus, setModus] = useState<'seiten' | 'doppelseite'>('seiten');
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Fahrschein je Ladeanfrage – wer beim Blättern zuletzt kam, gilt. */
  const fahrschein = useRef(0);

  const laden = useCallback(() => {
    const eigener = ++fahrschein.current;
    setLadeFehler(null);
    anordnungenLaden(index)
      .then((d) => {
        if (eigener === fahrschein.current) setDaten(d);
      })
      .catch((e: unknown) => {
        if (eigener !== fahrschein.current) return;
        setDaten(null);
        setLadeFehler(`Die Anordnungen ließen sich nicht laden: ${fehlertext(e)}`);
      });
  }, [index, version]);

  useEffect(laden, [laden]);

  /**
   * Setzt eine Anordnung für eine einzelne Seite; die andere bleibt stehen.
   *
   * Die Paarkennung baut der Server. Hier stand sie einmal – zusammengesetzt aus
   * der gewählten und der bekannten Gegenseite –, und wenn die Gegenseite keine
   * bekannte Halbseite war, blieb nur eine Fehlermeldung. Das traf jede justierte
   * Doppelseite, und dort will man die Anordnung besonders oft ändern.
   */
  async function halbseiteWaehlen(seite: 'left' | 'right', halb: Halbseite) {
    const bisher = seite === 'left' ? daten?.counts.left : daten?.counts.right;
    if (bisher !== undefined && halb.slotCount < bisher) {
      const zuviel = bisher - halb.slotCount;
      const ok = window.confirm(
        `Diese Anordnung hat ${halb.slotCount} Plätze, auf der Seite liegen ${bisher} Bilder. ` +
          `${zuviel === 1 ? 'Ein Bild wandert' : `${zuviel} Bilder wandern`} in den Fotopool.`,
      );
      if (!ok) return;
    }

    setBusy(halb.id);
    try {
      const data = await halbseiteSetzen(index, seite, halb.id);
      onApplied({ spread: data.spread, leftover: data.leftover ?? [] });
    } catch (e) {
      onFehler(`Die Anordnung ließ sich nicht ändern: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function waehlen(v: Vorlage) {
    if (v.current) return;
    // Beim Verkleinern gehen Bilder in den Pool. Das ist umkehrbar, aber nicht
    // offensichtlich – deshalb vorher gefragt.
    if (v.slotCount < photoCount) {
      const zuviel = photoCount - v.slotCount;
      const ok = window.confirm(
        `Diese Anordnung hat ${v.slotCount} Plätze, auf der Doppelseite liegen ${photoCount} Bilder. ` +
          `${zuviel === 1 ? 'Ein Bild wandert' : `${zuviel} Bilder wandern`} in den Fotopool.`,
      );
      if (!ok) return;
    }

    setBusy(v.id);
    try {
      const data = await vorlageSetzen(index, v.id);
      onApplied({ spread: data.spread, leftover: data.leftover ?? [] });
    } catch (e) {
      onFehler(`Die Anordnung ließ sich nicht ändern: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (daten === null) {
    if (ladeFehler) return <span style={B.fehlerfeld}>{ladeFehler}</span>;
    return <span style={B.leiser}>lade …</span>;
  }

  // Eine Auftaktseite kennt die seitenweise Wahl nicht: Aus zwei Hälften des
  // Flusses zusammengesetzt verlöre sie Jahreszahl und Ereigniszeilen. Der
  // Umschalter fehlt dort deshalb ganz, statt eine Wahl zu zeigen, die der
  // Server ablehnt.
  const gewaehlterModus = daten.auftakt ? 'doppelseite' : modus;

  return (
    <>
      {daten.auftakt ? (
        <span style={B.leiser}>
          Eine Jahresseite wird als ganze Doppelseite angeordnet — seitenweise verlöre sie
          Jahreszahl und Ereigniszeilen.
        </span>
      ) : (
        <div style={B.segRahmen}>
          {(
            [
              ['seiten', 'einzelne Seite'],
              ['doppelseite', 'ganze Doppelseite'],
            ] as const
          ).map(([wert, text]) => (
            <button
              key={wert}
              onClick={() => setModus(wert)}
              style={{ ...(modus === wert ? B.segAn : B.segAus), flex: 1, fontSize: 12 }}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {gewaehlterModus === 'doppelseite' ? (
        <Faecher
          soll={photoCount}
          eintraege={daten.templates}
          kachel={(v) => (
            <button
              key={v.id}
              onClick={() => void waehlen(v)}
              disabled={busy !== null}
              title={`${v.name} · ${v.slotCount} ${v.slotCount === 1 ? 'Bild' : 'Bilder'}`}
              style={{ ...S.kachel, ...(v.current ? S.kachelAn : {}) }}
            >
              <Skizze slots={v.slots} />
              <Zahl hat={v.slotCount} soll={photoCount} />
            </button>
          )}
        />
      ) : (
        (['left', 'right'] as const).map((seite) => {
          const bisher = seite === 'left' ? daten.counts.left : daten.counts.right;
          return (
            <div key={seite}>
              <p style={S.seitenTitel}>
                {seite === 'left' ? 'Linke Seite' : 'Rechte Seite'}
                <span style={S.seitenZahl}>
                  {bisher} {bisher === 1 ? 'Bild' : 'Bilder'}
                </span>
              </p>
              <Faecher
                soll={bisher}
                benannt={false}
                eintraege={daten.halves}
                kachel={(h) => {
                  const aktiv =
                    (seite === 'left' ? daten.current.left : daten.current.right) === h.id;
                  return (
                    <button
                      key={`${seite}-${h.id}`}
                      onClick={() => void halbseiteWaehlen(seite, h)}
                      disabled={busy !== null}
                      title={`${h.name ? `${h.name} · ` : ''}${h.slotCount} ${
                        h.slotCount === 1 ? 'Bild' : 'Bilder'
                      } auf dieser Seite`}
                      style={{ ...S.kachel, ...(aktiv ? S.kachelAn : {}) }}
                    >
                      {/* Für die rechte Seite gespiegelt – so wie die Engine sie einsetzt. */}
                      <Skizze slots={h.slots} halb={seite} />
                      <Zahl hat={h.slotCount} soll={bisher} />
                    </button>
                  );
                }}
              />
            </div>
          );
        })
      )}

      <span style={B.leiser}>
        {daten.auftakt
          ? 'Jede Fassung trägt Jahreszahl und Ereigniszeilen. Die Bilder werden den neuen Plätzen nach Passung zugeordnet; Ausschnitte entstehen dabei neu.'
          : 'Erst die linke, dann die rechte Seite — oder die ganze Doppelseite. Die Bilder werden den neuen Plätzen nach Passung zugeordnet; Ausschnitte entstehen dabei neu.'}
      </span>
    </>
  );
}

/**
 * Zwei Fächer: erst die Anordnungen für diese Bilderzahl, dann die übrigen.
 *
 * Die Bibliothek hat für jede Bilderzahl mehrere Anordnungen und über vierzig
 * Halbseiten insgesamt. Nach Plätzezahl sortiert lag die passende irgendwo in
 * der Mitte des Rollbereichs – man suchte also erst die eigene Zahl und wählte
 * dann. Umgekehrt ist es richtig: Wer die Anordnung anfasst, will diese Bilder
 * anders liegen sehen, nicht andere Bilder.
 *
 * Die übrigen bleiben sichtbar, weil eine andere Bilderzahl eine berechtigte
 * Absicht ist – ein Bild soll in den Pool, oder es soll eines dazukommen. Sie
 * stehen nach Abstand zur eigenen Zahl, nicht nach ihrer Größe.
 */
function Faecher<T extends { id: string; slotCount: number }>({
  soll,
  eintraege,
  kachel,
  /**
   * Ob das erste Fach seine Bilderzahl nennt.
   *
   * Bei den einzelnen Seiten steht sie schon in der Zeile darüber („Linke
   * Seite · 2 Bilder"), und zweimal dieselbe Zahl übereinander liest sich wie
   * zwei verschiedene Angaben.
   */
  benannt = true,
}: {
  soll: number;
  eintraege: readonly T[];
  kachel: (e: T) => React.ReactNode;
  benannt?: boolean;
}) {
  const passend = eintraege.filter((e) => e.slotCount === soll);
  const andere = eintraege
    .filter((e) => e.slotCount !== soll)
    .sort(
      (a, b) =>
        Math.abs(a.slotCount - soll) - Math.abs(b.slotCount - soll) || a.slotCount - b.slotCount,
    );

  return (
    <div style={S.rolle}>
      {passend.length === 0 ? (
        <p style={S.fach}>
          <span style={S.abweichung}>
            Für {soll} {soll === 1 ? 'Bild' : 'Bilder'} gibt es keine Anordnung
          </span>
        </p>
      ) : (
        <>
          {benannt && (
            <p style={S.fach}>
              {soll} {soll === 1 ? 'Bild' : 'Bilder'}
            </p>
          )}
          <div style={S.gitter}>{passend.map(kachel)}</div>
        </>
      )}
      <p style={S.fach}>andere Bilderzahlen</p>
      <div style={S.gitter}>{andere.map(kachel)}</div>
    </div>
  );
}

/** Die Plätzezahl einer Anordnung, mit dem Abstand zur Bilderzahl der Seite. */
function Zahl({ hat, soll }: { hat: number; soll: number }) {
  return (
    <span style={S.zahl}>
      {hat}
      {hat !== soll && (
        <span style={S.abweichung}>{hat > soll ? ` +${hat - soll}` : ` −${soll - hat}`}</span>
      )}
    </span>
  );
}

/**
 * Die Anordnung als Rechteckskizze.
 *
 * Randabfallende Slots ragen absichtlich über 0..1 hinaus; das Beschneiden
 * übernimmt das SVG, damit die Kachel nicht ausfranst.
 */
function Skizze({ slots, halb }: { slots: Vorlage['slots']; halb?: 'left' | 'right' }) {
  // Eine Halbseite ist halb so breit; die rechte wird gespiegelt gezeichnet,
  // weil eine Seite außen mehr Rand hat als am Falz.
  const breite = halb ? SKIZZE_BREITE / 2 : SKIZZE_BREITE;
  const gezeigt = halb === 'right' ? slots.map((s) => ({ ...s, x: 0.5 - s.x - s.w })) : slots;

  return (
    <svg
      width={breite}
      height={SKIZZE_HOEHE}
      viewBox={
        halb ? `0 0 ${SKIZZE_BREITE / 2} ${SKIZZE_HOEHE}` : `0 0 ${SKIZZE_BREITE} ${SKIZZE_HOEHE}`
      }
      style={S.svg}
    >
      <rect x={0} y={0} width={SKIZZE_BREITE} height={SKIZZE_HOEHE} fill="var(--bg-3)" />
      {gezeigt.map((s, i) => (
        <rect
          key={i}
          x={s.x * SKIZZE_BREITE}
          y={s.y * SKIZZE_HOEHE}
          width={s.w * SKIZZE_BREITE}
          height={s.h * SKIZZE_HOEHE}
          fill={s.bleed ? 'var(--cyan-100)' : 'var(--warm-300)'}
        />
      ))}
      {/* Die Falzachse: Sie entscheidet mit, ob eine Anordnung taugt. */}
      {!halb && (
        <line
          x1={SKIZZE_BREITE / 2}
          y1={0}
          x2={SKIZZE_BREITE / 2}
          y2={SKIZZE_HOEHE}
          stroke="#fff"
          strokeWidth={1}
        />
      )}
      {/* Bei der Halbseite steht der Falz an der Kante, die zur Buchmitte zeigt. */}
      {halb && (
        <line
          x1={halb === 'left' ? SKIZZE_BREITE / 2 - 0.5 : 0.5}
          y1={0}
          x2={halb === 'left' ? SKIZZE_BREITE / 2 - 0.5 : 0.5}
          y2={SKIZZE_HOEHE}
          stroke="var(--warm-500)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
    </svg>
  );
}

const S = {
  /**
   * Eigener Scrollbereich, und zwar aus einer gemessenen Not: Die Bibliothek hat
   * über vierzig Halbseiten, und in einer Spalte von 336 Pixeln sind das rund
   * zwanzig Reihen Skizzen. Ohne diese Grenze stünden Hintergrund und Text zwei
   * Bildschirmhöhen weiter unten, und die Anordnung — der Griff, den man am
   * seltensten braucht — hätte die Spalte für sich.
   *
   * Die Grenze sitzt am Rollbereich und nicht mehr am Gitter, weil darin jetzt
   * zwei Fächer stehen: Läge sie am Gitter, hätte jedes Fach seine eigene
   * Bildlaufleiste und die Spalte wäre doppelt so hoch.
   */
  rolle: { maxHeight: 156, overflowY: 'auto' as const },
  gitter: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 2,
    alignContent: 'flex-start' as const,
  },
  /**
   * Die Überschrift eines Fachs. Nicht klebend am oberen Rand: Die Komponente
   * steht in drei Rahmen mit verschiedenem Hintergrund, und eine klebende Zeile
   * bräuchte eine Fläche, die zu allen dreien passt.
   */
  fach: { margin: '6px 0 0', fontSize: 11, fontWeight: 600, color: T.fg4 },
  kachel: {
    padding: 3,
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
    background: T.bg1,
    cursor: 'pointer',
    lineHeight: 0,
  },
  kachelAn: { borderColor: T.cyan },
  svg: { display: 'block', borderRadius: T.rSm },
  zahl: {
    display: 'block',
    fontSize: 11,
    color: T.fg3,
    lineHeight: 1.7,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  abweichung: { color: T.warn },
  seitenTitel: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    fontSize: 12,
    fontWeight: 600,
    margin: '8px 0 4px',
    color: T.fg2,
  },
  seitenZahl: { fontWeight: 400, color: T.fg4, fontSize: 11 },
} satisfies Record<string, React.CSSProperties>;
