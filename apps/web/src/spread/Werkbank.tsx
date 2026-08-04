/**
 * Variante 1b — die Seite groß, die Werkzeuge schwebend.
 *
 * Der Gegenentwurf zum Inspektor: Statt einer festen Spalte, die immer ein Drittel
 * der Breite kostet, liegt eine Pillenleiste über dem unteren Rand der Bühne und
 * öffnet je Bedarf ein Panel. Dafür steht links dauerhaft das ganze Buch als
 * Kachelbaum nach Jahren — man blättert nicht mehr, man springt.
 *
 * Der Handel ist bewusst: mehr Fläche für das Papier, aber jeder Griff einen Klick
 * weiter weg. Ob das beim Durcharbeiten von achtzig Doppelseiten trägt, entscheidet
 * sich am Gebrauch und nicht am Entwurf — deshalb steht die Variante neben den
 * anderen zwei und nicht statt ihnen.
 */
import { useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';
import { B, T, dpiFarbe } from '../theme.js';
import { BackgroundPicker } from '../BackgroundPicker.js';
import { TemplatePicker } from '../TemplatePicker.js';
import { TextBlocks, type TextBlockData } from '../TextBlocks.js';
import { Fotopool, poolZahl } from './Fotopool.js';
import { SpreadStage } from './SpreadStage.js';
import { DATUMSQUELLE, zeitpunkt } from './SpreadStage.js';
import { miniaturSrc } from './useNachbarn.js';
import { useSpreadTiles } from './useSpreadTiles.js';
import { ZOOM_SCHRITT, type SpreadEditorModel } from './useSpreadEditor.js';
import { Vorlagentexte } from './Vorlagentexte.js';
import type { SpreadAussen } from './types.js';

/**
 * Breite einer Kachel im Buchnavigator.
 *
 * Gemessen und nicht gewählt: In der 232 Pixel breiten Spalte bleiben nach
 * Polsterung 193 Pixel Inhalt, und zwei Kacheln samt Rahmen, Innenabstand und
 * Lücke müssen darin liegen. Bei 92 waren es vier Pixel zu viel, und der
 * Navigator zeigte achtzig Kacheln in achtzig Reihen.
 */
const NAVI_KACHEL = 88;

type Panel = 'anordnung' | 'hintergrund' | 'text' | 'blatt' | null;

interface Props {
  model: SpreadEditorModel;
  aussen: SpreadAussen;
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  imageSrc: (photoId: string) => string;
}

export function Werkbank({ model, aussen, spread, imageSrc }: Props) {
  const [panel, setPanel] = useState<Panel>(null);

  const bilder = spread.boxes.filter((b) => b.kind === 'image').length;
  const zuKlein = spread.boxes.filter(
    (b) => b.kind === 'image' && b.warnings.some((w) => w.code === 'below-min-dpi'),
  ).length;
  const gruppe = aussen.gruppen.find((g) => g.active);

  return (
    <div style={S.wrap}>
      <Buchnavigator aussen={aussen} version={model.buchVersion} />

      <div style={S.mitte}>
        <div style={S.kopf}>
          <span style={S.zaehler}>
            {aussen.index + 1} / {aussen.spreadCount}
          </span>
          <span style={B.leise}>
            {gruppe ? gruppe.title : aussen.jahr !== undefined ? String(aussen.jahr) : '—'} ·{' '}
            {bilder} {bilder === 1 ? 'Foto' : 'Fotos'}
          </span>
          {zuKlein > 0 && (
            <span style={S.warnChip}>
              {zuKlein === 1 ? '1 Bild' : `${zuKlein} Bilder`} zu klein für ihren Platz
            </span>
          )}
          <span style={B.dehner} />
          <label style={B.haken} title="Diese Doppelseite beim Neuanordnen unverändert lassen">
            <input
              type="checkbox"
              checked={aussen.locked}
              onChange={(e) => aussen.onLocked(e.target.checked)}
            />
            festgehalten
          </label>
        </div>

        <div ref={model.platzRef} style={S.buehnenPlatz}>
          <SpreadStage model={model} imageSrc={imageSrc} guides={aussen.guides} />
        </div>

        {/*
          Die Leiste schwebt über dem unteren Rand der Bühne statt an ihr zu
          kleben: So bleibt sie an derselben Stelle, wie hoch das Blatt auch
          steht, und verdeckt nur den Bereich, in dem bei fast jeder Vorlage
          Hintergrund liegt.
        */}
        <div style={S.leiste}>
          <button
            onClick={() => aussen.onIndex(Math.max(0, aussen.index - 1))}
            disabled={aussen.index === 0}
            style={S.rund}
            title="Eine Doppelseite zurück"
          >
            ←
          </button>
          <button
            onClick={() => aussen.onIndex(Math.min(aussen.spreadCount - 1, aussen.index + 1))}
            disabled={aussen.index >= aussen.spreadCount - 1}
            style={S.rund}
            title="Eine Doppelseite weiter"
          >
            →
          </button>
          <span style={S.strich} />
          {(
            [
              ['ausschnitt', 'Ausschnitt'],
              ['position', 'Position'],
            ] as const
          ).map(([wert, text]) => (
            <button
              key={wert}
              onClick={() => model.setWerkzeug(wert)}
              style={model.werkzeug === wert ? B.pilleAn : B.pilleAus}
            >
              {text}
            </button>
          ))}
          <span style={S.strich} />
          {(
            [
              ['anordnung', 'Anordnung'],
              ['hintergrund', 'Hintergrund'],
              ['text', 'Text'],
              ['blatt', 'Blatt'],
            ] as const
          ).map(([wert, text]) => (
            <button
              key={wert}
              onClick={() => setPanel((p) => (p === wert ? null : wert))}
              style={panel === wert ? B.pilleAn : B.pilleAus}
            >
              {text}
            </button>
          ))}
          <span style={S.strich} />
          <button
            onClick={() =>
              aussen.onGuides(
                aussen.guides.trim
                  ? {}
                  : { trim: true, safety: true, gutter: true, diagnostics: true },
              )
            }
            style={aussen.guides.trim ? B.pilleAn : B.pilleAus}
            title="Hilfslinien ein- und ausblenden (g)"
          >
            Hilfslinien
          </button>
          <button
            onClick={() => model.setInfosSichtbar(!model.infosSichtbar)}
            style={model.infosSichtbar ? B.pilleAn : B.pilleAus}
            title="Aufnahmezeit und Ort über den Bildern (i)"
          >
            Bildinfos
          </button>
        </div>

        {model.gewaehlteBox && <BildKarte model={model} />}
        {panel && (
          <SeitenKarte
            panel={panel}
            model={model}
            aussen={aussen}
            spread={spread}
            onSchliessen={() => setPanel(null)}
          />
        )}

        <div
          style={{ ...S.fuss, ...(model.poolIstZiel ? S.fussZiel : {}) }}
          onDragOver={model.poolAblage.onDragOver}
          onDrop={model.poolAblage.onDrop}
        >
          <div style={S.fussKopf}>
            <span style={B.marke}>Fotopool</span>
            <span style={B.leiser}>{poolZahl(model.pool)}</span>
            <span style={B.leiser}>Hierher ziehen nimmt ein Bild aus dem Buch.</span>
          </div>
          <div style={S.fussGitter}>
            <Fotopool model={model} hoehe={84} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Das ganze Buch als Kachelbaum, nach Jahrgängen.
 *
 * Was der Nachbarstreifen des Inspektors nicht kann: zu einer Stelle springen,
 * die zwanzig Seiten weit weg ist, ohne über die Übersicht zu gehen. Geladen wird
 * wie in der Übersicht nur, was in Sichtweite kommt.
 */
function Buchnavigator({ aussen, version }: { aussen: SpreadAussen; version: number }) {
  const { containerRef, geladen } = useSpreadTiles(aussen.spreadCount, version);

  /**
   * Zu welchem Jahrgang eine Doppelseite gehört.
   *
   * Die Kapitel nennen nur ihre erste Doppelseite; alles dahinter gehört dazu,
   * bis das nächste anfängt. Seiten vor dem ersten Kapitel — Auftakte, selbst
   * eingefügte Blätter — bekommen keinen Kopf und stehen oben für sich.
   */
  const bloecke: { year: number | null; photoCount: number; von: number; bis: number }[] = [];
  const kapitel = [...aussen.chapters].sort((a, b) => a.firstSpreadIndex - b.firstSpreadIndex);
  if (kapitel.length === 0 || (kapitel[0]?.firstSpreadIndex ?? 0) > 0) {
    bloecke.push({
      year: null,
      photoCount: 0,
      von: 0,
      bis: kapitel[0]?.firstSpreadIndex ?? aussen.spreadCount,
    });
  }
  kapitel.forEach((c, k) => {
    bloecke.push({
      year: c.year,
      photoCount: c.photoCount,
      von: c.firstSpreadIndex,
      bis: kapitel[k + 1]?.firstSpreadIndex ?? aussen.spreadCount,
    });
  });

  return (
    <aside style={S.navi}>
      <div style={S.naviKopf}>
        <strong style={{ ...B.titel, fontSize: 17 }}>Franibook</strong>
        <p style={B.leiser}>
          {aussen.spreadCount} Doppelseiten · {aussen.spreadCount * 2} Seiten
        </p>
      </div>
      <div ref={containerRef} style={S.naviListe}>
        {bloecke.map((blk) => (
          <div key={`${blk.year ?? 'vorn'}-${blk.von}`} style={{ marginBottom: 10 }}>
            <div style={S.naviJahr}>
              <span style={{ ...B.zahl, fontSize: 15 }}>{blk.year ?? 'vorn'}</span>
              {blk.photoCount > 0 && <span style={S.naviZahl}>{blk.photoCount}</span>}
            </div>
            <div style={S.naviGitter}>
              {Array.from({ length: Math.max(0, blk.bis - blk.von) }, (_, k) => {
                const i = blk.von + k;
                const spread = geladen.get(i);
                return (
                  <button
                    key={i}
                    data-index={i}
                    onClick={() => aussen.onIndex(i)}
                    title={`Doppelseite ${i + 1}`}
                    style={{
                      ...S.naviKachel,
                      ...(i === aussen.index ? { borderColor: T.cyan } : {}),
                    }}
                  >
                    {spread ? (
                      <SpreadView
                        spread={spread}
                        widthPx={NAVI_KACHEL}
                        imageSrc={miniaturSrc}
                        guides={{}}
                      />
                    ) : (
                      <span style={S.naviPlatzhalter} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Das ausgewählte Bild als schwebende Karte, oben rechts über der Bühne. */
function BildKarte({ model }: { model: SpreadEditorModel }) {
  const box = model.gewaehlteBox;
  if (!box) return null;
  const info = model.infoVon(box.photoId);
  const dpi = Math.round(box.effectiveDpi);
  const farbe = dpiFarbe(dpi, model.minDpi, model.targetDpi);

  return (
    <div style={S.karte}>
      <div style={S.karteKopf}>
        <strong style={{ ...B.dateiname, ...S.kurz }}>{info?.fileName ?? box.slotId}</strong>
        <button onClick={model.auswahlAufheben} style={S.x} title="Auswahl aufheben">
          ×
        </button>
      </div>
      <p style={B.leiser}>
        {info ? (zeitpunkt(info) ?? 'ohne Datum') : '…'}
        {info && info.dateSource !== 'exif' && ` · ${DATUMSQUELLE[info.dateSource] ?? ''}`}
        <br />
        {info?.place?.label ?? 'ohne Ortsangabe'}
        {info?.camera && ` · ${info.camera}`}
      </p>

      <div style={S.dpiZeile}>
        <span style={{ ...B.zahl, fontSize: 15, color: farbe }}>{dpi} dpi</span>
        <span style={S.balken}>
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              borderRadius: 2,
              width: `${Math.min(100, (dpi / model.targetDpi) * 100)}%`,
              background: farbe,
            }}
          />
        </span>
      </div>

      {model.werkzeug === 'ausschnitt' ? (
        <div style={S.paar}>
          <button onClick={() => model.zoomen(ZOOM_SCHRITT)} style={S.halb}>
            Näher
          </button>
          <button onClick={() => model.zoomen(1 / ZOOM_SCHRITT)} style={S.halb}>
            Weiter
          </button>
          <button onClick={() => void model.ausschnittZuruecksetzen()} style={S.halb}>
            auto
          </button>
        </div>
      ) : (
        <div style={S.paar}>
          <button onClick={() => void model.groesseAendern(1 / ZOOM_SCHRITT)} style={S.halb}>
            Größer
          </button>
          <button onClick={() => void model.groesseAendern(ZOOM_SCHRITT)} style={S.halb}>
            Kleiner
          </button>
          <button
            onClick={() => void model.insRaster()}
            disabled={!model.istFreiGesetzt}
            style={S.halb}
          >
            Raster
          </button>
        </div>
      )}

      <label style={{ ...B.haken, fontSize: 12, marginTop: 12 }}>
        Neigung
        <input
          type="range"
          min={-model.neigungGrenze}
          max={model.neigungGrenze}
          step={0.1}
          value={model.neigungGesperrt ? 0 : model.aktuelleNeigung}
          disabled={model.neigungGesperrt}
          onChange={(e) => model.setPendingTilt(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={S.gradWert}>
          {model.neigungGesperrt ? '—' : `${model.aktuelleNeigung.toFixed(1).replace('.', ',')}°`}
        </span>
      </label>

      <div style={{ ...S.paar, marginTop: 12 }}>
        <button onClick={() => void model.ausDemBuch()} style={S.halb}>
          aus dem Buch
        </button>
        <button
          onClick={() => void model.loeschen(box.photoId, model.dateiname(box.photoId), true)}
          style={{ ...S.halb, borderColor: T.fehlerRand, color: T.fehler }}
          title="Legt die Datei in den Papierkorb ihrer Bildquelle."
        >
          aussortieren
        </button>
      </div>
    </div>
  );
}

/** Anordnung, Hintergrund, Text oder das Blatt – je nachdem, welche Pille offen ist. */
function SeitenKarte({
  panel,
  model,
  aussen,
  spread,
  onSchliessen,
}: {
  panel: Exclude<Panel, null>;
  model: SpreadEditorModel;
  aussen: SpreadAussen;
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  onSchliessen: () => void;
}) {
  const titel = {
    anordnung: 'Anordnung',
    hintergrund: 'Hintergrund',
    text: 'Text',
    blatt: 'Blatt im Buch',
  }[panel];

  return (
    <div style={S.karteUnten}>
      <div style={S.karteKopf}>
        <strong style={B.marke}>{titel}</strong>
        <button onClick={onSchliessen} style={S.x} title="Schließen">
          ×
        </button>
      </div>

      {panel === 'anordnung' && (
        <TemplatePicker
          index={aussen.index}
          photoCount={spread.boxes.filter((b) => b.kind === 'image').length}
          version={model.buchVersion}
          onFehler={model.setNote}
          onApplied={({ spread: neu }) => model.anordnungUebernommen(neu as RenderedSpread)}
        />
      )}

      {panel === 'hintergrund' && (
        <>
          <BackgroundPicker
            spreadIndex={aussen.index}
            global={aussen.hintergrundGlobal}
            aktuell={spread.background}
            onChanged={aussen.onNeuRendern}
          />
          {aussen.zeitstrahlGlobal && (
            <label style={{ ...B.haken, marginTop: 12 }} title="Gilt nur für diese Doppelseite">
              <input
                type="checkbox"
                checked={aussen.hatZeitstrahl}
                onChange={(e) => aussen.onZeitstrahl(e.target.checked ? null : false)}
              />
              Zeitstrahl auf dieser Seite
            </label>
          )}
        </>
      )}

      {panel === 'text' && (
        <>
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
              if (id) model.auswahlAufheben();
            }}
            onSpread={(neu) => model.spreadGeaendert(neu as RenderedSpread)}
            onFehler={model.setNote}
          />
        </>
      )}

      {panel === 'blatt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={S.paar}>
            <button onClick={() => aussen.onEinfuegen(aussen.index)} style={S.halb}>
              ＋ Seite davor
            </button>
            <button onClick={() => aussen.onEinfuegen(aussen.index + 1)} style={S.halb}>
              ＋ Seite danach
            </button>
          </div>
          <div style={S.paar}>
            {aussen.splittable && (
              <>
                <button
                  onClick={() => aussen.onSeiteLoeschen('left')}
                  style={{ ...S.halb, borderColor: T.fehlerRand, color: T.fehler }}
                >
                  links löschen
                </button>
                <button
                  onClick={() => aussen.onSeiteLoeschen('right')}
                  style={{ ...S.halb, borderColor: T.fehlerRand, color: T.fehler }}
                >
                  rechts löschen
                </button>
              </>
            )}
            <button
              onClick={aussen.onSpreadLoeschen}
              disabled={aussen.spreadCount <= 1}
              style={{ ...S.halb, borderColor: T.fehlerRand, color: T.fehler }}
            >
              ganze Doppelseite
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: { flex: 1, display: 'flex', minHeight: 0 },
  navi: {
    width: 232,
    flexShrink: 0,
    background: T.bg1,
    borderRight: `1px solid ${T.line}`,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  naviKopf: { padding: 16, borderBottom: `1px solid ${T.line}` },
  naviListe: { flex: 1, overflowY: 'auto' as const, padding: '10px 12px 20px' },
  naviJahr: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '4px 4px 6px',
  },
  naviZahl: { fontSize: 11, color: T.fg4, fontVariantNumeric: 'tabular-nums' as const },
  naviGitter: { display: 'flex', flexWrap: 'wrap' as const, gap: 5 },
  naviKachel: {
    padding: 1,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    cursor: 'pointer',
    lineHeight: 0,
  },
  naviPlatzhalter: {
    display: 'block',
    width: NAVI_KACHEL,
    height: NAVI_KACHEL / 2,
    background: T.bg3,
  },

  mitte: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 20px',
    height: 52,
    borderBottom: `1px solid ${T.line}`,
    background: T.bg1,
    flexShrink: 0,
  },
  zaehler: {
    fontFamily: T.display,
    fontSize: 16,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  warnChip: {
    fontSize: 12,
    color: T.fehler,
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: T.rPill,
    padding: '3px 10px',
  },
  buehnenPlatz: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px 28px 74px',
    minHeight: 0,
    background: T.bg3,
  },
  leiste: {
    position: 'absolute' as const,
    left: '50%',
    bottom: 122,
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rPill,
    padding: '7px 10px',
    boxShadow: T.schattenSchwebend,
    zIndex: 10,
    flexWrap: 'wrap' as const,
    maxWidth: 'calc(100% - 48px)',
    justifyContent: 'center',
  },
  rund: {
    width: 30,
    height: 30,
    border: 'none',
    borderRadius: T.rPill,
    background: T.bg3,
    color: T.fg1,
    cursor: 'pointer',
    fontSize: 14,
  },
  strich: { width: 1, height: 22, background: T.line, margin: '0 4px' },

  karte: {
    position: 'absolute' as const,
    right: 24,
    top: 76,
    width: 268,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: T.schattenSchwebend,
    padding: 16,
    zIndex: 12,
  },
  karteUnten: {
    position: 'absolute' as const,
    left: '50%',
    bottom: 170,
    transform: 'translateX(-50%)',
    width: 'min(560px, calc(100% - 48px))',
    maxHeight: '46vh',
    overflowY: 'auto' as const,
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: T.schattenSchwebend,
    padding: 16,
    zIndex: 11,
  },
  karteKopf: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  kurz: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  x: {
    font: 'inherit',
    fontSize: 14,
    color: T.fg3,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
  },
  dpiZeile: { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' },
  balken: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: T.line,
    position: 'relative' as const,
  },
  paar: { display: 'flex', gap: 6 },
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
  gradWert: {
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: '2.8rem',
    textAlign: 'right' as const,
  },

  fuss: {
    height: 106,
    flexShrink: 0,
    background: T.bg1,
    borderTop: `1px solid ${T.line}`,
    padding: '10px 20px',
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
  },
  fussZiel: { background: T.cyanZart, borderTopColor: T.cyan },
  /** Breit genug für „Hierher ziehen nimmt ein Bild aus dem Buch." in zwei Zeilen. */
  fussKopf: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    width: 210,
    flexShrink: 0,
  },
  fussGitter: { flex: 1, minWidth: 0 },
} satisfies Record<string, React.CSSProperties>;
