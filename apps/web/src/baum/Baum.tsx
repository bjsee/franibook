/**
 * Die Aufteilung als Baum: Jahr → Doppelseite → Bilder.
 *
 * Sie beantwortet die zwei Fragen, an denen das Verteilen bisher hing. **Wo
 * gehört dieses Bild hin?** — der Nachbarstreifen in der Doppelseite reicht zwei
 * Seiten weit, und das JSON zeigte nur Dateinamen; hier ist jede Seite des
 * Buches ein Ziel, das man sieht. **Wo ist das Buch schief?** — dass Seite 12
 * acht Bilder trägt und Seite 13 vier, steht sonst nirgends nebeneinander.
 *
 * Deshalb Zeilen und keine Kacheln: Eine gerenderte Miniatur zeigt die
 * *Gestalt* der Seite, aber auf 248 px erkennt man nicht, *welches* Bild das
 * ist. Die Übersicht bleibt für die Gestalt zuständig, der Baum für den Inhalt.
 *
 * Das Ausklappen ist ein Werkzeug, keine Ordnung: Vorgabe ist alles offen, und
 * Jahrgänge klappt man zu, um Seite 3 und Seite 60 nebeneinanderzubekommen.
 * Monat und Segment sind bewusst **keine** dritte Ebene — sie schnitten die
 * Seiten, statt sie zu gliedern —, und die Fotogruppe ist eine Marke an der
 * Zeile, weil sie quer zu den Doppelseiten liegt.
 */
import { useEffect, useMemo, useState } from 'react';
import { dragBild } from '@franibook/render-dom';
import { type BaumSeite, type PoolFoto } from '../api.js';
import { Link, type Route } from '../router.js';
import { B, T } from '../theme.js';
import {
  BILD_AUS,
  BILD_MAX,
  BILD_MIN,
  bildgroesseLesen,
  bildgroesseMerken,
  zugeklappteLesen,
  zugeklappteMerken,
} from './merken.js';
import { type Herkunft, useBaum } from './useBaum.js';

interface Props {
  /** Fassung der Vorschauen, damit eine gedrehte Datei sichtbar wird. */
  bildVersion: number;
  standVersion: number;
  /** Das Buch hat sich geändert – Kennzahlen und gerenderte Seiten gelten nicht weiter. */
  onChanged: () => void;
  onNavigieren: (ziel: Route) => void;
}

