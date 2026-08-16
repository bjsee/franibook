/**
 * Das Titelbild aus vielen kleinen Fotos.
 *
 * Ein eigenes Panel neben der Titelbildauswahl, weil es eine andere Frage
 * beantwortet: Dort wählt man **ein** Bild, hier beschreibt man, wie aus dem
 * ganzen Bestand eines gebaut wird. Beides nebeneinander in derselben Reihe
 * hätte ausgesehen, als wäre das Mosaik einer der Kandidaten.
 *
 * **Jeder Regler sendet erst beim Loslassen.** Ein Zug am Rasterregler löst
 * serverseitig einen Backvorgang aus — je nach Feinheit ein bis zehn Sekunden.
 * Ein `onChange` je Zwischenwert hieße vierzig Backvorgänge für eine
 * Handbewegung. Deshalb hält die Ansicht den Wert lokal, während gezogen wird,
 * und schickt ihn, wenn die Hand loslässt. Aus demselben Grund kein
 * `ausstehend`-Timer wie an den Ziehstellen der Doppelseite: Es gibt hier
 * nichts Verzögertes, das ein Cmd+Z vorziehen müsste.
 */
import { useEffect, useState } from 'react';
import {
  DEFAULT_COVER_MOSAIC,
  DEFAULT_MOSAIC_SETTINGS,
  FONT_FAMILIES,
  MAX_MOSAIC_COLS,
  MIN_MOSAIC_COLS,
  type CoverMosaic,
  type FontFamilyId,
} from '@franibook/core';
import type { Mosaikfortschritt, Umschlag } from './api.js';
import { Bildwahl } from './Bildwahl.js';
import { B, T } from './theme.js';

/** Welche Werte ein Regler stellt. */
type Reglerfeld = 'cols' | 'gap' | 'tint' | 'reuseCost';

/** Tasten, die einen Schieberegler bewegen — alle anderen lösen nichts aus. */
const BEWEGT = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Die Regler, die etwas an der Wirkung ändern — mit ihren Grenzen. */
const REGLER: {
  key: Reglerfeld;
  label: string;
  min: number;
  max: number;
  step: number;
  einheit: (v: number) => string;
  hinweis: string;
}[] = [
  {
    key: 'cols',
    label: 'Rasterweite',
    // Die Grenzen kommen aus dem Kern, damit Regler und Route dieselbe Zahl
    // kennen — sonst weist der Server ab, was der Regler noch zulässt.
    min: MIN_MOSAIC_COLS,
    max: MAX_MOSAIC_COLS,
    step: 1,
    einheit: (v: number) => `${v} Spalten`,
    hinweis: 'Wenige Spalten zeigen große, erkennbare Bilder — viele eine feinere Form.',
  },
  {
    key: 'gap',
    label: 'Fuge',
    min: 0,
    max: 0.3,
    step: 0.01,
    einheit: (v: number) => `${Math.round(v * 100)} %`,
    hinweis: 'Ohne Fuge verschmelzen die Kacheln, mit steht jede Aufnahme für sich.',
  },
  {
    key: 'tint',
    label: 'Einfärbung',
    min: 0,
    max: 1,
    step: 0.05,
    einheit: (v: number) => `${Math.round(v * 100)} %`,
    hinweis: 'Nur mit Zielbild: Ohne sie bleibt das Motiv im Bestandsfarbton stecken.',
  },
  {
    key: 'reuseCost',
    label: 'Vielfalt',
    min: 0,
    max: 6,
    step: 0.25,
    // Der eigene Zahlenwert des Reglers sagt niemandem etwas — er steht in
    // Lab-Einheiten. Was er bewirkt, steht daneben: wie viele der verfügbaren
    // Fotos tatsächlich vorkommen. Deshalb hier keine Einheit.
    einheit: () => '',
    hinweis:
      'Wie stark eine Wiederholung bestraft wird. Höher heißt mehr verschiedene Bilder — ' +
      'und jedes an einer etwas schlechter passenden Stelle.',
  },
];

