/**
 * Coveransicht.
 *
 * Der Umschlag als flach liegender Bogen, dazu die Zahlen, die man beim Cover
 * wirklich braucht: Rückenbreite, Bogenmaß und die Seitenzahl, aus der beides
 * folgt. Die Gelenkzonen sind standardmäßig eingeblendet – sie sind der eine
 * Ort, an dem der Bildschirm nicht zeigt, was der Druck macht.
 *
 * Jetzt ein Reiter neben „Übersicht" und „Doppelseite"; `?cover` wählt ihn nur
 * noch aus. Vorher war es ein eigener Einstiegspunkt in `main.tsx`, weil die
 * Hauptansicht nicht angefasst werden sollte — der Grund ist mit dem Umbau der
 * Kopfzeile weggefallen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverDesign, CoverMosaic } from '@franibook/core';
import { CoverView, type CoverGuideVisibility } from '@franibook/render-dom';
import {
  exportDateiHerunterladen,
  fehlertext,
  type Umschlag as CoverAntwort,
  umschlagAendern,
  type Mosaikfortschritt,
  mosaikFortschrittLaden,
  type UmschlagPatch,
  pdfMitUmschlagExportieren,
  umschlagExportieren,
  umschlagLaden,
} from './api.js';
import { Bildwahl } from './Bildwahl.js';
import { useBackvorgang } from './useBackvorgang.js';
import { CoverMosaik } from './CoverMosaik.js';
import { CoverTexte } from './CoverTexte.js';
import { Farbwahl } from './Farbwahl.js';
import { B, T } from './theme.js';

/**
 * Die Farben ganzer Flächen — im Unterschied zu denen einzelner Texte.
 *
 * `frontBackground` und `backBackground` liegen als Fläche über dem Bogengrund
 * und heißen weggelassen „wie der Bogen". Deshalb steht in ihrem Wähler die
 * geltende Vorgabe und nicht eine Farbe, die niemand gewählt hat.
 */
const GRUNDFARBEN: {
  key: 'background' | 'frontBackground' | 'backBackground' | 'accent' | 'accentText';
  label: string;
  hinweis: string;
  vorgabe: (d: CoverDesign) => string;
}[] = [
  {
    key: 'background',
    label: 'Bogen',
    hinweis: 'Der ganze Umschlagbogen, sichtbar überall dort, wo nichts darüber liegt.',
    vorgabe: () => '#ffffff',
  },
  {
    key: 'frontBackground',
    label: 'Vorderseite',
    hinweis: 'Nur der vordere Deckel samt Gelenk und Beschnitt. Ein Titelbild deckt sie zu.',
    vorgabe: (d) => d.background ?? '#ffffff',
  },
  {
    key: 'backBackground',
    label: 'Rückseite',
    hinweis: 'Nur der hintere Deckel — ausdrücklich getrennt von der Vorderseite.',
    vorgabe: (d) => d.background ?? '#ffffff',
  },
  {
    key: 'accent',
    label: 'Akzent',
    hinweis: 'Vorgabe für Buchrücken und Textbalken, solange ein Text keine eigene Farbe hat.',
    vorgabe: () => '#1a1a1a',
  },
  {
    key: 'accentText',
    label: 'Akzentschrift',
    hinweis: 'Vorgabe für die Schrift auf Rücken und Balken.',
    vorgabe: () => '#ffffff',
  },
];

/** Wie oft nachgefragt wird, während ein Mosaik entsteht. */
const MOSAIK_TAKT_MS = 700;

const SCHALTER = [
  { key: 'hinge', label: 'Gelenk & Rücken' },
  { key: 'fold', label: 'Falzlinien' },
  { key: 'wrap', label: 'Sichtbare Kante' },
  { key: 'safety', label: 'Sicherheit' },
  { key: 'bleed', label: 'Beschnitt' },
  { key: 'diagnostics', label: 'Diagnose' },
] as const;

