/**
 * Jahresereignisse pflegen.
 *
 * Eine Zeile ist ein Ereignis, höchstens fünf je Jahr – so viele nimmt der
 * Textplatz der Auftaktseite auf. Gespeichert wird beim Verlassen des Feldes und
 * wirkt sofort auf der Auftaktseite; das Buch wird dabei nicht neu erzeugt.
 *
 * Bewusst eine schlichte Liste über alle Jahrgänge statt einer Eingabe je
 * Auftaktseite: Wer die Jahre eines Buches füllt, tut das in einem Zug und will
 * sehen, was noch fehlt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Chapter {
  year: number;
  photoCount: number;
  firstSpreadIndex: number;
}

interface YearEventsProps {
  chapters: readonly Chapter[];
  /** Springt zur Auftaktseite eines Jahres. */
  onOpen: (spreadIndex: number) => void;
}

/** So viele Zeilen nimmt der Textplatz auf – siehe `lines` in library.json. */
const MAX_ZEILEN = 5;

/**
 * Ab so vielen Zeichen wird eine Zeile im Druck zu breit.
 *
 * Der Textplatz ist 225 mm breit, die Schrift 12,7 pt; das reicht für etwa
 * hundert Zeichen. Sechzig ist die Warnschwelle mit Sicherheitsabstand — ein
 * Umbruch findet nicht statt, zu langer Text würde am Rand abgeschnitten.
 */
const ZEICHEN_WARNUNG = 60;

export function YearEvents({ chapters, onOpen }: YearEventsProps) {
  const [events, setEvents] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [zuLang, setZuLang] = useState<Record<string, string[]>>({});
  // Was zuletzt gespeichert wurde, je Jahr – damit ein Verlassen ohne Änderung
  // keine Anfrage auslöst.
  const gespeichert = useRef<Record<string, string>>({});

  const laden = useCallback(() => {
    fetch('/api/chapters/events')
      .then((r) => r.json())
      .then((d: { yearEvents: Record<string, string[]> }) => {
        setEvents(d.yearEvents ?? {});
        gespeichert.current = Object.fromEntries(
          Object.entries(d.yearEvents ?? {}).map(([jahr, zeilen]) => [jahr, zeilen.join('\n')]),
        );
        setGeladen(true);
      })
      .catch((e: unknown) => setStatus(String(e)));
  }, []);

  useEffect(laden, [laden]);

  async function speichern(year: number, text: string) {
    const key = String(year);
    if ((gespeichert.current[key] ?? '') === text) return;

    const zeilen = text
      .split('\n')
      .map((z) => z.trim())
      .filter((z) => z.length > 0)
      .slice(0, MAX_ZEILEN);

    const res = await fetch(`/api/chapters/${year}/events`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: zeilen }),
    });
    if (!res.ok) {
      setStatus(`${year} konnte nicht gespeichert werden`);
      return;
    }
    const d = (await res.json()) as { angewendet: boolean };
    gespeichert.current[key] = zeilen.join('\n');
    setStatus(
      d.angewendet
        ? `${year} gespeichert`
        : `${year} gespeichert – erscheint beim nächsten Erzeugen, weil das Jahr keine Auftaktseite hat`,
    );
  }

  /** Zeilen, die im Druck über den Rand liefen – je Jahr die Anfänge. */
  function merkeLang(year: number, text: string) {
    const lang = text
      .split('\n')
      .map((z) => z.trim())
      .filter((z) => z.length > ZEICHEN_WARNUNG)
      .map((z) => `„${z.slice(0, 24)}…"`);
    setZuLang((v) => ({ ...v, [String(year)]: lang }));
  }

  const gefuellt = chapters.filter((c) => (events[String(c.year)] ?? []).length > 0).length;

  return (
    <div style={S.wrap}>
      <div style={S.kopf}>
        <h2 style={S.titel}>Was geschah in diesem Jahr?</h2>
        <p style={S.hinweis}>
          Eine Zeile je Ereignis, bis zu {MAX_ZEILEN}, je höchstens {ZEICHEN_WARNUNG} Zeichen. Sie
          stehen auf der Auftaktseite des Jahres, rechts neben der Jahreszahl. {gefuellt} von{' '}
          {chapters.length} Jahrgängen sind gefüllt.
        </p>
      </div>

      {status && <p style={S.status}>{status}</p>}
      {!geladen && <p style={S.hinweis}>lädt …</p>}

      <div style={S.liste}>
        {chapters.map((c) => {
          const zeilen = events[String(c.year)] ?? [];
          return (
            <div key={c.year} style={S.zeile}>
              <div style={S.jahrSpalte}>
                <button onClick={() => onOpen(c.firstSpreadIndex)} style={S.jahr} title="Zur Seite">
                  {c.year}
                </button>
                <span style={S.anzahl}>{c.photoCount} Fotos</span>
              </div>
              <div>
                <textarea
                  defaultValue={zeilen.join('\n')}
                  onChange={(e) => merkeLang(c.year, e.target.value)}
                  onBlur={(e) => void speichern(c.year, e.target.value)}
                  rows={Math.max(3, Math.min(MAX_ZEILEN, zeilen.length + 1))}
                  placeholder={`Wahl von Emmanuel Macron\nG20-Gipfel in Hamburg`}
                  spellCheck
                  style={S.feld}
                />
                {(zuLang[String(c.year)] ?? []).length > 0 && (
                  <p style={S.warnung}>
                    zu lang für den Platz: {(zuLang[String(c.year)] ?? []).join(', ')}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  wrap: { padding: '1rem 1.25rem', maxWidth: '52rem' },
  kopf: { marginBottom: '1rem' },
  titel: { fontSize: '1.1rem', margin: '0 0 0.35rem' },
  hinweis: { margin: 0, fontSize: '0.85rem', color: '#52525b' },
  status: {
    margin: '0 0 0.75rem',
    fontSize: '0.85rem',
    color: '#166534',
    background: '#f0fdf4',
    padding: '0.35rem 0.6rem',
    borderRadius: 4,
  },
  liste: { display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' },
  zeile: {
    display: 'grid',
    gridTemplateColumns: '6.5rem 1fr',
    gap: '0.75rem',
    alignItems: 'start',
    paddingBottom: '0.5rem',
    borderBottom: '1px solid #e4e4e7',
  },
  jahrSpalte: { display: 'flex', flexDirection: 'column' as const, gap: '0.15rem' },
  jahr: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '1.35rem',
    fontVariantNumeric: 'tabular-nums' as const,
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: '#18181b',
  },
  anzahl: { fontSize: '0.75rem', color: '#71717a' },
  warnung: { margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#b45309' },
  feld: {
    width: '100%',
    font: 'inherit',
    fontSize: '0.9rem',
    lineHeight: 1.45,
    padding: '0.4rem 0.5rem',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    resize: 'vertical' as const,
  },
} satisfies Record<string, React.CSSProperties>;
