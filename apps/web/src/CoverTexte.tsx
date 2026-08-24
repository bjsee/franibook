/**
 * Die vier Texte des Umschlags und wie sie gesetzt werden.
 *
 * Ein eigenes Panel und keine vier Eingabefelder mehr in `Cover.tsx`: Jeder der
 * vier Texte beantwortet dieselben sechs Fragen — Wortlaut, Schrift,
 * Ausrichtung, Größe, Farbe, Grund —, und nebeneinander in einer Tabelle sieht
 * man, was gleich und was verschieden gesetzt ist. Untereinander als sechs
 * Felder je Text wären es vierundzwanzig Kästen, in denen sich derselbe
 * Vergleich nicht anstellen lässt.
 *
 * **Eine Zeile je Text, eine Spalte je Frage.** Der Wortlaut steht dabei zuerst,
 * denn er ist die einzige Angabe, die es geben *muss* — alle übrigen dürfen leer
 * bleiben und heißen dann „wie das Buch es vorgibt". Genau das zeigt auch die
 * Anzeige: Ein nicht gesetzter Wert steht als Vorgabe im Feld, nicht als Zahl,
 * die jemand gewählt hätte.
 *
 * **Größe und Farben senden beim Verlassen, nicht bei jedem Tastendruck.** Ein
 * `PATCH /api/cover` rendert den Umschlag neu und stößt (bei gesetztem Mosaik)
 * einen Abgleich an; vierzig davon für eine getippte Zahl wären Arbeit für
 * nichts. Für die Farben tut das `Farbwahl` — dort steht auch, warum eine
 * Umschlagfarbe offen bleiben können muss.
 */
import { Fragment, useEffect, useState } from 'react';
import {
  FONT_FAMILIES,
  MAX_COVER_TEXT_PT,
  MIN_COVER_TEXT_PT,
  type CoverTextName,
  type CoverTextStyle,
  type FontFamilyId,
} from '@franibook/core';
import type { Umschlag, UmschlagPatch } from './api.js';
import { Farbwahl } from './Farbwahl.js';
import { B, T } from './theme.js';

/**
 * Die vier Zeilen — und je Zeile, welches Feld des Umschlags den Wortlaut hält.
 *
 * `spineText` heißt im Wortlaut anders als im Stil (`spine`), weil das eine der
 * Text und das andere seine Gestaltung ist. Beide Namen stehen hier zusammen,
 * damit sie nicht an vier Stellen einzeln zugeordnet werden.
 */
const ZEILEN: {
  stil: CoverTextName;
  feld: 'title' | 'subtitle' | 'backText' | 'spineText';
  label: string;
  hinweis: string;
}[] = [
  {
    stil: 'title',
    feld: 'title',
    label: 'Titel (Vorderseite)',
    hinweis: 'Steht auf einem deckenden Balken am unteren Rand der Vorderseite.',
  },
  {
    stil: 'subtitle',
    feld: 'subtitle',
    label: 'Untertitel',
    hinweis: 'Liegt unter dem Titel. Beide Balken stoßen aneinander.',
  },
  {
    stil: 'backText',
    feld: 'backText',
    label: 'Rückseite',
    hinweis: 'Kurze Zeile unten auf der Rückseite, etwa der Zeitraum.',
  },
  {
    stil: 'spine',
    feld: 'spineText',
    label: 'Buchrücken',
    hinweis: 'Von oben nach unten lesend. Der Grund ist der Rücken selbst.',
  },
];

/** Farben, die gelten, solange keine eigene gesetzt ist. */
const VORGABE_GRUND = '#1a1a1a';
const VORGABE_SCHRIFT = '#ffffff';

