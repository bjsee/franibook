/**
 * Eine Doppelseite selbst einfügen.
 *
 * Zwei Ausgangspunkte, und der Unterschied ist eine Frage der Absicht: Die leere
 * Seite ist ein weißes Blatt – Textblöcke setzen, Bilder aus dem Pool
 * hinziehen, alles selbst. Ein Auftakt ist die vorhandene Gestaltung für den
 * Fall, dass die Automatik ein Ereignis nicht als Gruppe erkannt hat: Titel
 * groß, ein Bild daneben.
 *
 * Gezeigt werden Skizzen wie im `TemplatePicker` und aus demselben Grund:
 * `spread.group.opener-portrait` sagt niemandem, wie die Seite aussieht. Die
 * Skizze kommt aus derselben Slotgeometrie wie das Layout und kann deshalb nicht
 * von ihr abweichen.
 */
import { useEffect, useState } from 'react';

interface Vorlage {
  id: string;
  name: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  /** Ob die Vorlage einen Titelplatz hat – nur dann lohnt das Textfeld. */
  hasTitle: boolean;
}

interface Props {
  /** Stelle im Buch: 0 heißt ganz vorn, `spreadCount` ganz hinten. */
  at: number;
  spreadCount: number;
  onEingefuegt: (index: number) => void;
  onAbbrechen: () => void;
  onFehler: (text: string) => void;
}

/** Seitenverhältnis der Skizze: eine Doppelseite ist zwei Quadrate breit. */
const SKIZZE_BREITE = 132;
const SKIZZE_HOEHE = 66;

export function InsertSpread({ at, spreadCount, onEingefuegt, onAbbrechen, onFehler }: Props) {
  const [vorlagen, setVorlagen] = useState<Vorlage[] | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [titel, setTitel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/templates/insert')
      .then((r) => r.json())
      .then((d: { templates: Vorlage[] }) => {
        setVorlagen(d.templates);
        setGewaehlt(d.templates[0]?.id ?? null);
      })
      .catch(() => setVorlagen([]));
  }, []);

  // Escape schließt: Derselbe Griff wie überall sonst in der Oberfläche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAbbrechen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAbbrechen]);

  const vorlage = vorlagen?.find((v) => v.id === gewaehlt);

  async function einfuegen() {
    if (!gewaehlt) return;
    setBusy(true);
    try {
      const res = await fetch('/api/spreads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          at,
          templateId: gewaehlt,
          ...(vorlage?.hasTitle && titel.trim() ? { title: titel.trim() } : {}),
        }),
      });
      const daten = (await res.json()) as { ok?: boolean; index?: number; error?: string };
      if (!res.ok || !daten.ok) {
        onFehler(daten.error ?? `Seite nicht eingefügt (HTTP ${res.status})`);
        return;
      }
      onEingefuegt(daten.index ?? at);
    } catch (e) {
      onFehler(`Seite nicht eingefügt: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.hintergrund} onClick={onAbbrechen}>
      <div style={S.karte} onClick={(e) => e.stopPropagation()}>
        <h2 style={S.titel}>
          Eigene Doppelseite {at >= spreadCount ? 'am Ende' : `vor Seite ${at + 1}`}
        </h2>
        <p style={S.hinweis}>
          Die Seite wird festgehalten: Ein Neuanordnen des Buches baut sie nicht neu. Bilder ziehst
          du selbst aus dem Fotopool hinein.
        </p>

        {vorlagen === null ? (
          <p style={S.muted}>Lade Vorlagen …</p>
        ) : (
          <div style={S.gitter}>
            {vorlagen.map((v) => (
              <button
                key={v.id}
                onClick={() => setGewaehlt(v.id)}
                style={{ ...S.kachel, ...(v.id === gewaehlt ? S.kachelAn : {}) }}
                title={v.name}
              >
                <Skizze slots={v.slots} />
                <span style={S.kachelName}>{kurzname(v)}</span>
              </button>
            ))}
          </div>
        )}

        {/*
          Das Titelfeld nur dort, wo die Vorlage einen Platz dafür hat. Auf der
          leeren Seite entsteht der Text als Textblock – frei gesetzt, in
          beliebiger Größe, und das ist eine andere Handlung.
        */}
        {vorlage?.hasTitle && (
          <label style={S.feld}>
            Titel
            <input
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder="z. B. Einschulung"
              style={S.eingabe}
              autoFocus
            />
          </label>
        )}

        <div style={S.knoepfe}>
          <button onClick={onAbbrechen} style={S.button}>
            Abbrechen
          </button>
          <button onClick={() => void einfuegen()} disabled={busy || !gewaehlt} style={S.primaer}>
            {busy ? 'Füge ein …' : 'Einfügen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Der unterscheidende Teil des Vorlagennamens.
 *
 * Acht Auftaktvorlagen heißen alle „Gruppenauftakt, …" – die Gattung stünde
 * achtmal unter acht Skizzen und sagte nichts. Was sie trennt, steht hinter dem
 * Komma: Querformat, Hochformat, vollflächig, jeweils auch gespiegelt. Der ganze
 * Name bleibt als Tooltip an der Kachel.
 */
function kurzname(v: Vorlage): string {
  const komma = v.name.indexOf(',');
  return komma > 0 ? v.name.slice(komma + 1).trim() : v.name;
}

/** Die Slotgeometrie als Skizze – dieselbe Rechnung wie im Layout. */
function Skizze({ slots }: { slots: Vorlage['slots'] }) {
  return (
    <span style={{ ...S.skizze, width: SKIZZE_BREITE, height: SKIZZE_HOEHE }}>
      {slots.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x * 100}%`,
            top: `${s.y * 100}%`,
            width: `${s.w * 100}%`,
            height: `${s.h * 100}%`,
            background: '#cbd5e1',
          }}
        />
      ))}
      {/* Der Falz: Ohne ihn ist eine Doppelseite nicht als solche zu erkennen. */}
      <span style={S.falz} />
    </span>
  );
}

const S = {
  hintergrund: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(17, 24, 39, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  karte: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: '1.25rem',
    maxWidth: '46rem',
    maxHeight: '85vh',
    overflowY: 'auto' as const,
  },
  titel: { margin: '0 0 0.35rem', fontSize: '1rem', fontWeight: 600 },
  hinweis: { margin: '0 0 0.9rem', fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.5 },
  muted: { color: '#6b7280', fontSize: '0.875rem' },
  gitter: {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${SKIZZE_BREITE + 20}px, 1fr))`,
    gap: '0.6rem',
  },
  kachel: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.4rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
    font: 'inherit',
  },
  kachelAn: { borderColor: '#1d4ed8', background: '#eff6ff' },
  kachelName: { fontSize: '0.7rem', color: '#6b7280' },
  skizze: {
    position: 'relative' as const,
    display: 'block',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },
  falz: {
    position: 'absolute' as const,
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    background: '#e2e8f0',
  },
  feld: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.9rem',
    fontSize: '0.8125rem',
    color: '#374151',
  },
  eingabe: {
    flex: 1,
    padding: '0.3rem 0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    font: 'inherit',
  },
  knoepfe: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '1.1rem',
  },
  button: {
    padding: '0.35rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
    font: 'inherit',
  },
  primaer: {
    padding: '0.35rem 0.9rem',
    border: '1px solid #1d4ed8',
    borderRadius: '6px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    font: 'inherit',
  },
} satisfies Record<string, React.CSSProperties>;