export function CoverMosaik({
  data,
  onAendern,
  imageSrc,
  arbeit,
  laeuft = false,
}: {
  data: Umschlag;
  onAendern: (patch: { frontMosaic?: CoverMosaic }) => Promise<void>;
  imageSrc: (photoId: string) => string;
  /** Woran der Server gerade backt, sofern er schon geantwortet hat. */
  arbeit?: Mosaikfortschritt | null;
  /** Ob überhaupt gewartet wird — die erste Auskunft kommt einen Takt später. */
  laeuft?: boolean;
}) {
  const gesetzt = data.design.frontMosaic;
  /** Der Stand am Regler, während gezogen wird. Danach gilt wieder der Server. */
  const [entwurf, setEntwurf] = useState<CoverMosaic | null>(null);
  const wert = entwurf ?? gesetzt ?? DEFAULT_COVER_MOSAIC;

  // Ein Zurücknehmen oder ein Wechsel der Anweisung wirft den Entwurf weg —
  // sonst zeigte der Regler weiter, was gerade nicht mehr gilt.
  useEffect(() => setEntwurf(null), [gesetzt]);

  const senden = (patch: Partial<CoverMosaic>) => {
    const naechste = { ...wert, ...patch };
    setEntwurf(naechste);
    void onAendern({ frontMosaic: naechste });
  };

  /**
   * Einen Reglerwert senden — aber nur, wenn er sich geändert hat.
   *
   * `onPointerUp` feuert bei jedem Klick auf den Regler, auch auf den Daumen,
   * und `onKeyUp` bei jedem Pfeiltastendruck am Anschlag. Beides löste sonst
   * einen vollen Backvorgang aus: SVG rastern, cols×rows×Kandidaten
   * Farbabstände (am echten Bestand knapp zwei Millionen Vergleiche), Bild
   * zusammensetzen — sekundenlang, für nichts. Das Textfeld daneben hat
   * denselben Vergleich.
   */
  const sendeRegler = (key: Reglerfeld) => {
    const neu = zahl(wert, key);
    if (gesetzt && zahl(gesetzt, key) === neu) return;
    senden({ [key]: neu });
  };

  /**
   * Das Zielbild abwählen.
   *
   * Eigener Weg, weil `exactOptionalPropertyTypes` ein `photoId: undefined`
   * nicht als „weglassen" durchgehen lässt — es muss tatsächlich fehlen, sonst
   * steht im gespeicherten Projekt ein Feld ohne Wert.
   */
  const ohneZielbild = () => {
    const { photoId: _weg, ...rest } = wert;
    setEntwurf(rest);
    void onAendern({ frontMosaic: rest });
  };

  if (!gesetzt) {
    return (
      <div style={S.aus}>
        <div>
          <strong style={B.titel}>Titelbild aus vielen Fotos</strong>
          <p style={{ ...B.leiser, margin: '4px 0 0' }}>
            Eine Zahl oder ein Wort aus den Bildern des Bestands formen — oder ein Foto als Mosaik
            nachbauen lassen.
          </p>
        </div>
        <button
          onClick={() => void onAendern({ frontMosaic: { ...DEFAULT_COVER_MOSAIC, text: '18' } })}
          style={B.knopf}
        >
          Mosaik anlegen
        </button>
      </div>
    );
  }

  return (
    <div style={S.panel}>
      <div style={S.zeile}>
        <strong style={B.titel}>Titelbild aus vielen Fotos</strong>
        <span style={B.dehner} />
        {data.mosaik && (
          <span style={B.leiser}>
            {data.mosaik.kacheln} Kacheln aus {data.mosaik.fotos} Fotos ·{' '}
            {data.mosaik.druckBreitePx} × {data.mosaik.druckHoehePx} px im Druck
          </span>
        )}
        <button onClick={() => void onAendern({})} style={B.knopf} title="Zurück zum Einzelbild">
          Mosaik entfernen
        </button>
      </div>

      {/*
        Die Anzeige steht hier und nicht oben bei den Kennzahlen: Wer an einem
        Regler zieht, schaut auf den Regler. Eine Meldung am anderen Ende einer
        gescrollten Seite ist keine.
      */}
      {laeuft && <Fortschritt arbeit={arbeit} />}

      <div style={S.vorlage}>
        <label style={S.feldWrap}>
          <span style={B.marke}>Form</span>
          <input
            key={`text-${gesetzt.text ?? ''}`}
            defaultValue={gesetzt.text ?? ''}
            placeholder="z. B. 18 — leer lassen für ein Feld ohne Form"
            onBlur={(e) => {
              if (e.target.value !== (gesetzt.text ?? '')) senden({ text: e.target.value });
            }}
            style={{ ...B.feld, fontSize: 14 }}
          />
        </label>

        <label style={S.feldWrap}>
          <span style={B.marke}>Schrift der Form</span>
          <select
            value={wert.family ?? 'display'}
            onChange={(e) => senden({ family: e.target.value as FontFamilyId })}
            style={{ ...B.feld, fontSize: 14 }}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label style={S.feldWrap}>
          <span style={B.marke}>Kachelausschnitt</span>
          <select
            value={wert.crop ?? 'ganz'}
            onChange={(e) => senden({ crop: e.target.value === 'feld' ? 'feld' : 'ganz' })}
            style={{ ...B.feld, fontSize: 14 }}
          >
            <option value="ganz">Ganzes Bild — erkennbare Aufnahmen</option>
            <option value="feld">Passende Stelle — trifft die Farbe besser</option>
          </select>
        </label>
      </div>

      <div style={S.regler}>
        {REGLER.map((r) => (
          <label key={r.key} style={S.reglerWrap} title={r.hinweis}>
            <span style={B.marke}>
              {r.label} <span style={{ color: T.cyan }}>{r.einheit(zahl(wert, r.key))}</span>
              {/*
                Der Vielfaltsregler zeigt seine Wirkung statt seines Wertes:
                „674 von 971 Fotos" ist die Aussage, die man beim Ziehen sucht.
                Die Zahl stammt aus dem zuletzt gebauten Mosaik und zieht darum
                erst nach — das ist richtig so, sie beschreibt ein Ergebnis.
              */}
              {r.key === 'reuseCost' && data.mosaik && (
                <span style={{ color: T.cyan }}>
                  {data.mosaik.fotos} von {data.mosaik.verfuegbar} Fotos
                </span>
              )}
            </span>
            <input
              type="range"
              min={r.min}
              max={r.max}
              step={r.step}
              value={zahl(wert, r.key)}
              // Beim Ziehen nur die Anzeige, beim Loslassen der Backvorgang.
              onChange={(e) => setEntwurf({ ...wert, [r.key]: Number(e.target.value) })}
              onPointerUp={() => sendeRegler(r.key)}
              // Nur die Tasten, die einen Regler überhaupt bewegen. Ein rohes
              // `onKeyUp` löste auch beim Durchtabben einen Backvorgang aus —
              // Sekunden Arbeit für eine Taste, die nichts geändert hat.
              onKeyUp={(e) => {
                if (BEWEGT.has(e.key)) sendeRegler(r.key);
              }}
              style={{ width: '100%' }}
            />
          </label>
        ))}
      </div>

      <span style={B.marke}>Zielbild — sein Motiv wird aus Miniaturen nachgebaut</span>
      <div style={S.kandidaten}>
        <button
          onClick={ohneZielbild}
          style={{
            ...S.kandidat,
            ...S.ohne,
            borderColor: gesetzt.photoId ? T.line : T.cyan,
          }}
        >
          <span style={S.thumbLabel}>Ohne — nur die Form</span>
        </button>
        {data.candidates.map((c) => (
          <button
            key={c.photoId}
            onClick={() => senden({ photoId: c.photoId })}
            title={c.label}
            style={{
              ...S.kandidat,
              borderColor: c.photoId === gesetzt.photoId ? T.cyan : T.line,
            }}
          >
            <img src={imageSrc(c.photoId)} alt={c.label} style={S.thumb} />
            <span style={S.thumbLabel}>{c.label}</span>
          </button>
        ))}
      </div>
      <Bildwahl
        gewaehlt={gesetzt.photoId}
        onWaehlen={(photoId) => senden({ photoId })}
        knopf="Zielbild aus dem ganzen Bestand wählen"
      />
    </div>
  );
}