export function CoverTexte({
  data,
  onAendern,
  laeuft = false,
}: {
  data: Umschlag;
  onAendern: (patch: UmschlagPatch) => Promise<void>;
  /** Ob gerade ein Mosaik gebacken wird — dann warten die Felder.  */
  laeuft?: boolean;
}) {
  const design = data.design;

  /** Ein Stilfeld setzen; ein leerer Wert nimmt es zurück. */
  const setzeStil = (name: CoverTextName, feld: keyof CoverTextStyle, wert: unknown) =>
    void onAendern({ texts: { [name]: { [feld]: wert === '' ? null : wert } } });

  return (
    <div style={S.panel}>
      <div style={S.zeile}>
        <strong style={B.titel}>Texte des Umschlags</strong>
        <span style={B.dehner} />
        <span style={B.leiser}>
          Leere Felder heißen „wie das Buch es vorgibt" — {MIN_COVER_TEXT_PT} bis{' '}
          {MAX_COVER_TEXT_PT} pt
        </span>
      </div>

      <div style={S.gitter}>
        <span />
        <span style={B.marke}>Text</span>
        <span style={B.marke}>Schrift</span>
        <span style={B.marke}>Ausrichtung</span>
        <span style={B.marke}>Größe</span>
        <span style={B.marke}>Schriftfarbe</span>
        <span style={B.marke}>Grundfarbe</span>

        {ZEILEN.map((z) => {
          const stil: CoverTextStyle = design.texts?.[z.stil] ?? {};
          return (
            <Fragment key={z.stil}>
              <span style={{ ...B.marke, alignSelf: 'center' }} title={z.hinweis}>
                {z.label}
              </span>
              <input
                // Schlüssel mit dem geladenen Wert, sonst überlebt ein
                // serverseitiges Zurücknehmen nicht: `defaultValue` setzt React
                // nur beim ersten Mount.
                key={`${z.feld}-${design[z.feld] ?? ''}`}
                defaultValue={design[z.feld] ?? ''}
                placeholder={z.label}
                disabled={laeuft}
                onBlur={(e) => {
                  if (e.target.value !== (design[z.feld] ?? ''))
                    void onAendern({ [z.feld]: e.target.value });
                }}
                style={{ ...B.feld, fontSize: 14 }}
              />
              <select
                value={stil.family ?? ''}
                disabled={laeuft}
                onChange={(e) => setzeStil(z.stil, 'family', e.target.value as FontFamilyId)}
                style={{ ...B.feld, fontSize: 14 }}
              >
                <option value="">Buchschrift (Vorgabe)</option>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={stil.align ?? ''}
                disabled={laeuft}
                onChange={(e) => setzeStil(z.stil, 'align', e.target.value)}
                style={{ ...B.feld, fontSize: 14 }}
                title={
                  z.stil === 'spine'
                    ? 'Gilt entlang der gedrehten Zeile auf dem Rücken.'
                    : undefined
                }
              >
                <option value="">Links (Vorgabe)</option>
                <option value="center">Mittig</option>
                <option value="right">Rechts</option>
              </select>
              <Punktfeld
                wert={stil.sizePt}
                gesperrt={laeuft}
                onSetzen={(pt) => setzeStil(z.stil, 'sizePt', pt)}
              />
              <Farbwahl
                wert={stil.color}
                vorgabe={design.accentText ?? VORGABE_SCHRIFT}
                gesperrt={laeuft}
                onSetzen={(farbe) => setzeStil(z.stil, 'color', farbe)}
              />
              <Farbwahl
                wert={stil.band}
                vorgabe={design.accent ?? VORGABE_GRUND}
                gesperrt={laeuft}
                onSetzen={(farbe) => setzeStil(z.stil, 'band', farbe)}
              />
            </Fragment>
          );
        })}
      </div>

      <p style={{ ...B.leiser, margin: 0 }}>
        Eine gesetzte Grundfarbe zeichnet den Balken auch dort, wo kein Bild darunter liegt — ohne
        sie erscheint er nur über einem Deckelbild. Der Buchrücken trägt seinen Text immer auf sich
        selbst; seine Grundfarbe färbt den ganzen Rücken.
      </p>
    </div>
  );
}

/**
 * Die Schriftgröße in Punkt — leer heißt „aus der Seitenhöhe gerechnet".
 *
 * Kein Schieberegler: Eine Punktgröße ist eine Zahl, die man kennt und
 * hinschreibt, und die Spanne von 4 bis 240 pt wäre als Regler an keiner Stelle
 * fein genug. Der lokale Entwurf hält die Eingabe, während getippt wird;
 * gesendet wird beim Verlassen.
 */
function Punktfeld({
  wert,
  gesperrt,
  onSetzen,
}: {
  wert: number | undefined;
  gesperrt: boolean;
  onSetzen: (pt: number | '') => void;
}) {
  const [entwurf, setEntwurf] = useState<string | null>(null);
  useEffect(() => setEntwurf(null), [wert]);
  const angezeigt = entwurf ?? (wert === undefined ? '' : String(wert));

  return (
    <input
      type="number"
      min={MIN_COVER_TEXT_PT}
      max={MAX_COVER_TEXT_PT}
      step={0.5}
      value={angezeigt}
      placeholder="auto"
      disabled={gesperrt}
      onChange={(e) => setEntwurf(e.target.value)}
      onBlur={() => {
        if (entwurf === null) return;
        const roh = entwurf.trim();
        if (roh === '') return onSetzen('');
        const zahl = Number(roh);
        // Ein unbrauchbarer Wert wird verworfen und nicht gesendet: Der Server
        // wiese ihn mit einem Satz ab, und der stünde dann als Fehlermeldung
        // über einem Feld, in dem offensichtlich Unsinn steht.
        if (!Number.isFinite(zahl)) return setEntwurf(null);
        if (zahl !== wert) onSetzen(zahl);
      }}
      // `minWidth: 0` gegen die Mindestbreite, die Chrome einem Zahlenfeld
      // gibt: Ohne sie läuft es über seine Gitterspalte in die nächste hinein.
      style={{ ...B.feld, fontSize: 14, width: '100%', minWidth: 0, boxSizing: 'border-box' }}
    />
  );
}

const S = {
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: '14px 16px',
    border: `1px solid ${T.line}`,
    borderRadius: 8,
    marginTop: 24,
  },
  zeile: { display: 'flex', alignItems: 'center', gap: 12 },
  /**
   * Vier Zeilen zu fünf Spalten — als Gitter und nicht als Tabelle, damit die
   * Spalten bei schmalem Fenster umbrechen können statt zu schrumpfen.
   */
  gitter: {
    display: 'grid',
    gridTemplateColumns:
      '7rem minmax(12rem, 2fr) minmax(9rem, 1fr) minmax(8rem, 1fr) 6rem 7.5rem 7.5rem',
    gap: '10px 12px',
    alignItems: 'end',
    overflowX: 'auto' as const,
  },
} satisfies Record<string, React.CSSProperties>;
