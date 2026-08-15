/**
 * Variante 1c — die Seite fast allein.
 *
 * Dunkler Grund, ein Filmstreifen zum Blättern, sonst nichts. Was man braucht,
 * kommt auf Tastendruck und verschwindet wieder: <kbd>g</kbd> Hilfslinien,
 * <kbd>i</kbd> Bildinfos, <kbd>p</kbd> Fotopool, <kbd>a</kbd> Anordnung. Ein
 * ausgewähltes Bild bringt seine Werkzeuge als schmale Leiste mit.
 *
 * Der dunkle Grund ist keine Stimmung, sondern eine Messhilfe: Ein hellgrauer
 * Rahmen um ein Foto verschiebt, wie man seine Helligkeit einschätzt. Zum
 * Durchsehen des ganzen Buches ist das die ehrlichere Umgebung — zum Arbeiten an
 * Rändern und Auflösungen die unbequemere, weil jeder Griff einen Tastendruck
 * kostet.
 *
 * Die Kommandopalette aus dem Entwurf (<kbd>⌘K</kbd> „alles andere") fehlt: Die
 * Reiter der Kopfzeile stehen in allen drei Varianten, damit ein Wechsel keine
 * Ansicht unerreichbar macht — damit hätte sie nichts zu tun, was die Reiter
 * nicht schon tun.
 */
import { useEffect, useState } from 'react';
import { imageBoxes } from '@franibook/core';
import type { RenderedSpread } from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';
import { B, T, dpiFarbe } from '../theme.js';
import { TemplatePicker } from '../TemplatePicker.js';
import type { TextBlockData } from '../TextBlocks.js';
import { Bildanpassung } from './Bildanpassung.js';
import { Bilddaten } from './Bilddaten.js';
import { Bildbefunde } from './Bildbefunde.js';
import { Ebene } from './Ebene.js';
import { Fotopool, poolZahl } from './Fotopool.js';
import { SpreadStage, zeitpunkt } from './SpreadStage.js';
import { useNachbarn } from './useNachbarn.js';
import { useMiniaturSrc } from '../bildadresse.js';
import { ZOOM_SCHRITT, type SpreadEditorModel } from './useSpreadEditor.js';
import type { SpreadAussen } from './types.js';

/** Breite einer Kachel im Filmstreifen. */
const FILM_KACHEL = 132;

interface Props {
  model: SpreadEditorModel;
  aussen: SpreadAussen;
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  imageSrc: (photoId: string) => string;
}

