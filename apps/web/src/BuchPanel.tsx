/**
 * Die Einstellungen, die das ganze Buch betreffen.
 *
 * Sie stehen in der Seitenspalte der Übersicht, weil man dort das Ergebnis sieht:
 * Ob ein Seitenbudget aufgeht oder Jahresauftakte den Rhythmus tragen, erkennt man
 * am ganzen Buch und nicht an einer Doppelseite.
 *
 * Die Spalte ist in zwei Teile geteilt, und die Trennung ist die wichtigste
 * Auskunft dieser Ansicht: **oben, was das Buch neu baut** und dabei jede
 * Handarbeit verwirft, **unten, was nur die Darstellung ändert** und nichts
 * kostet. Vorher standen beide Sorten als Kästchen in einer Reihe, und der
 * Unterschied zwischen „Zeitstrahl aus" (folgenlos) und „Jahresauftakte aus"
 * (vierzehn Ausschnitte weg) war nirgends zu sehen.
 */
import { MAX_TILT_DEG } from '@franibook/core';
import { B, T } from './theme.js';

export interface BuchEinstellungen {
  targetPages: number;
  chapterOpeners: boolean;
  groupOpeners: boolean | 'auto';
  timeline: boolean;
  timelineStyle: 'foot' | 'side';
  chapterColors: boolean;
  tilt: number;
  seed: number;
}

export interface Handarbeit {
  crops: number;
  neigungen: number;
  hintergruende: number;
  zeitstrahl: number;
  positionen: number;
  texte: number;
  festgehalten: number;
}

interface Props {
  settings: BuchEinstellungen;
  handwork: Handarbeit;
  busy: boolean;
  /** Baut das Buch neu – verwirft Handarbeit. */
  onNeuAnordnen: (patch: Record<string, unknown>) => void;
  /** Ändert nur die Darstellung. */
  onDarstellung: (patch: {
    timeline?: boolean;
    timelineStyle?: 'foot' | 'side';
    tilt?: number;
  }) => void;
  onNeuEinlesen: () => void;
}

