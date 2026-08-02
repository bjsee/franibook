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
 */
import { useCallback, useEffect, useState } from 'react';

interface Source {
  id: string;
  label: string;
  root: string;
  addedAt: string;
  erreichbar: boolean;
  photoCount: number;
  /** Fotos dieser Quelle, die derzeit in einer Doppelseite stehen. */
  inBookCount: number;
}

interface ImportDiff {
  neu: string[];
  verschwunden: string[];
  unveraendert: number;
  imBuchVerschwunden: string[];
  offline: { label: string; photoCount: number }[];
  photoCount: number;
}

interface PhotoSourcesProps {
  /** Nach jeder Änderung am Bestand: Projektinfo und Vorschau neu laden. */
  onChanged: () => void;
}

export function PhotoSources({ onChanged }: PhotoSourcesProps) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [pfad, setPfad] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d: { sources: Source[] }) => setSources(d.sources))
      .catch((e: unknown) => setFehler(String(e)));
  }, []);

  useEffect(laden, [laden]);

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

  async function anfrage(
    was: string,
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setBusy(was);
    setNote(null);
    setFehler(null);
    try {
      const res = await fetch(url, init);
      const d = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setFehler(String(d['error'] ?? res.statusText));
        return null;
      }
      laden();
      onChanged();
      return d;
    } catch (e: unknown) {
      setFehler(String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function hinzufuegen() {
    const root = pfad.trim();
    if (!root) return;
    const d = await anfrage('Lese Ordner ein …', '/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, ...(name.trim() ? { label: name.trim() } : {}) }),
    });
    if (d) {
      setPfad('');
      setName('');
      setNote(meldung(d as unknown as ImportDiff));
    }
  }

  async function einlesen(source?: Source) {
    const d = await anfrage(
      source ? `Lese „${source.label}" neu ein …` : 'Lese alle Quellen neu ein …',
      '/api/import',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(source ? { sourceId: source.id } : {}),
      },
    );
    if (d) setNote(meldung(d as unknown as ImportDiff));
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

    const d = await anfrage(`Entferne „${source.label}" …`, `/api/sources/${source.id}`, {
      method: 'DELETE',
    });
    if (d) setNote(`„${source.label}" entfernt, ${String(d['entfernt'])} Fotos weniger`);
  }

  async function umbenennen(source: Source, label: string) {
    if (label.trim() === source.label || !label.trim()) return;
    await anfrage('Benenne um …', `/api/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  }

  const gesamt = (sources ?? []).reduce((n, q) => n + q.photoCount, 0);

  return (
    <div style={S.wrap}>
      <div style={S.kopf}>
        <h2 style={S.titel}>Woher kommen die Bilder?</h2>
        <p style={S.hinweis}>
          Jeder Ordner wird nur gelesen, nichts wird kopiert oder verschoben. Neue Fotos landen im
          Fotopool der Doppelseitenansicht – das Buch wird dabei nicht neu gebaut.
        </p>
      </div>

      {busy && <p style={S.status}>{busy}</p>}
      {note && !busy && <p style={S.status}>{note}</p>}
      {fehler && <p style={S.fehler}>{fehler}</p>}

      <div style={S.liste}>
        {sources?.map((q) => (
          <div key={q.id} style={S.zeile}>
            <div>
              <input
                defaultValue={q.label}
                onBlur={(e) => void umbenennen(q, e.target.value)}
                style={S.name}
                title="Anzeigename"
              />
              <p style={S.pfad}>{q.root}</p>
              <p style={S.zahlen}>
                {q.photoCount} Fotos
                {q.inBookCount > 0 && `, ${q.inBookCount} im Buch`}
                {!q.erreichbar && (
                  <span style={S.offline}>
                    {' '}
                    · nicht erreichbar – die Fotos bleiben, bis der Ordner wieder da ist
                  </span>
                )}
              </p>
            </div>
            <div style={S.knoepfe}>
              <button
                onClick={() => void einlesen(q)}
                disabled={!!busy || !q.erreichbar}
                style={S.button}
                title="Liest diesen Ordner erneut ein. Das Buch bleibt stehen."
              >
                Neu einlesen
              </button>
              <button onClick={() => void entfernen(q)} disabled={!!busy} style={S.buttonWeg}>
                Entfernen
              </button>
            </div>
          </div>
        ))}
        {sources?.length === 0 && <p style={S.hinweis}>Noch keine Bildquelle.</p>}
      </div>

      <div style={S.neu}>
        <h3 style={S.untertitel}>Ordner hinzufügen</h3>
        <div style={S.eingaben}>
          <input
            value={pfad}
            onChange={(e) => setPfad(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void hinzufuegen();
            }}
            placeholder="/Users/see/Bilder/Nachtrag"
            spellCheck={false}
            style={S.feld}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            style={S.feldKurz}
          />
          <button
            onClick={() => void hinzufuegen()}
            disabled={!!busy || !pfad.trim()}
            style={S.button}
          >
            Hinzufügen und einlesen
          </button>
        </div>
        <p style={S.hinweis}>
          Im Finder mit <kbd>⌥⌘C</kbd> den Pfad des Ordners kopieren und hier einfügen. Unterordner
          werden mitgelesen; ein Ordner, der in einer bestehenden Quelle liegt, wird abgelehnt.
        </p>
      </div>

      <div style={S.fuss}>
        <span style={S.zahlen}>{gesamt} Fotos insgesamt</span>
        <button onClick={() => void einlesen()} disabled={!!busy} style={S.button}>
          Alle Quellen neu einlesen
        </button>
      </div>
    </div>
  );
}

const S = {
  wrap: { padding: '1rem 1.25rem', maxWidth: '52rem' },
  kopf: { marginBottom: '1rem' },
  titel: { fontSize: '1.1rem', margin: '0 0 0.35rem' },
  untertitel: { fontSize: '0.95rem', margin: '0 0 0.5rem' },
  hinweis: { margin: '0.4rem 0 0', fontSize: '0.85rem', color: '#52525b', lineHeight: 1.5 },
  status: {
    margin: '0 0 0.75rem',
    fontSize: '0.85rem',
    color: '#166534',
    background: '#f0fdf4',
    padding: '0.35rem 0.6rem',
    borderRadius: 4,
  },
  fehler: {
    margin: '0 0 0.75rem',
    fontSize: '0.85rem',
    color: '#991b1b',
    background: '#fef2f2',
    padding: '0.35rem 0.6rem',
    borderRadius: 4,
  },
  liste: { display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' },
  zeile: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '0.75rem',
    alignItems: 'start',
    paddingBottom: '0.6rem',
    borderBottom: '1px solid #e4e4e7',
  },
  name: {
    font: 'inherit',
    fontSize: '1rem',
    border: '1px solid transparent',
    borderRadius: 4,
    padding: '0.15rem 0.3rem',
    marginLeft: '-0.3rem',
    background: 'transparent',
    width: '100%',
    maxWidth: '24rem',
  },
  pfad: {
    margin: '0.1rem 0 0',
    fontSize: '0.8rem',
    color: '#71717a',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    wordBreak: 'break-all' as const,
  },
  zahlen: { margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#52525b' },
  offline: { color: '#b45309' },
  knoepfe: { display: 'flex', gap: '0.4rem' },
  button: {
    font: 'inherit',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
  },
  buttonWeg: {
    font: 'inherit',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    border: '1px solid #fca5a5',
    borderRadius: 4,
    background: '#fff',
    color: '#991b1b',
    cursor: 'pointer',
  },
  neu: { marginTop: '1.5rem' },
  eingaben: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' as const },
  feld: {
    font: 'inherit',
    fontSize: '0.9rem',
    padding: '0.35rem 0.5rem',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    flex: '1 1 22rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  feldKurz: {
    font: 'inherit',
    fontSize: '0.9rem',
    padding: '0.35rem 0.5rem',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    width: '10rem',
  },
  fuss: {
    marginTop: '1.5rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid #e4e4e7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
  },
} satisfies Record<string, React.CSSProperties>;
