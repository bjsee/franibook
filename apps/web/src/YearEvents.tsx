/**
 * Jahresereignisse pflegen.
 *
 * Eine Zeile ist ein Ereignis, höchstens fünf je Jahr – so viele nimmt der
 * Textplatz der Auftaktseite auf. Gespeichert wird beim Verlassen des Feldes und
 * wirkt sofort auf der Auftaktseite; das Buch wird dabei nicht neu erzeugt.
 *
 * Bewusst eine schlichte Liste über alle Jahrgänge statt einer Eingabe je
 * Auftaktseite: Wer die Jahre eines Buches füllt, tut das in einem Zug und will
 * sehen, was noch fehlt. Deshalb steht die Zahl der gefüllten Jahrgänge oben.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { B, T } from './theme.js';

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
    <div style={S.flaeche}>
      <div style={S.spalte}>
        <h2 style={S.titel}>Was geschah in diesem Jahr?</h2>
        <p style={S.lead}>
          Eine Zeile je Ereignis, bis zu {MAX_ZEILEN}, je höchstens {ZEICHEN_WARNUNG} Zeichen. Sie
          stehen auf der Auftaktseite des Jahres, rechts neben der Jahreszahl. {gefuellt} von{' '}
          {chapters.length} Jahrgängen sind gefüllt.
        </p>

        {status && <p style={S.status}>{status}</p>}
        {!geladen && <p style={B.leise}>lädt …</p>}

        {chapters.map((c) => {
          const zeilen = events[String(c.year)] ?? [];
          const lang = zuLang[String(c.year)] ?? [];
          return (
            <div key={c.year} style={S.zeile}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => onOpen(c.firstSpreadIndex)} style={S.jahr} title="Zur Seite">
                  {c.year}
                </button>
                <span style={B.leiser}>{c.photoCount} Fotos</span>
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
                {lang.length > 0 && (
                  <p style={{ ...B.leiser, marginTop: 4, color: T.warn }}>
                    zu lang für den Platz: {lang.join(', ')}
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
  zeile: {
    display: 'grid',
    gridTemplateColumns: '7rem 1fr',
    gap: 16,
    alignItems: 'start',
    padding: '14px 0',
    borderTop: `1px solid ${T.line}`,
  },
  jahr: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: T.display,
    fontSize: 26,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums' as const,
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: T.fg1,
  },
  feld: {
    width: '100%',
    boxSizing: 'border-box' as const,
    font: 'inherit',
    fontSize: 14,
    lineHeight: 1.5,
    padding: '10px 12px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    resize: 'vertical' as const,
    color: T.fg1,
    background: T.bg1,
  },
} satisfies Record<string, React.CSSProperties>;
