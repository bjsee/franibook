/**
 * Aufnahmedaten korrigieren.
 *
 * Der Bestand hat Fotos ohne Datum und Fotos mit falschem — beide sortiert das
 * Buch an die falsche Stelle. Diese Ansicht ist der Ort, an dem man sie
 * abarbeitet: Vorgabe ist deshalb der Filter *zweifelhaft*, nicht der ganze
 * Bestand. Wer ein einzelnes Bild an seiner Doppelseite bemerkt, korrigiert es
 * dort (`spread/BildPanel.tsx`); undatierte Fotos stehen aber oft in keiner
 * Doppelseite und wären auf diesem Weg unerreichbar.
 *
 * Zwei Spalten, weil die Arbeit zwei Schritte hat: **links wählen, rechts
 * anwenden.** Die Werkzeuge stehen dabei nach der Frage geordnet, die sie
 * beantworten — *ich kenne den Zeitpunkt* (setzen), *die Abstände stimmen, der
 * Nullpunkt nicht* (verschieben), *ich kenne nur einen Zeitraum* (verteilen).
 * Danach der Ort, denn er ist die zweite Angabe, die das Buch aus einem Foto
 * liest: Er beschriftet nichts von selbst, speist aber die Gruppenvorschläge.
 *
 * Die Reihenfolge der Auswahl ist sichtbar und ziehbar, weil sie beim Verteilen
 * eine Aussage trägt: Das erste Bild bekommt den frühesten Zeitpunkt. Gezogen
 * wird in der Auswahlleiste und nicht in der langen Liste — dort wäre es bei
 * achthundert Zeilen eine Geduldsübung, und die Reihenfolge betrifft ohnehin nur
 * die Auswahl.
 *
 * Das Buch bleibt bei allem unangetastet. Ändert eine Korrektur die Gliederung,
 * sagt es die Meldung; der Neuaufbau bleibt ein ausdrücklicher Griff, sonst
 * verwürfe eine Serienkorrektur vierzigmal jede Handarbeit.
 */
import { useState } from 'react';
import { DATUMSQUELLE } from './spread/SpreadStage.js';
import { B, T } from './theme.js';
import { type Filter, useFotodaten } from './useFotodaten.js';

const FILTER: { id: Filter; label: string; titel: string }[] = [
  { id: 'zweifelhaft', label: 'zweifelhaft', titel: 'Ohne Datum oder mit schwacher Quelle' },
  { id: 'geschaetzt', label: 'geschätzt', titel: 'Aus einem Zeitraum gerechnet' },
  { id: 'alle', label: 'alle', titel: 'Der ganze Bestand' },
];

