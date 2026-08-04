/**
 * Variante 1a — die Werkzeuge folgen der Auswahl.
 *
 * Eine feste Spalte rechts, deren Inhalt sich mit der Auswahl austauscht: ein Bild
 * gewählt heißt Ausschnitt, Neigung, Aussortieren; nichts gewählt heißt Anordnung,
 * Hintergrund, Text und Seiten. Vorher standen dieselben Griffe als Leiste über der
 * Bühne und sprangen bei jedem Klick um — bei zwölf Knöpfen in einer Zeile war nach
 * jedem Auswahlwechsel neu zu suchen, wo etwas hingerutscht ist.
 *
 * Über der Bühne bleibt nur, was die ganze Doppelseite betrifft: blättern, ihre
 * Gruppen, festhalten, Hilfslinien und Bildinfos.
 */
import { useState } from 'react';
import type { GuideVisibility } from '@franibook/render-dom';
import type { RenderedSpread } from '@franibook/core';
import { B, MASSE, T } from '../theme.js';
import type { TextBlockData } from '../TextBlocks.js';
import { BildPanel } from './BildPanel.js';
import { Fotopool, poolZahl } from './Fotopool.js';
import { Nachbarn } from './Nachbarn.js';
import { SeitenPanel } from './SeitenPanel.js';
import { SpreadStage } from './SpreadStage.js';
import type { SpreadAussen } from './types.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

interface Props {
  model: SpreadEditorModel;
  aussen: SpreadAussen;
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  imageSrc: (photoId: string) => string;
}

export function Inspektor({ model, aussen, spread, imageSrc }: Props) {
  return (
    <div style={S.wrap}>
      <div style={S.mitte}>
        <div style={S.kopf}>
          <button
            onClick={() => aussen.onIndex(Math.max(0, aussen.index - 1))}
            disabled={aussen.index === 0}
            style={S.pfeil}
            title="Eine Doppelseite zurück"
          >
            ←
          </button>
          <span style={S.zaehler}>
            {aussen.index + 1} / {aussen.spreadCount}
          </span>
          <button
            onClick={() => aussen.onIndex(Math.min(aussen.spreadCount - 1, aussen.index + 1))}
            disabled={aussen.index >= aussen.spreadCount - 1}
            style={S.pfeil}
            title="Eine Doppelseite weiter"
          >
            →
          </button>
          {aussen.jahr !== undefined && <span style={B.leise}>{aussen.jahr}</span>}

          <SpreadGruppen aussen={aussen} />

          <span style={B.dehner} />

          <label style={B.haken} title="Diese Doppelseite beim Neuanordnen unverändert lassen">
            <input
              type="checkbox"
              checked={aussen.locked}
              onChange={(e) => aussen.onLocked(e.target.checked)}
            />
            festgehalten
          </label>
          <Hilfslinien guides={aussen.guides} onGuides={aussen.onGuides} />
          <button
            onClick={() => model.setInfosSichtbar(!model.infosSichtbar)}
            style={model.infosSichtbar ? B.knopfAn : B.knopf}
            title="Aufnahmezeit und Ort über den Bildern (i)"
          >
            Bildinfos
          </button>
        </div>

        <div ref={model.platzRef} style={S.buehnenPlatz}>
          <SpreadStage model={model} imageSrc={imageSrc} guides={aussen.guides} />
        </div>

        {/*
          Nachbarn und Fotopool teilen den Fuß, weil sie dieselbe Frage
          beantworten: Wohin gehört dieses Bild, wenn nicht hierhin? Der Pool ist
          zugeklappt, solange man ihn nicht braucht — 42 bis 830 Kacheln sind
          sonst der lauteste Teil der Ansicht.
        */}
        <div
          style={S.fuss}
          onDragOver={model.poolAblage.onDragOver}
          onDrop={model.poolAblage.onDrop}
        >
          <div style={S.fussKopf}>
            <span style={B.marke}>Nachbarn</span>
            <span style={B.dehner} />
            <button
              onClick={() => model.setPoolOffen(!model.poolOffen)}
              style={model.poolOffen ? B.knopfAn : B.knopf}
            >
              {model.poolOffen ? 'Fotopool schließen' : 'Fotopool öffnen'}
            </button>
            <span style={{ ...B.leiser, ...(model.poolIstZiel ? { color: T.cyanTief } : {}) }}>
              {model.poolIstZiel ? 'hierher ziehen nimmt es aus dem Buch' : poolZahl(model.pool)}
            </span>
          </div>
          <div style={S.fussReihe}>
            <Nachbarn
              index={aussen.index}
              spreadCount={aussen.spreadCount}
              zieht={model.zug !== null}
              version={model.buchVersion}
              onOpen={aussen.onIndex}
              onDrop={(ziel) => {
                if (!model.zug) return;
                void model.verschieben(model.zug.source, { kind: 'spread', spreadIndex: ziel });
                model.setZug(null);
              }}
            />
            {model.poolOffen && (
              <div style={S.poolSpalte}>
                <Fotopool model={model} hoehe={92} />
              </div>
            )}
          </div>
        </div>
      </div>

      <aside style={S.spalte}>
        {model.gewaehlteBox ? (
          <BildPanel model={model} />
        ) : model.selectedSlotId ? (
          <div style={{ ...B.abschnitt, borderBottom: 'none' }}>
            <strong style={B.titel}>Leerer Platz {model.selectedSlotId}</strong>
            <p style={B.leiser}>
              Ein Bild aus dem Fotopool anklicken oder hierher ziehen. <kbd>Esc</kbd> hebt die
              Auswahl auf.
            </p>
          </div>
        ) : (
          <SeitenPanel model={model} aussen={aussen} spread={spread} />
        )}
      </aside>
    </div>
  );
}