export function Baum({ bildVersion, standVersion, onChanged, onNavigieren }: Props) {
  const model = useBaum(standVersion, onChanged);
  const [px, setPx] = useState(bildgroesseLesen);
  const [zu, setZu] = useState<Set<number>>(zugeklappteLesen);

  // Gemerkt wird bei jeder Änderung, nicht beim Verlassen: Ein Reiterwechsel
  // hängt die Ansicht aus, und ein Aufräumeffekt liefe dann mit dem Zustand von
  // vorher.
  useEffect(() => zugeklappteMerken(zu), [zu]);

  /** Die Seiten in Jahrgängen, in Buchreihenfolge. */
  const jahrgaenge = useMemo(() => gruppiereNachJahr(model.seiten), [model.seiten]);

  const bilderAn = px >= BILD_MIN;

  /** Die Jahrgänge, die sich zuklappen lassen – Seiten ohne Jahr gehören keinem. */
  const alleJahre = useMemo(
    () => jahrgaenge.map((j) => j.jahr).filter((j): j is number => j !== undefined),
    [jahrgaenge],
  );
  const etwasOffen = alleJahre.some((j) => !zu.has(j));

  function jahrgangKippen(jahr: number) {
    setZu((prev) => {
      const next = new Set(prev);
      if (next.has(jahr)) next.delete(jahr);
      else next.add(jahr);
      return next;
    });
  }

  /**
   * Alles auf oder alles zu – ein Knopf, der kippt.
   *
   * Zwei Knöpfe nebeneinander wären der halbe Weg: Einer von beiden ist immer
   * wirkungslos, und welcher, sieht man ihm nicht an. Maßgeblich ist, ob noch
   * irgendein Jahrgang offen steht.
   */
  function alleKippen() {
    setZu(etwasOffen ? new Set(alleJahre) : new Set());
  }

  return (
    <div style={S.rahmen}>
      <div style={S.spalte}>
        <div style={S.kopf}>
          <strong style={B.titel}>Aufteilung</strong>
          <span style={B.leiser}>
            {model.seiten.length} Doppelseiten · {model.pool.length} Bilder außerhalb
          </span>

          <span style={S.schieber}>
            <label htmlFor="baum-bild" style={B.leiser}>
              Bilder
            </label>
            <input
              id="baum-bild"
              type="range"
              min={BILD_AUS}
              max={BILD_MAX}
              step={8}
              value={px}
              onChange={(e) => setPx(Number(e.target.value))}
              // Gemerkt wird beim Loslassen: Beim Ziehen wäre jede Zwischenstufe
              // ein Schreibvorgang in die Adresse.
              onPointerUp={() => bildgroesseMerken(px)}
              onKeyUp={() => bildgroesseMerken(px)}
              style={B.regler}
            />
            <span style={S.pxZahl}>{bilderAn ? `${px} px` : 'aus'}</span>
          </span>

          <button
            style={B.knopf}
            onClick={alleKippen}
            disabled={alleJahre.length === 0}
            title="Alle Jahrgänge auf einmal auf- oder zuklappen"
          >
            {etwasOffen ? 'Alle zuklappen' : 'Alle aufklappen'}
          </button>

          <span style={S.rechts}>
            {model.selected.size > 0 && (
              <>
                <span style={B.leiser}>{model.selected.size} gewählt</span>
                <button
                  style={B.knopf}
                  disabled={model.busy}
                  onClick={() => void model.auswahlInDenPool()}
                >
                  Aus dem Buch nehmen
                </button>
                <button style={B.knopfText} onClick={model.auswahlLoeschen}>
                  Auswahl aufheben
                </button>
              </>
            )}
            <Link
              route={{ view: 'edit', json: true }}
              onNavigieren={onNavigieren}
              style={B.knopf}
              title="Die ganze Aufteilung als Text – für den großen Umbau"
            >
              Als JSON bearbeiten
            </Link>
          </span>
        </div>

        {model.note && (
          <div style={S.meldung}>
            <span>{model.note}</span>
            <button style={B.knopfText} onClick={() => model.setNote(null)}>
              ×
            </button>
          </div>
        )}

        {!model.geladen ? (
          <span style={B.leise}>Lade Baum …</span>
        ) : (
          <div style={S.liste}>
            {jahrgaenge.map(({ jahr, seiten }) => (
              <section key={jahr ?? 'ohne'}>
                <button
                  style={S.jahrzeile}
                  onClick={() => jahr !== undefined && jahrgangKippen(jahr)}
                  title={jahr === undefined ? '' : 'Jahrgang auf- und zuklappen'}
                >
                  <span style={S.pfeil}>{jahr !== undefined && zu.has(jahr) ? '▸' : '▾'}</span>
                  <strong>{jahr ?? 'Ohne Jahrgang'}</strong>
                  <span style={B.leiser}>
                    {seiten.length} Doppelseiten · {seiten.reduce((n, s) => n + s.bilder.length, 0)}{' '}
                    Bilder
                  </span>
                </button>

                {!(jahr !== undefined && zu.has(jahr)) &&
                  seiten.map((seite) => (
                    <Seitenzeile
                      key={seite.index}
                      seite={seite}
                      model={model}
                      px={px}
                      bilderAn={bilderAn}
                      bildVersion={bildVersion}
                      onNavigieren={onNavigieren}
                    />
                  ))}
              </section>
            ))}
          </div>
        )}
      </div>

      <Poolspalte
        pool={model.pool}
        model={model}
        px={px}
        bilderAn={bilderAn}
        bildVersion={bildVersion}
      />
    </div>
  );
}

