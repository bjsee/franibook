/**
 * Das Gerüst: Kopfzeile, Kennzahlen, sieben Ansichten.
 *
 * Die App füllt das Fenster und scrollt nicht als Ganzes. Kopfzeile und
 * Kennzahlenzeile stehen fest, darunter füllt die Ansicht den Rest — bei der
 * Doppelseite heißt das, dass die Bühne so groß ist, wie der Bildschirm es
 * erlaubt, ohne dass man sie sich zurechtscrollt.
 *
 * Was hier liegt, ist der Zustand des Projekts und die Handgriffe am Buchgerüst
 * (blättern, festhalten, Seiten einfügen und löschen). Die Doppelseiten-Ansicht
 * bekommt beides als `SpreadAussen` — dieselbe Naht für alle drei Varianten,
 * damit ein Wechsel der Variante keine Funktion kostet.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TimelineFootVariant, TimelineSideVariant } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import {
  buchErzeugen,
  buchseiteLoeschen,
  ApiFehler,
  doppelseiteFesthalten,
  doppelseiteLaden,
  doppelseiteLoeschen,
  einstellungenAendern,
  fehlertext,
  neuEinlesen,
  pdfExportieren,
  type ProjectInfo,
  projektLaden,
  type SpreadResponse,
  type UndoErgebnis,
  wiederholen,
  zeitstrahlSetzen,
  zurueckNehmen,
} from './api.js';
import { ausstehendSenden } from './ausstehend.js';
import { B, T } from './theme.js';
import { Kennzahlen } from './Kennzahlen.js';
import { BuchPanel } from './BuchPanel.js';
import { Cover } from './Cover.js';
import { Fotodaten } from './Fotodaten.js';
import { Overview } from './Overview.js';
import { LayoutEditor } from './LayoutEditor.js';
import { PhotoGroups } from './PhotoGroups.js';
import { PhotoSources } from './PhotoSources.js';
import { YearEvents } from './YearEvents.js';
import { InsertSpread } from './InsertSpread.js';
import { SpreadEditor } from './SpreadEditor.js';
import type { SpreadAussen } from './spread/types.js';
import { VARIANTEN, varianteLesen, varianteMerken, type Variante } from './spread/varianten.js';

/**
 * Abstand zwischen zwei Anfragen, solange der Server anläuft.
 *
 * Eine Sekunde: Der Import dauert bei vollem Bestand Minuten, häufigeres Fragen
 * beschleunigt ihn nicht und belegt nur einen Thread, den er selbst braucht.
 * Deutlich länger wäre ebenso falsch – der Warmstart ist in Sekunden fertig, und
 * dann soll die Oberfläche auch in Sekunden da sein.
 */
const ANLAUF_TAKT_MS = 1000;

type View = 'overview' | 'spread' | 'groups' | 'years' | 'fotodaten' | 'sources' | 'edit' | 'cover';

const REITER: { id: View; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'spread', label: 'Doppelseite' },
  { id: 'groups', label: 'Gruppen' },
  { id: 'years', label: 'Jahre' },
  { id: 'fotodaten', label: 'Fotodaten' },
  { id: 'sources', label: 'Bildquellen' },
  { id: 'edit', label: 'Aufteilung' },
  { id: 'cover', label: 'Umschlag' },
];

/**
 * Bildquelle. Der Parity-Test schaltet über `?original=1` auf die Originale
 * um – sonst würde er WebP-Kompression gegen JPEG-Kompression messen statt
 * Geometrie gegen Geometrie.
 */
function useImageSrc(bildVersion: number) {
  const useOriginal = new URLSearchParams(location.search).has('original');
  return useCallback(
    (photoId: string) => {
      if (useOriginal) return `/api/photos/${photoId}/original`;
      // Die Fassung hängt an *jeder* Vorschau-Adresse, nicht nur an der des
      // gedrehten Bildes: Die Oberfläche weiß an dieser Stelle nur die Kennung,
      // nicht die Korrektur — und eine Ausrichtungskorrektur muss sichtbar
      // werden, obwohl Vorschauen `immutable` ausgeliefert werden. Der Server
      // ignoriert den Parameter; er ist allein dazu da, dass die Adresse eine
      // andere ist. Der Preis ist ein einmaliges Nachladen der sichtbaren
      // Kacheln, und dafür bleibt die Zusage für alle übrigen Bilder in Kraft.
      const fassung = bildVersion > 0 ? `?v=${bildVersion}` : '';
      return `/api/photos/${photoId}/preview${fassung}`;
    },
    [useOriginal, bildVersion],
  );
}

