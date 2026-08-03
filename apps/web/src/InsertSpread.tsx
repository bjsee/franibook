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
import {
  buchseiteEinfuegen,
  doppelseiteEinfuegen,
  type EinfuegeVorlage as Vorlage,
  einfuegeVorlagenLaden,
  fehlertext,
  type Umpaarbericht,
} from './api.js';
import { B, T } from './theme.js';

interface Props {
  /** Stelle im Buch: 0 heißt ganz vorn, `spreadCount` ganz hinten. */
  at: number;
  spreadCount: number;
  onEingefuegt: (index: number, bericht?: Umpaarbericht) => void;
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
    einfuegeVorlagenLaden()
      .then((d) => {
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
      if (einzeln) {
        const daten = await buchseiteEinfuegen({
          atPage: at * 2 + (seite === 'right' ? 1 : 0),
          halfId: gewaehlt,
          ...titelText,
        });
        onEingefuegt(daten.index ?? at, daten.bericht);
      } else {
        const daten = await doppelseiteEinfuegen({ at, templateId: gewaehlt, ...titelText });
        onEingefuegt(daten.index ?? at);
      }
    } catch (e) {
      onFehler(`Seite nicht eingefügt: ${fehlertext(e)}`);
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
            background: 'var(--warm-300)',
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
    background: 'rgba(51, 46, 42, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 24,
  },
  karte: {
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: '0 16px 48px rgba(84,76,70,0.28)',
    padding: 24,
    maxWidth: '46rem',
    maxHeight: '85vh',
    overflowY: 'auto' as const,
  },
  titel: { margin: '0 0 6px', fontSize: 20 },
  hinweis: { margin: '0 0 16px', fontSize: 13, color: T.fg2, lineHeight: 1.55 },
  muted: { color: T.fg2, fontSize: 13 },
  gitter: {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${SKIZZE_BREITE + 20}px, 1fr))`,
    gap: 8,
  },
  kachel: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: 6,
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
    background: T.bg1,
    cursor: 'pointer',
    font: 'inherit',
  },
  kachelAn: { borderColor: T.cyan, background: T.cyanZart },
  kachelName: { fontSize: 11, color: T.fg3 },
  gruppe: { margin: '16px 0 6px', ...B.marke },
  seitenwahl: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    fontSize: 13,
    flexWrap: 'wrap' as const,
  },
  buttonAn: { borderColor: T.cyanRand, background: T.cyanZart, color: T.cyanTief, fontWeight: 600 },
  warnung: { ...B.warnung, margin: '10px 0 0', color: T.warnText },
  skizze: {
    position: 'relative' as const,
    display: 'block',
    background: T.bg3,
    border: `1px solid ${T.line}`,
  },
  falz: {
    position: 'absolute' as const,
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    background: T.bg1,
  },
  feld: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    fontSize: 13,
    color: T.fg2,
  },
  eingabe: { ...B.feld, flex: 1 },
  knoepfe: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  button: B.knopf,
  primaer: B.knopfPrimaer,
} satisfies Record<string, React.CSSProperties>;