/** Eine Doppelseite: Kopfzeile mit Marken, darunter das Bilderband. */
function Seitenzeile({
  seite,
  model,
  px,
  bilderAn,
  bildVersion,
  onNavigieren,
}: {
  seite: BaumSeite;
  model: ReturnType<typeof useBaum>;
  px: number;
  bilderAn: boolean;
  bildVersion: number;
  onNavigieren: (ziel: Route) => void;
}) {
  const [ueber, setUeber] = useState(false);
  /*
   * Nur die festgehaltene Seite ist kein Ziel; das steht vorher fest und gehört
   * deshalb vor den Zug gesagt.
   *
   * Ein Auftakt dagegen nimmt Bilder an, solange die neue Zahl eine
   * Auftaktfassung hat (1, 2, 3, 4, 6 oder 9 beim Jahresauftakt). Ob sie das
   * tut, hängt daran, wie viele Bilder gerade gezogen werden – das hier vorweg
   * zu rechnen hieße, die Vorlagenbibliothek in der Oberfläche nachzubauen.
   * Passt es nicht, sagt es die Meldung des Servers, und geändert hat sich
   * nichts.
   */
  const nimmtAn = !seite.locked;
  // Solange ein Zug noch beim Server unterwegs ist, nimmt keine Seite ein
  // weiteres Bild an – sonst überholte ein zweiter Zug den ersten, und
  // `useBaum.laden()` liefe zweimal gegeneinander.
  const zieht = model.zug.length > 0 && !model.busy;
  const ziel: Herkunft = { kind: 'spread', spreadIndex: seite.index };

  return (
    <div
      onDragOver={(e) => {
        if (!zieht || !nimmtAn) return;
        // Ohne preventDefault lehnt der Browser das Fallenlassen ab.
        e.preventDefault();
        setUeber(true);
      }}
      onDragLeave={() => setUeber(false)}
      onDrop={(e) => {
        if (!zieht || !nimmtAn) return;
        e.preventDefault();
        setUeber(false);
        void model.fallenlassen(ziel);
      }}
      style={{
        ...S.seite,
        ...(zieht && nimmtAn ? S.seiteZiel : {}),
        ...(ueber ? S.seiteUeber : {}),
      }}
    >
      <div style={S.seitenkopf}>
        <Link
          route={{ view: 'spread', index: seite.index }}
          onNavigieren={onNavigieren}
          style={S.nummer}
          title={`Doppelseite ${seite.index + 1} öffnen`}
        >
          {seite.index + 1}
        </Link>
        <span style={S.bildzahl}>{seite.bilder.length} Bilder</span>
        {seite.groupTitle && <span style={B.chip}>{seite.groupTitle}</span>}
        {seite.auftakt && (
          <span
            style={B.marke}
            title="Trägt 1, 2, 3, 4, 6 oder 9 Bilder – dazwischen gibt es keine Fassung"
          >
            Auftakt
          </span>
        )}
        {seite.locked && <span style={B.marke}>festgehalten</span>}
        {seite.handarbeit && (
          <span
            style={B.marke}
            title="Ausschnitte, Neigungen oder Rahmen – ein Zug rechnet sie neu"
          >
            Handarbeit
          </span>
        )}
        {seite.zuKlein > 0 && (
          <span style={S.warn}>
            {seite.zuKlein === 1 ? '1 Bild' : `${seite.zuKlein} Bilder`} zu klein
          </span>
        )}
        {seite.falscheLage > 0 && (
          <span
            style={S.warn}
            title="Hochkant im Querformatplatz oder umgekehrt – meist nach einer Ausrichtungskorrektur. Zum Beheben die Doppelseite öffnen."
          >
            {seite.falscheLage === 1 ? '1 Bild' : `${seite.falscheLage} Bilder`} quer im Platz
          </span>
        )}
        {seite.leer && <span style={S.warn}>leer</span>}
      </div>

      {bilderAn && (
        <div style={S.band}>
          {seite.bilder.map((b) => (
            <Bildchen
              key={b.photoId}
              photoId={b.photoId}
              von={ziel}
              model={model}
              px={px}
              bildVersion={bildVersion}
            />
          ))}
          {seite.leer && <span style={B.leiser}>keine Bilder</span>}
        </div>
      )}
    </div>
  );
}