/**
 * Die Gruppen dieser Doppelseite als Sprungmarken.
 *
 * Die erste aktive Gruppe ist die, deren Titel im Zeitstrahl steht – dieselbe
 * Rangfolge wie dort: die mit den meisten Fotos. Abgeschaltete Gruppen stehen
 * blass daneben; sie gliedern das Buch nicht, erklären aber, wohin die Bilder
 * gehören.
 */
function SpreadGruppen({ aussen }: { aussen: SpreadAussen }) {
  if (aussen.gruppen.length === 0) return null;
  const beschriftend = aussen.gruppen.find((g) => g.active);

  return (
    <>
      {aussen.gruppen.map((g) => (
        <button
          key={g.id}
          onClick={() => aussen.onGruppeOeffnen(g.id)}
          title={
            (g.active
              ? g.id === beschriftend?.id
                ? 'Steht im Zeitstrahl dieser Doppelseite'
                : 'Gliedert das Buch'
              : 'Abgeschaltet — gliedert das Buch nicht') +
            ` · ${g.count} ${g.count === 1 ? 'Foto' : 'Fotos'} hier · in der Gruppenansicht öffnen`
          }
          style={{
            ...(g.id === beschriftend?.id ? B.chipAn : B.chip),
            ...(g.active ? {} : { opacity: 0.6 }),
          }}
        >
          {g.active ? '' : '○ '}
          {g.title} ↗
        </button>
      ))}
    </>
  );
}

/** Was die vier Hilfslinien im Einzelnen sind. */
const LINIEN = [
  ['trim', 'Endformat'],
  ['safety', 'Sicherheit'],
  ['gutter', 'Falz'],
  ['diagnostics', 'Diagnose'],
] as const;

/**
 * Ein Umschalter für alle Hilfslinien, dahinter die vier einzeln.
 *
 * Die Taste `g` schaltet seit je alles auf einmal, und so benutzt man sie auch:
 * Linien an, um die Ränder zu prüfen, Linien aus, um die Seite zu sehen. Die
 * vier einzelnen Schalter braucht man selten und dann gezielt — deshalb hinter
 * einem Klapper und nicht als vier Kästchen in der Leiste.
 */
function Hilfslinien({
  guides,
  onGuides,
}: {
  guides: GuideVisibility;
  onGuides: (g: GuideVisibility) => void;
}) {
  const [offen, setOffen] = useState(false);
  const an = LINIEN.some(([k]) => guides[k]);

  return (
    <span style={S.linienWrap}>
      <button
        onClick={() =>
          onGuides(an ? {} : { trim: true, safety: true, gutter: true, diagnostics: true })
        }
        style={{
          ...(an ? B.knopfAn : B.knopf),
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        }}
        title="Hilfslinien ein- und ausblenden (g)"
      >
        Hilfslinien
      </button>
      <button
        onClick={() => setOffen((o) => !o)}
        style={{
          ...(an ? B.knopfAn : B.knopf),
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: 'none',
          padding: '7px 8px',
        }}
        title="Einzelne Linien wählen"
      >
        ⌄
      </button>
      {offen && (
        <div style={S.linienPanel}>
          {LINIEN.map(([k, text]) => (
            <label key={k} style={B.haken}>
              <input
                type="checkbox"
                checked={guides[k] ?? false}
                onChange={(e) => onGuides({ ...guides, [k]: e.target.checked })}
              />
              {text}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}

const S = {
  wrap: { flex: 1, display: 'flex', minHeight: 0 },
  mitte: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    background: T.bg3,
  },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 24px 0',
    flexWrap: 'wrap' as const,
  },
  pfeil: {
    width: 30,
    height: 30,
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
  },
  zaehler: {
    fontFamily: T.display,
    fontSize: 15,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 96,
    textAlign: 'center' as const,
  },
  buehnenPlatz: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 24px',
    minHeight: 0,
  },
  fuss: {
    borderTop: `1px solid ${T.line}`,
    background: T.bg1,
    padding: '10px 24px 12px',
    flexShrink: 0,
  },
  fussKopf: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  fussReihe: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  poolSpalte: {
    flex: 1,
    minWidth: 0,
    borderLeft: `1px solid ${T.line}`,
    paddingLeft: 14,
    marginLeft: 4,
  },
  spalte: {
    width: MASSE.spalte,
    flexShrink: 0,
    background: T.bg1,
    borderLeft: `1px solid ${T.line}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflowY: 'auto' as const,
  },
  linienWrap: { position: 'relative' as const, display: 'flex' },
  linienPanel: {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: 12,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: T.schattenSchwebend,
  },
} satisfies Record<string, React.CSSProperties>;