export function App() {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [spread, setSpread] = useState<SpreadResponse | null>(null);
  // Zählt hoch, wenn sich am Rendern etwas ändert, ohne dass das Buch neu
  // erzeugt wurde. Die Übersicht hält geladene Doppelseiten selbst vor und
  // wird darüber verworfen.
  const [renderVersion, setRenderVersion] = useState(0);
  /**
   * Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat.
   *
   * Ein Undo kann alles betreffen – Gruppen, Bildquellen, Umschlag –, und die
   * Ansichten laden ihre Daten selbst beim Einhängen. Der Zähler geht als Prop
   * in ihre Ladeabhängigkeit: Sie laden neu, ohne neu einzuhängen, und Auswahl,
   * Scrollstand und aufgeklappte Gruppen bleiben. Als `key` wäre es eine Zeile
   * weniger, aber jedes Cmd+Z würfe die Fotoliste an den Anfang zurück.
   */
  const [standVersion, setStandVersion] = useState(0);
  /**
   * Zählt hoch, wenn sich Bildpixel geändert haben — heute nur bei einer
   * Ausrichtungskorrektur.
   *
   * Sie hängt als `?v=` an jeder Vorschau-Adresse. Ohne das bliebe das gedrehte
   * Bild unsichtbar: Vorschauen gehen mit `Cache-Control: immutable` heraus, weil
   * die Kennung eines Fotos sein Inhaltshash ist — und der ändert sich beim
   * Kippen gerade nicht.
   */
  const [bildVersion, setBildVersion] = useState(0);
  const [index, setIndex] = useState(() => {
    const p = new URLSearchParams(location.search).get('spread');
    return p ? Number(p) : 0;
  });
  const [view, setView] = useState<View>(() => {
    const q = new URLSearchParams(location.search);
    // `?cover` war der Sonderweg zur Coveransicht, solange sie kein Reiter war.
    // Die Adresse gilt weiter, sie wählt jetzt nur den Reiter.
    if (q.has('cover')) return 'cover';
    return q.has('spread') ? 'spread' : 'overview';
  });
  const [variante, setVariante] = useState<Variante>(varianteLesen);
  const [error, setError] = useState<string | null>(null);
  /** Was der Server gerade tut, solange er noch nicht antwortet. `null` = läuft. */
  const [anlauf, setAnlauf] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Ausgewählter Slot. Liegt hier und nicht im Editor, weil er die
   * Tastenbelegung umschaltet: Solange ein Slot gewählt ist, justieren die
   * Pfeiltasten den Ausschnitt statt zu blättern.
   */
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  /** Gruppe, auf die die Gruppenansicht beim Wechsel dorthin springen soll. */
  const [gruppenFokus, setGruppenFokus] = useState<string | null>(null);
  /**
   * Stelle, an der eine eigene Doppelseite entstehen soll – `null` heißt: kein
   * Dialog offen. Die Zahl ist die Einfügestelle, nicht der Index einer
   * bestehenden Seite; `spreadCount` bedeutet „ganz hinten".
   */
  const [einfuegenAn, setEinfuegenAn] = useState<number | null>(null);

  const bare = new URLSearchParams(location.search).has('bare');
  const [guides, setGuides] = useState<GuideVisibility>(() =>
    bare ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
  );

  const imageSrc = useImageSrc(bildVersion);

  const hatZeitstrahl = spread?.timelineOverride !== false;

  /**
   * Projektdaten holen – und warten, solange der Server noch anläuft.
   *
   * Ein Kaltstart liest den ganzen Bestand ein, bevor er auskunftsfähig ist,
   * und antwortet in dieser Zeit mit `503` und einem Satz darüber, was er
   * gerade tut (siehe `anlauf` in `apps/server/src/main.ts`). Das ist kein
   * Fehler, sondern eine Ansage: Sie wird angezeigt, und die Oberfläche fragt
   * weiter, statt eine Fehlerseite zu zeigen, die zum Neuladen auffordert.
   */
  const loadInfo = useCallback(() => {
    const versuch = () => {
      projektLaden()
        .then((geladen) => {
          setInfo(geladen);
          setAnlauf((lief) => {
            // Kam die Oberfläche über den Anlauf hierher, ist die Doppelseite
            // an einem 503 gescheitert und muss nachgeholt werden.
            if (lief !== null) setRenderVersion((v) => v + 1);
            return null;
          });
        })
        .catch((e: unknown) => {
          if (e instanceof ApiFehler && e.status === 503) {
            setAnlauf(e.message);
            window.setTimeout(versuch, ANLAUF_TAKT_MS);
            return;
          }
          setError(fehlertext(e));
        });
    };
    versuch();
  }, []);

  useEffect(loadInfo, [loadInfo]);

  useEffect(() => {
    if (view !== 'spread' && !bare) return;
    setSpread(null);
    doppelseiteLaden(index)
      .then(setSpread)
      .catch((e: unknown) => {
        // Während des Anlaufs still bleiben: `loadInfo` wartet bereits und
        // holt die Doppelseite nach, sobald der Server steht. Zwei Stellen, die
        // dasselbe pollen, wären doppelte Last und ein doppelter Satz.
        if (e instanceof ApiFehler && e.status === 503) return;
        setError(fehlertext(e));
      });
  }, [index, view, bare, renderVersion]);

  // Beim Blättern gilt die Auswahl nicht weiter: Slotkennungen wiederholen
  // sich zwar von Doppelseite zu Doppelseite, gemeint war aber dieses Bild.
  useEffect(() => setSelectedSlotId(null), [index]);

  /** Die Doppelseite verwerfen und neu holen. */
  const neuRendern = useCallback(() => {
    setSpread(null);
    setRenderVersion((v) => v + 1);
  }, []);

  // ------------------------------------------------------------ Zurücknehmen

  /**
   * Was nach einem Zurücknehmen oder Wiederholen zu tun ist.
   *
   * Grob und einmal für alles: Der Server sagt nicht, welcher Bereich sich
   * geändert hat, und bei einem lokalen Server ist die eingesparte Anfrage
   * nichts wert. Eine falsche Bereichsangabe wäre dagegen ein veralteter Stand,
   * den niemand sieht.
   */
  const nachSchritt = useCallback(
    (d: UndoErgebnis, wort: string) => {
      loadInfo();
      neuRendern();
      setStandVersion((v) => v + 1);
      // Zur betroffenen Stelle: Sonst nimmt man etwas zurück, das man nicht
      // sieht – und der zweite Anschlag geschieht im Blindflug.
      if (d.spreadIndex !== undefined) {
        setIndex(d.spreadIndex);
        setView('spread');
      }
      setNote(
        `${wort}: ${d.label}` +
          (d.spreadIndex !== undefined ? ` (Doppelseite ${d.spreadIndex + 1})` : ''),
      );
    },
    [loadInfo, neuRendern],
  );

  const zurueck = useCallback(async () => {
    // Erst alles Ausstehende zum Server: Ausschnitt, Neigung und Unterschrift
    // gehen verzögert raus, und ein PATCH, der nach dem Undo eintrifft, stellt
    // genau das wieder her, was man zurückgenommen hat.
    await ausstehendSenden();
    try {
      nachSchritt(await zurueckNehmen(), 'Zurückgenommen');
    } catch (e) {
      setNote(fehlertext(e));
    }
  }, [nachSchritt]);

  const vor = useCallback(async () => {
    await ausstehendSenden();
    try {
      nachSchritt(await wiederholen(), 'Wiederholt');
    } catch (e) {
      setNote(fehlertext(e));
    }
  }, [nachSchritt]);

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
        // In einem Textfeld gehört Cmd+Z dem Browser: Dort nimmt man Getipptes
        // zurück, nicht den letzten Griff am Buch.
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // Sonst nimmt Safari die Seitennavigation und Chrome nichts.
        e.preventDefault();
        void (e.shiftKey ? vor() : zurueck());
        return;
      }
      if (view === 'spread') {
        // Ist ein Slot gewählt, gehören die Pfeiltasten dem Ausschnitt-Editor.
        if (!selectedSlotId) {
          if (e.key === 'ArrowRight')
            setIndex((i) => Math.min(i + 1, (info?.spreadCount ?? 1) - 1));
          if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
        }
        if (e.key === 'Escape') {
          if (selectedSlotId) setSelectedSlotId(null);
          else setView('overview');
        }
      }
      if (e.key === 'g') {
        setGuides((g) =>
          g.trim ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bare, info?.spreadCount, view, selectedSlotId, zurueck, vor]);

  /**
   * Ändert eine Darstellungseinstellung.
   *
   * Anders als `regenerate` bleibt die Fotoverteilung unangetastet – es wird
   * nur neu gezeichnet. Für den Zeitstrahl ist das der Unterschied zwischen
   * einer Linie ein- und ausblenden und dem Verwerfen aller Korrekturen.
   */
  async function setSetting(patch: {
    timeline?: boolean;
    timelineStyle?: 'foot' | 'side';
    timelineFootVariant?: TimelineFootVariant;
    timelineSideVariant?: TimelineSideVariant;
    timelineAccent?: string;
    tilt?: number;
  }) {
    await einstellungenAendern(patch);
    loadInfo();
    neuRendern();
  }

  /**
   * Liest alle Bildquellen erneut ein.
   *
   * Das Buch bleibt stehen – neue Fotos stehen danach im Fotopool. Ein
   * Neuanordnen ist ausdrücklich nicht Teil davon.
   */
  async function reimport() {
    setBusy('Lese Bilder neu ein …');
    setNote(null);
    try {
      const d = await neuEinlesen();
      loadInfo();
      neuRendern();
      const teile = [
        `${d.photoCount} Fotos`,
        `${d.neu.length} neu`,
        `${d.unveraendert} unverändert`,
      ];
      if (d.verschwunden.length > 0) teile.push(`${d.verschwunden.length} verschwunden`);
      if (d.imBuchVerschwunden.length > 0) {
        teile.push(
          `davon ${d.imBuchVerschwunden.length} noch im Buch – dort bleibt der Platz leer`,
        );
      }
      // Eine übersprungene Quelle muss dranstehen, sonst liest sich „0 neu" wie
      // „nichts dazugekommen" statt wie „gar nicht nachgesehen".
      for (const q of d.offline ?? []) {
        teile.push(`„${q.label}" nicht erreichbar, ${q.photoCount} Fotos daraus unberührt`);
      }
      setNote(teile.join(', '));
    } catch (e: unknown) {
      setError(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Hält die gezeigte Doppelseite fest oder gibt sie frei.
   *
   * Für eine selbst gebaute Seite ist das Schloss die Voraussetzung, dass sie
   * den nächsten Knopfdruck übersteht; für eine erzeugte der Weg, eine gelungene
   * Seite zu behalten, während der Rest neu gemischt wird.
   */
  async function setSpreadLocked(locked: boolean) {
    try {
      const daten = await doppelseiteFesthalten(index, locked);
      if (daten.spread) setSpread(daten.spread);
      loadInfo();
    } catch (e) {
      setNote(`Nicht geändert: ${fehlertext(e)}`);
    }
  }

  /**
   * Nimmt die gezeigte Doppelseite aus dem Buch.
   *
   * Ihre Bilder gehen in den Fotopool – verloren ist keines. Gefragt wird
   * trotzdem: Die folgenden Seitenzahlen verschieben sich alle.
   */
  async function removeSpread() {
    if (!info) return;
    const bilder = spread?.boxes.filter((b) => b.kind === 'image').length ?? 0;
    if (
      !window.confirm(
        `Doppelseite ${index + 1} aus dem Buch nehmen?` +
          (bilder > 0 ? `\n\n${bilder} Bilder wandern in den Fotopool.` : ''),
      )
    ) {
      return;
    }

    try {
      const daten = await doppelseiteLoeschen(index);
      setIndex((i) => Math.max(0, Math.min(i, (daten.spreadCount ?? 1) - 1)));
      loadInfo();
      neuRendern();
    } catch (e) {
      setNote(`Nicht gelöscht: ${fehlertext(e)}`);
    }
  }

  /**
   * Nimmt eine einzelne Buchseite aus dem Buch.
   *
   * Das Gegenstück zum Einfügen: Alles dahinter rückt eine Halbseite auf, und
   * geht die Rechnung auf, wird das Buch ein Blatt kürzer.
   */
  async function removePage(seite: 'left' | 'right') {
    const bilder =
      spread?.boxes.filter(
        (b) =>
          b.kind === 'image' &&
          (seite === 'left'
            ? b.xMm + b.wMm / 2 < spread.gutterXMm
            : b.xMm + b.wMm / 2 >= spread.gutterXMm),
      ).length ?? 0;

    if (
      !window.confirm(
        `${seite === 'left' ? 'Linke' : 'Rechte'} Seite von Doppelseite ${index + 1} aus dem Buch nehmen?` +
          (bilder > 0 ? `\n\n${bilder} Bild(er) wandern in den Fotopool.` : '') +
          '\n\nAlles dahinter rückt eine Seite auf.',
      )
    ) {
      return;
    }

    try {
      const daten = await buchseiteLoeschen(index * 2 + (seite === 'right' ? 1 : 0));
      setIndex((i) => Math.max(0, Math.min(i, (daten.spreadCount ?? 1) - 1)));
      loadInfo();
      neuRendern();
      setNote(
        `Seite entfernt` +
          (daten.photoCount ? `, ${daten.photoCount} Bild(er) im Fotopool` : '') +
          (daten.bericht?.neuGepaart
            ? `, ${daten.bericht.neuGepaart} Doppelseite(n) neu zusammengesetzt`
            : ''),
      );
    } catch (e) {
      setNote(`Seite nicht entfernt: ${fehlertext(e)}`);
    }
  }

  /** Zeitstrahl dieser einen Doppelseite, abweichend von der Vorgabe. */
  async function setSpreadTimeline(value: boolean | null) {
    await zeitstrahlSetzen(index, value);
    neuRendern();
  }

  async function regenerate(patch: Record<string, unknown>) {
    setBusy('Erzeuge Buch neu …');
    setNote(null);
    try {
      const data = await buchErzeugen(patch);
      loadInfo();
      neuRendern();
      const r = data.report;
      setNote(
        `${r.spreadCount} Doppelseiten, ${r.pageCount} Seiten, ` +
          `${r.photosPerSpread.toFixed(1)} Fotos je Doppelseite`,
      );
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function exportPdf(all: boolean) {
    setBusy(all ? 'Exportiere ganzes Buch …' : 'Exportiere Doppelseite …');
    setNote(null);
    try {
      const data = await pdfExportieren(all ? undefined : index);
      setNote(`${data.outputPath} — ${data.pages} Seiten, ${data.images} Bilder`);
    } catch (e) {
      setNote(`Fehler: ${fehlertext(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function waehleVariante(v: Variante) {
    setVariante(v);
    varianteMerken(v);
  }

  // Vor der Fehlerseite: Ein anlaufender Server ist kein Fehler. Die Meldung
  // kommt von ihm selbst und wechselt mit seiner Phase – laden, einlesen,
  // erzeugen –, damit ein Kaltstart über 830 Fotos nicht wie ein Hänger aussieht.
  if (anlauf) {
    return (
      <main style={S.fehlerSeite}>
        <h1>Einen Moment</h1>
        <p style={{ ...B.leise, marginTop: 12 }}>{anlauf}</p>
        <p style={{ ...B.leiser, marginTop: 12 }}>
          Die Oberfläche meldet sich von selbst, sobald der Server so weit ist.
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={S.fehlerSeite}>
        <h1>Fehler</h1>
        <p style={{ ...B.fehlerfeld, marginTop: 12 }}>{error}</p>
        <p style={{ ...B.leise, marginTop: 12 }}>
          Läuft der Server? <code>pnpm --filter @franibook/server dev</code>
        </p>
      </main>
    );
  }

  // Der Parity-Test rendert die Doppelseite ohne jedes Beiwerk – und prüft
  // ausdrücklich, dass hier kein einziger Knopf steht.
  if (bare) {
    return spread ? (
      <SpreadView
        spread={spread}
        widthPx={Number(new URLSearchParams(location.search).get('width') ?? 1200)}
        imageSrc={imageSrc}
        guides={{}}
      />
    ) : null;
  }

  const report = info?.report;
  const jahre = info?.chapters ?? [];
  const spanne =
    jahre.length > 0 ? `${jahre[0]?.year} – ${jahre[jahre.length - 1]?.year}` : undefined;
  const offline = info?.sources.filter((q) => !q.erreichbar) ?? [];

  /** Der Jahrgang, zu dem eine Doppelseite gehört. */
  const jahrVon = (i: number): number | undefined =>
    [...jahre]
      .sort((a, b) => a.firstSpreadIndex - b.firstSpreadIndex)
      .filter((c) => c.firstSpreadIndex <= i)
      .at(-1)?.year;

  const aussen: SpreadAussen | null =
    info && spread
      ? {
          index,
          spreadCount: info.spreadCount,
          jahr: jahrVon(index),
          chapters: info.chapters,
          gruppen: spread.groups ?? [],
          locked: spread.locked ?? false,
          splittable: spread.splittable ?? false,
          hatZeitstrahl,
          zeitstrahlGlobal: info.settings.timeline,
          hintergrundGlobal: info.settings.background,
          minDpi: info.profile.resolution.minDpi,
          targetDpi: info.profile.resolution.targetDpi,
          guides,
          onGuides: setGuides,
          onIndex: setIndex,
          onLocked: (v) => void setSpreadLocked(v),
          onZeitstrahl: (v) => void setSpreadTimeline(v),
          onEinfuegen: setEinfuegenAn,
          onSeiteLoeschen: (seite) => void removePage(seite),
          onSpreadLoeschen: () => void removeSpread(),
          onGruppeOeffnen: (id) => {
            setGruppenFokus(id);
            setView('groups');
          },
          onGeaendert: loadInfo,
          onNeuRendern: () => {
            loadInfo();
            neuRendern();
          },
          onBildGeaendert: () => setBildVersion((v) => v + 1),
        }
      : null;

  return (
    <div style={S.app}>
      <header style={S.kopf}>
        <span style={S.marke}>
          <strong style={S.name}>Franibook</strong>
          {spanne && <span style={S.spanne}>{spanne}</span>}
        </span>

        <nav style={B.segRahmen}>
          {REITER.map((r) => (
            <button
              key={r.id}
              onClick={() => setView(r.id)}
              style={view === r.id ? B.segAn : B.segAus}
            >
              {r.label}
            </button>
          ))}
        </nav>

        <span style={B.dehner} />

        {/*
          Zwei Knöpfe mit der Bezeichnung des Schritts im Hinweis: Ein Pfeil ohne
          Wortlaut sagt nicht, was er zurücknimmt, und bei achtzig Doppelseiten
          ist das der Unterschied zwischen Zutrauen und Ausprobieren.
        */}
        <span style={B.segRahmen}>
          <button
            onClick={() => void zurueck()}
            disabled={!info?.undo.zurueck}
            style={{ ...S.verlaufKnopf, color: info?.undo.zurueck ? T.fg2 : T.fg4 }}
            title={
              info?.undo.zurueck
                ? `Zurücknehmen: ${info.undo.zurueck} (⌘Z)`
                : 'Nichts zurückzunehmen'
            }
            aria-label="Zurücknehmen"
          >
            ↶
          </button>
          <button
            onClick={() => void vor()}
            disabled={!info?.undo.vor}
            style={{ ...S.verlaufKnopf, color: info?.undo.vor ? T.fg2 : T.fg4 }}
            title={info?.undo.vor ? `Wiederholen: ${info.undo.vor} (⇧⌘Z)` : 'Nichts zu wiederholen'}
            aria-label="Wiederholen"
          >
            ↷
          </button>
        </span>

        {/*
          Eine nicht eingehängte Quelle fällt sonst erst auf, wenn Bilder im PDF
          fehlen – der Grundbestand liegt auf einem Netzlaufwerk.
        */}
        {offline.length > 0 && (
          <button onClick={() => setView('sources')} style={S.offline}>
            <span style={S.punkt} />
            {offline.length === 1
              ? '1 Bildquelle offline'
              : `${offline.length} Bildquellen offline`}
          </button>
        )}

        {/*
          Der Variantenumschalter steht nur bei der Doppelseite, weil er nur dort
          etwas ändert. Er ist der eine Teil dieser Oberfläche, der wieder
          verschwindet, sobald eine der drei gewonnen hat.
        */}
        {view === 'spread' && (
          <span style={B.segRahmen} title="Rahmen um die Doppelseite (?ui=a|b|c)">
            {VARIANTEN.map((v) => (
              <button
                key={v.id}
                onClick={() => waehleVariante(v.id)}
                style={{
                  ...(variante === v.id ? B.segAn : B.segAus),
                  fontSize: 12,
                  padding: '5px 10px',
                }}
                title={v.hinweis}
              >
                {v.name}
              </button>
            ))}
          </span>
        )}

        {view !== 'cover' && (
          <button
            onClick={() => void exportPdf(view !== 'spread')}
            disabled={!!busy}
            style={B.knopfPrimaer}
          >
            {view === 'spread' ? 'Diese Seite als PDF' : 'Buch als PDF'}
          </button>
        )}
      </header>

      {info && (
        <Kennzahlen
          report={report ?? null}
          photoCount={info.photoCount}
          spreadCount={info.spreadCount}
          undated={info.undatedCount}
          groupsPending={info.groupsPending}
          structurePending={info.structurePending}
          busy={!!busy}
          onZeigeSpread={(i) => {
            setIndex(i);
            setView('spread');
          }}
          onNeuAnordnen={() => void regenerate({})}
        />
      )}

      {view === 'overview' && info ? (
        <div style={S.inhaltReihe}>
          <div style={S.scrollFlaeche}>
            <Overview
              key={renderVersion}
              spreadCount={info.spreadCount}
              chapters={info.chapters}
              groupMarks={info.groupMarks}
              imageSrc={imageSrc}
              onOpen={(i) => {
                setIndex(i);
                setView('spread');
              }}
              onInsert={setEinfuegenAn}
            />
          </div>
          <BuchPanel
            settings={info.settings}
            handwork={info.handwork}
            busy={!!busy}
            onNeuAnordnen={(patch) => void regenerate(patch)}
            onDarstellung={(patch) => void setSetting(patch)}
            onNeuEinlesen={() => void reimport()}
            onNotankerZurueck={(satz) => {
              // Wie nach einem Zurücknehmen: Der Stand ist ein anderer, und
              // welche Ansicht davon betroffen ist, weiß niemand.
              loadInfo();
              neuRendern();
              setStandVersion((v) => v + 1);
              setIndex(0);
              setNote(satz);
            }}
          />
        </div>
      ) : view === 'spread' ? (
        spread && aussen ? (
          <SpreadEditor
            spread={spread}
            onSpread={setSpread}
            imageSrc={imageSrc}
            selectedSlotId={selectedSlotId}
            onSelect={setSelectedSlotId}
            variante={variante}
            aussen={aussen}
          />
        ) : (
          <div style={S.laedt}>
            <span style={B.leise}>Lade Doppelseite …</span>
          </div>
        )
      ) : view === 'groups' ? (
        <PhotoGroups
          focusGroupId={gruppenFokus}
          standVersion={standVersion}
          onOpenSpread={(i) => {
            setIndex(i);
            setView('spread');
          }}
          onChanged={() => {
            loadInfo();
            // Der Zeitstrahl holt seine Beschriftung bei jedem Rendern aus den
            // Gruppen. Eine aufgelöste oder umbenannte Gruppe wirkt damit
            // sofort – aber nur, wenn die gerenderte Doppelseite im Speicher
            // nicht weitergilt.
            neuRendern();
          }}
        />
      ) : view === 'years' && info ? (
        <YearEvents
          chapters={info.chapters}
          standVersion={standVersion}
          onOpen={(i) => {
            setIndex(i);
            setView('spread');
            // Die Auftaktseite hat sich geändert, also neu holen.
            neuRendern();
          }}
        />
      ) : view === 'fotodaten' ? (
        <Fotodaten
          standVersion={standVersion}
          bildVersion={bildVersion}
          onBildGeaendert={() => setBildVersion((v) => v + 1)}
          onChanged={() => {
            loadInfo();
            // Ein korrigiertes Datum ändert das Buch nicht von selbst – aber die
            // Zeitleiste am Fuß der Doppelseite liest die Daten beim Rendern,
            // also gilt das gerenderte Blatt im Speicher nicht weiter.
            neuRendern();
          }}
        />
      ) : view === 'sources' ? (
        <PhotoSources
          standVersion={standVersion}
          onChanged={() => {
            loadInfo();
            // Fotos können hinzugekommen oder weggefallen sein – die gerenderte
            // Doppelseite im Speicher gilt nicht weiter.
            neuRendern();
          }}
        />
      ) : view === 'edit' ? (
        <LayoutEditor
          imageSrc={imageSrc}
          onApplied={() => {
            loadInfo();
            neuRendern();
          }}
        />
      ) : view === 'cover' ? (
        <Cover imageSrc={imageSrc} standVersion={standVersion} />
      ) : (
        <div style={S.laedt}>
          <span style={B.leise}>Lade Projekt …</span>
        </div>
      )}

      {/*
        Nach dem Einfügen gleich zur neuen Seite: Sie ist leer, und alles
        weitere – Textblock setzen, Bild hineinziehen – passiert dort.
      */}
      {einfuegenAn !== null && info && (
        <InsertSpread
          at={einfuegenAn}
          spreadCount={info.spreadCount}
          onAbbrechen={() => setEinfuegenAn(null)}
          onFehler={(text) => {
            setEinfuegenAn(null);
            setNote(text);
          }}
          onEingefuegt={(neu, bericht) => {
            setEinfuegenAn(null);
            loadInfo();
            setIndex(neu);
            neuRendern();
            setView('spread');
            // Bei einer einzelnen Seite hat die Umpaarung mehr angefasst als die
            // eine Stelle. Das gehört gesagt, sonst wundert man sich über die
            // veränderten Nachbarseiten.
            if (bericht && bericht.neuGepaart > 0) {
              setNote(
                `${bericht.neuGepaart} Doppelseite(n) neu zusammengesetzt` +
                  (bericht.leerseiten > 0
                    ? `, ${bericht.leerseiten} leere Seite(n) für die Parität`
                    : '') +
                  (bericht.leereBlaetter > 0
                    ? `, ${bericht.leereBlaetter} Doppelseite(n) ganz ohne Bild`
                    : '') +
                  ' — die Fotoverteilung ist unverändert.',
              );
            }
          }}
        />
      )}

      {(busy || note) && (
        <div style={S.toast} role="status">
          {busy ?? note}
          {!busy && (
            <button onClick={() => setNote(null)} style={S.toastZu} title="Ausblenden">
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  app: { height: '100%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  kopf: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '0 20px',
    minHeight: 60,
    background: T.bg1,
    borderBottom: `1px solid ${T.line}`,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  marke: { display: 'flex', alignItems: 'baseline', gap: 10 },
  name: {
    fontFamily: T.display,
    fontSize: 19,
    fontWeight: 600,
    letterSpacing: 'var(--tracking-tight)',
  },
  spanne: { fontSize: 13, color: T.fg3, fontVariantNumeric: 'tabular-nums' as const },
  offline: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    font: 'inherit',
    fontSize: 13,
    color: T.warn,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  punkt: { width: 7, height: 7, borderRadius: '50%', background: T.warn },
  /** Wie ein Segmentknopf, nur schmaler – das Zeichen trägt keine Wortlänge. */
  verlaufKnopf: {
    font: 'inherit',
    fontSize: 15,
    lineHeight: 1,
    padding: '5px 11px',
    border: 'none',
    borderRadius: T.rMd,
    background: 'none',
    cursor: 'pointer',
  },

  inhaltReihe: { flex: 1, display: 'flex', minHeight: 0 },
  scrollFlaeche: { flex: 1, minWidth: 0, overflowY: 'auto' as const, padding: '20px 24px 32px' },
  laedt: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: T.bg3,
  },

  fehlerSeite: { padding: '48px 32px', maxWidth: '46rem', margin: '0 auto' },

  toast: {
    position: 'fixed' as const,
    left: '50%',
    bottom: 20,
    transform: 'translateX(-50%)',
    zIndex: 70,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    maxWidth: 'min(720px, calc(100vw - 32px))',
    padding: '10px 12px 10px 16px',
    background: 'var(--warm-900)',
    color: 'var(--warm-50)',
    borderRadius: T.rLg,
    boxShadow: '0 12px 32px rgba(84,76,70,0.32)',
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: T.mono,
  },
  toastZu: {
    font: 'inherit',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'var(--warm-400)',
    cursor: 'pointer',
    flexShrink: 0,
  },
} satisfies Record<string, React.CSSProperties>;
