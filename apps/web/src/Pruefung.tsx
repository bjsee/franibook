/**
 * Die Prüfung: was vor dem Druck noch zu tun ist.
 *
 * Zwei Bereiche unter einem Reiter, weil es **eine** Frage ist — was ist noch
 * offen? —, nur an zwei Gegenständen: `Am Buch` findet die Funde in der
 * gesetzten Doppelseite (Auflösung, Texte am Rand, Gesichter im Beschnitt),
 * `Im Bestand` die Aufnahmen, von denen es mehrere desselben Augenblicks gibt.
 *
 * Getrennte Reiter waren die erste Fassung und die schlechtere: Sie standen
 * nebeneinander in der Kopfzeile, ohne dass etwas sagte, dass beide zur selben
 * Vorbereitung gehören — und die Zahl offener Punkte hätte zweimal
 * dagestanden, wo eine Zahl gefragt ist.
 *
 * **Der Rahmen zählt nicht selbst.** Jeder Bereich weiß, wie viele Punkte bei
 * ihm offen sind, und meldet es nach oben (`onOffen`); von dort geht es an den
 * Reiter. Eine eigene Rechnung hier wäre eine zweite Wahrheit über dieselbe
 * Zahl — und für die Doppel eine zweite Anfrage, die anderthalb Sekunden
 * kostet.
 */
import { useCallback } from 'react';
import { Abnahme } from './Abnahme.js';
import { Doppel } from './Doppel.js';
import { Link, type Route } from './router.js';
import { B, T } from './theme.js';

/** Welche Bereiche es gibt, in der Reihenfolge der Kopfzeile. */
const BEREICHE = [
  {
    teil: undefined,
    label: 'Am Buch',
    titel: 'Was dem Druck im Weg steht: Auflösung, Texte am Rand, Gesichter im Beschnitt',
  },
  {
    teil: 'doppel' as const,
    label: 'Im Bestand',
    titel: 'Doppel: mehrere Aufnahmen desselben Augenblicks',
  },
];

export interface PruefungProps {
  /** Welcher Bereich offen ist. */
  teil?: 'doppel';
  onNavigieren: (ziel: Route) => void;
  standVersion?: number;
  onChanged?: () => void;
  /**
   * Meldet, wie viele Punkte in einem Bereich offen sind.
   *
   * Je Bereich einzeln, damit der Reiter beide Zahlen addieren kann, ohne dass
   * ein Bereich die des anderen kennen muss.
   */
  onOffen?: (bereich: 'buch' | 'bestand', offen: number) => void;
}

export function Pruefung({ teil, onNavigieren, standVersion, onChanged, onOffen }: PruefungProps) {
  // Stabile Melder: Die Bereiche rufen sie aus einem Effekt heraus, und eine bei
  // jedem Rendern neue Funktion wäre eine Meldung bei jedem Rendern — dieselbe
  // Sorge wie bei `gruppeInAdresse` in `App.tsx`.
  const buchOffen = useCallback((n: number) => onOffen?.('buch', n), [onOffen]);
  const bestandOffen = useCallback((n: number) => onOffen?.('bestand', n), [onOffen]);

  return (
    <div style={S.rahmen}>
      {/*
        Die Bereiche sind `Link` und keine Knöpfe: Sie sind Stationen im Verlauf
        (`/pruefung`, `/pruefung/doppel`), und nur ein `href` gibt ⌘-Klick.
      */}
      <div style={S.leiste}>
        <span style={B.segRahmen}>
          {BEREICHE.map((b) => (
            <Link
              key={b.label}
              route={{ view: 'pruefung', ...(b.teil ? { teil: b.teil } : {}) }}
              onNavigieren={onNavigieren}
              style={teil === b.teil ? B.segAn : B.segAus}
              title={b.titel}
            >
              {b.label}
            </Link>
          ))}
        </span>
      </div>

      {teil === 'doppel' ? (
        <Doppel
          onOffen={bestandOffen}
          {...(standVersion !== undefined ? { standVersion } : {})}
          {...(onChanged ? { onChanged } : {})}
        />
      ) : (
        <Abnahme
          onNavigieren={onNavigieren}
          onOffen={buchOffen}
          {...(standVersion !== undefined ? { standVersion } : {})}
          {...(onChanged ? { onChanged } : {})}
        />
      )}
    </div>
  );
}

const S = {
  rahmen: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  leiste: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 24px 0',
    borderBottom: `1px solid ${T.line}`,
    paddingBottom: 14,
  },
};
