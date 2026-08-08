/**
 * Die Abnahme: was dem Druck im Weg steht, auf einer Seite.
 *
 * Vor einer Bestellung war die Frage „ist noch etwas übrig?" nur durch achtzig
 * Doppelseiten zu beantworten. Hier steht die Antwort als Liste, und jede Zeile
 * führt an die Stelle — beim Bildfund auf das Bild und nicht nur auf das Blatt
 * (`/doppelseite/18/platz/r2c`), denn bei acht Bildern auf einem Blatt ist das
 * der Unterschied zwischen einer Auskunft und einem Suchbild.
 *
 * **Gruppiert nach Art und nicht nach Seite.** Nach Seite sortiert wäre es eine
 * zweite Übersicht — die gibt es, und sie zeigt Bilder. Wer diese Ansicht
 * öffnet, arbeitet dagegen eine Sorte Fund ab: erst die Bilder unter der
 * Mindestauflösung, dann die Texte am Rand. Die Reihenfolge der Gruppen kommt
 * aus dem Kern (`BEFUNDARTEN`), damit „was wiegt schwerer" an einer Stelle
 * entschieden ist und nicht in der Ansicht.
 *
 * **Die Zeilen sind Links und keine Knöpfe** (`Link` aus `router.tsx`): Wer eine
 * Liste von Funden durcharbeitet, will die nächste Stelle im zweiten Tab
 * aufmachen, und das gibt nur ein `href`.
 *
 * **Der Bericht entscheidet nichts.** Er blockiert keinen Export und ordnet
 * nichts um; manche Funde nimmt man bewusst in Kauf — ein Gesicht im Beschnitt
 * kann genau die Absicht sein. Was man gesehen und für gut befunden hat, wird
 * abgenickt und verschwindet aus der Liste, nicht aus dem Bericht: Am Fuß steht,
 * wie viele es sind, und dort kommen sie auch wieder hervor.
 */
import { useCallback, useEffect, useState } from 'react';
import { BEFUNDARTEN, istSchwer, type Abnahmebericht, type Befund } from '@franibook/core';
import { abnahmeLaden, abnahmeZuruecknehmen, befundAbnicken, fehlertext } from './api.js';
import { Link, type Route } from './router.js';
import { B, T } from './theme.js';

interface AbnahmeProps {
  onNavigieren: (ziel: Route) => void;
  /** Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat. */
  standVersion?: number;
  /** Eine Abnahme ändert das Projekt — die Kennzahlen und der Verlauf ziehen nach. */
  onChanged?: () => void;
  /**
   * Meldet die offenen Funde an den Reiter der Prüfung.
   *
   * Die Ansicht hat die Zahl ohnehin (`bilanz.schwer + leicht`, beide zählen nur
   * Offenes); sie ein zweites Mal zu holen wäre eine zweite Anfrage für dieselbe
   * Auskunft.
   */
  onOffen?: (offen: number) => void;
}