/**
 * Woran gerade gebacken wird.
 *
 * Der Balken erscheint nur, wo es zählbare Schritte gibt — Vorlage und
 * Zuordnung dauern Millisekunden, ein Balken, der sofort wieder verschwindet,
 * wäre Unruhe. Solange noch keine Auskunft da ist (der erste Takt läuft), steht
 * der allgemeine Satz: Es soll nie ein Augenblick geben, in dem nichts zu sehen
 * ist und trotzdem gerechnet wird.
 */
function Fortschritt({ arbeit }: { arbeit: Mosaikfortschritt | null | undefined }) {
  const anteil = arbeit && arbeit.gesamt > 0 ? arbeit.fertig / arbeit.gesamt : null;
  return (
    <div style={S.arbeit}>
      <span style={B.leise}>
        {arbeit?.phase ?? 'Baue das Titelmosaik'} …
        {anteil !== null && (
          <span style={{ color: T.fg3 }}>
            {' '}
            {arbeit!.fertig} von {arbeit!.gesamt} Kacheln
          </span>
        )}
      </span>
      <span style={S.bahn}>
        <span
          style={{
            ...S.balken,
            // Ohne zählbare Schritte kein Vortäuschen eines Standes: ein
            // schmaler Streifen sagt „läuft", eine Zahl wäre erfunden.
            width: anteil === null ? '12%' : `${Math.round(anteil * 100)}%`,
            opacity: anteil === null ? 0.5 : 1,
          }}
        />
      </span>
    </div>
  );
}