/** Die Bilder außerhalb des Buches, zugleich Ablage zum Herausnehmen. */
function Poolspalte({
  pool,
  model,
  px,
  bilderAn,
  bildVersion,
}: {
  pool: PoolFoto[];
  model: ReturnType<typeof useBaum>;
  px: number;
  bilderAn: boolean;
  bildVersion: number;
}) {
  const [ueber, setUeber] = useState(false);
  // Dieselbe Sperre wie bei den Seiten: kein zweites Fallenlassen, solange das
  // erste noch beim Server unterwegs ist.
  const zieht = model.zug.length > 0 && !model.busy;

  return (
    <aside
      onDragOver={(e) => {
        if (!zieht) return;
        e.preventDefault();
        setUeber(true);
      }}
      onDragLeave={() => setUeber(false)}
      onDrop={(e) => {
        if (!zieht) return;
        e.preventDefault();
        setUeber(false);
        void model.fallenlassen({ kind: 'pool' });
      }}
      style={{ ...S.pool, ...(zieht ? S.poolZiel : {}), ...(ueber ? S.poolUeber : {}) }}
    >
      <div style={S.poolkopf}>
        <strong style={B.titel}>Außerhalb</strong>
        <span style={B.leiser}>{pool.length}</span>
      </div>
      <p style={B.leiser}>Hierher gezogen fällt ein Bild aus dem Buch – verloren geht es nicht.</p>

      {bilderAn && (
        <div style={S.poolgitter}>
          {pool.slice(0, POOL_SICHTBAR).map((p) => (
            <Bildchen
              key={p.id}
              photoId={p.id}
              von={{ kind: 'pool' }}
              model={model}
              px={Math.min(px, 96)}
              bildVersion={bildVersion}
            />
          ))}
        </div>
      )}
      {pool.length > POOL_SICHTBAR && (
        <span style={B.leiser}>… und {pool.length - POOL_SICHTBAR} weitere</span>
      )}
    </aside>
  );
}

/**
 * Ein Bild im Baum.
 *
 * `loading="lazy"` statt eines Beobachters: Achthundert Vorschauen sind für den
 * Browser eine gelöste Aufgabe, und die Kacheln der Übersicht laden nur deshalb
 * über `IntersectionObserver` nach, weil dort jede Kachel eine eigene
 * Serverantwort ist.
 */
function Bildchen({
  photoId,
  von,
  model,
  px,
  bildVersion,
}: {
  photoId: string;
  von: Herkunft;
  model: ReturnType<typeof useBaum>;
  px: number;
  bildVersion: number;
}) {
  const gewaehlt = model.selected.has(photoId);
  const info = model.infos.get(photoId);
  const fassung = bildVersion > 0 ? `&v=${bildVersion}` : '';

  return (
    <button
      // Solange ein voriger Zug noch beim Server unterwegs ist, darf kein
      // neuer beginnen – sonst überholt er den ersten, bevor `useBaum` neu
      // geladen hat.
      draggable={!model.busy}
      onDragStart={(e) => {
        if (model.busy) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', photoId);
        // Dasselbe Zeichen wie beim Ziehen in der Doppelseite.
        e.dataTransfer.setDragImage(dragBild(), 14, 14);
        model.zugBeginnen(photoId, von);
      }}
      onDragEnd={model.zugBeenden}
      onClick={(e) => model.waehlen(photoId, e)}
      title={`${info?.fileName ?? photoId}${
        info?.effectiveDate ? ` · ${info.effectiveDate.slice(0, 10)}` : ' · ohne Datum'
      }`}
      style={{ ...S.bild, width: px, height: px, ...(gewaehlt ? S.bildGewaehlt : {}) }}
    >
      <img
        src={`/api/photos/${photoId}/preview?size=thumb${fassung}`}
        alt=""
        loading="lazy"
        // Ohne das zieht Chrome das Bild selbst – als Datei, an der Anwendung
        // vorbei –, und der Zug der Kachel beginnt nie. Derselbe Handgriff wie
        // im Fotopool der Doppelseite.
        draggable={false}
        style={S.pixel}
      />
    </button>
  );
}

/** Wie viele Bilder des Pools gezeigt werden – darüber wird die Spalte zur Halde. */
const POOL_SICHTBAR = 120;

/**
 * Die Seiten nach Jahrgang, in Buchreihenfolge.
 *
 * Ein Jahrgang ist eine Folge und kein Behälter: Der Baum zeigt das Buch, wie
 * es liegt, und ein Jahr, das zweimal anfinge, wäre eine Aussage über die
 * Gliederung — die trifft `structure/segment.ts`, nicht diese Ansicht.
 */
