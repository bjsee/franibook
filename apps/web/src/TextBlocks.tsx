/**
 * Eigene Textblöcke auf einer Doppelseite.
 *
 * Alles, was das Buch sonst beschriftet, gehört einer Vorlage oder einer
 * Fotogruppe. Ein Textblock gehört niemandem: Er steht, wo man ihn hinsetzt.
 * Gedacht für das, was kein Automatismus wissen kann – eine Zeile zu einem
 * Bild, ein Zitat, ein Datum, das erzählt.
 *
 * Die Schrift ist die Buchschrift, wählbar sind ihre beiden Schnitte. Eine
 * zweite Familie hieße eine zweite Datei, und die Parität von Vorschau und PDF
 * hängt daran, dass beide Adapter dieselbe laden.
 *
 * **Die Farbe ist eine Palette und kein Farbwähler** (`TEXT_BLOCK_COLORS`) —
 * dieselbe Entscheidung wie beim Hintergrund. „Wie der Grund" bleibt die
 * Vorgabe und rechnet dunkel oder hell aus der Seitenfarbe; ein fester Ton gilt
 * dagegen unverändert, denn auf einem Hintergrundbild kennt keine Automatik das
 * Motiv. Genau dort kann man sich aber vergreifen, deshalb steht neben der
 * Wahl, was sie auf diesem Grund bedeutet.
 *
 * Verschoben und gedreht wird auf der Bühne, nicht hier: Diese Felder halten den
 * Text und seine Maße, die Lage bestimmt die Hand.
 */
import { useEffect, useRef, useState } from 'react';
import {
  FONT_FAMILIES,
  type FontFamilyId,
  fontFamily,
  luminance,
  TEXT_BLOCK_COLORS,
  textColorOn,
  TEXT_DEFAULT_COLOR,
} from '@franibook/core';
import { fehlertext, textAendern, textErstellen, textLoeschen } from './api.js';
import { planeSofort } from './ausstehend.js';
import { B, T } from './theme.js';

/**
 * Verzögerung, bis ein Reglerwert zum Server geht.
 *
 * Derselbe Wert wie beim Ausschnitt im Editor – der Griff soll sich anfühlen
 * wie dort.
 */
const SENDE_VERZOEGERUNG_MS = 250;

export interface TextBlockData {
  id: string;
  content: string;
  rect: { x: number; y: number; w: number; h: number };
  family?: FontFamilyId;
  weight: 'regular' | 'semibold';
  fontSizePt: number;
  align: 'left' | 'center' | 'right';
  color?: string;
  rotateDeg?: number;
}

interface Props {
  index: number;
  blocks: readonly TextBlockData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Nach jeder Änderung: die neu gerenderte Doppelseite. */
  onSpread: (spread: unknown) => void;
  onFehler: (text: string) => void;
  /** Farbe, auf der der Text steht – für die Vorschau der Farbfelder. */
  grund: string;
  /** Ob ein Bild dahinterliegt: Dann sagt die Farbe des Grundes nichts. */
  bildDahinter: boolean;
}