export function Lesetisch({ model, aussen, spread, imageSrc }: Props) {
  const [blatt, setBlatt] = useState<'pool' | 'anordnung' | null>(null);

  // `p` und `a` öffnen die beiden Blätter, `Esc` schließt sie. Dieselbe Prüfung
  // auf Eingabefelder wie beim `i` im Editor: In einem Textfeld ist ein `p` ein
  // Buchstabe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'p') setBlatt((b) => (b === 'pool' ? null : 'pool'));
      if (e.key === 'a') setBlatt((b) => (b === 'anordnung' ? null : 'anordnung'));
      if (e.key === 'Escape') setBlatt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const zuKlein = spread.boxes.filter(
    (b) => b.kind === 'image' && b.warnings.some((w) => w.code === 'below-min-dpi'),
  ).length;
  // Wie in der Werkbank: nur die Zahl. Welches Bild betroffen ist, sagt das
  // Panel des Inspektors — der Lesetisch ist zum Durchsehen da, nicht zum
  // Nachbessern.
  const amRand = spread.boxes.filter(
    (b) => b.kind === 'image' && b.warnings.some((w) => w.code === 'face-at-edge'),
  ).length;
  const gruppe = aussen.gruppen.find((g) => g.active);

  return (
    <div style={S.wrap}>
      <div style={S.kopf}>
        <span style={S.marke}>
          {aussen.jahr ?? '—'}
          {gruppe && ` · ${gruppe.title}`}
        </span>
        <span style={B.dehner} />
        {zuKlein > 0 && (
          <span style={S.warnChip}>{zuKlein === 1 ? '1 Bild' : `${zuKlein} Bilder`} zu klein</span>
        )}
        {amRand > 0 && (
          <span style={S.warnChip} title="Im Beschnitt oder in der Falzzone">
            {amRand === 1 ? '1 Gesicht' : `${amRand} Gesichter`} am Rand
          </span>
        )}
        <label style={S.hakenDunkel} title="Diese Doppelseite beim Neuanordnen unverändert lassen">
          <input
            type="checkbox"
            checked={aussen.locked}
            onChange={(e) => aussen.onLocked(e.target.checked)}
          />
          festgehalten
        </label>
        <span style={S.zaehler}>
          {aussen.index + 1} / {aussen.spreadCount}
        </span>
      </div>

      <div ref={model.platzRef} style={S.buehnenPlatz}>
        <SpreadStage model={model} imageSrc={imageSrc} guides={aussen.guides} />
      </div>

      <Filmstreifen model={model} aussen={aussen} />

      <div style={S.tasten}>
        <span style={S.taste}>
          <kbd style={S.kbd}>←</kbd> <kbd style={S.kbd}>→</kbd> blättern
        </span>
        <span style={S.taste}>
          <kbd style={S.kbd}>g</kbd> Hilfslinien
        </span>
        <span style={S.taste}>
          <kbd style={S.kbd}>i</kbd> Bildinfos
        </span>
        <span style={S.taste}>
          <kbd style={S.kbd}>p</kbd> Fotopool
        </span>
        <span style={S.taste}>
          <kbd style={S.kbd}>a</kbd> Anordnung
        </span>
        <span style={S.taste}>
          <kbd style={S.kbd}>Esc</kbd> schließt
        </span>
      </div>

      {model.gewaehlteBox && <BildLeiste model={model} />}

      {blatt === 'pool' && (
        <div
          style={S.blatt}
          onDragOver={model.poolAblage.onDragOver}
          onDrop={model.poolAblage.onDrop}
        >
          <div style={S.blattKopf}>
            <span style={B.marke}>Fotopool</span>
            <span style={B.leiser}>{poolZahl(model.pool)}</span>
            <span style={B.dehner} />
            <button onClick={() => setBlatt(null)} style={S.x}>
              ×
            </button>
          </div>
          <Fotopool model={model} hoehe={180} />
        </div>
      )}

      {blatt === 'anordnung' && (
        <div style={S.blatt}>
          <div style={S.blattKopf}>
            <span style={B.marke}>Anordnung</span>
            <span style={B.dehner} />
            <button onClick={() => setBlatt(null)} style={S.x}>
              ×
            </button>
          </div>
          <TemplatePicker
            index={aussen.index}
            photoCount={imageBoxes(spread).length}
            version={model.buchVersion}
            onFehler={model.setNote}
            onApplied={({ spread: neu }) => model.anordnungUebernommen(neu as RenderedSpread)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Drei Seiten in jede Richtung, die aufgeschlagene in der Mitte.
 *
 * Anders als der Nachbarstreifen des Inspektors ist er kein Ablageziel: Am
 * Lesetisch sieht man durch, man hängt nicht um. Deshalb keine Rahmen und keine
 * Nummern — nur die Helligkeit unterscheidet, was gerade offen ist.
 */
function Filmstreifen({ model, aussen }: { model: SpreadEditorModel; aussen: SpreadAussen }) {
  const { nachbarn, geladen } = useNachbarn(aussen.index, aussen.spreadCount, 3, model.buchVersion);
  const miniaturSrc = useMiniaturSrc();

  return (
    <div style={S.film}>
      {nachbarn.map((i) => {
        const spread = geladen.get(i);
        const hier = i === aussen.index;
        return (
          <div
            key={i}
            onClick={() => !hier && aussen.onIndex(i)}
            title={`Doppelseite ${i + 1}`}
            style={{
              ...S.filmKachel,
              cursor: hier ? 'default' : 'pointer',
              background: hier ? 'var(--warm-50)' : 'transparent',
              opacity: hier ? 1 : 0.55,
            }}
          >
            {spread ? (
              <SpreadView
                spread={spread}
                widthPx={FILM_KACHEL}
                imageSrc={miniaturSrc}
                guides={{}}
              />
            ) : (
              <span style={S.filmPlatzhalter} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Die Werkzeuge des ausgewählten Bildes als eine Zeile über der Bühne. */
function BildLeiste({ model }: { model: SpreadEditorModel }) {
  const box = model.gewaehlteBox;
  if (!box) return null;
  const info = model.infoVon(box.photoId);
  const dpi = Math.round(box.effectiveDpi);

  return (
    <div style={S.leiste}>
      <strong style={B.dateiname}>{info?.fileName ?? box.slotId}</strong>
      <span
        style={{
          ...B.zahl,
          fontSize: 14,
          whiteSpace: 'nowrap',
          color: dpiFarbe(dpi, model.minDpi, model.targetDpi),
        }}
      >
        {dpi} dpi
      </span>
      <span style={{ fontSize: 12, color: T.fg3 }}>
        {info ? (zeitpunkt(info) ?? 'ohne Datum') : '…'}
      </span>
      <Bilddaten model={model} />
      <Bildanpassung model={model} />
      <Bildbefunde model={model} />
      <span style={B.trenner} />
      {/*
        Kein Umschalter mehr: Ob das Ziehen den Ausschnitt oder den Kasten
        bewegt, sagt am Bild der Ort des Griffs. Die Zoomknöpfe bleiben, weil
        die im Bild an kleinen Plätzen ausbleiben — dort verdeckten sie mehr,
        als sie wert sind.
      */}
      <button
        onClick={() => model.zoomen(ZOOM_SCHRITT)}
        style={B.pilleAus}
        title="Ausschnitt enger fassen (+)"
      >
        +
      </button>
      <button
        onClick={() => model.zoomen(1 / ZOOM_SCHRITT)}
        style={B.pilleAus}
        title="Mehr vom Bild zeigen (−)"
      >
        −
      </button>
      <span style={B.trenner} />
      <input
        type="range"
        min={-model.neigungGrenze}
        max={model.neigungGrenze}
        step={0.1}
        value={model.neigungGesperrt ? 0 : model.aktuelleNeigung}
        disabled={model.neigungGesperrt}
        onChange={(e) => model.setPendingTilt(Number(e.target.value))}
        style={{ width: 84 }}
        title="Neigung"
      />
      <span style={S.grad}>
        {model.neigungGesperrt ? '—' : `${model.aktuelleNeigung.toFixed(1).replace('.', ',')}°`}
      </span>
      <Ebene model={model} variante="leiste" />
      <span style={B.trenner} />
      <button onClick={model.auswahlAufheben} style={S.rundKlein} title="Auswahl aufheben (Esc)">
        ×
      </button>
    </div>
  );
}

const S = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    background: 'var(--warm-900)',
    position: 'relative' as const,
  },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '0 24px',
    height: 48,
    flexShrink: 0,
  },
  marke: { fontSize: 13, color: 'var(--warm-400)' },
  zaehler: {
    fontSize: 12,
    color: 'var(--warm-400)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  warnChip: {
    fontSize: 12,
    color: 'var(--warm-50)',
    background: T.fehler,
    borderRadius: T.rPill,
    padding: '3px 10px',
  },
  hakenDunkel: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 12,
    color: 'var(--warm-400)',
    cursor: 'pointer',
  },
  buehnenPlatz: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 40px 0',
    minHeight: 0,
  },
  film: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
    padding: '14px 0',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  filmKachel: { padding: 2, borderRadius: T.rSm, lineHeight: 0 },
  filmPlatzhalter: {
    display: 'block',
    width: FILM_KACHEL,
    height: FILM_KACHEL / 2,
    background: 'var(--warm-700)',
  },
  tasten: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingBottom: 18,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  taste: { fontSize: 12, color: 'var(--warm-400)' },
  kbd: {
    borderColor: 'var(--warm-700)',
    background: 'var(--warm-700)',
    color: 'var(--warm-50)',
  },
  leiste: {
    position: 'absolute' as const,
    left: '50%',
    top: 60,
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--warm-50)',
    borderRadius: T.rPill,
    padding: '8px 8px 8px 16px',
    boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
    zIndex: 12,
    maxWidth: 'calc(100% - 48px)',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  },
  grad: {
    fontFamily: T.display,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums' as const,
    color: T.fg2,
    minWidth: '2.8rem',
    textAlign: 'right' as const,
  },
  rundKlein: {
    width: 26,
    height: 26,
    border: 'none',
    borderRadius: T.rPill,
    background: T.bg3,
    color: T.fg2,
    cursor: 'pointer',
    fontSize: 13,
    flexShrink: 0,
  },
  blatt: {
    position: 'absolute' as const,
    left: '50%',
    bottom: 24,
    transform: 'translateX(-50%)',
    width: 'min(720px, calc(100% - 48px))',
    maxHeight: '52vh',
    overflowY: 'auto' as const,
    background: T.bg1,
    borderRadius: T.rLg,
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    padding: 16,
    zIndex: 13,
  },
  blattKopf: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  x: {
    font: 'inherit',
    fontSize: 14,
    color: T.fg3,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
} satisfies Record<string, React.CSSProperties>;
