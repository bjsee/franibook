/**
 * Doppel: mehrere Aufnahmen desselben Augenblicks, nebeneinander.
 *
 * Bei einem vorausgewählten Bestand ist „von diesen dreien das schärfste" der
 * häufigste Handgriff überhaupt (Issue #18) — und der einzige, für den man die
 * Bilder **nebeneinander** sehen muss. In der Fotoliste stehen sie
 * untereinander, auf der Doppelseite oft gar nicht zusammen; beides beantwortet
 * die Frage nicht.
 *
 * **Eine Zeile je Doppel, die Bilder groß.** Nicht als Raster über alle
 * beteiligten Fotos: Was hier zählt, ist der Vergleich *innerhalb* einer
 * Gruppe, und ein Raster machte aus 49 Vergleichen eine Wand aus 103 Bildern.
 * Die Zeilenhöhe ist der Preis dafür, und sie ist es wert — bei Miniaturen von
 * 80 px ist nicht zu erkennen, welches der beiden schärfer ist.
 *
 * **Ein Vorschlag, keine Automatik.** Die Automatik markiert das schärfste
 * Bild, aber sie klickt nicht: Welches der drei das gute ist, entscheidet kein
 * Abstandsmaß — auf dem unschärferen lacht vielleicht das Kind. Deshalb trägt
 * jedes Bild seinen eigenen Knopf, und der Vorschlag ist nur ein Rahmen.
 *
 * **Die Zahlen stehen dabei.** Die Schärfe ist eine gemessene Größe
 * (`docs/spikes/serien.md`), und wer einen Vorschlag sieht, soll sehen können,
 * worauf er beruht. Absolut sagt sie niemandem etwas — deshalb steht sie als
 * Vergleich innerhalb der Zeile, nicht als Note.
 */
import { Fragment, useEffect, useState } from 'react';
import { type FotoInfo } from './api.js';
import { type DoppelZeile, useDoppel } from './useDoppel.js';
import { B, T } from './theme.js';
import { useBildSrc } from './bildadresse.js';