export function TextBlocks({
  index,
  blocks,
  selectedId,
  onSelect,
  onSpread,
  onFehler,
  grund,
  bildDahinter,
}: Props) {
  const gewaehlt = blocks.find((b) => b.id === selectedId);
  /**
   * Der Text, solange er getippt wird.
   *
   * Jeder Tastendruck als Anfrage wäre ein Schreibvorgang auf das ganze
   * Projekt-JSON. Gespeichert wird beim Verlassen des Feldes – wie bei den
   * Jahresereignissen.
   */
  const [entwurf, setEntwurf] = useState<string | null>(null);
  /**
   * Winkel und Größe, solange sie noch nicht beim Server sind.
   *
   * Ein Regler feuert je Pixel Reglerweg ein Ereignis. Jedes davon war eine
   * Anfrage und ein Schreibvorgang auf ein Projekt von 760 kB – der Server ist
   * daran erstickt. Gesendet wird deshalb verzögert, gezeigt sofort.
   */
  const [regler, setRegler] = useState<{ rotateDeg?: number; fontSizePt?: number } | null>(null);
  const sendeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Abmeldung bei `planeSofort` für den gerade laufenden Timer, falls einer läuft. */
  const sendeAbmelden = useRef<(() => void) | null>(null);

  useEffect(() => {
    setEntwurf(null);
    setRegler(null);
    // Ein Timer, der noch auf den vorher gewählten Block zielt, darf nach dem
    // Wechsel nicht mehr feuern – und muss sich bei `planeSofort` abmelden,
    // sonst wartete ein Cmd+Z auf einen Schreibvorgang, der nie mehr kommt.
    if (sendeTimer.current) clearTimeout(sendeTimer.current);
    sendeTimer.current = null;
    sendeAbmelden.current?.();
    sendeAbmelden.current = null;
  }, [selectedId]);

  /** Ein Aufruf mit der Doppelseite als Antwort – und einer Meldung im Fehlerfall. */
  async function ruf<T extends { spread?: unknown }>(
    tun: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const data = await tun();
      if (data.spread) onSpread(data.spread);
      return data;
    } catch (e) {
      onFehler(`Der Textblock ließ sich nicht ändern: ${fehlertext(e)}`);
      return undefined;
    }
  }

  async function anlegen() {
    const data = await ruf(() => textErstellen(index, {}));
    if (data?.block?.id) onSelect(data.block.id);
  }

  async function aendern(patch: Partial<Omit<TextBlockData, 'id'>>) {
    if (!gewaehlt) return;
    await ruf(() => textAendern(index, gewaehlt.id, patch));
  }

  /**
   * Reglerwert übernehmen: sofort anzeigen, verzögert senden.
   *
   * Der Timer wird bei jeder Bewegung neu gesetzt, es geht also genau eine
   * Anfrage heraus – die mit dem Wert, bei dem die Hand stehen geblieben ist.
   */
  function reglerSetzen(patch: { rotateDeg?: number; fontSizePt?: number }) {
    setRegler((r) => ({ ...r, ...patch }));
    if (sendeTimer.current) clearTimeout(sendeTimer.current);
    sendeAbmelden.current?.();

    const senden = async () => {
      sendeTimer.current = null;
      sendeAbmelden.current = null;
      await aendern(patch);
      setRegler(null);
    };
    sendeTimer.current = setTimeout(() => void senden(), SENDE_VERZOEGERUNG_MS);
    // Cmd+Z zieht den Schreibvorgang vor: Sonst nähme der Server den Stand von
    // vor der Bewegung zurück, und dieser Schreibvorgang stellte sie danach
    // wieder her – dasselbe Muster wie in `useSpreadEditor.ts`.
    sendeAbmelden.current = planeSofort(async () => {
      if (sendeTimer.current) clearTimeout(sendeTimer.current);
      await senden();
    });
  }

  async function entfernen() {
    if (!gewaehlt) return;
    await ruf(() => textLoeschen(index, gewaehlt.id));
    onSelect(null);
  }

  return (
    <>
      <button onClick={() => void anlegen()} style={S.breit}>
        Text hinzufügen
      </button>

      {blocks.length === 0 ? (
        <span style={B.leiser}>
          Für das, was kein Automatismus weiß — eine Zeile zum Bild, ein Zitat, ein Datum.
        </span>
      ) : (
        <div style={S.chips}>
          {blocks.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelect(b.id === selectedId ? null : b.id)}
              title={b.content || '(leer)'}
              style={b.id === selectedId ? B.chipAn : B.chip}
            >
              {b.content.split('\n')[0]?.slice(0, 18) || '(leer)'}
            </button>
          ))}
        </div>
      )}

      {gewaehlt && (
        <div style={S.felder}>
          <textarea
            value={entwurf ?? gewaehlt.content}
            onChange={(e) => setEntwurf(e.target.value)}
            onBlur={() => {
              if (entwurf !== null && entwurf !== gewaehlt.content)
                void aendern({ content: entwurf });
              setEntwurf(null);
            }}
            rows={2}
            placeholder="Text — Zeilenumbrüche bleiben erhalten"
            style={S.feld}
          />

          <div style={S.zeile}>
            <label style={{ ...B.haken, flex: 1 }}>
              Größe
              <input
                type="number"
                min={5}
                max={200}
                step={0.5}
                value={regler?.fontSizePt ?? gewaehlt.fontSizePt}
                onChange={(e) => reglerSetzen({ fontSizePt: Number(e.target.value) })}
                style={S.zahl}
              />
              pt
            </label>
            <label style={{ ...B.haken, flex: 1 }}>
              Satz
              <select
                value={gewaehlt.align}
                onChange={(e) =>
                  void aendern({ align: e.target.value as 'left' | 'center' | 'right' })
                }
                style={S.auswahl}
              >
                <option value="left">links</option>
                <option value="center">zentriert</option>
                <option value="right">rechts</option>
              </select>
            </label>
          </div>

          <label style={B.haken}>
            Schrift
            <select
              value={gewaehlt.family ?? 'sans'}
              onChange={(e) => void aendern({ family: e.target.value as FontFamilyId })}
              style={{
                ...S.auswahl,
                flex: 1,
                fontFamily: fontFamily(gewaehlt.family ?? 'sans').cssName,
              }}
            >
              {FONT_FAMILIES.map((f) => (
                // Jeder Eintrag in seiner eigenen Schrift: Namen wie „Serife"
                // sagen weniger als ein Blick.
                <option key={f.id} value={f.id} style={{ fontFamily: f.cssName }}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          {/* Nur zeigen, wo es etwas zu wählen gibt – Abril hat einen Schnitt. */}
          {fontFamily(gewaehlt.family ?? 'sans').weights.length > 1 && (
            <label style={B.haken}>
              Schnitt
              <select
                value={gewaehlt.weight}
                onChange={(e) => void aendern({ weight: e.target.value as 'regular' | 'semibold' })}
                style={{ ...S.auswahl, flex: 1 }}
              >
                <option value="regular">normal</option>
                <option value="semibold">halbfett</option>
              </select>
            </label>
          )}

          {/*
            Der Winkel als Regler und als Zahl: Der Regler ist zum Suchen, die
            Zahl zum Treffen — 90° stellt man nicht mit der Maus ein.
          */}
          <label style={B.haken} title="Drehung im Uhrzeigersinn">
            Drehung
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={regler?.rotateDeg ?? gewaehlt.rotateDeg ?? 0}
              onChange={(e) => reglerSetzen({ rotateDeg: Number(e.target.value) })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <input
              type="number"
              min={0}
              max={359}
              step={1}
              value={regler?.rotateDeg ?? gewaehlt.rotateDeg ?? 0}
              onChange={(e) => reglerSetzen({ rotateDeg: Number(e.target.value) })}
              style={S.zahl}
            />
            °
          </label>

          <div>
            <span style={B.leiser}>Farbe</span>
            <div style={S.farbreihe}>
              {TEXT_BLOCK_COLORS.filter((f) => f.value !== 'auto').map((f) => (
                <button
                  key={f.value}
                  title={f.label}
                  onClick={() => void aendern({ color: f.value })}
                  style={{
                    ...S.farbfeld,
                    background: f.value,
                    ...(gewaehlt.color?.toLowerCase() === f.value.toLowerCase()
                      ? S.farbfeldAn
                      : {}),
                  }}
                />
              ))}
              <button
                onClick={() => void aendern({ color: '' })}
                style={gewaehlt.color ? B.knopfKlein : { ...B.knopfKlein, borderColor: T.cyan }}
                title="Dunkel oder hell, je nach Grund der Doppelseite"
              >
                wie der Grund
              </button>
            </div>
            {/*
              Was die Wahl auf diesem Grund bedeutet. Über einem Hintergrundbild
              ist die Aussage keine: Gerechnet würde gegen die Farbe darunter,
              und die verdeckt das Motiv.
            */}
            {bildDahinter ? (
              <p style={B.leiser}>Über einem Hintergrundbild — die Lesbarkeit sagt das Motiv.</p>
            ) : (
              kontrastsatz(gewaehlt.color, grund) && (
                <p style={B.warnung}>{kontrastsatz(gewaehlt.color, grund)}</p>
              )
            )}
          </div>

          <button onClick={() => void entfernen()} style={{ ...B.knopfWeg, textAlign: 'left' }}>
            Textblock entfernen
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Warnt, wenn Text und Grund zu nah beieinanderliegen.
 *
 * Der Kontrastwert nach WCAG, Schwelle 3:1 — das ist die Grenze für großen
 * Text, und ein Textblock ist selten klein. Keine Sperre, sondern ein Satz: Wer
 * eine Zeile bewusst nur angedeutet setzen will, darf das.
 */
function kontrastsatz(farbe: string | undefined, grund: string): string | null {
  const text = farbe ?? textColorOn(grund, TEXT_DEFAULT_COLOR);
  const hell = Math.max(luminance(text), luminance(grund));
  const dunkel = Math.min(luminance(text), luminance(grund));
  const kontrast = (hell + 0.05) / (dunkel + 0.05);
  if (kontrast >= 3) return null;
  return `Kontrast ${kontrast.toFixed(1)}:1 gegen den Grund — im Druck kaum zu lesen.`;
}

const S = {
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
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  farbreihe: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    margin: '4px 0 2px',
  },
  farbfeld: {
    width: 22,
    height: 22,
    padding: 0,
    border: `1px solid ${T.line2}`,
    borderRadius: T.rSm,
    cursor: 'pointer',
  },
  farbfeldAn: { borderColor: T.cyan, boxShadow: `0 0 0 2px ${T.cyanZart}` },
  felder: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    paddingTop: 10,
    borderTop: `1px solid ${T.line}`,
  },
  zeile: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  feld: {
    font: 'inherit',
    fontSize: 13,
    padding: '8px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    resize: 'vertical' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  zahl: {
    width: '4.2rem',
    font: 'inherit',
    fontSize: 13,
    padding: '6px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
  },
  auswahl: {
    font: 'inherit',
    fontSize: 13,
    padding: '6px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    minWidth: 0,
  },
} satisfies Record<string, React.CSSProperties>;