export function Cover({
  imageSrc,
  standVersion,
}: {
  imageSrc: (photoId: string) => string;
  /** Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat. */
  standVersion?: number;
}) {
  const [data, setData] = useState<CoverAntwort | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Die Meldung, wahlweise mit der erzeugten Datei daran — wie in `App.tsx`.
   * `setNote` löscht die Datei mit, damit kein Öffnen-Link einer abgelösten
   * Meldung stehen bleibt.
   */
  const [note, setNote] = useState<string | null>(null);
  const [guides, setGuides] = useState<CoverGuideVisibility>({ hinge: true, diagnostics: true });
  /**
   * Woran der Server gerade backt.
   *
   * Die Antwort auf das `PATCH` kommt erst, wenn alles fertig ist — für eine
   * Anzeige *während* der Arbeit taugt sie also nicht. Deshalb fragt die
   * Ansicht, solange sie wartet.
   */
  const [arbeit, setArbeit] = useState<Mosaikfortschritt | null>(null);

  /** Der Rahmen um Backvorgänge mit Fortschrittsanzeige — siehe `mosaikAendern`. */
  const starteBackvorgang = useBackvorgang();

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1000);

  const load = useCallback(() => {
    umschlagLaden()
      .then(setData)
      .catch((e: unknown) => setError(fehlertext(e)));
  }, []);

  useEffect(load, [load, standVersion]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  async function patch(patch: UmschlagPatch) {
    try {
      setData(await umschlagAendern(patch));
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    }
  }

  /**
   * Das Mosaik ändern — `null` im Patch entfernt es.
   *
   * Eigener Weg neben `patch`, weil der Server hier tatsächlich arbeitet: Er
   * backt das Bild neu, und das dauert Sekunden. Deshalb die Anzeige „baue das
   * Mosaik" statt eines stummen Wartens; ohne sie sähe ein Regler, der eine
   * Sekunde später nachzieht, nach einem Aussetzer aus.
   */
  async function mosaikAendern(patch: {
    frontMosaic?: CoverMosaic | null;
    backMosaic?: CoverMosaic | null;
  }) {
    // **Nur die jüngste Änderung gilt.** Zwei können sich überlappen: Der
    // Cursor steht im Feld „Form", die Hand greift zum Regler — `onBlur`
    // schickt das eine, `onPointerUp` das andere. Käme das ältere zuletzt
    // zurück, überschriebe sein `setData` den neueren Stand, und die Ansicht
    // zeigte ein Mosaik, das nicht mehr gespeichert ist. Der Haken sichert das
    // über `istAktuell` ab — dieselbe Absicherung, mit der er selbst Fehler und
    // Aufräumen gegen einen überholten Lauf schützt.
    await starteBackvorgang({
      fortschrittLaden: mosaikFortschrittLaden,
      taktMs: MOSAIK_TAKT_MS,
      setArbeit,
      setBusy,
      setNote,
      busyText: 'Baue das Mosaik …',
      aktion: async ({ istAktuell }) => {
        // Das Patch geht unverändert weiter: Welcher Deckel gemeint ist und ob
        // er ein Mosaik bekommt oder verliert (`null`), hat das Panel schon
        // gesagt.
        const antwort = await umschlagAendern(patch);
        if (istAktuell()) setData(antwort);
      },
    });
  }

  async function exportCover() {
    setBusy('Exportiere Umschlag …');
    setNote(null);
    try {
      const r = await umschlagExportieren();
      await exportDateiHerunterladen(`/api/export/${r.fileName}`, r.fileName);
      setNote(
        `Heruntergeladen: ${r.fileName} — ${r.widthMm.toFixed(1)} × ${r.heightMm.toFixed(1)} mm, ` +
          `Rücken ${r.spineMm.toFixed(1)} mm bei ${r.pageCount} Seiten`,
      );
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Für den einen Uploadweg des Anbieters, der eine einzige Datei mit dem
   * Umschlag als erster Seite erwartet, statt der beiden getrennten Dateien
   * von `exportCover` und dem „Buch als PDF"-Knopf.
   */
  async function exportPdfMitUmschlag() {
    setBusy('Exportiere Buch mit Umschlag …');
    setNote(null);
    try {
      const r = await pdfMitUmschlagExportieren();
      await exportDateiHerunterladen(`/api/export/${r.fileName}`, r.fileName);
      setNote(`Heruntergeladen: ${r.fileName} — ${r.pages} Seiten, ${r.images} Bilder`);
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div style={S.flaeche}>
        <p style={B.fehlerfeld}>Fehler: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={S.flaeche}>
        <p style={B.leise}>Lade Umschlag …</p>
      </div>
    );
  }

  const geo = data.cover.geometry;

  return (
    <div style={S.flaeche}>
      <div style={S.kopf}>
        <Kennzahl label="Buchrücken" wert={`${geo.spineMm.toFixed(1)} mm`} />
        <Kennzahl label="Seiten" wert={String(geo.pageCount)} />
        <Kennzahl
          label="Bogen"
          wert={`${geo.widthMm.toFixed(1)} × ${geo.heightMm.toFixed(1)} mm`}
        />
        <Kennzahl label="Falzbereich" wert={`${geo.hingeSafeMm} mm je Seite`} />
        <Kennzahl label="Überstand" wert={`${geo.overhangSideMm} mm`} />
        <span style={B.dehner} />
        <button onClick={() => void exportPdfMitUmschlag()} disabled={!!busy} style={B.knopf}>
          Buch mit Umschlag (eine Datei)
        </button>
        <button onClick={() => void exportCover()} disabled={!!busy} style={B.knopfPrimaer}>
          Umschlag als PDF
        </button>
      </div>

      {/*
        Die Hinweise des Servers sind fast immer derselbe: Die Maße dieses
        Druckprofils sind Annahmen. Das gehört gelesen, bevor jemand einen
        Druckauftrag auslöst, also steht es hier und nicht in einem Tooltip.
      */}
      {data.hints.length > 0 && (
        <ul style={S.hinweise}>
          {data.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      {(busy || note) && <p style={S.status}>{busy ?? note}</p>}

      <div style={S.schalter}>
        {SCHALTER.map((s) => (
          <label key={s.key} style={B.haken}>
            <input
              type="checkbox"
              checked={guides[s.key] ?? false}
              onChange={(e) => setGuides((g) => ({ ...g, [s.key]: e.target.checked }))}
            />
            {s.label}
          </label>
        ))}
      </div>

      <div ref={stageRef} style={S.buehne}>
        <CoverView cover={data.cover} widthPx={stageWidth} imageSrc={imageSrc} guides={guides} />
      </div>
      <p style={{ ...B.leiser, marginTop: 10 }}>
        Links die Rückseite, in der Mitte der Buchrücken, rechts die Vorderseite. Die roten Bänder
        sind die Gelenkzonen — dort verschwindet beim Binden Fläche.
      </p>

      <CoverTexte data={data} onAendern={patch} laeuft={busy !== null} />

      {/*
        Die Grundfarben stehen unter den Texten und nicht bei ihnen: Sie gelten
        für eine ganze Fläche, nicht für eine Zeile — und die Vorderseite trägt
        ihre nur dort, wo kein Bild liegt.
      */}
      <div style={S.farbpanel}>
        <strong style={B.titel}>Grundfarben</strong>
        <div style={S.farbreihe}>
          {GRUNDFARBEN.map((f) => (
            <Grundfarbe
              key={f.key}
              label={f.label}
              hinweis={f.hinweis}
              wert={data.design[f.key]}
              vorgabe={f.vorgabe(data.design)}
              gesperrt={busy !== null}
              onSetzen={(farbe) => void patch({ [f.key]: farbe })}
            />
          ))}
        </div>
      </div>

      <strong style={{ ...B.titel, display: 'block', fontSize: 15, margin: '26px 0 10px' }}>
        Titelbild
      </strong>
      {/*
        Ein gesetztes Mosaik **ist** das Titelbild und schlägt jede Wahl hier.
        Ohne diesen Satz klickt man ein Bild an und es geschieht sichtbar
        nichts — gespeichert wird es sehr wohl, es liegt nur unter dem Mosaik.
        Ein wirkungsloser Griff sagt, warum er wirkungslos ist; die Wahl bleibt
        möglich, denn sie gilt in dem Augenblick, in dem das Mosaik weggeht.
      */}
      {data.design.frontMosaic && (
        <p style={{ ...B.leiser, margin: '0 0 10px' }}>
          Der Umschlag trägt gerade ein Mosaik — eine Wahl hier wird gemerkt und gilt, sobald du es
          weiter unten entfernst.
        </p>
      )}
      <div style={{ ...S.kandidaten, opacity: data.design.frontMosaic ? 0.5 : 1 }}>
        {data.candidates.map((c) => (
          <button
            key={c.photoId}
            onClick={() => void patch({ frontPhotoId: c.photoId })}
            title={c.label}
            style={{
              ...S.kandidat,
              // Ein gesetztes Mosaik **ist** das Titelbild; dann ist keiner
              // dieser Kandidaten der gewählte, auch wenn `frontPhotoId` noch
              // auf einen zeigt. Ihn trotzdem türkis zu rahmen behauptete eine
              // Auswahl, die nicht gedruckt wird.
              borderColor:
                !data.design.frontMosaic && c.photoId === data.design.frontPhotoId
                  ? T.cyan
                  : T.line,
            }}
          >
            <img src={imageSrc(c.photoId)} alt={c.label} style={S.thumb} />
            <span style={S.thumbLabel}>{c.label}</span>
          </button>
        ))}
      </div>
      <p style={{ ...B.leiser, margin: '8px 0 10px' }}>
        Die Reihe zeigt je ein Bild der Fotogruppen — {data.candidates.length} Stück. Jedes andere
        Foto des Bestands geht auch:
      </p>
      <div style={{ opacity: data.design.frontMosaic ? 0.5 : 1 }}>
        <Bildwahl
          gewaehlt={data.design.frontMosaic ? undefined : data.design.frontPhotoId}
          onWaehlen={(photoId) => void patch({ frontPhotoId: photoId })}
          knopf="Titelbild aus dem ganzen Bestand wählen"
        />
      </div>

      <CoverMosaik
        data={data}
        panel="front"
        onAendern={mosaikAendern}
        imageSrc={imageSrc}
        arbeit={arbeit}
        laeuft={busy !== null}
      />

      <strong style={{ ...B.titel, display: 'block', fontSize: 15, margin: '26px 0 10px' }}>
        Rückseite
      </strong>
      {/*
        Dieselbe Reihenfolge wie vorn — erst das einzelne Bild, dann das Mosaik,
        das es schlägt. Die Rückseite darf leer bleiben: Ohne Bild trägt sie ihre
        Grundfarbe, und das ist für ein Fotobuch eine ordentliche Rückseite.
      */}
      {data.design.backMosaic && (
        <p style={{ ...B.leiser, margin: '0 0 10px' }}>
          Die Rückseite trägt gerade ein Mosaik — eine Wahl hier wird gemerkt und gilt, sobald du es
          weiter unten entfernst.
        </p>
      )}
      <div style={{ opacity: data.design.backMosaic ? 0.5 : 1 }}>
        <Bildwahl
          gewaehlt={data.design.backMosaic ? undefined : data.design.backPhotoId}
          onWaehlen={(photoId) => void patch({ backPhotoId: photoId })}
          knopf="Bild der Rückseite aus dem ganzen Bestand wählen"
        />
      </div>

      <CoverMosaik
        data={data}
        panel="back"
        onAendern={mosaikAendern}
        imageSrc={imageSrc}
        arbeit={arbeit}
        laeuft={busy !== null}
      />
    </div>
  );
}

/** Eine Flächenfarbe mit ihrer Beschriftung. */
function Grundfarbe({
  label,
  hinweis,
  wert,
  vorgabe,
  gesperrt,
  onSetzen,
}: {
  label: string;
  hinweis: string;
  wert: string | undefined;
  vorgabe: string;
  gesperrt: boolean;
  onSetzen: (farbe: string | '') => void;
}) {
  return (
    <label style={S.farbfeld} title={hinweis}>
      <span style={B.marke}>{label}</span>
      <Farbwahl wert={wert} vorgabe={vorgabe} gesperrt={gesperrt} onSetzen={onSetzen} />
    </label>
  );
}

function Kennzahl({ label, wert }: { label: string; wert: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={B.marke}>{label}</span>
      <span style={{ ...B.zahl, fontSize: 19 }}>{wert}</span>
    </div>
  );
}

const S = {
  flaeche: { flex: 1, overflowY: 'auto' as const, padding: '24px 32px 48px', minHeight: 0 },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    flexWrap: 'wrap' as const,
    paddingBottom: 18,
    borderBottom: `1px solid ${T.line}`,
  },
  hinweise: {
    margin: '14px 0 0',
    paddingLeft: 18,
    fontSize: 13,
    color: T.warn,
    lineHeight: 1.55,
    maxWidth: '70ch',
  },
  status: {
    margin: '14px 0 0',
    padding: '6px 10px',
    fontSize: 13,
    color: T.fg2,
    background: T.bg3,
    borderRadius: T.rMd,
    fontFamily: T.mono,
  },
  schalter: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap' as const,
    margin: '18px 0',
  },
  buehne: { border: `1px solid ${T.line}`, lineHeight: 0, background: T.bg1 },
  farbpanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: '14px 16px',
    border: `1px solid ${T.line}`,
    borderRadius: 8,
    marginTop: 12,
  },
  farbreihe: { display: 'flex', gap: 22, flexWrap: 'wrap' as const },
  farbfeld: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  felder: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
    gap: 14,
    marginTop: 24,
    maxWidth: 900,
  },
  feldWrap: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  kandidaten: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  kandidat: {
    padding: 3,
    border: `2px solid ${T.line}`,
    borderRadius: 6,
    background: T.bg1,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    width: '7rem',
  },
  thumb: {
    width: '100%',
    height: '4.5rem',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: T.rSm,
  },
  thumbLabel: {
    fontSize: 11,
    color: T.fg3,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
} satisfies Record<string, React.CSSProperties>;