function gruppiereNachJahr(seiten: BaumSeite[]): { jahr?: number; seiten: BaumSeite[] }[] {
  const blöcke: { jahr?: number; seiten: BaumSeite[] }[] = [];
  for (const seite of seiten) {
    const letzter = blöcke[blöcke.length - 1];
    if (letzter && letzter.jahr === seite.year) letzter.seiten.push(seite);
    else
      blöcke.push({ ...(seite.year !== undefined ? { jahr: seite.year } : {}), seiten: [seite] });
  }
  return blöcke;
}

const S = {
  /*
   * Die Ansicht scrollt selbst.
   *
   * `App.tsx` hält nur die Übersicht in einer Scrollfläche; jede andere Ansicht
   * ist ein Flexkind der Anwendung (`flex: 1`, `minHeight: 0`) und bringt ihren
   * eigenen Roller mit — so wie `PhotoGroups` und `Fotodaten`. Ohne das
   * `minHeight: 0` wächst ein Flexkind mit seinem Inhalt über den Rahmen hinaus,
   * und dann scrollt gar nichts: Der Inhalt steht unter der Fensterkante, ohne
   * dass irgendwo eine Leiste erschiene.
   *
   * Gescrollt wird die Liste, nicht der ganze Rahmen: Kopfzeile, Regler und
   * Fotopool sollen stehen bleiben, während man durch achtzig Doppelseiten
   * fährt.
   */
  rahmen: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    gap: 16,
    alignItems: 'stretch',
    padding: '20px 24px 24px',
  },
  spalte: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  kopf: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  rechts: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 },
  schieber: { display: 'flex', alignItems: 'center', gap: 8 },
  pxZahl: { fontFamily: T.mono, fontSize: 12, color: T.fg3, width: 44 },
  meldung: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 12px',
    background: T.bg2,
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
    fontSize: 13,
  },
  liste: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    // Der Rand hält die klebende Jahreszeile von der Bildlaufleiste fern.
    paddingRight: 8,
  },
  jahrzeile: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    width: '100%',
    padding: '10px 4px 6px',
    border: 'none',
    borderBottom: `1px solid ${T.line}`,
    font: 'inherit',
    fontSize: 15,
    color: T.fg1,
    cursor: 'pointer',
    textAlign: 'left',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    // Deckend und nicht weichgezeichnet: Ein Blur ließ die Bilder der Seiten
    // darunter durchscheinen, und dann liest sich die Jahreszahl auf einem
    // Kinderfoto so schlecht wie erwartet.
    background: T.bg1,
  },
  pfeil: { width: 12, color: T.fg3 },
  seite: {
    padding: '6px 4px',
    borderRadius: T.rMd,
    border: '1px solid transparent',
  },
  seiteZiel: { border: `1px dashed ${T.line2}` },
  seiteUeber: { border: `1px solid ${T.cyan}`, background: T.cyanZart },
  seitenkopf: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nummer: {
    fontFamily: T.mono,
    fontSize: 13,
    color: T.fg2,
    minWidth: 28,
    textDecoration: 'none',
  },
  bildzahl: { fontSize: 13, color: T.fg2 },
  warn: { fontSize: 12, color: T.fehler },
  band: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  bild: {
    padding: 0,
    border: `2px solid transparent`,
    borderRadius: T.rSm,
    background: T.bg3,
    cursor: 'grab',
    overflow: 'hidden',
  },
  bildGewaehlt: { borderColor: T.cyan },
  pixel: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  pool: {
    width: 260,
    flexShrink: 0,
    // Volle Höhe statt `sticky`: Die Spalte steht neben einem Roller, sie muss
    // nicht mitwandern – und ihr Gitter rollt selbst.
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    background: T.bg2,
    border: `1px solid ${T.line}`,
    borderRadius: T.rMd,
  },
  poolZiel: { borderStyle: 'dashed', borderColor: T.line2 },
  poolUeber: { borderStyle: 'solid', borderColor: T.cyan, background: T.cyanZart },
  poolkopf: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
  poolgitter: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: 4,
    overflowY: 'auto',
  },
} satisfies Record<string, React.CSSProperties>;