export function Abnahme({ onNavigieren, standVersion, onChanged, onOffen }: AbnahmeProps) {
  const [bericht, setBericht] = useState<Abnahmebericht | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  /** Ob die abgenickten Funde mit angezeigt werden. */
  const [zeigeAbgenommene, setZeigeAbgenommene] = useState(false);

  const laden = useCallback(() => {
    setLaeuft(true);
    abnahmeLaden()
      .then((d) => {
        setBericht(d);
        setFehler(null);
      })
      .catch((e: unknown) => setFehler(fehlertext(e)))
      .finally(() => setLaeuft(false));
  }, []);

  // Wie in den übrigen Ansichten: neu laden, ohne neu einzuhängen. Ein
  // Zurücknehmen kann jeden Fund beseitigt oder erzeugt haben.
  useEffect(laden, [laden, standVersion]);

  // Die offenen Funde an den Reiter melden. `schwer` und `leicht` zählen beide
  // nur Offenes (siehe `Abnahmebericht.bilanz`), also ist die Summe genau das,
  // was dort in Klammern stehen soll.
  useEffect(() => {
    if (bericht) onOffen?.(bericht.bilanz.schwer + bericht.bilanz.leicht);
  }, [bericht, onOffen]);

  /**
   * Abnicken und Zurücknehmen liefern den ganzen Bericht zurück.
   *
   * Nicht nur die eine Zeile: Eine Abnahme ändert die Bilanz, und bei einem
   * gebündelten Textplatz betrifft sie achtzig Doppelseiten auf einmal. Ein
   * lokal weggestrichener Eintrag zeigte danach andere Zahlen als der Server.
   */
  const griff = useCallback(
    (arbeit: Promise<{ bericht: Abnahmebericht }>) => {
      setLaeuft(true);
      arbeit
        .then((d) => {
          setBericht(d.bericht);
          setFehler(null);
          onChanged?.();
        })
        .catch((e: unknown) => setFehler(fehlertext(e)))
        .finally(() => setLaeuft(false));
    },
    [onChanged],
  );

  const offen = (bericht?.befunde ?? []).filter((b) => !b.abgenommen);
  const abgenickt = (bericht?.befunde ?? []).filter((b) => b.abgenommen);
  const sichtbar = zeigeAbgenommene ? [...offen, ...abgenickt] : offen;

  return (
    <div style={S.flaeche}>
      <div style={S.spalte}>
        <h2 style={S.titel}>Was dem Druck im Weg steht</h2>
        <p style={S.lead}>
          {bericht
            ? bilanzsatz(bericht)
            : fehler
              ? 'Der Bericht konnte nicht geholt werden.'
              : 'Das Buch wird durchgesehen …'}{' '}
          <button onClick={laden} disabled={laeuft} style={B.knopfText}>
            {laeuft ? 'prüft …' : 'erneut prüfen'}
          </button>
        </p>

        {fehler && <p style={B.fehlerfeld}>{fehler}</p>}

        {bericht && offen.length === 0 && (
          <p style={S.sauber}>
            Nichts Offenes. Das Buch hat {bericht.umfang.doppelseiten} Doppelseiten,{' '}
            {bericht.umfang.seiten} Seiten und {bericht.umfang.bilder} Bilder.
          </p>
        )}

        {bericht &&
          BEFUNDARTEN.map((art) => {
            const funde = sichtbar.filter((b) => b.art === art.art);
            if (funde.length === 0) return null;
            return (
              <section key={art.art} style={S.gruppe}>
                <h3 style={S.gruppentitel}>
                  {/*
                    Gezählt werden die offenen Funde — die abgenickten sind
                    erledigt und sollen die Zahl nicht aufblasen. Sind alle
                    abgenickt, steht dort eine 0 und die Gruppe ist trotzdem zu
                    sehen: Sie erscheint nur, wenn „auch abgenommene zeigen" an
                    ist, und dann ist die 0 die richtige Auskunft.
                  */}
                  <span style={istSchwer(art.art) ? S.zahlSchwer : S.zahlLeicht}>
                    {funde.filter((b) => !b.abgenommen).length}
                  </span>
                  {art.titel}
                </h3>
                <ul style={S.liste}>
                  {funde.map((fund) => (
                    <li
                      key={fund.schluessel}
                      style={{ ...S.zeile, ...(fund.abgenommen ? S.zeileAb : {}) }}
                    >
                      <Ortsmarke fund={fund} onNavigieren={onNavigieren} />
                      <span style={S.text}>{fund.text}</span>
                      {fund.abgenommen ? (
                        <button
                          onClick={() => griff(abnahmeZuruecknehmen(fund.schluessel))}
                          disabled={laeuft}
                          style={B.knopfText}
                          title="Diesen Befund wieder melden"
                        >
                          wieder melden
                        </button>
                      ) : (
                        <button
                          onClick={() => griff(befundAbnicken(fund.schluessel))}
                          disabled={laeuft}
                          style={B.knopfText}
                          title="Gesehen und in Ordnung – nicht mehr melden"
                        >
                          ist ok
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

        {/*
          Der Fuß erscheint an der gespeicherten Zahl und nicht an den sichtbaren
          Abnahmen: Ein abgenickter Fund kann verschwinden — behobene Randachse,
          gelöschtes Foto —, sein Eintrag bleibt aber stehen, weil der Fund
          zurückkommen kann. Ohne diese Zeile gäbe es dafür keinen Rückweg mehr
          außer der Hand am `project.json`.
        */}
        {bericht && bericht.bilanz.gespeichert > 0 && (
          <p style={S.fuss}>
            <span style={B.leise}>{abnahmesatz(bericht)}</span>
            <button onClick={() => setZeigeAbgenommene((v) => !v)} style={B.knopfText}>
              {zeigeAbgenommene ? 'ausblenden' : 'anzeigen'}
            </button>
            <button
              onClick={() => griff(abnahmeZuruecknehmen())}
              disabled={laeuft}
              style={B.knopfText}
              title="Jede Abnahme aufheben – ein Cmd+Z holt sie zurück"
            >
              alle zurücknehmen
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Die Stelle eines Funds, als Sprung dorthin.
 *
 * Ein Fund am ganzen Buch (Seitenzahl, Gliederung) hat kein Ziel — dort steht
 * das Wort ohne Link, statt auf die erste Doppelseite zu zeigen, die nichts
 * damit zu tun hat.
 */
function Ortsmarke({ fund, onNavigieren }: { fund: Befund; onNavigieren: (ziel: Route) => void }) {
  if (fund.ort.kind === 'buch') return <span style={S.ortStumm}>ganzes Buch</span>;

  const ziel: Route =
    fund.ort.kind === 'umschlag'
      ? { view: 'cover' }
      : {
          view: 'spread',
          index: fund.ort.index,
          // Der Platz gehört ins Ziel: Auf einer Achterseite wäre „Doppelseite
          // 18" sonst eine Suchaufgabe.
          ...(fund.ort.slotId ? { slotId: fund.ort.slotId } : {}),
        };
  const wort = fund.ort.kind === 'umschlag' ? 'Umschlag' : `Doppelseite ${fund.ort.index + 1}`;
  const platz = fund.ort.kind === 'spread' ? fund.ort.slotId : undefined;

  return (
    <span style={S.ort}>
      <Link route={ziel} onNavigieren={onNavigieren} style={S.link}>
        {wort}
      </Link>
      {platz && <span style={S.platz}>{platz}</span>}
    </span>
  );
}

/** Wie viele Abnahmen gespeichert sind — und wie viele davon gerade greifen. */
function abnahmesatz(bericht: Abnahmebericht): string {
  const { abgenommen, gespeichert } = bericht.bilanz;
  const stamm = gespeichert === 1 ? '1 Befund abgenommen' : `${gespeichert} Befunde abgenommen`;
  const ruhend = gespeichert - abgenommen;
  return ruhend === 0 ? stamm : `${stamm}, ${ruhend} davon ohne Fund im Buch`;
}

/** Die Bilanz als Satz — die Zahl, die man vor einer Bestellung sehen will. */
function bilanzsatz(bericht: Abnahmebericht): string {
  const { schwer, leicht, abgenommen } = bericht.bilanz;
  const umfang = `${bericht.umfang.doppelseiten} Doppelseiten, ${bericht.umfang.bilder} Bilder`;
  const nachsatz = abgenommen > 0 ? ` ${abgenommen} abgenommen.` : '';
  if (schwer === 0 && leicht === 0) return `Nichts Offenes über ${umfang}.${nachsatz}`;
  const teile = [
    schwer === 1 ? '1 schwerer Fund' : `${schwer} schwere Funde`,
    leicht === 1 ? '1 leichter' : `${leicht} leichte`,
  ];
  return `${teile.join(', ')} über ${umfang}. Nichts davon verhindert einen Export.${nachsatz}`;
}

const S = {
  flaeche: { flex: 1, overflowY: 'auto' as const, padding: '28px 32px 48px', minHeight: 0 },
  spalte: { maxWidth: '64rem' },
  titel: { fontSize: 24, marginBottom: 6 },
  lead: { fontSize: 14, color: T.fg2, lineHeight: 1.55, marginBottom: 22 },
  sauber: {
    ...B.leise,
    padding: '10px 12px',
    background: T.bg3,
    borderRadius: T.rMd,
  },
  gruppe: { marginBottom: 26 },
  gruppentitel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    margin: '0 0 8px',
    paddingBottom: 6,
    borderBottom: `1px solid ${T.line}`,
  },
  /** Die Zahl vor der Überschrift: rot nur, wenn der Fund wirklich wiegt. */
  zahlSchwer: {
    ...B.zahl,
    fontSize: 12,
    minWidth: 22,
    textAlign: 'center' as const,
    padding: '1px 6px',
    borderRadius: T.rPill,
    color: T.fehler,
    border: `1px solid ${T.fehlerRand}`,
  },
  zahlLeicht: {
    ...B.zahl,
    fontSize: 12,
    minWidth: 22,
    textAlign: 'center' as const,
    padding: '1px 6px',
    borderRadius: T.rPill,
    color: T.fg2,
    border: `1px solid ${T.line2}`,
  },
  liste: { listStyle: 'none', margin: 0, padding: 0 },
  zeile: {
    display: 'grid',
    gridTemplateColumns: '14rem 1fr auto',
    gap: 14,
    alignItems: 'baseline',
    padding: '5px 0',
    fontSize: 13,
  },
  /** Abgenickt: leiser, aber nicht durchgestrichen – gelesen wird es weiter. */
  zeileAb: { opacity: 0.55 },
  ort: { display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 },
  ortStumm: { color: T.fg3, fontSize: 13 },
  link: { color: T.cyanTief, textDecoration: 'none' },
  platz: { fontFamily: T.mono, fontSize: 11, color: T.fg3, overflow: 'hidden' },
  text: { color: T.fg1, lineHeight: 1.5 },
  fuss: {
    display: 'flex',
    gap: 14,
    alignItems: 'baseline',
    marginTop: 26,
    paddingTop: 12,
    borderTop: `1px solid ${T.line}`,
  },
} satisfies Record<string, React.CSSProperties>;
