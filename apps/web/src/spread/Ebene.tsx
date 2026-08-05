/**
 * Die Ebene eines Bildes im Stapel – vier Züge und eine Auskunft.
 *
 * Solange jedes Bild in seinem Platz aus der Vorlage sitzt, überlappt sich
 * nichts (`library.test.ts` prüft das). Seit die Kästen frei gezogen werden,
 * schon – und dann ist „wer liegt vorn" eine Frage, die jemand beantworten
 * will. Vorher hat sie die Reihenfolge der Vorlage beantwortet.
 *
 * **Vier Knöpfe und keine Ebenennummer zum Eintippen.** Eine Nummer ist das
 * Ergebnis eines Zuges, nicht die Absicht: Man will „das da vor das andere",
 * nicht „Ebene 3". Dieselbe Geste wie in jedem Grafikprogramm.
 *
 * **Und nichts, wo es keinen Stapel gibt.** Bei einem einzigen Bild auf der
 * Doppelseite ist die Ebene keine leere Wahl, sondern eine Frage ohne Sinn.
 *
 * Ein Baustein für alle drei Rahmen, weil die Wirkung in allen dreien dieselbe
 * ist (`useSpreadEditor`). `variante` unterscheidet allein die Anordnung:
 * Abschnitt in der Spalte des Inspektors, Zeile in der Karte der Werkbank,
 * Pillen in der Leiste des Lesetischs.
 */
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

const ZUEGE = [
  { zug: 'vorn' as const, text: 'ganz vor', titel: 'Ganz nach vorn' },
  { zug: 'vor' as const, text: 'vor', titel: 'Eine Ebene nach vorn' },
  { zug: 'zurueck' as const, text: 'zurück', titel: 'Eine Ebene nach hinten' },
  { zug: 'hinten' as const, text: 'ganz hinten', titel: 'Ganz nach hinten' },
];

export function Ebene({
  model,
  variante = 'spalte',
}: {
  model: SpreadEditorModel;
  variante?: 'spalte' | 'karte' | 'leiste';
}) {
  const stand = model.ebene;
  if (!stand || stand.von < 2) return null;

  const vorn = stand.ebene === 1;
  const hinten = stand.ebene === stand.von;
  const gesperrt = (zug: (typeof ZUEGE)[number]['zug']) =>
    ((zug === 'vorn' || zug === 'vor') && vorn) ||
    ((zug === 'hinten' || zug === 'zurueck') && hinten);

  const knoepfe = (grundstil: React.CSSProperties, breit: boolean) =>
    ZUEGE.map((z) => (
      <button
        key={z.zug}
        onClick={() => void model.ebeneZiehen(z.zug)}
        disabled={gesperrt(z.zug)}
        title={z.titel}
        style={{ ...grundstil, ...(breit ? { flex: 1 } : {}), ...(gesperrt(z.zug) ? S.aus : {}) }}
      >
        {z.text}
      </button>
    ));

  // „Ebene 1 von 4" statt „oben": Die Zahl sagt zugleich, wie viele es sind, und
  // damit, ob ein Zug überhaupt noch etwas ändern kann.
  const stelle = `Ebene ${stand.ebene} von ${stand.von}`;

  if (variante === 'leiste') {
    return (
      <>
        <span style={B.trenner} />
        <span style={S.stelle} title="Ebene im Stapel dieser Doppelseite">
          {stand.ebene}/{stand.von}
        </span>
        {knoepfe(B.pilleAus, false)}
      </>
    );
  }

  if (variante === 'karte') {
    // Zwei mal zwei und nicht vier nebeneinander: In der schwebenden Karte sind
    // vier Knöpfe je vierzig Pixel breit, und „ganz hinten" bricht mitten im
    // Wort um.
    return (
      <>
        <span style={{ ...B.marke, marginTop: 8 }}>
          Ebene · {stand.ebene} von {stand.von}
        </span>
        <div style={S.raster}>{knoepfe(S.knopf, false)}</div>
      </>
    );
  }

  return (
    <div style={B.abschnitt}>
      <div style={S.kopfzeile}>
        <span style={B.marke}>Ebene</span>
        <span style={S.stelle}>{stelle}</span>
      </div>
      <div style={S.reihe}>{knoepfe(S.knopf, true)}</div>
      <span style={B.leiser}>
        Wirkt, wo sich Bilder überlappen — im Raster der Vorlage berührt sich keines.
      </span>
    </div>
  );
}

const S = {
  kopfzeile: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  stelle: { fontSize: 11, color: T.fg4, fontVariantNumeric: 'tabular-nums' as const },
  reihe: { display: 'flex', gap: 4 },
  raster: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  knopf: { ...B.knopfKlein, padding: '4px 0', whiteSpace: 'nowrap' as const },
  aus: { opacity: 0.4, cursor: 'default' as const },
} satisfies Record<string, React.CSSProperties>;
