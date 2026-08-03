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
  /** Ob diese Form eine ganze Doppelseite belegt oder eine einzelne Buchseite. */
  scope: 'spread' | 'page';
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  /** Ob ein Titel gesetzt werden kann – nur dann lohnt das Textfeld. */
  hasTitle: boolean;
}

interface Props {
  /** Stelle im Buch: 0 heißt ganz vorn, `spreadCount` ganz hinten. */
  at: number;
  spreadCount: number;
  onEingefuegt: (
    index: number,
    bericht?: { neuGepaart: number; leerseiten: number; leereBlaetter: number },
  ) => void;
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
  /**
   * Welche Buchseite eine einzelne Seite belegen soll.
   *
   * Nur für `scope: 'page'` von Belang, und dort entscheidend: Links oder rechts
   * ist keine Kosmetik, sondern bestimmt, wo die Parität kippt und welches Blatt
   * dahinter aus welchen zwei Seiten besteht.
   */
  const [seite, setSeite] = useState<'left' | 'right'>('left');

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
    if (!gewaehlt || !vorlage) return;
    setBusy(true);

    // Zwei Endpunkte, weil es zwei verschiedene Eingriffe sind: Eine
    // Doppelseite kommt zwischen zwei Blätter, eine einzelne Seite zwischen zwei
    // Buchseiten – und verschiebt dabei jede Blattgrenze dahinter.
    const einzeln = vorlage.scope === 'page';
    const titelText = vorlage.hasTitle && titel.trim() ? { title: titel.trim() } : {};

    try {
      const res = await fetch(einzeln ? '/api/spreads/page' : '/api/spreads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          einzeln
            ? { atPage: at * 2 + (seite === 'right' ? 1 : 0), halfId: gewaehlt, ...titelText }
            : { at, templateId: gewaehlt, ...titelText },
        ),
      });
      const daten = (await res.json()) as {
        ok?: boolean;
        index?: number;
        error?: string;
        bericht?: { neuGepaart: number; leerseiten: number; leereBlaetter: number };
      };
      if (!res.ok || !daten.ok) {
        onFehler(daten.error ?? `Seite nicht eingefügt (HTTP ${res.status})`);
        return;
      }
      onEingefuegt(daten.index ?? at, daten.bericht);
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
          Eigene Seite {at >= spreadCount ? 'am Ende' : `bei Doppelseite ${at + 1}`}
        </h2>
        <p style={S.hinweis}>
          Was du einfügst, wird festgehalten: Ein Neuanordnen des Buches baut es nicht neu. Bilder
          ziehst du selbst aus dem Fotopool hinein.
        </p>

        {vorlagen === null ? (
          <p style={S.muted}>Lade Vorlagen …</p>
        ) : (
          (['page', 'spread'] as const).map((scope) => {
            const gruppe = vorlagen.filter((v) => v.scope === scope);
            if (gruppe.length === 0) return null;
            return (
              <div key={scope}>
                <h3 style={S.gruppe}>
                  {scope === 'page' ? 'Einzelne Buchseite' : 'Ganze Doppelseite'}
                </h3>
                <div style={S.gitter}>
                  {gruppe.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setGewaehlt(v.id)}
                      style={{ ...S.kachel, ...(v.id === gewaehlt ? S.kachelAn : {}) }}
                      title={v.name}
                    >
                      <Skizze slots={v.slots} nurLinks={v.scope === 'page'} />
                      <span style={S.kachelName}>{kurzname(v)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {/*
          Links oder rechts ist bei einer einzelnen Seite keine Kosmetik: Dort
          kippt die Parität, und jedes Blatt dahinter besteht danach aus anderen
          zwei Buchseiten. Deshalb steht die Folge auch dabei.
        */}
        {vorlage?.scope === 'page' && (
          <>
            <div style={S.seitenwahl}>
              <span style={S.muted}>Als</span>
              {(
                [
                  ['left', 'linke Seite'],
                  ['right', 'rechte Seite'],
                ] as const
              ).map(([wert, text]) => (
                <button
                  key={wert}
                  onClick={() => setSeite(wert)}
                  style={{ ...S.button, ...(seite === wert ? S.buttonAn : {}) }}
                >
                  {text}
                </button>
              ))}
              <span style={S.muted}>von Doppelseite {at + 1}</span>
            </div>
            <p style={S.warnung}>
              Eine einzelne Seite verschiebt jede Blattgrenze dahinter: Was rechts stand, steht
              danach links. Die Fotoverteilung bleibt, kein Bild geht verloren – bis zum nächsten
              Auftakt sehen die Doppelseiten aber anders aus.
            </p>
          </>
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

/**
 * Die Slotgeometrie als Skizze – dieselbe Rechnung wie im Layout.
 *
 * `nurLinks` zeigt eine einzelne Buchseite: Halbseiten sind in Linksform
 * normiert, also auf die ganze Doppelseite bezogen, und werden auf die halbe
 * Breite beschnitten. Sonst stünde die Skizze einer Einzelseite in einem Kasten,
 * dessen rechte Hälfte leer bleibt und wie Fläche aussieht, die es nicht gibt.
 */
function Skizze({ slots, nurLinks = false }: { slots: Vorlage['slots']; nurLinks?: boolean }) {
  const breite = nurLinks ? SKIZZE_BREITE / 2 : SKIZZE_BREITE;
  return (
    <span style={{ ...S.skizze, width: breite, height: SKIZZE_HOEHE }}>
      {slots.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            // Bei einer Halbseite ist der Bezug die Doppelseite, der Kasten aber
            // eine Seite – die Anteile verdoppeln sich.
            left: `${s.x * (nurLinks ? 200 : 100)}%`,
            top: `${s.y * 100}%`,
            width: `${s.w * (nurLinks ? 200 : 100)}%`,
            height: `${s.h * 100}%`,
            background: '#cbd5e1',
          }}
        />
      ))}
      {/* Der Falz: Ohne ihn ist eine Doppelseite nicht als solche zu erkennen. */}
      {!nurLinks && <span style={S.falz} />}
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
  gruppe: {
    margin: '0.9rem 0 0.4rem',
    fontSize: '0.7rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: '#6b7280',
  },
  seitenwahl: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginTop: '0.9rem',
    fontSize: '0.8125rem',
  },
  buttonAn: { borderColor: '#1d4ed8', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 },
  warnung: {
    margin: '0.6rem 0 0',
    fontSize: '0.75rem',
    color: '#78350f',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    padding: '0.4rem 0.6rem',
    lineHeight: 1.5,
  },
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
