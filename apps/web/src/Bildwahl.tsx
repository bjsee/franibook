/**
 * Ein Bild aus dem ganzen Bestand wählen.
 *
 * Die Vorschlagsreihen des Umschlags zeigen die Hauptbilder der Fotogruppen —
 * kuratiert und benannt, aber eben nur sechzig von tausend. Wer ein anderes
 * Bild will, braucht den Bestand, und der passt in keine Reihe.
 *
 * **Zugeklappt, bis jemand ihn braucht.** Der Normalfall ist, dass einer der
 * Vorschläge taugt; tausend Miniaturen dauernd zu zeigen hieße, die Ansicht für
 * den seltenen Fall zu bauen. Geladen wird deshalb auch erst beim Aufklappen.
 *
 * **Gefiltert wird nach Jahr, und die Jahre kommen aus den Bildern selbst.**
 * Ein Fotobuch ist chronologisch, also ist das Jahr die eine Auskunft, mit der
 * man sich in tausend Bildern zurechtfindet — Ort und Kamera wären eine zweite
 * Antwort auf eine Frage, die die Fotodatenansicht schon vollständig
 * beantwortet.
 */
import { useEffect, useState } from 'react';
import { type FotoInfo, fehlertext, fotosLaden } from './api.js';
import { useBildSrc } from './bildadresse.js';
import { B, T } from './theme.js';

/** Wie viele Bilder ein Jahr höchstens zeigt, bevor gescrollt wird — nur Optik. */
const GITTER_HOEHE = 320;

export function Bildwahl({
  gewaehlt,
  onWaehlen,
  knopf = 'Aus dem ganzen Bestand wählen',
}: {
  /** Die aktuelle Wahl, damit sie im Gitter markiert werden kann. */
  gewaehlt?: string | undefined;
  onWaehlen: (photoId: string) => void;
  knopf?: string;
}) {
  const bildSrc = useBildSrc();
  const [offen, setOffen] = useState(false);
  const [fotos, setFotos] = useState<FotoInfo[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [jahr, setJahr] = useState<number | null>(null);

  useEffect(() => {
    if (!offen || fotos) return;
    fotosLaden()
      .then((d) => setFotos(d.photos))
      .catch((e: unknown) => setFehler(fehlertext(e)));
  }, [offen, fotos]);

  if (!offen) {
    return (
      <button onClick={() => setOffen(true)} style={{ ...B.knopf, alignSelf: 'flex-start' }}>
        {knopf}
      </button>
    );
  }

  // Die Jahre des Bestands, aufsteigend. Undatierte Bilder fallen unter „ohne
  // Datum" — sie wegzulassen wäre falsch, gerade Scans haben oft keines.
  const jahre = [
    ...new Set((fotos ?? []).map(jahrVon).filter((j): j is number => j !== null)),
  ].sort((a, b) => a - b);
  const ohneDatum = (fotos ?? []).some((f) => jahrVon(f) === null);
  const sichtbar = (fotos ?? []).filter((f) => {
    if (jahr === null) return true;
    const j = jahrVon(f);
    return jahr === OHNE_DATUM ? j === null : j === jahr;
  });

  return (
    <div style={S.rahmen}>
      <div style={S.kopf}>
        <span style={B.marke}>
          Ganzer Bestand
          {fotos && (
            <>
              {' — '}
              {sichtbar.length}
              {sichtbar.length !== fotos.length && ` von ${fotos.length}`} Bilder
            </>
          )}
        </span>
        <span style={B.dehner} />
        <button onClick={() => setOffen(false)} style={B.knopfKlein}>
          Zuklappen
        </button>
      </div>

      {fehler && <p style={B.fehlerfeld}>Fehler: {fehler}</p>}
      {!fotos && !fehler && <p style={B.leise}>Lade den Bestand …</p>}

      {fotos && (
        <>
          <div style={S.jahre}>
            <button onClick={() => setJahr(null)} style={jahr === null ? B.pilleAn : B.pilleAus}>
              Alle
            </button>
            {jahre.map((j) => (
              <button
                key={j}
                onClick={() => setJahr(j)}
                style={jahr === j ? B.pilleAn : B.pilleAus}
              >
                {j}
              </button>
            ))}
            {ohneDatum && (
              <button
                onClick={() => setJahr(OHNE_DATUM)}
                style={jahr === OHNE_DATUM ? B.pilleAn : B.pilleAus}
              >
                ohne Datum
              </button>
            )}
          </div>

          <div style={S.gitter}>
            {sichtbar.map((f) => (
              <button
                key={f.id}
                onClick={() => onWaehlen(f.id)}
                title={`${f.fileName}${f.effectiveDate ? ` · ${f.effectiveDate.slice(0, 10)}` : ''}`}
                style={{
                  ...S.zelle,
                  borderColor: f.id === gewaehlt ? T.cyan : 'transparent',
                }}
              >
                {/*
                  `loading="lazy"`: Ein Jahr sind schnell zweihundert Bilder, und
                  der Browser soll nur laden, was zu sehen ist. Die Miniaturen
                  sind die 320-px-Fassung — die große wäre hier 500 MB.
                */}
                <img src={bildSrc(f.id, 'thumb')} alt={f.fileName} loading="lazy" style={S.bild} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Der Jahrgang eines Fotos, oder `null` ohne Datum.
 *
 * Aus dem **effektiven** Datum, also nach allen Korrekturen: Ein Bild, dessen
 * Datum von Hand geradegerückt wurde, gehört in das Jahr, in dem es aufgenommen
 * wurde, und nicht in das seines EXIF-Fehlers.
 */
function jahrVon(f: FotoInfo): number | null {
  if (!f.effectiveDate) return null;
  const jahr = Number(f.effectiveDate.slice(0, 4));
  return Number.isFinite(jahr) ? jahr : null;
}

/** Eigener Wert für „ohne Datum" — kein Jahrgang, aber eine Auswahl. */
const OHNE_DATUM = -1;

const S = {
  rahmen: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    padding: '12px 14px',
    border: `1px solid ${T.line}`,
    borderRadius: 8,
  },
  kopf: { display: 'flex', alignItems: 'center', gap: 12 },
  jahre: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  gitter: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
    gap: 6,
    maxHeight: GITTER_HOEHE,
    overflowY: 'auto' as const,
  },
  zelle: {
    padding: 0,
    border: '2px solid',
    borderRadius: 4,
    background: 'none',
    cursor: 'pointer',
    lineHeight: 0,
  },
  bild: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' as const, borderRadius: 2 },
};
