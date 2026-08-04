/**
 * Alles zur Doppelseite, wenn kein Bild ausgewählt ist.
 *
 * Dieselbe Spalte wie beim Bild, andere Fragen: *wie sind die Bilder verteilt?*
 * (Anordnung), *worauf liegen sie?* (Hintergrund, Zeitstrahl), *was steht darauf
 * und wie viele Seiten sind es?* (Text, Seiten einfügen und löschen).
 *
 * Die drei Griffe am Buchgerüst — einfügen, löschen, festhalten — stehen absichtlich
 * hier unten und nicht bei den Bildwerkzeugen: Sie ändern nicht die Doppelseite,
 * sondern ihren Platz im Buch. „Festgehalten" ist der einzige davon, der über der
 * Bühne steht, weil man ihn beim Durchblättern setzt.
 */
import type { RenderedSpread } from '@franibook/core';
import { B, T } from '../theme.js';
import { BackgroundPicker } from '../BackgroundPicker.js';
import { TemplatePicker } from '../TemplatePicker.js';
import { TextBlocks, type TextBlockData } from '../TextBlocks.js';
import type { SpreadAussen } from './types.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';
import { Vorlagentexte } from './Vorlagentexte.js';

interface Props {
  model: SpreadEditorModel;
  aussen: SpreadAussen;
  spread: RenderedSpread & { blocks?: TextBlockData[] };
}

export function SeitenPanel({ model, aussen, spread }: Props) {
  const bilder = spread.boxes.filter((b) => b.kind === 'image').length;
  const gruppen = aussen.gruppen.filter((g) => g.active);

  return (
    <>
      <div style={{ ...B.abschnitt, gap: 4 }}>
        <strong style={B.titel}>Doppelseite {aussen.index + 1}</strong>
        <p style={B.leise}>
          {bilder} {bilder === 1 ? 'Foto' : 'Fotos'}
          {gruppen.length > 0 && ` · ${gruppen.map((g) => g.title).join(', ')}`}
        </p>
        <p style={{ ...B.leiser, marginTop: 6 }}>
          Klick auf ein Bild öffnet hier seine Werkzeuge. Ein nicht ausgewähltes Bild lässt sich in
          einen anderen Platz ziehen — ist der belegt, tauschen die beiden.
        </p>
      </div>

      <div style={B.abschnitt}>
        <span style={B.marke}>Anordnung</span>
        <TemplatePicker
          index={aussen.index}
          photoCount={bilder}
          version={model.buchVersion}
          onFehler={model.setNote}
          onApplied={({ spread: neu, leftover }) => {
            model.anordnungUebernommen(neu as RenderedSpread);
            model.setNote(
              leftover.length === 0
                ? null
                : `${leftover.length} ${leftover.length === 1 ? 'Bild liegt' : 'Bilder liegen'} ` +
                    `jetzt im Fotopool — die neue Anordnung hat weniger Plätze`,
            );
          }}
        />
      </div>

      <div style={B.abschnitt}>
        <span style={B.marke}>Hintergrund</span>
        <BackgroundPicker
          spreadIndex={aussen.index}
          global={aussen.hintergrundGlobal}
          aktuell={spread.background}
          onChanged={aussen.onNeuRendern}
        />
        {/*
          Der Zeitstrahl steht hier und nicht bei den Buchgriffen, weil er auf der
          Seite liegt wie der Hintergrund: eine Darstellungssache, die keine
          Handarbeit verwirft. Nur zu sehen, wenn er überhaupt eingeschaltet ist —
          sonst schaltete man eine Ausnahme von etwas, das es nicht gibt.
        */}
        {aussen.zeitstrahlGlobal && (
          <label style={B.haken} title="Gilt nur für diese Doppelseite">
            <input
              type="checkbox"
              checked={aussen.hatZeitstrahl}
              onChange={(e) => aussen.onZeitstrahl(e.target.checked ? null : false)}
            />
            Zeitstrahl auf dieser Seite
          </label>
        )}
      </div>

      <div style={{ ...B.abschnitt, borderBottom: 'none' }}>
        <span style={B.marke}>Text &amp; Seiten</span>
        <Vorlagentexte
          index={aussen.index}
          model={model}
          onSpread={(neu) => model.spreadGeaendert(neu)}
          onFehler={model.setNote}
        />
        <TextBlocks
          index={aussen.index}
          blocks={spread.blocks ?? []}
          selectedId={model.textId}
          onSelect={(id) => {
            model.setTextId(id);
            // Beide Auswahlen zugleich wären zwei Werkzeuge auf denselben Tasten.
            if (id) model.auswahlAufheben();
          }}
          onSpread={(neu) => model.spreadGeaendert(neu as RenderedSpread)}
          onFehler={model.setNote}
        />

        <div style={S.paar}>
          <button
            onClick={() => aussen.onEinfuegen(aussen.index)}
            style={S.halb}
            title="Eigene Doppelseite vor dieser einfügen"
          >
            ＋ Seite davor
          </button>
          <button
            onClick={() => aussen.onEinfuegen(aussen.index + 1)}
            style={S.halb}
            title="Eigene Doppelseite hinter dieser einfügen"
          >
            ＋ Seite danach
          </button>
        </div>

        {/*
          Drei Griffe, weil es drei verschiedene Eingriffe sind: eine einzelne
          Buchseite (alles dahinter rückt auf) oder das ganze Blatt. Bei einem
          Auftakt oder justierten Zeilen gibt es keine einzelne Seite — dort steht
          nur der letzte Knopf. Zugeklappt, weil man sie selten braucht und weil
          ein aufgeklappter roter Dreiklang die ganze Spalte beherrschte.
        */}
        <details>
          <summary style={S.summary}>Seiten löschen</summary>
          <div style={{ ...S.paar, marginTop: 8 }}>
            {aussen.splittable && (
              <>
                <button
                  onClick={() => aussen.onSeiteLoeschen('left')}
                  style={S.halbWeg}
                  title="Nur die linke Buchseite herausnehmen. Alles dahinter rückt eine Seite auf."
                >
                  links
                </button>
                <button
                  onClick={() => aussen.onSeiteLoeschen('right')}
                  style={S.halbWeg}
                  title="Nur die rechte Buchseite herausnehmen. Alles dahinter rückt eine Seite auf."
                >
                  rechts
                </button>
              </>
            )}
            <button
              onClick={aussen.onSpreadLoeschen}
              disabled={aussen.spreadCount <= 1}
              style={S.halbWeg}
              title="Die ganze Doppelseite aus dem Buch nehmen. Die Bilder gehen in den Fotopool."
            >
              ganze Doppelseite
            </button>
          </div>
        </details>
      </div>
    </>
  );
}

const S = {
  paar: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  halb: {
    flex: 1,
    font: 'inherit',
    fontSize: 12,
    padding: '7px 0',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg2,
    cursor: 'pointer',
  },
  halbWeg: {
    flex: 1,
    font: 'inherit',
    fontSize: 12,
    padding: '7px 0',
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fehler,
    cursor: 'pointer',
  },
  summary: { fontSize: 12, color: T.fehler, cursor: 'pointer' },
} satisfies Record<string, React.CSSProperties>;