export function Doppel({
  onChanged,
  standVersion,
  onOffen,
}: {
  onChanged?: () => void;
  standVersion?: number;
  /**
   * Meldet die offenen Doppel an den Reiter der Prüfung.
   *
   * Die Ansicht hat die Zahl ohnehin; ein zweiter Aufruf dafür kostete
   * anderthalb Sekunden Bildvergleich für dieselbe Auskunft.
   */
  onOffen?: (offen: number) => void;
}) {
  const m = useDoppel({
    ...(onChanged ? { onChanged } : {}),
    ...(standVersion !== undefined ? { standVersion } : {}),
  });

  /**
   * Ob die erledigten Doppel mitlaufen.
   *
   * Wie im Abnahmebericht: Was man abgearbeitet hat, verschwindet aus der
   * Liste, aber nicht aus der Welt — im Kopf steht, wie viele es sind, und dort
   * kommen sie wieder hervor.
   */
  const [zeigeErledigte, setZeigeErledigte] = useState(false);

  const erledigt = (z: DoppelZeile): boolean =>
    z.behaltenSeit !== undefined || z.fotos.length - z.entfernt.length <= 1;
  const nochOffen = m.zeilen.filter((z) => !erledigt(z)).length;
  const abgearbeitet = m.zeilen.length - nochOffen;

  // Die offenen Doppel an den Reiter melden — erst wenn geladen ist, denn eine
  // Null vor dem Laden wäre eine Aussage und nicht ein fehlender Wert.
  useEffect(() => {
    if (m.bericht) onOffen?.(nochOffen);
  }, [m.bericht, nochOffen, onOffen]);

  /**
   * Sortiert nach Sicherheit, nicht nach Datum.
   *
   * Am Bestand durchgesehen: Bis etwa 0,75 sind praktisch alle Vorschläge echte
   * Doppel, darüber mischen sich Aufnahmen desselben Augenblicks von
   * verschiedenen Motiven darunter — zwei Kameras auf demselben Fest, oder
   * dieselbe Geste an zwei Orten. **Eine Schwelle löst das nicht:** Bei genau
   * 0,77 stehen vier echte Doppel neben einem Fehlfund, und wer dort schneidet,
   * verliert vier, um einen zu entfernen.
   *
   * Was hilft, ist die Reihenfolge. Vorne die zwanzig zweifelsfreien Fälle, die
   * in zwei Minuten abgearbeitet sind; hinten der Block, bei dem man hinsehen
   * muss. Chronologisch geordnet lagen beide Sorten dazwischen, und dann sieht
   * man bei jeder Zeile gleich genau hin — also bei keiner.
   */
  const sichtbar = [...(zeigeErledigte ? m.zeilen : m.zeilen.filter((z) => !erledigt(z)))].sort(
    (a, b) =>
      // Ohne Bildvergleich gibt es keine Sicherheit zu sortieren; dann bleibt
      // es bei der Reihenfolge der Aufnahme.
      (a.aehnlichkeit ?? Number.POSITIVE_INFINITY) - (b.aehnlichkeit ?? Number.POSITIVE_INFINITY) ||
      a.from.localeCompare(b.from),
  );

  /**
   * Ab hier lohnt der zweite Blick.
   *
   * Ein Erfahrungswert aus der Durchsicht des Bestands (der erste Fehlfund lag
   * bei 0,77), **keine Wirkschwelle**: Er ändert nichts an den Vorschlägen,
   * sondern setzt nur eine Marke in die Liste. Wer die Grenze verschieben will,
   * verstellt `?abstand=` und bekommt eine andere Liste.
   */
  const AUFMERKSAM_AB = 0.75;
  const ersterUnsicherer = sichtbar.findIndex((z) => (z.aehnlichkeit ?? 0) > AUFMERKSAM_AB);

  return (
    <div style={S.seite}>
      <div style={S.kopf}>
        <div style={S.kopftext}>
          <div style={B.titel}>Doppel</div>
          <div style={S.bilanz}>
            <span style={B.leise}>
              {m.laedt
                ? 'wird gerechnet …'
                : m.bericht
                  ? `${String(m.bericht.doppel.length)} Doppel mit ${String(m.bericht.fotos)} Fotos` +
                    (abgearbeitet > 0 ? ` · ${String(abgearbeitet)} erledigt` : '')
                  : '—'}
            </span>
            {/*
              Am Kopf und nicht am Fuß wie im Abnahmebericht: Die Liste ist
              neunundvierzig Zeilen zu je einer halben Bildschirmhöhe, und wer
              ein Doppel versehentlich wegklickt, findet den Weg zurück sonst
              erst nach fünfzehn Bildschirmen.
            */}
            {abgearbeitet > 0 && (
              <>
                <button style={B.knopfText} onClick={() => setZeigeErledigte((v) => !v)}>
                  {zeigeErledigte ? 'erledigte ausblenden' : 'erledigte anzeigen'}
                </button>
                <button style={B.knopfText} onClick={() => void m.wiederOeffnen()}>
                  alle wieder öffnen
                </button>
              </>
            )}
          </div>
          {m.bericht && !m.laedt && (
            <p style={{ ...B.leiser, marginTop: 8, maxWidth: '46rem' }}>
              Vorgeschlagen wird in zwei Schritten:{' '}
              <strong>die Aufnahmezeit findet die Kandidaten</strong> — alles, was höchstens{' '}
              {String(m.bericht.fensterSekunden)} Sekunden auseinanderliegt —, und{' '}
              <strong>ein Bildvergleich bestätigt sie</strong>. Der Vergleich misst, wie ähnlich
              sich zwei Aufnahmen sind (0 = gleiches Bild); zusammen bleibt, was unter{' '}
              {zahl(m.bericht.hoechstabstand)} liegt. Beide Werte stehen an jeder Zeile.
            </p>
          )}
        </div>
        <button style={B.knopf} onClick={() => void m.laden()} disabled={m.laedt}>
          Neu rechnen
        </button>
      </div>

      {m.bericht && !m.bericht.bestaetigt && (
        <div style={{ ...B.warnung, margin: '0 24px 16px' }}>
          Ohne Bildvergleich — die Vorschläge stammen allein aus der Aufnahmezeit. Zwei Kameras auf
          demselben Fest stehen dann als Doppel darin. (Auf diesem Rechner fehlt <code>swiftc</code>
          .)
        </div>
      )}
      {m.fehler && <div style={{ ...B.fehlerfeld, margin: '0 24px 16px' }}>{m.fehler}</div>}
      {m.meldung && <div style={{ ...B.leise, margin: '0 24px 16px' }}>{m.meldung}</div>}

      {!m.laedt && m.zeilen.length === 0 && !m.fehler && (
        <div style={{ ...B.leiser, padding: '0 24px' }}>
          Keine Doppel gefunden. Im Bestand liegt keine Aufnahme dicht genug an einer anderen — oder
          sie sind schon abgearbeitet.
        </div>
      )}

      <div style={S.liste}>
        {sichtbar.map((zeile, platz) => {
          const i = m.zeilen.indexOf(zeile);
          return (
            <Fragment key={zeile.schluessel}>
              {platz === ersterUnsicherer && (
                <div style={S.marke}>
                  <span style={B.marke}>Ab hier lohnt der zweite Blick</span>
                  <span style={B.leiser}>
                    Bildabstand über {zahl(AUFMERKSAM_AB)} — darunter mischen sich Aufnahmen
                    desselben Augenblicks, die verschiedene Motive zeigen. Was keins ist, ist mit
                    „beide behalten" in einem Klick vom Tisch.
                  </span>
                </div>
              )}
              <Zeile
                zeile={zeile}
                schwelle={m.bericht?.hoechstabstand}
                laeuft={m.laeuft}
                onBehalten={(id) => void m.behalten(i, id)}
                onAlleBehalten={() => void m.alleBehalten(i)}
                onWiederOeffnen={() => void m.wiederOeffnen(zeile.schluessel)}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Zeile({
  zeile,
  schwelle,
  laeuft,
  onBehalten,
  onAlleBehalten,
  onWiederOeffnen,
}: {
  zeile: DoppelZeile;
  /** Bis wohin der Bildvergleich zwei Aufnahmen zusammenlässt. */
  schwelle: number | undefined;
  laeuft: string | null;
  onBehalten: (photoId: string) => void;
  onAlleBehalten: () => void;
  onWiederOeffnen: () => void;
}) {
  const uebrig = zeile.fotos.filter((f) => !zeile.entfernt.includes(f.id));
  const ausgeduennt = uebrig.length <= 1;
  const gemerkt = zeile.behaltenSeit !== undefined;
  const erledigt = ausgeduennt || gemerkt;

  return (
    <div style={{ ...S.zeile, opacity: erledigt ? 0.55 : 1 }}>
      <div style={S.zeilenkopf}>
        <span style={B.leise}>{zeitraum(zeile)}</span>
        <span style={B.leiser}>{begruendung(zeile, schwelle)}</span>
      </div>
      <div style={S.bilder}>
        {zeile.fotos.map((foto) => (
          <Bild
            key={foto.id}
            foto={foto}
            vorschlag={foto.id === zeile.behalten}
            entfernt={zeile.entfernt.includes(foto.id)}
            bester={istBester(foto, uebrig)}
            laeuft={laeuft === foto.id}
            zeigeKnopf={!erledigt}
            onBehalten={() => onBehalten(foto.id)}
          />
        ))}
        {/*
          Der Knopf gehört an die Bilder und nicht an den rechten Rand der
          Zeile: Die Entscheidung fällt beim Vergleichen, also links, und ein
          Knopf tausend Pixel daneben wird übersehen. Auf Höhe der
          „dieses behalten"-Knöpfe, weil er zu derselben Frage gehört.
        */}
        <div style={S.wahl}>
          {gemerkt ? (
            <>
              <span style={B.leiser}>alle behalten</span>
              <button style={B.knopfText} onClick={onWiederOeffnen} disabled={laeuft !== null}>
                wieder öffnen
              </button>
            </>
          ) : ausgeduennt ? (
            <span style={B.leiser}>ausgedünnt</span>
          ) : (
            <button
              style={B.knopf}
              onClick={onAlleBehalten}
              disabled={laeuft !== null}
              title="Kein Doppel — alle Bilder bleiben, und die Zeile kommt nicht wieder"
            >
              {laeuft === zeile.schluessel
                ? 'wird gemerkt …'
                : uebrig.length === 2
                  ? 'beide behalten'
                  : `alle ${String(uebrig.length)} behalten`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Warum die Automatik hier ein Doppel sieht.
 *
 * Ohne diesen Satz bleibt einem Vorschlag gegenüber nur Glauben oder
 * Ignorieren — und beides ist bei 49 Zeilen keine Arbeitsgrundlage. Genannt
 * werden beide Schritte: der zeitliche Abstand, der die Kandidaten findet, und
 * der gemessene Bildabstand, der sie bestätigt hat.
 */
function begruendung(zeile: DoppelZeile, schwelle: number | undefined): string {
  const teile = [`${spanne(zeile)} auseinander`];
  if (zeile.aehnlichkeit === undefined) {
    teile.push('kein Bildvergleich');
  } else {
    teile.push(
      `Bildabstand ${zahl(zeile.aehnlichkeit)}` +
        (schwelle !== undefined ? ` von höchstens ${zahl(schwelle)}` : ''),
    );
  }
  return teile.join(' · ');
}

/** Eine Zahl mit zwei Nachkommastellen, deutsch. */
function zahl(wert: number): string {
  return wert.toFixed(2).replace('.', ',');
}

function Bild({
  foto,
  vorschlag,
  entfernt,
  bester,
  laeuft,
  zeigeKnopf,
  onBehalten,
}: {
  foto: FotoInfo;
  vorschlag: boolean;
  entfernt: boolean;
  bester: boolean;
  laeuft: boolean;
  zeigeKnopf: boolean;
  onBehalten: () => void;
}) {
  const bildSrc = useBildSrc();
  const schaerfe = foto.quality?.sharpness;

  return (
    <div style={S.bild}>
      <div
        style={{
          ...S.rahmen,
          // Türkis markiert die Aktion und sonst nichts — hier den Vorschlag,
          // den ein Klick ausführen würde.
          borderColor: entfernt ? T.line : vorschlag ? T.cyan : T.line,
          background: entfernt ? T.bg2 : T.bg1,
        }}
      >
        <img
          src={bildSrc(foto.id)}
          alt={foto.fileName}
          style={{ ...S.pixel, filter: entfernt ? 'grayscale(1)' : 'none' }}
        />
      </div>
      <div style={S.unterschrift}>
        <div style={{ ...B.dateiname, ...S.name }} title={foto.relPath}>
          {foto.fileName}
        </div>
        <div style={B.leiser}>
          {uhrzeit(foto)}
          {schaerfe !== undefined && (
            <>
              {' · '}
              <span style={{ color: bester ? T.fg1 : T.fg3, fontWeight: bester ? 600 : 400 }}>
                Schärfe {Math.round(schaerfe)}
              </span>
            </>
          )}
        </div>
        {entfernt ? (
          <div style={B.leiser}>aussortiert</div>
        ) : zeigeKnopf ? (
          <button
            style={vorschlag ? B.knopfPrimaer : B.knopf}
            onClick={onBehalten}
            disabled={laeuft}
            title="Dieses Foto behalten, die übrigen dieses Doppels aussortieren"
          >
            {laeuft ? 'sortiert aus …' : 'dieses behalten'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Ob dieses Foto das schärfste der noch übrigen ist. */
function istBester(foto: FotoInfo, uebrig: readonly FotoInfo[]): boolean {
  const eigen = foto.quality?.sharpness;
  if (eigen === undefined) return false;
  return uebrig.every((f) => (f.quality?.sharpness ?? -1) <= eigen);
}

/** Tag und Spanne eines Doppels, so kurz wie möglich. */
function zeitraum(zeile: DoppelZeile): string {
  const tag = zeile.from.slice(0, 10).split('-').reverse().join('.');
  return `${tag}, ${zeile.from.slice(11, 16)} · ${String(zeile.photoIds.length)} Aufnahmen`;
}

/** Wie weit die erste und die letzte Aufnahme auseinanderliegen. */
function spanne(zeile: DoppelZeile): string {
  const sekunden = Math.round((Date.parse(`${zeile.to}Z`) - Date.parse(`${zeile.from}Z`)) / 1000);
  return sekunden < 90 ? `${String(sekunden)} s` : `${String(Math.round(sekunden / 60))} min`;
}

function uhrzeit(foto: FotoInfo): string {
  return foto.effectiveDate ? foto.effectiveDate.slice(11, 19) : 'ohne Datum';
}

const S = {
  /**
   * Die Ansicht ist ihre eigene Scrollfläche.
   *
   * Die App füllt das Fenster und scrollt nicht als Ganzes (`App.tsx`,
   * `overflow: hidden`) — ohne `flex: 1` samt `minHeight: 0` wächst die Liste
   * über den unteren Rand hinaus und ist ab dem dritten Doppel unerreichbar.
   * Dieselbe Naht wie in `Abnahme.tsx`.
   */
  seite: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    padding: '24px 0 48px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  kopf: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    padding: '0 24px',
  },
  kopftext: { minWidth: 0 },
  /**
   * Die Entscheidung über das ganze Doppel, neben dem letzten Bild.
   *
   * `flex-end` setzt sie auf die Höhe der „dieses behalten"-Knöpfe: Alle drei
   * Antworten auf dieselbe Frage stehen damit in einer Reihe.
   */
  wahl: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 5,
    paddingBottom: 2,
  },
  bilanz: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    marginTop: 4,
    flexWrap: 'wrap' as const,
  },
  liste: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  /** Die Trennmarke zwischen den sicheren Fällen und dem Rest. */
  marke: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: '22px 24px 6px',
    borderTop: `1px solid ${T.line}`,
    maxWidth: '46rem',
  },
  zeile: {
    padding: '14px 24px',
    borderTop: `1px solid ${T.line}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  zeilenkopf: { display: 'flex', alignItems: 'baseline', gap: 12 },
  bilder: { display: 'flex', gap: 16, flexWrap: 'wrap' as const },
  // Groß genug, um Schärfe zu beurteilen: Bei 140 px sieht man, *dass* es zwei
  // Aufnahmen sind, aber nicht, welche die bessere ist — und das ist die
  // einzige Frage dieser Ansicht.
  bild: { width: 340, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  rahmen: {
    border: `2px solid ${T.line}`,
    borderRadius: T.rMd,
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
  },
  pixel: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const, display: 'block' },
  unterschrift: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
    alignItems: 'flex-start',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 340,
  },
};
