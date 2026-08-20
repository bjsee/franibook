/**
 * Die Projektwahl: welches Buch offen ist, und der Weg zu einem anderen.
 *
 * Der Schritt **vor** dem Buch — und trotzdem ein Reiter wie jede andere Ansicht,
 * der erste von links. Zwei Sonderwege standen hier zuerst und sind wieder
 * weggeräumt: der Buchname in der Kopfzeile als Link und ein Auftritt ohne
 * Kopfzeile bei leerem Projekt. Beides widerspricht dem Umbau der Kopfzeile
 * (`docs/konzept.md`, „Drei Rahmen um dieselbe Bühne"): Der Umschlag wurde damals
 * vom `?cover`-Sonderweg zu einem echten Reiter, die Kommandopalette entfiel mit
 * dem Satz „sie hätte nichts zu tun, was die Reiter nicht schon tun" — und die
 * Kopfzeile steht ausdrücklich in *allen* Varianten, damit ein Wechsel nie den
 * Zugang zu einer Ansicht kostet.
 *
 * Bei leerem Projekt ist sie die **Startansicht** (`App.tsx` leitet einmal dorthin
 * um): Die Übersicht eines Buches ohne Fotos ist nichts, und der erste Handgriff
 * ist dort ohnehin „öffnen" oder „neu".
 *
 * **Der Pfad kommt aus dem Dialog des Systems**, nicht aus einem Textfeld: Ein
 * Browser kann keinen Pfad herausgeben (`dateidialog.ts` im Server erklärt, warum
 * das über `osascript` läuft). Die Eingabe von Hand bleibt als zweiter Weg
 * daneben — sie ist die Antwort für einen Rechner, auf dem der Dialog nicht
 * aufgeht, und sie öffnet sich von selbst, wenn er es nicht tut.
 *
 * Was hier **nicht** steht: Speichern. Der Server schreibt nach jedem Griff von
 * selbst (`void project.save()`), es gibt also keinen Stand, den man verlieren
 * könnte, und ein Knopf „Speichern" wäre eine Zusage, die nichts hinzufügt.
 * „Speichern unter" ist etwas anderes: Es sagt, wo weitergeschrieben wird.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  type AblageInfo,
  ablageLaden,
  dateidialog,
  fehlertext,
  type LetztesProjekt,
  letztesVergessen,
  projektNeu,
  projektOeffnen,
  projektSpeichernUnter,
} from './api.js';
import { B, T } from './theme.js';

interface Props {
  /** Was gerade offen ist — kommt aus `GET /api/project`, nicht von hier. */
  offen: AblageInfo;
  /** Fotos im offenen Projekt. Null heißt: hier ist noch kein Buch. */
  photoCount: number;
  busy: boolean;
  /** Der Stand ist ein anderer: alles neu laden. */
  onGewechselt: (satz: string) => void;
  /** Nur der Ort hat sich geändert: die Projektauskunft nachziehen. */
  onUmbenannt: (satz: string) => void;
  /** Zu den Bildquellen — der nächste Schritt in einem leeren Projekt. */
  onZuBildquellen: () => void;
}

/** `2026-08-18T14:31:02` → `18.08.2026, 14:31`. */
function wann(zeit: string): string {
  const [tag, uhr] = zeit.split('T');
  const teile = tag?.split('-') ?? [];
  if (teile.length !== 3 || !uhr) return zeit;
  return `${teile[2]}.${teile[1]}.${teile[0]}, ${uhr.slice(0, 5)}`;
}

/** Die Größe einer Projektdatei, kurz. */
function groesse(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;
}

/** Der Ordner, in dem eine Datei liegt — ohne den Dateinamen selbst. */
function ordnerVon(pfad: string): string {
  const schnitt = pfad.lastIndexOf('/');
  return schnitt > 0 ? pfad.slice(0, schnitt) : pfad;
}

