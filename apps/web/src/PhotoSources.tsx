/**
 * Bildquellen verwalten.
 *
 * Das Buch entsteht aus einer Liste von Ordnern, nicht aus einem. Nachzügler
 * kommen als weiterer Ordner dazu – kopiert wird nichts, jede Quelle bleibt,
 * wo sie ist, und wird ausschließlich gelesen.
 *
 * Der Pfad wird getippt statt ausgewählt: Ein Dateidialog im Browser gibt
 * keinen echten Pfad heraus, und der Server läuft ohnehin auf demselben
 * Rechner wie die Bilder.
 *
 * Eine nicht erreichbare Quelle bekommt eine gelbe Karte statt einer Fußnote:
 * Der Grundbestand liegt auf einem Netzlaufwerk, und der Unterschied zwischen
 * „der Ordner ist leer" und „der Ordner ist nicht eingehängt" ist die ganze
 * Auskunft dieser Ansicht.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  type Bildquelle as Source,
  fehlertext,
  type ImportDiff,
  neuEinlesen,
  quelleEntfernen,
  quelleHinzufuegen,
  quellenLaden,
  quelleUmbenennen,
} from './api.js';
import { B, T } from './theme.js';

interface PhotoSourcesProps {
  /** Nach jeder Änderung am Bestand: Projektinfo und Vorschau neu laden. */
  onChanged: () => void;
  /** Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat. */
  standVersion?: number;
}