/**
 * Der Wert eines Reglers, mit der Vorgabe des Kerns als Rückfall.
 *
 * Die Vorgaben stehen in `DEFAULT_MOSAIC_SETTINGS` und werden hier gespiegelt,
 * damit der Regler auch dann etwas anzeigt, wenn im Projekt noch nichts steht.
 */
function zahl(m: CoverMosaic, key: Reglerfeld): number {
  const wert = m[key];
  if (typeof wert === 'number' && Number.isFinite(wert)) return wert;
  return VORGABEN[key];
}

const VORGABEN: Record<Reglerfeld, number> = {
  cols: DEFAULT_COVER_MOSAIC.cols,
  gap: DEFAULT_MOSAIC_SETTINGS.gap,
  tint: DEFAULT_MOSAIC_SETTINGS.tint,
  reuseCost: DEFAULT_MOSAIC_SETTINGS.reuseCost,
};

const S = {
  aus: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 16px',
    border: `1px solid ${T.line}`,
    borderRadius: 8,
    marginTop: 12,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    padding: '14px 16px',
    border: `1px solid ${T.line}`,
    borderRadius: 8,
    marginTop: 12,
  },
  zeile: { display: 'flex', alignItems: 'center', gap: 12 },
  arbeit: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  bahn: { display: 'block', height: 4, borderRadius: 2, background: T.bg3, overflow: 'hidden' },
  balken: {
    display: 'block',
    height: '100%',
    background: T.cyan,
    // Ohne Übergang springt der Balken bei jedem Takt; mit wirkt er stetig,
    // obwohl nur alle 700 ms eine Zahl ankommt.
    transition: 'width 0.4s linear',
  },
  vorlage: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  feldWrap: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  regler: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 12,
  },
  reglerWrap: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  kandidaten: { display: 'flex', gap: 8, overflowX: 'auto' as const, paddingBottom: 4 },
  kandidat: {
    flex: '0 0 auto',
    width: 104,
    padding: 4,
    border: '1px solid',
    borderRadius: 6,
    background: 'none',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  ohne: { justifyContent: 'center', minHeight: 92 },
  thumb: { width: '100%', height: 66, objectFit: 'cover' as const, borderRadius: 4 },
  thumbLabel: {
    fontSize: 11,
    color: T.fg3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};