export function Projektwahl({
  offen,
  photoCount,
  busy,
  onGewechselt,
  onUmbenannt,
  onZuBildquellen,
}: Props) {
  const [zuletzt, setZuletzt] = useState<LetztesProjekt[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  /** Der Pfad von Hand — offen, sobald der Dialog des Systems nicht aufgeht. */
  const [handpfad, setHandpfad] = useState('');
  const [handOffen, setHandOffen] = useState(false);

  const laden = useCallback(() => {
    ablageLaden()
      .then((d) => setZuletzt(d.zuletzt))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }, []);

  // Beim Einhängen und nach jedem Wechsel: Zwischen zwei Blicken auf die Liste
  // liegen Tage, und in der Zwischenzeit sind Projekte dazugekommen.
  useEffect(laden, [laden, offen.pfad]);

  /**
   * Führt einen Griff aus und hält Fehler und Laufanzeige an einer Stelle.
   *
   * Ohne das stünde `setLaeuft`/`catch`/`finally` fünfmal in dieser Datei —
   * einmal je Knopf —, und der vergessene `finally` wäre ein Knopf, der für
   * immer ausgeschaltet bleibt.
   */
  async function griff(kennung: string, tun: () => Promise<void>): Promise<void> {
    setLaeuft(kennung);
    setFehler(null);
    try {
      await tun();
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(null);
    }
  }

  /**
   * Fragt den Systemdialog nach einem Pfad.
   *
   * `null` heißt abgebrochen — dann geschieht nichts, und das ist die richtige
   * Antwort. Schlägt der Dialog fehl (kein macOS, keine Rechte), klappt die
   * Eingabe von Hand auf und trägt die Meldung: Der Weg ist dann ein anderer,
   * aber es gibt einen.
   */
  async function pfadWaehlen(art: 'oeffnen' | 'speichern' | 'neu'): Promise<string | null> {
    try {
      return (await dateidialog(art)).pfad;
    } catch (e) {
      setHandOffen(true);
      throw new Error(`${fehlertext(e)} — den Pfad unten von Hand eintragen.`, { cause: e });
    }
  }

  function oeffnen(pfad: string) {
    return griff(`oeffnen:${pfad}`, async () => {
      const d = await projektOeffnen(pfad);
      onGewechselt(`„${d.name}" geöffnet — ${d.photoCount} Fotos, ${d.spreadCount} Doppelseiten`);
    });
  }

  return (
    <div style={S.flaeche}>
      {/* Der Satz nur, wenn hier wirklich nichts ist: Bei einem gefüllten Buch
          wäre er eine Erklärung für einen Zustand, den man sieht. */}
      {photoCount === 0 && (
        <p style={B.leise}>
          Hier ist noch kein Buch. Öffne ein Projekt, oder beginne ein neues und nimm dann die
          Ordner mit den Fotos auf.
        </p>
      )}

      {/* Was offen ist, mit dem vollen Pfad: Bei zwei Büchern mit ähnlichem
          Namen ist der Ordner der Unterschied, und den liest man nur ganz. */}
      <section style={S.offen}>
        <span style={B.marke}>Offen</span>
        <div style={S.offenZeile}>
          <strong style={S.offenName}>{offen.name}</strong>
          <span style={B.leiser}>
            {photoCount === 0 ? 'noch ohne Fotos' : `${photoCount} Fotos`}
          </span>
        </div>
        <code style={S.pfad}>{offen.pfad}</code>
      </section>

      <div style={S.knoepfe}>
        <button
          style={B.knopf}
          disabled={busy || laeuft !== null}
          onClick={() =>
            void griff('dialog:oeffnen', async () => {
              const pfad = await pfadWaehlen('oeffnen');
              if (pfad === null) return;
              const d = await projektOeffnen(pfad);
              onGewechselt(
                `„${d.name}" geöffnet — ${d.photoCount} Fotos, ${d.spreadCount} Doppelseiten`,
              );
            })
          }
        >
          Projekt öffnen …
        </button>

        <button
          style={B.knopf}
          disabled={busy || laeuft !== null}
          title="Schreibt den jetzigen Stand an eine neue Stelle und arbeitet dort weiter. Die bisherige Datei bleibt als Stand von vorher liegen."
          onClick={() =>
            void griff('dialog:speichern', async () => {
              const pfad = await pfadWaehlen('speichern');
              if (pfad === null) return;
              const d = await projektSpeichernUnter(pfad);
              onUmbenannt(`Gespeichert als „${d.name}" — hier wird weitergeschrieben.`);
            })
          }
        >
          Speichern unter …
        </button>

        <button
          style={B.knopf}
          disabled={busy || laeuft !== null}
          title="Ein leeres Buch an einer neuen Stelle. Die Bildquellen bleiben, die Fotos nicht."
          onClick={() =>
            void griff('dialog:neu', async () => {
              const pfad = await pfadWaehlen('neu');
              if (pfad === null) return;
              const d = await projektNeu(pfad);
              onGewechselt(`Neues Projekt „${d.name}" — ${d.hinweise.join(' ')}`);
            })
          }
        >
          Neues Projekt …
        </button>

        {photoCount === 0 && (
          <button style={B.knopfPrimaer} onClick={onZuBildquellen} disabled={busy}>
            Bildquellen wählen
          </button>
        )}
      </div>

      {fehler && <p style={{ ...B.fehlerfeld, marginTop: 4 }}>{fehler}</p>}

      <section style={S.liste}>
        <span style={B.marke}>Zuletzt offen</span>

        {zuletzt !== null && zuletzt.length <= 1 && (
          <p style={B.leiser}>
            Noch keine anderen Projekte. Was du öffnest oder anlegst, steht danach hier.
          </p>
        )}

        {zuletzt
          ?.filter((v) => v.pfad !== offen.pfad)
          .map((v) => (
            <div key={v.pfad} style={S.zeile}>
              <div style={S.zeileText}>
                <span style={v.vorhanden ? S.name : S.nameFehlt}>{v.name}</span>
                <span style={S.zeileMeta}>
                  {v.vorhanden
                    ? `${ordnerVon(v.pfad)} · ${wann(v.zeit)}${v.bytes ? ` · ${groesse(v.bytes)}` : ''}`
                    : // Nicht stillschweigend aus der Liste geworfen: Eine
                      // unerreichbare Datei kann ein abgehängtes Laufwerk sein.
                      `${v.pfad} — nicht gefunden`}
                </span>
              </div>
              {v.vorhanden ? (
                <button
                  style={B.knopfKlein}
                  disabled={busy || laeuft !== null}
                  onClick={() => void oeffnen(v.pfad)}
                >
                  {laeuft === `oeffnen:${v.pfad}` ? '…' : 'öffnen'}
                </button>
              ) : (
                <button
                  style={B.knopfKlein}
                  disabled={busy || laeuft !== null}
                  title="Nimmt den Eintrag aus der Liste. Die Datei selbst wird nicht angefasst."
                  onClick={() =>
                    void griff(`vergessen:${v.pfad}`, async () => {
                      const d = await letztesVergessen(v.pfad);
                      setZuletzt(d.zuletzt);
                    })
                  }
                >
                  vergessen
                </button>
              )}
            </div>
          ))}
      </section>

      {/* Der zweite Weg zu einem Pfad. Zugeklappt, solange der Dialog des
          Systems seine Arbeit tut — und offen, sobald er es nicht tut. */}
      <details
        style={S.hand}
        open={handOffen}
        onToggle={(e) => setHandOffen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary style={S.handKopf}>Pfad von Hand eintragen</summary>
        <p style={{ ...B.leiser, marginTop: 8 }}>
          Voller Pfad ab „/". Ohne Endung wird <code>.franibook</code> ergänzt.
        </p>
        <div style={S.handZeile}>
          <input
            style={{ ...B.feldMono, flex: 1, minWidth: 0 }}
            value={handpfad}
            placeholder="/Users/…/franziska-2019.franibook"
            onChange={(e) => setHandpfad(e.target.value)}
          />
          <button
            style={B.knopf}
            disabled={busy || laeuft !== null || handpfad.trim().length === 0}
            onClick={() => void oeffnen(handpfad.trim())}
          >
            öffnen
          </button>
          <button
            style={B.knopf}
            disabled={busy || laeuft !== null || handpfad.trim().length === 0}
            onClick={() =>
              void griff('hand:speichern', async () => {
                const d = await projektSpeichernUnter(handpfad.trim());
                onUmbenannt(`Gespeichert als „${d.name}" — hier wird weitergeschrieben.`);
              })
            }
          >
            speichern unter
          </button>
          <button
            style={B.knopf}
            disabled={busy || laeuft !== null || handpfad.trim().length === 0}
            onClick={() =>
              void griff('hand:neu', async () => {
                const d = await projektNeu(handpfad.trim());
                onGewechselt(`Neues Projekt „${d.name}" — ${d.hinweise.join(' ')}`);
              })
            }
          >
            neu anlegen
          </button>
        </div>
      </details>
    </div>
  );
}

const S = {
  /**
   * Eine Ansicht wie jede andere: Der Rahmen scrollt, die Kopfzeile darüber
   * steht. Textbreite begrenzt — hier stehen Sätze und Pfade, kein Papier.
   */
  flaeche: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    padding: '24px 24px 40px',
    maxWidth: '52rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
  },

  offen: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  offenZeile: { display: 'flex', alignItems: 'baseline', gap: 10 },
  offenName: { fontFamily: T.display, fontSize: 19, fontWeight: 600 },
  pfad: { fontFamily: T.mono, fontSize: 12, color: T.fg3, wordBreak: 'break-all' as const },

  knoepfe: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },

  liste: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    borderBottom: `1px solid ${T.line}`,
  },
  zeileText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  name: { fontSize: 14, color: T.fg1 },
  /** Blass: Der Eintrag bleibt lesbar, ist aber nicht anklickbar. */
  nameFehlt: { fontSize: 14, color: T.fg4 },
  zeileMeta: {
    fontSize: 12,
    color: T.fg3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  hand: { display: 'block', marginTop: 4 },
  handKopf: { fontSize: 13, color: T.fg2, cursor: 'pointer' },
  handZeile: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
} satisfies Record<string, React.CSSProperties>;
