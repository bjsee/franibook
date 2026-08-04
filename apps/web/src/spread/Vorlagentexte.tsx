/**
 * Die Texte, die aus der Vorlage kommen: Jahreszahl, Überschrift, Ereignisse.
 *
 * Ein eigener Abschnitt neben den Textblöcken und nicht in ihrer Liste, obwohl
 * beide inzwischen dieselben Gesten kennen: Diese hier hat das Buch hingeschrieben,
 * jene hat jemand hingesetzt. Der Unterschied ist keine Kleinigkeit, denn er sagt,
 * was ein Neuaufbau mitnimmt – ein Vorlagentext kommt zurück, ein Block nicht.
 *
 * Wenige Felder, mit Absicht. Wortlaut und Zurücksetzen stehen hier; Platz, Größe
 * und Winkel zieht man an den Griffen am Text selbst, weil die Hand dann dort ist,
 * wo das Ergebnis entsteht. Schrift und Farbe fehlen ganz: Sie sind Aussagen über
 * das Buch (`TEXT_STYLES`), nicht über diese Seite – wer sie braucht, nimmt einen
 * Textblock.
 *
 * Die Auswahl teilt der Abschnitt mit der Bühne (`model.textId`): Was hier im Feld
 * steht, trägt dort den Auswahlrahmen.
 */
import { useEffect, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { fehlertext, vorlagentextAendern } from '../api.js';
import { B, T } from '../theme.js';
import { textName } from './bewegtext.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

interface Props {
  index: number;
  model: SpreadEditorModel;
  onSpread: (spread: RenderedSpread) => void;
  onFehler: (text: string | null) => void;
}

export function Vorlagentexte({ index, model, onSpread, onFehler }: Props) {
  const plaetze = model.texte.filter((t) => t.art === 'platz');
  const gewaehlt = plaetze.find((t) => t.id === model.textId);

  /**
   * Der Wortlaut, solange er getippt wird.
   *
   * Wie bei den Textblöcken: Jeder Tastendruck als Anfrage wäre ein Schreibvorgang
   * auf das ganze Projekt-JSON. Gespeichert wird beim Verlassen des Feldes.
   */
  const [entwurf, setEntwurf] = useState<string | null>(null);
  useEffect(() => setEntwurf(null), [model.textId]);

  if (plaetze.length === 0) return null;

  async function aendern(patch: {
    content?: string;
    rect?: null;
    rotateDeg?: null;
  }): Promise<void> {
    if (!gewaehlt) return;
    try {
      const data = await vorlagentextAendern(index, gewaehlt.id, patch);
      if (data.spread) onSpread(data.spread as RenderedSpread);
    } catch (e) {
      onFehler(`Der Text ließ sich nicht ändern: ${fehlertext(e)}`);
    }
  }

  const bewegt =
    gewaehlt?.element?.rect !== undefined || gewaehlt?.element?.rotateDeg !== undefined;

  return (
    <div style={S.rahmen}>
      <span style={B.marke}>Aus der Vorlage</span>

      <div style={S.chips}>
        {plaetze.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              const neu = t.id === model.textId ? null : t.id;
              model.setTextId(neu);
              // Beide Auswahlen zugleich wären zwei Werkzeuge auf denselben Tasten.
              if (neu) model.auswahlAufheben();
            }}
            title={t.content || '(leer)'}
            style={t.id === model.textId ? B.chipAn : B.chip}
          >
            {textName(t).slice(0, 18)}
          </button>
        ))}
      </div>

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
            placeholder="Wortlaut — Zeilenumbrüche bleiben erhalten"
            style={S.feld}
          />
          <p style={B.leiser}>
            Größe, Platz und Winkel zieht man an den Griffen am Text. Die Höhe des Kastens ist die
            Schriftgröße.
          </p>
          {/*
            Nur zu sehen, wenn es etwas zurückzustellen gibt – sonst wäre der Knopf
            eine Behauptung über Handarbeit, die niemand gemacht hat.
          */}
          {bewegt && (
            <button
              onClick={() => void aendern({ rect: null, rotateDeg: null })}
              style={S.zurueck}
              title="Platz, Größe und Winkel wieder aus der Vorlage nehmen"
            >
              Zurück auf den Platz der Vorlage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  rahmen: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  felder: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    paddingTop: 8,
    borderTop: `1px solid ${T.line}`,
  },
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
  zurueck: {
    font: 'inherit',
    fontSize: 13,
    padding: '8px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
} satisfies Record<string, React.CSSProperties>;
