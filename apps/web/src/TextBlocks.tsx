/**
 * Eigene Textblöcke auf einer Doppelseite.
 *
 * Alles, was das Buch sonst beschriftet, gehört einer Vorlage oder einer
 * Fotogruppe. Ein Textblock gehört niemandem: Er steht, wo man ihn hinsetzt.
 * Gedacht für das, was kein Automatismus wissen kann – eine Zeile zu einem
 * Bild, ein Zitat, ein Datum, das erzählt.
 *
 * Die Schrift ist die Buchschrift, wählbar sind ihre beiden Schnitte. Eine
 * zweite Familie hieße eine zweite Datei, und die Parität von Vorschau und PDF
 * hängt daran, dass beide Adapter dieselbe laden.
 *
 * Verschoben und gedreht wird auf der Bühne, nicht hier: Diese Leiste hält den
 * Text und seine Maße, die Lage bestimmt die Hand.
 */
import { useEffect, useState } from 'react';

export interface TextBlockData {
  id: string;
  content: string;
  rect: { x: number; y: number; w: number; h: number };
  weight: 'regular' | 'semibold';
  fontSizePt: number;
  align: 'left' | 'center' | 'right';
  color?: string;
  rotateDeg?: number;
}

interface Props {
  index: number;
  blocks: readonly TextBlockData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Nach jeder Änderung: die neu gerenderte Doppelseite. */
  onSpread: (spread: unknown) => void;
  onFehler: (text: string) => void;
}

export function TextBlocks({ index, blocks, selectedId, onSelect, onSpread, onFehler }: Props) {
  const gewaehlt = blocks.find((b) => b.id === selectedId);
  /**
   * Der Text, solange er getippt wird.
   *
   * Jeder Tastendruck als Anfrage wäre ein Schreibvorgang auf das ganze
   * Projekt-JSON. Gespeichert wird beim Verlassen des Feldes – wie bei den
   * Jahresereignissen.
   */
  const [entwurf, setEntwurf] = useState<string | null>(null);

  useEffect(() => setEntwurf(null), [selectedId]);

  async function ruf(pfad: string, init: RequestInit) {
    try {
      const res = await fetch(pfad, {
        ...init,
        ...(init.body ? { headers: { 'content-type': 'application/json' } } : {}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onFehler(data.error ?? 'Der Textblock ließ sich nicht ändern');
        return undefined;
      }
      if (data.spread) onSpread(data.spread);
      return data;
    } catch (e) {
      onFehler(`Der Textblock ließ sich nicht ändern: ${String(e)}`);
      return undefined;
    }
  }

  async function anlegen() {
    const data = await ruf(`/api/spreads/${index}/texts`, { method: 'POST', body: '{}' });
    if (data?.block?.id) onSelect(data.block.id as string);
  }

  async function aendern(patch: Partial<Omit<TextBlockData, 'id'>>) {
    if (!gewaehlt) return;
    await ruf(`/api/spreads/${index}/texts/${gewaehlt.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async function entfernen() {
    if (!gewaehlt) return;
    await ruf(`/api/spreads/${index}/texts/${gewaehlt.id}`, { method: 'DELETE' });
    onSelect(null);
  }

  return (
    <section style={S.bereich}>
      <div style={S.kopf}>
        <button onClick={() => void anlegen()} style={S.button}>
          Text hinzufügen
        </button>

        {blocks.length > 0 && (
          <span style={S.liste}>
            {blocks.map((b) => (
              <button
                key={b.id}
                onClick={() => onSelect(b.id === selectedId ? null : b.id)}
                title={b.content || '(leer)'}
                style={b.id === selectedId ? S.chipAktiv : S.chip}
              >
                {b.content.split('\n')[0]?.slice(0, 18) || '(leer)'}
              </button>
            ))}
          </span>
        )}

        {blocks.length === 0 && (
          <span style={S.hint}>
            Für das, was kein Automatismus weiß — eine Zeile zum Bild, ein Zitat, ein Datum.
          </span>
        )}
      </div>

      {gewaehlt && (
        <div style={S.zeile}>
          <textarea
            value={entwurf ?? gewaehlt.content}
            onChange={(e) => setEntwurf(e.target.value)}
            onBlur={() => {
              if (entwurf !== null && entwurf !== gewaehlt.content)
                void aendern({ content: entwurf });
              setEntwurf(null);
            }}
            rows={2}
            placeholder="Text — Zeilenumbrüche bleiben erhalten"
            style={S.feld}
          />

          <label style={S.check}>
            Größe
            <input
              type="number"
              min={5}
              max={200}
              step={0.5}
              value={gewaehlt.fontSizePt}
              onChange={(e) => void aendern({ fontSizePt: Number(e.target.value) })}
              style={S.zahl}
            />
            pt
          </label>

          <label style={S.check}>
            Schnitt
            <select
              value={gewaehlt.weight}
              onChange={(e) => void aendern({ weight: e.target.value as 'regular' | 'semibold' })}
            >
              <option value="regular">normal</option>
              <option value="semibold">halbfett</option>
            </select>
          </label>

          <label style={S.check}>
            Satz
            <select
              value={gewaehlt.align}
              onChange={(e) =>
                void aendern({ align: e.target.value as 'left' | 'center' | 'right' })
              }
            >
              <option value="left">links</option>
              <option value="center">zentriert</option>
              <option value="right">rechts</option>
            </select>
          </label>

          {/*
            Der Winkel als Regler und als Zahl: Der Regler ist zum Suchen, die
            Zahl zum Treffen — 90° stellt man nicht mit der Maus ein.
          */}
          <label style={S.check} title="Drehung im Uhrzeigersinn">
            Drehung
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={gewaehlt.rotateDeg ?? 0}
              onChange={(e) => void aendern({ rotateDeg: Number(e.target.value) })}
              style={S.regler}
            />
            <input
              type="number"
              min={0}
              max={359}
              step={1}
              value={gewaehlt.rotateDeg ?? 0}
              onChange={(e) => void aendern({ rotateDeg: Number(e.target.value) })}
              style={S.zahl}
            />
            °
          </label>

          <button onClick={() => void entfernen()} style={S.weg}>
            Entfernen
          </button>
        </div>
      )}
    </section>
  );
}

const S = {
  bereich: { marginTop: '0.75rem' },
  kopf: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' as const },
  liste: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' as const },
  hint: { fontSize: '0.72rem', color: '#9ca3af' },
  button: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
  chip: {
    padding: '0.15rem 0.5rem',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.74rem',
    maxWidth: '11rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chipAktiv: {
    padding: '0.15rem 0.5rem',
    border: '1px solid #1d4ed8',
    borderRadius: '4px',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '0.74rem',
    fontWeight: 600,
    maxWidth: '11rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    flexWrap: 'wrap' as const,
    marginTop: '0.5rem',
  },
  feld: {
    font: 'inherit',
    fontSize: '0.8rem',
    padding: '0.3rem 0.4rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    minWidth: '18rem',
    resize: 'vertical' as const,
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.78rem',
    color: '#374151',
  },
  zahl: {
    width: '4.2rem',
    padding: '0.15rem 0.3rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
  },
  regler: { width: '90px' },
  weg: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #fca5a5',
    borderRadius: '5px',
    background: '#fff',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
} satisfies Record<string, React.CSSProperties>;