export function BuchPanel({
  settings,
  handwork,
  busy,
  onNeuAnordnen,
  onDarstellung,
  onNeuEinlesen,
}: Props) {
  /** Was ein Neuaufbau kosten würde, in Stücken. */
  const verlust = [
    handwork.crops > 0 ? `${handwork.crops} Ausschnitte` : null,
    handwork.neigungen > 0 ? `${handwork.neigungen} von Hand gesetzte Neigungen` : null,
    handwork.hintergruende > 0 ? `${handwork.hintergruende} Hintergründe` : null,
    handwork.zeitstrahl > 0 ? `${handwork.zeitstrahl} Zeitstrahl-Ausnahmen` : null,
    handwork.positionen > 0 ? `${handwork.positionen} frei gesetzte Bilder` : null,
    handwork.texte > 0 ? `${handwork.texte} Textblöcke` : null,
  ].filter((s): s is string => s !== null);

  function neuAnordnen() {
    // Was bleibt, gehört genauso in die Warnung wie was geht: Sonst klingt sie,
    // als würde auch die selbst gebaute Seite verworfen.
    const bleibt =
      handwork.festgehalten > 0
        ? `\n\n${handwork.festgehalten} festgehaltene Doppelseite(n) bleiben unangetastet.`
        : '';
    if (
      verlust.length > 0 &&
      !window.confirm(
        `Das Buch wird komplett neu gebaut. Verworfen werden: ${verlust.join(', ')}.\n\n` +
          'Fotos, Datumskorrekturen, Gruppen und Jahresereignisse bleiben erhalten.' +
          bleibt,
      )
    ) {
      return;
    }
    onNeuAnordnen({ seed: settings.seed + 1 });
  }

  return (
    <aside style={S.spalte}>
      <div style={{ ...B.abschnitt, gap: 4 }}>
        <strong style={B.titel}>Das ganze Buch</strong>
        <p style={B.leiser}>
          Was hier oben steht, baut das Buch neu und verwirft dabei Handarbeit an den Doppelseiten.
        </p>
      </div>

      <div style={B.abschnitt}>
        <label style={{ ...B.haken, justifyContent: 'space-between' }}>
          Seiten
          <input
            type="number"
            min={24}
            max={400}
            step={2}
            defaultValue={settings.targetPages}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== settings.targetPages) onNeuAnordnen({ targetPages: v });
            }}
            style={S.zahl}
          />
        </label>
        <label style={B.haken}>
          <input
            type="checkbox"
            checked={settings.chapterOpeners}
            onChange={(e) => onNeuAnordnen({ chapterOpeners: e.target.checked })}
          />
          Jahresauftakte
        </label>
        <label style={B.haken} title="Jeder Jahrgang bekommt eine eigene Hintergrundfarbe">
          <input
            type="checkbox"
            checked={settings.chapterColors}
            onChange={(e) => onNeuAnordnen({ chapterColors: e.target.checked })}
          />
          Jahresfarben
        </label>
        {/*
          Dreiwertig: „wie Zeitstrahl" ist die Vorgabe und bedeutet das Gegenteil
          von ihm – trägt der Zeitstrahl den Gruppentitel auf jeder Doppelseite,
          kostet ein eigener Auftakt nur zwei Seiten, ohne etwas hinzuzufügen.
        */}
        <label style={{ ...B.haken, justifyContent: 'space-between' }}>
          Gruppenauftakte
          <select
            value={String(settings.groupOpeners)}
            onChange={(e) =>
              onNeuAnordnen({
                groupOpeners: e.target.value === 'auto' ? 'auto' : e.target.value === 'true',
              })
            }
            style={B.auswahl}
          >
            <option value="auto">wie Zeitstrahl</option>
            <option value="true">immer</option>
            <option value="false">nie</option>
          </select>
        </label>
      </div>

      <div style={B.abschnitt}>
        <span style={B.marke}>Nur Darstellung — keine Handarbeit geht verloren</span>
        <label style={B.haken}>
          <input
            type="checkbox"
            checked={settings.timeline}
            onChange={(e) => onDarstellung({ timeline: e.target.checked })}
          />
          Zeitstrahl
        </label>
        {/*
          Zwei Achsen, zwei Fragen: Der Fuß sagt, wie weit es seit der letzten
          Seite ist, der Rand, wo man im Buch steht.
        */}
        {settings.timeline && (
          <label
            style={{ ...B.haken, justifyContent: 'space-between' }}
            title="Achse am Seitenfuß oder am äußeren Rand"
          >
            Achse
            <select
              value={settings.timelineStyle}
              onChange={(e) => onDarstellung({ timelineStyle: e.target.value as 'foot' | 'side' })}
              style={B.auswahl}
            >
              <option value="foot">im Fuß, mit Gruppentitel</option>
              <option value="side">am Rand, über alle Jahre</option>
            </select>
          </label>
        )}
        {/*
          Wie der Zeitstrahl eine reine Darstellungssache: Die Neigung entsteht
          beim Rendern und rührt die Fotoverteilung nicht an. Ein Dreh am Regler
          kostet deshalb keine handgemachte Korrektur.
        */}
        <label style={B.haken} title="Wie schief die Bilder auf den Seiten liegen">
          Neigung
          <input
            type="range"
            min={0}
            max={MAX_TILT_DEG}
            step={0.1}
            value={settings.tilt}
            onChange={(e) => onDarstellung({ tilt: Number(e.target.value) })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={S.reglerWert}>
            {settings.tilt === 0 ? 'aus' : `${settings.tilt.toFixed(1).replace('.', ',')}°`}
          </span>
        </label>
      </div>

      <div style={{ ...B.abschnitt, borderBottom: 'none', gap: 10 }}>
        <button
          onClick={onNeuEinlesen}
          disabled={busy}
          style={S.breit}
          title="Liest die Quellordner erneut ein. Das Buch bleibt stehen, neue Fotos landen im Fotopool."
        >
          Bilder neu einlesen
        </button>
        <button
          onClick={neuAnordnen}
          disabled={busy}
          style={{ ...S.breit, borderColor: T.fehlerRand, color: T.fehler }}
          title="Baut das Buch neu und wählt andere Vorlagen. Bilder werden nicht neu eingelesen."
        >
          Buch neu anordnen …
        </button>
        <p style={B.leiser}>
          {verlust.length > 0
            ? `Verworfen würden ${verlust.join(', ')}.`
            : 'Derzeit gibt es keine Handarbeit, die dabei verloren gehen könnte.'}
          {handwork.festgehalten > 0 &&
            ` ${handwork.festgehalten} festgehaltene Doppelseite(n) bleiben unangetastet.`}
        </p>
      </div>
    </aside>
  );
}

const S = {
  spalte: {
    width: 336,
    flexShrink: 0,
    background: T.bg1,
    borderLeft: `1px solid ${T.line}`,
    overflowY: 'auto' as const,
  },
  zahl: {
    width: '5rem',
    font: 'inherit',
    fontSize: 13,
    padding: '6px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
  },
  reglerWert: {
    fontFamily: T.display,
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: '2.8rem',
    textAlign: 'right' as const,
  },
  breit: {
    font: 'inherit',
    fontSize: 13,
    padding: '9px 12px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
} satisfies Record<string, React.CSSProperties>;