export function PhotoSources({ onChanged, standVersion }: PhotoSourcesProps) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [pfad, setPfad] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(() => {
    quellenLaden()
      .then((d) => setSources(d.sources))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }, []);

  useEffect(laden, [laden, standVersion]);

  /** Was ein Import bewirkt hat, in einem Satz. */
  function meldung(d: ImportDiff): string {
    const teile = [`${d.photoCount} Fotos`, `${d.neu.length} neu`, `${d.unveraendert} unverändert`];
    if (d.verschwunden.length > 0) teile.push(`${d.verschwunden.length} verschwunden`);
    if (d.imBuchVerschwunden.length > 0) {
      teile.push(`davon ${d.imBuchVerschwunden.length} noch im Buch – dort bleibt der Platz leer`);
    }
    for (const q of d.offline) {
      teile.push(`„${q.label}" nicht erreichbar, ${q.photoCount} Fotos daraus bleiben unberührt`);
    }
    return teile.join(', ');
  }

  /**
   * Eine Änderung am Bestand, mit Statusanzeige.
   *
   * Der Aufrufer übergibt den Aufruf als Funktion, damit das Ergebnis seinen
   * Typ behält – vorher kam hier ein `Record<string, unknown>` heraus, das an
   * jeder Verwendungsstelle wieder zurechtgebogen werden musste.
   */
  async function anfrage<T>(was: string, tun: () => Promise<T>): Promise<T | null> {
    setBusy(was);
    setNote(null);
    setFehler(null);
    try {
      const d = await tun();
      laden();
      onChanged();
      return d;
    } catch (e: unknown) {
      setFehler(fehlertext(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function hinzufuegen() {
    const root = pfad.trim();
    if (!root) return;
    const d = await anfrage('Lese Ordner ein …', () =>
      quelleHinzufuegen(root, name.trim() || undefined),
    );
    if (d) {
      setPfad('');
      setName('');
      setNote(meldung(d));
    }
  }

  async function einlesen(source?: Source) {
    const d = await anfrage(
      source ? `Lese „${source.label}" neu ein …` : 'Lese alle Quellen neu ein …',
      () => neuEinlesen(source ? { sourceId: source.id } : undefined),
    );
    if (d) setNote(meldung(d));
  }

  async function entfernen(source: Source) {
    const folgen =
      source.inBookCount > 0
        ? `\n\n${source.inBookCount} davon stehen im Buch; dort bleiben die Plätze leer. ` +
          'Die Doppelseiten selbst bleiben erhalten.'
        : '';
    if (
      !window.confirm(
        `„${source.label}" entfernen? ${source.photoCount} Fotos verschwinden aus dem Projekt.${folgen}` +
          '\n\nDie Dateien auf der Platte bleiben unangetastet.',
      )
    ) {
      return;
    }

    const d = await anfrage(`Entferne „${source.label}" …`, () => quelleEntfernen(source.id));
    if (d) setNote(`„${source.label}" entfernt, ${d.entfernt} Fotos weniger`);
  }

  async function umbenennen(source: Source, label: string) {
    if (label.trim() === source.label || !label.trim()) return;
    await anfrage('Benenne um …', () => quelleUmbenennen(source.id, label));
  }

  const gesamt = (sources ?? []).reduce((n, q) => n + q.photoCount, 0);

  return (
    <div style={S.flaeche}>
      <div style={S.spalte}>
        <h2 style={S.titel}>Woher kommen die Bilder?</h2>
        <p style={S.lead}>
          Jeder Ordner wird nur gelesen, nichts wird kopiert oder verschoben. Neue Fotos landen im
          Fotopool der Doppelseitenansicht – das Buch wird dabei nicht neu gebaut.
        </p>

        {busy && <p style={S.status}>{busy}</p>}
        {note && !busy && <p style={S.status}>{note}</p>}
        {fehler && <p style={{ ...B.fehlerfeld, margin: '0 0 12px' }}>{fehler}</p>}

        {sources?.map((q) => (
          <div key={q.id} style={{ ...S.karte, ...(q.erreichbar ? {} : S.karteOffline) }}>
            <div style={S.karteReihe}>
              <div style={{ minWidth: 0 }}>
                <input
                  // Trägt den geladenen Namen im Schlüssel: Sonst überlebt
                  // eine serverseitig zurückgenommene Umbenennung nicht, weil
                  // React `defaultValue` nur beim ersten Mount setzt.
                  key={`${q.id}-${q.label}`}
                  defaultValue={q.label}
                  onBlur={(e) => void umbenennen(q, e.target.value)}
                  style={S.name}
                  title="Anzeigename"
                />
                <p style={S.pfad}>{q.root}</p>
                <p style={{ ...B.leise, marginTop: 6 }}>
                  {q.photoCount} Fotos
                  {q.inBookCount > 0 && ` · ${q.inBookCount} im Buch`}
                </p>
                {!q.erreichbar && (
                  <p style={{ ...B.leise, marginTop: 8, color: T.warn }}>
                    Nicht erreichbar — die Fotos bleiben im Buch, bis der Ordner wieder da ist.
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => void einlesen(q)}
                  disabled={!!busy || !q.erreichbar}
                  style={{ ...B.knopf, ...(q.erreichbar ? {} : S.aus) }}
                  title="Liest diesen Ordner erneut ein. Das Buch bleibt stehen."
                >
                  Neu einlesen
                </button>
                <button onClick={() => void entfernen(q)} disabled={!!busy} style={B.knopfWeg}>
                  Entfernen
                </button>
              </div>
            </div>
          </div>
        ))}
        {sources?.length === 0 && <p style={B.leise}>Noch keine Bildquelle.</p>}

        <div style={{ ...S.karte, marginTop: 24 }}>
          <strong style={{ ...B.titel, fontSize: 15 }}>Ordner hinzufügen</strong>
          <div style={S.eingaben}>
            <input
              value={pfad}
              onChange={(e) => setPfad(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void hinzufuegen();
              }}
              placeholder="/Users/see/Bilder/Nachtrag"
              spellCheck={false}
              style={{ ...B.feldMono, flex: '1 1 22rem' }}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              style={{ ...B.feld, width: '11rem' }}
            />
            <button
              onClick={() => void hinzufuegen()}
              disabled={!!busy || !pfad.trim()}
              style={B.knopfPrimaer}
            >
              Hinzufügen und einlesen
            </button>
          </div>
          <p style={{ ...B.leise, marginTop: 10 }}>
            Im Finder mit <kbd>⌥⌘C</kbd> den Pfad des Ordners kopieren und hier einfügen.
            Unterordner werden mitgelesen; ein Ordner, der in einer bestehenden Quelle liegt, wird
            abgelehnt.
          </p>
        </div>

        <div style={S.fuss}>
          <span style={B.leise}>{gesamt} Fotos insgesamt</span>
          <button onClick={() => void einlesen()} disabled={!!busy} style={B.knopf}>
            Alle Quellen neu einlesen
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  flaeche: { flex: 1, overflowY: 'auto' as const, padding: '28px 32px 48px', minHeight: 0 },
  spalte: { maxWidth: '52rem' },
  titel: { fontSize: 24, marginBottom: 6 },
  lead: { fontSize: 14, color: T.fg2, lineHeight: 1.55, marginBottom: 22 },
  status: {
    margin: '0 0 12px',
    padding: '6px 10px',
    fontSize: 13,
    color: T.fg2,
    background: T.bg3,
    borderRadius: T.rMd,
  },
  karte: {
    padding: '16px 18px',
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    marginBottom: 10,
  },
  karteOffline: { background: T.warnBg, borderColor: T.warnRand },
  karteReihe: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 16,
    alignItems: 'start',
  },
  name: {
    fontFamily: T.display,
    fontSize: 17,
    fontWeight: 600,
    border: '1px solid transparent',
    borderRadius: T.rMd,
    padding: '2px 6px',
    marginLeft: -6,
    background: 'transparent',
    width: '100%',
    maxWidth: '24rem',
    color: T.fg1,
  },
  pfad: {
    margin: '4px 0 0',
    fontSize: 13,
    color: T.fg3,
    fontFamily: T.mono,
    wordBreak: 'break-all' as const,
  },
  aus: { color: T.fg4, cursor: 'not-allowed' },
  eingaben: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginTop: 12 },
  fuss: {
    marginTop: 20,
    paddingTop: 14,
    borderTop: `1px solid ${T.line}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
} satisfies Record<string, React.CSSProperties>;
