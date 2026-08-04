/**
 * Die Notanker: ganze Projektstände, abgelegt vor den großen Griffen.
 *
 * Cmd+Z ist die zweite Tür, das hier ist der Notausgang. Der Unterschied steht
 * auch in der Bedienung: zugeklappt, geladen erst beim Aufklappen, mit einer
 * Rückfrage, die die Zahlen nennt. Ein Anker verwirft alles seit ihm — das
 * gehört nicht neben einen Umschalter für den Zeitstrahl.
 *
 * Aufgeklappt statt dauernd sichtbar, weil die Liste nichts über das Buch sagt.
 * Und beim Aufklappen geladen statt beim Einhängen: Zwischen zwei Blicken darauf
 * liegen Stunden, und in der Zwischenzeit sind Anker gefallen.
 */
import { useState } from 'react';
import { ankerListe, ankerZurueckholen, fehlertext, type Notanker as Anker } from './api.js';
import { B, T } from './theme.js';

interface Props {
  /** Nach dem Zurückholen: Projektinfo und Vorschau neu laden. */
  onZurueckgeholt: (satz: string) => void;
  busy: boolean;
}

/** `2026-08-04T14:31:02` → `04.08. 14:31`. */
function kurz(zeit: string): string {
  const [tag, uhr] = zeit.split('T');
  const teile = tag?.split('-') ?? [];
  if (teile.length !== 3 || !uhr) return zeit;
  return `${teile[2]}.${teile[1]}. ${uhr.slice(0, 5)}`;
}

export function Notanker({ onZurueckgeholt, busy }: Props) {
  const [anker, setAnker] = useState<Anker[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  function laden() {
    ankerListe()
      .then((d) => setAnker(d.anker))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }

  async function zurueckholen(a: Anker) {
    if (
      !window.confirm(
        `Stand von ${kurz(a.zeit)} zurückholen?\n\n` +
          `Er lag vor „${a.aktion}". Alles, was seitdem am Buch geschehen ist, ` +
          `wird verworfen.\n\nRückgängig machen lässt sich auch das: ` +
          `Der jetzige Stand wird vorher als Notanker abgelegt und steht im Verlauf.`,
      )
    ) {
      return;
    }

    setLaeuft(a.name);
    try {
      const d = await ankerZurueckholen(a.name);
      onZurueckgeholt(
        `Stand von ${kurz(a.zeit)} zurückgeholt — ${d.photoCount} Fotos, ${d.spreadCount} Doppelseiten`,
      );
      laden();
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <details
      style={S.block}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) laden();
      }}
    >
      <summary style={S.kopf}>Notanker</summary>

      <p style={{ ...B.leiser, marginTop: 8 }}>
        Vor Neuanordnen, Layout einspielen, Import, Quellenwechsel und Gruppenvorschlägen legt der
        Server den ganzen Stand ab. Die letzten zehn bleiben — anders als der Verlauf überleben sie
        einen Neustart.
      </p>

      {fehler && <p style={{ ...B.fehlerfeld, marginTop: 8 }}>{fehler}</p>}

      {anker !== null && anker.length === 0 && (
        <p style={{ ...B.leiser, marginTop: 8 }}>Noch keiner gefallen.</p>
      )}

      {anker?.map((a) => (
        <div key={a.name} style={S.zeile}>
          <span style={S.zeit}>{kurz(a.zeit)}</span>
          <span style={S.aktion}>vor „{a.aktion}"</span>
          <button
            onClick={() => void zurueckholen(a)}
            disabled={busy || laeuft !== null}
            style={S.knopf}
            title="Setzt das ganze Projekt auf diesen Stand zurück"
          >
            {laeuft === a.name ? '…' : 'zurückholen'}
          </button>
        </div>
      ))}
    </details>
  );
}

const S = {
  block: { display: 'block' },
  kopf: { fontSize: 13, color: T.fg2, cursor: 'pointer' },
  zeile: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 8,
    fontSize: 12,
  },
  zeit: {
    fontFamily: T.mono,
    color: T.fg2,
    fontVariantNumeric: 'tabular-nums' as const,
    flexShrink: 0,
  },
  aktion: { color: T.fg3, flex: 1, minWidth: 0 },
  knopf: {
    font: 'inherit',
    fontSize: 12,
    padding: '3px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    flexShrink: 0,
  },
} satisfies Record<string, React.CSSProperties>;