export function Fotodaten({
  onChanged,
  onBildGeaendert,
  bildVersion,
  standVersion,
}: {
  onChanged: () => void;
  onBildGeaendert: () => void;
  /** Hängt an den Miniaturen, damit eine gekippte Ausrichtung sichtbar wird. */
  bildVersion: number;
  standVersion?: number;
}) {
  const m = useFotodaten({ onChanged, onBildGeaendert, standVersion });

  // Die Eingaben der drei Werkzeuge. Lokal und nicht im Haken: Sie sind
  // Formularzustand dieser Ansicht und bedeuten nichts, bis man anwendet.
  const [zeitpunkt, setZeitpunkt] = useState('');
  const [betrag, setBetrag] = useState({ years: 0, months: 0, days: 0, hours: 0, minutes: 0 });
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [ortname, setOrtname] = useState('');
  const [gezogen, setGezogen] = useState<number | null>(null);

  const n = m.auswahl.length;
  const gesperrt = n === 0 || m.busy;

  return (
    <div style={S.rahmen}>
      <div style={S.liste}>
        <div style={S.kopf}>
          <div style={B.segRahmen}>
            {FILTER.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.titel}
                onClick={() => m.setFilter(f.id)}
                style={m.filter === f.id ? B.segAn : B.segAus}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span style={B.leise}>{m.fotos ? `${m.fotos.length} Fotos` : 'lädt …'}</span>
          <div style={B.dehner} />
          <button type="button" style={B.knopfKlein} onClick={m.alleWaehlen} disabled={!m.fotos}>
            alle wählen
          </button>
          <button type="button" style={B.knopfKlein} onClick={m.auswahlLeeren} disabled={n === 0}>
            Auswahl leeren
          </button>
        </div>

        <div style={S.rollen}>
          {m.fotos?.length === 0 && (
            <p style={S.leer}>
              {m.filter === 'zweifelhaft'
                ? 'Kein Foto mit zweifelhaftem Datum. Der Bestand ist in Ordnung.'
                : 'Nichts in dieser Auswahl.'}
            </p>
          )}
          {m.fotos?.map((f) => {
            const platz = m.auswahl.indexOf(f.id);
            return (
              <div
                key={f.id}
                onClick={(e) => m.umschalten(f.id, e.shiftKey)}
                title="Umschalt-Klick wählt bis hierher"
                style={{ ...S.zeile, ...(platz >= 0 ? S.zeileAn : {}) }}
              >
                <img
                  src={`/api/photos/${f.id}/preview?size=thumb${bildVersion > 0 ? `&v=${bildVersion}` : ''}`}
                  alt=""
                  style={S.thumb}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={B.dateiname}>{f.fileName}</div>
                  <div style={S.meta}>
                    <span style={S.datum}>
                      {f.effectiveDate?.replace('T', ' ').slice(0, 16) ?? 'ohne Datum'}
                    </span>
                    <span style={quellenStil(f.dateSource)}>
                      {DATUMSQUELLE[f.dateSource] ?? f.dateSource}
                    </span>
                    {/* Der Ort gehört in die Zeile, weil er hier gesetzt wird —
                        und „von Hand" dazu, aus demselben Grund wie beim Datum:
                        Ein stillschweigend ersetzter Wert wäre nicht mehr als
                        Entscheidung erkennbar. */}
                    {f.place && (
                      <span style={S.ort}>
                        {f.place.label}
                        {f.placeManual && <span style={S.ortHand}> von Hand</span>}
                      </span>
                    )}
                    {/* Wie „von Hand" beim Ort: eine getroffene Entscheidung
                        gehört in die Zeile, sonst ist sie nur im Buch zu sehen —
                        und dort erst nach dem nächsten Anordnen. */}
                    {f.weight === 'hero' && <span style={S.hauptbild}>★ Hauptbild</span>}
                    {f.weight === 'filler' && <span style={S.beifoto}>Beifoto</span>}
                    {f.issues.map((i) => (
                      <span key={i.code} style={S.befund} title={i.detail}>
                        {i.detail ?? i.code}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Der Platz in der Verteilreihenfolge, nicht bloß ein Haken:
                    Beim Verteilen entscheidet er, welches Bild vorne liegt. */}
                {platz >= 0 && <span style={S.platz}>{platz + 1}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={S.werkzeuge}>
        <div style={B.abschnitt}>
          <div style={B.titel}>Auswahl</div>
          {n === 0 ? (
            <p style={B.leiser}>Links wählen. Umschalt-Klick nimmt alles bis dorthin dazu.</p>
          ) : (
            <>
              <div style={S.chips}>
                {m.gewaehlt.map((f, i) => (
                  <span
                    key={f.id}
                    draggable
                    onDragStart={() => setGezogen(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (gezogen !== null) m.umordnen(gezogen, i);
                      setGezogen(null);
                    }}
                    onDragEnd={() => setGezogen(null)}
                    title={`${f.fileName} – ziehen ordnet um`}
                    style={{ ...B.chip, ...S.chip, ...(gezogen === i ? S.chipZieht : {}) }}
                  >
                    <span style={S.chipZahl}>{i + 1}</span>
                    {f.fileName}
                  </span>
                ))}
              </div>
              <div style={S.zeileRechts}>
                <span style={B.leiser}>
                  {m.handOrdnung ? 'von Hand geordnet' : 'nach Dateinamen'}
                </span>
                {m.handOrdnung && (
                  <button type="button" style={B.knopfKlein} onClick={m.nachDateinamen}>
                    zurück zur Dateinamenfolge
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Zeitpunkt setzen</div>
          <p style={B.leiser}>
            Für einen bekannten Zeitpunkt. Bei mehreren Fotos hält eine Sekunde Abstand die
            Reihenfolge.
          </p>
          <div style={S.zeileRechts}>
            <input
              type="datetime-local"
              step={1}
              value={zeitpunkt}
              onChange={(e) => setZeitpunkt(e.target.value)}
              style={{ ...B.feld, flex: 1 }}
            />
            <button
              type="button"
              style={B.knopfPrimaer}
              disabled={gesperrt || zeitpunkt === ''}
              onClick={() => m.anwenden({ kind: 'set', value: sekundengenau(zeitpunkt) })}
            >
              setzen
            </button>
          </div>
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Um einen Betrag verschieben</div>
          <p style={B.leiser}>
            Für einen Kamera-Reset oder einen Zeitzonenfehler: Die Abstände zwischen den Bildern
            bleiben, nur der Nullpunkt wandert. Negative Werte gehen zurück.
          </p>
          <div style={S.betrag}>
            {(
              [
                ['years', 'Jahre'],
                ['months', 'Monate'],
                ['days', 'Tage'],
                ['hours', 'Stunden'],
                ['minutes', 'Minuten'],
              ] as const
            ).map(([feld, label]) => (
              <label key={feld} style={S.betragFeld}>
                <span style={B.leiser}>{label}</span>
                <input
                  type="number"
                  value={betrag[feld]}
                  onChange={(e) => setBetrag({ ...betrag, [feld]: Number(e.target.value) || 0 })}
                  style={{ ...B.feldMono, width: '100%' }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            style={{ ...B.knopfPrimaer, marginTop: 8 }}
            disabled={gesperrt || Object.values(betrag).every((v) => v === 0)}
            onClick={() => m.anwenden({ kind: 'shift', ...betrag })}
          >
            verschieben
          </button>
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Über einen Zeitraum verteilen</div>
          <p style={B.leiser}>
            Wenn nur der Zeitraum bekannt ist. Die Fotos werden in der Reihenfolge oben gleichmäßig
            verteilt und gelten danach als geschätzt.
          </p>
          {/*
            Untereinander und nicht nebeneinander: Zwei `datetime-local` tragen
            je Datum und Uhrzeit und sind damit breiter als die halbe Spalte —
            nebeneinander ragte das zweite Feld heraus und die Ansicht bekam
            einen waagerechten Rollbalken.
          */}
          <label style={S.zeitraumZeile}>
            <span style={{ ...B.leiser, width: 24 }}>von</span>
            <input
              type="datetime-local"
              step={1}
              value={von}
              onChange={(e) => setVon(e.target.value)}
              style={{ ...B.feld, flex: 1, minWidth: 0 }}
            />
          </label>
          <label style={S.zeitraumZeile}>
            <span style={{ ...B.leiser, width: 24 }}>bis</span>
            <input
              type="datetime-local"
              step={1}
              value={bis}
              onChange={(e) => setBis(e.target.value)}
              style={{ ...B.feld, flex: 1, minWidth: 0 }}
            />
          </label>
          <button
            type="button"
            style={{ ...B.knopfPrimaer, marginTop: 8 }}
            disabled={gesperrt || von === '' || bis === ''}
            onClick={() =>
              m.anwenden({ kind: 'spread', from: sekundengenau(von), to: sekundengenau(bis) })
            }
          >
            verteilen
          </button>
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Ort setzen</div>
          <p style={B.leiser}>
            Nur jedes vierte Foto trägt Koordinaten. Ein gesetzter Ort speist die Gruppenvorschläge
            und wird dort zum Anker für die Nachbarn ohne GPS.
          </p>
          {/*
            Vervollständigung aus dem Bestand, freier Text bleibt möglich: Wer
            „Bremerhaven" aus der Liste nimmt, bekommt dessen Kennung und fällt
            mit den über GPS aufgelösten Fotos in *einen* Vorschlag. Getippt
            entstünde eine eigene — zwei Vorschläge für denselben Ort, ohne dass
            man sieht, warum. Ein `datalist` kann beides, ein `select` nicht.
          */}
          <div style={S.zeileRechts}>
            <input
              list="franibook-orte"
              value={ortname}
              placeholder="Ortsname"
              onChange={(e) => setOrtname(e.target.value)}
              style={{ ...B.feld, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              style={B.knopfPrimaer}
              disabled={gesperrt || ortname.trim() === ''}
              onClick={() => {
                const treffer = m.orte.find((o) => o.label === ortname.trim());
                m.ortAnwenden({
                  label: ortname.trim(),
                  ...(treffer ? { key: treffer.key } : {}),
                });
              }}
            >
              setzen
            </button>
          </div>
          <datalist id="franibook-orte">
            {m.orte.map((o) => (
              <option key={o.key} value={o.label}>
                {`${o.count} ${o.count === 1 ? 'Foto' : 'Fotos'}`}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            style={{ ...B.knopf, marginTop: 6 }}
            disabled={gesperrt}
            onClick={() => m.ortAnwenden(null)}
          >
            Ort an die Automatik zurückgeben
          </button>
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Ausrichtung kippen</div>
          <p style={B.leiser}>
            Für Scans und Bilder ohne brauchbare EXIF-Ausrichtung: Beim Kippen um 90° tauschen
            Breite und Höhe, und die Vorlagenwahl sieht endlich das richtige Format. Die Drehungen
            addieren sich; die Vorlage folgt beim Neuanordnen.
          </p>
          <div style={S.zeileRechts}>
            <button
              type="button"
              style={{ ...B.knopf, flex: 1 }}
              disabled={gesperrt}
              onClick={() => m.ausrichtungAnwenden(3)}
            >
              ↺ links
            </button>
            <button
              type="button"
              style={{ ...B.knopf, flex: 1 }}
              disabled={gesperrt}
              onClick={() => m.ausrichtungAnwenden(1)}
            >
              ↻ rechts
            </button>
            <button
              type="button"
              style={{ ...B.knopf, flex: 1 }}
              disabled={gesperrt}
              onClick={() => m.ausrichtungAnwenden(2)}
            >
              180°
            </button>
          </div>
          <button
            type="button"
            style={{ ...B.knopf, marginTop: 6 }}
            disabled={gesperrt}
            onClick={() => m.ausrichtungAnwenden(null)}
          >
            Ausrichtung an die Datei zurückgeben
          </button>
        </div>

        {/*
          Das einzige Werkzeug dieser Spalte, das nichts korrigiert: Es sagt,
          welchen Platz ein Bild im Buch verdient. Es steht trotzdem hier, weil
          hier die Mehrfachauswahl liegt — „diese vierzig Serienbilder sollen
          keine Seite tragen" ist ein Griff und keine vierzig. Das *einzelne*
          Hauptbild zeichnet man an der Doppelseite aus, wo man es groß sieht.
        */}
        <div style={B.abschnitt}>
          <div style={B.titel}>Gewicht im Buch</div>
          <p style={B.leiser}>
            Ein Hauptbild bekommt den größten Platz seiner Doppelseite, ein Beifoto einen kleinen.
            Wirksam wird das beim nächsten Anordnen — das Buch bleibt stehen, bis es angeordnet
            wird.
          </p>
          <div style={S.zeileRechts}>
            <button
              type="button"
              style={{ ...B.knopfPrimaer, flex: 1 }}
              disabled={gesperrt}
              onClick={() => m.gewichtAnwenden('hero')}
            >
              ★ Hauptbild
            </button>
            <button
              type="button"
              style={{ ...B.knopf, flex: 1 }}
              disabled={gesperrt}
              onClick={() => m.gewichtAnwenden('filler')}
            >
              Beifoto
            </button>
          </div>
          <button
            type="button"
            style={{ ...B.knopf, marginTop: 6 }}
            disabled={gesperrt}
            onClick={() => m.gewichtAnwenden('normal')}
          >
            Auszeichnung zurücknehmen
          </button>
        </div>

        <div style={B.abschnitt}>
          <div style={B.titel}>Datumskorrektur zurücknehmen</div>
          <p style={B.leiser}>
            Gibt das Datum an die Datei zurück. Anders als Cmd+Z auch dann noch, wenn seither
            anderes geschehen ist.
          </p>
          <button
            type="button"
            style={B.knopf}
            disabled={gesperrt}
            onClick={() => m.anwenden({ kind: 'clear' })}
          >
            {n === 1 ? 'Korrektur verwerfen' : `Korrektur bei ${n} Fotos verwerfen`}
          </button>
        </div>

        {m.note && <p style={B.meldung}>{m.note}</p>}
        {m.fehler && <p style={B.fehlerfeld}>{m.fehler}</p>}
      </div>
    </div>
  );
}

/**
 * `2015-06-12T14:12` → `2015-06-12T14:12:00`.
 *
 * `datetime-local` liefert die Sekunden nur, wenn welche getippt wurden; das
 * Projekt erwartet sie immer (`NaiveDateTime`). Ohne Zeitzonenumrechnung, denn
 * der Wert des Feldes *ist* naive lokale Zeit — genau die Form, in der das
 * ganze Projekt rechnet.
 */
function sekundengenau(wert: string): string {
  return wert.length === 16 ? `${wert}:00` : wert;
}

/** Eine schwache Datumsquelle wird gelb, eine erschlossene grau. */
function quellenStil(source: string): React.CSSProperties {
  if (source === 'unknown' || source === 'file') return S.quelleSchwach;
  if (source === 'interpolated') return S.quelleGeschaetzt;
  return S.quelle;
}

const S = {
  rahmen: {
    display: 'flex',
    gap: 16,
    height: '100%',
    minHeight: 0,
    padding: 16,
    boxSizing: 'border-box' as const,
  },
  liste: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  kopf: { display: 'flex', alignItems: 'center', gap: 8 },
  rollen: { flex: 1, overflowY: 'auto' as const, minHeight: 0 },
  leer: { ...B.leise, padding: 24, textAlign: 'center' as const },
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px',
    borderRadius: T.rSm,
    cursor: 'pointer',
    borderLeft: `3px solid transparent`,
    // Sonst markiert der Umschalt-Klick, mit dem man einen Bereich wählt,
    // gleich den Text der überstrichenen Zeilen mit.
    userSelect: 'none' as const,
  },
  zeileAn: { background: T.cyanZart, borderLeftColor: T.cyan },
  thumb: {
    width: 48,
    height: 36,
    objectFit: 'cover' as const,
    borderRadius: T.rSm,
    background: T.line,
    flexShrink: 0,
  },
  meta: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center', marginTop: 2 },
  datum: { fontSize: 12, color: T.fg2, fontVariantNumeric: 'tabular-nums' as const },
  quelle: { fontSize: 11, color: T.fg3 },
  quelleSchwach: { fontSize: 11, color: T.warnText },
  quelleGeschaetzt: { fontSize: 11, color: T.fg3, fontStyle: 'italic' as const },
  ort: { fontSize: 11, color: T.fg2 },
  ortHand: { color: T.fg3 },
  befund: {
    fontSize: 11,
    color: T.warnText,
    background: T.warnBg,
    padding: '1px 6px',
    borderRadius: T.rPill,
  },
  // Türkis, weil es eine getroffene Entscheidung ist und keine Aussage über das
  // Buch — dieselbe Regel, die die Farben Rot, Gelb und Grün der Auflösung und
  // den Bildquellen vorbehält.
  hauptbild: { fontSize: 11, color: T.cyanTief, fontWeight: 600 },
  beifoto: { fontSize: 11, color: T.fg3 },
  platz: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums' as const,
    color: T.cyanTief,
    minWidth: 20,
    textAlign: 'right' as const,
  },
  werkzeuge: {
    width: 340,
    flexShrink: 0,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
    maxHeight: 132,
    overflowY: 'auto' as const,
  },
  // `B.chip` ist kein Flexkasten, also hier: sonst klebt die Platzzahl am
  // Dateinamen und liest sich als dessen erste Ziffer.
  chip: {
    cursor: 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    userSelect: 'none' as const,
  },
  chipZieht: { opacity: 0.4 },
  chipZahl: {
    fontSize: 10,
    color: T.cyanTief,
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 10,
    textAlign: 'right' as const,
  },
  zeileRechts: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  zeitraumZeile: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  betrag: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginTop: 6 },
  betragFeld: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 },
};
