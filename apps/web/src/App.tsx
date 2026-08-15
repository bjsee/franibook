/**
 * Das Gerüst: Kopfzeile, Kennzahlen, die Ansichten.
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
 *
 * **Welche Ansicht offen ist, hält die App nicht selbst** — das steht in der
 * Adresse und kommt aus `useRoute` (`router.tsx`). Vorher war es `useState`, und
 * damit war jede Stelle im Buch unteilbar: kein Zurück, kein neuer Tab, kein
 * Link an jemand anderen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { imageBoxes } from '@franibook/core';
import type { TimelineFootVariant, TimelineSideVariant } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import {
  abnahmeLaden,
  buchErzeugen,
  buchseiteLoeschen,
  ApiFehler,
  doppelLaden,
  doppelseiteFesthalten,
  doppelseiteLaden,
  doppelseiteLoeschen,
  einstellungenAendern,
  formatWechseln,
  fehlertext,
  neuEinlesen,
  abzugExportieren,
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
import { BildfassungenProvider, bildSrcVon } from './bildadresse.js';
import { B, T } from './theme.js';
import { Kennzahlen } from './Kennzahlen.js';
import { BuchPanel } from './BuchPanel.js';
import { Cover } from './Cover.js';
import { Pruefung } from './Pruefung.js';
import { Fotodaten } from './Fotodaten.js';
import { Overview } from './Overview.js';
import { Baum } from './baum/Baum.js';
import { LayoutEditor } from './LayoutEditor.js';
import { PhotoGroups } from './PhotoGroups.js';
import { PhotoSources } from './PhotoSources.js';
import { YearEvents } from './YearEvents.js';
import { InsertSpread } from './InsertSpread.js';
import { SpreadEditor } from './SpreadEditor.js';
import type { SpreadAussen } from './spread/types.js';
import { VARIANTEN, varianteLesen, varianteMerken, type Variante } from './spread/varianten.js';
import { Link, type NavOptionen, type Route, useRoute, type View } from './router.js';

/**
 * Abstand zwischen zwei Anfragen, solange der Server anläuft.
 *
 * Eine Sekunde: Der Import dauert bei vollem Bestand Minuten, häufigeres Fragen
 * beschleunigt ihn nicht und belegt nur einen Thread, den er selbst braucht.
 * Deutlich länger wäre ebenso falsch – der Warmstart ist in Sekunden fertig, und
 * dann soll die Oberfläche auch in Sekunden da sein.
 */
const ANLAUF_TAKT_MS = 1000;

const REITER: { id: View; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'spread', label: 'Doppelseite' },
  { id: 'groups', label: 'Gruppen' },
  { id: 'years', label: 'Jahre' },
  { id: 'fotodaten', label: 'Fotodaten' },
  { id: 'sources', label: 'Bildquellen' },
  { id: 'edit', label: 'Aufteilung' },
  { id: 'cover', label: 'Umschlag' },
  { id: 'pruefung', label: 'Prüfung' },
];

/**
 * Eine Meldung im Toast, wahlweise mit einer erzeugten Datei daran.
 *
 * `datei` ist der Dateiname aus der Export-Antwort, nicht der volle Pfad: Er ist
 * die Adresse für `GET /api/export/:fileName`, und den Namen aus dem Pfad zu
 * schneiden hieße, hier noch einmal zu wissen, welcher Trenner gilt.
 */
interface Notiz {
  text: string;
  datei?: string;
}

export function App() {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [spread, setSpread] = useState<SpreadResponse | null>(null);
  /** Zählt jede Anfrage nach einer Doppelseite hoch – der Stale-Guard dafür. */
  const spreadFahrschein = useRef(0);
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
  const [route, navigieren] = useRoute();
  const view = route.view;
  /**
   * Zuletzt gezeigte Doppelseite.
   *
   * Der Index steht in der Adresse, aber nur, solange die Doppelseite offen ist.
   * Wer von Seite 34 zu den Gruppen wechselt und den Reiter „Doppelseite" wieder
   * anklickt, will zurück zu 34 und nicht an den Anfang des Buches — der Reiter
   * trägt deshalb die gemerkte Nummer in seinem `href`.
   */
  const [letzterSpread, setLetzterSpread] = useState(() =>
    route.view === 'spread' ? route.index : 0,
  );
  const index = route.view === 'spread' ? route.index : letzterSpread;
  const [variante, setVariante] = useState<Variante>(varianteLesen);
  const [error, setError] = useState<string | null>(null);
  /** Was der Server gerade tut, solange er noch nicht antwortet. `null` = läuft. */
  const [anlauf, setAnlauf] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notiz, setNotiz] = useState<Notiz | null>(null);
  const note = notiz?.text ?? null;
  /**
   * Die gewöhnliche Meldung — und sie löscht eine angehängte Datei mit.
   *
   * Der Wrapper statt eines zweiten Zustands neben `note`: Zwei getrennte
   * Zustände hießen, an jeder der zwanzig Meldestellen an beide zu denken, und
   * die eine vergessene ließe den Öffnen-Link einer längst abgelösten Meldung
   * stehen. So kann das gar nicht passieren.
   */
  const setNote = (text: string | null) => setNotiz(text === null ? null : { text });
  /** Meldung mit Öffnen-Link auf eine erzeugte Datei. */
  const meldeDatei = (text: string, datei: string) => setNotiz({ text, datei });
  /**
   * Stelle, an der eine eigene Doppelseite entstehen soll – `null` heißt: kein
   * Dialog offen. Die Zahl ist die Einfügestelle, nicht der Index einer
   * bestehenden Seite; `spreadCount` bedeutet „ganz hinten".
   */
  const [einfuegenAn, setEinfuegenAn] = useState<number | null>(null);

  /**
   * Offene Prüfpunkte je Bereich, `null` heißt „noch nicht gezählt".
   *
   * Am Reiter steht die Summe, und der Unterschied zwischen „null offen" und
   * „noch nicht gezählt" ist der Grund für die beiden `null`: Eine Zahl, die von
   * 12 auf 61 springt, weil der zweite Bereich nachlädt, sieht aus wie ein
   * Fehler.
   *
   * Gezählt wird **einmal** im Hintergrund nach dem Anlauf und danach von den
   * Bereichen selbst, wenn sie geöffnet sind (`Pruefung.onOffen`). Nicht bei
   * jeder Änderung neu: Die Doppel-Rechnung kostet anderthalb Sekunden
   * Bildvergleich, und wer zwanzig Doppel abarbeitet, löste damit zwanzig
   * Durchläufe aus — für eine Zahl, die die offene Ansicht ohnehin kennt.
   */
  const [offen, setOffen] = useState<{ buch: number | null; bestand: number | null }>({
    buch: null,
    bestand: null,
  });
  const pruefpunkte =
    offen.buch !== null && offen.bestand !== null ? offen.buch + offen.bestand : null;

  const merkeOffen = useCallback((bereich: 'buch' | 'bestand', anzahl: number) => {
    // Gleicher Wert, gleiches Objekt: Sonst rendert jede Meldung neu, und die
    // Meldung kommt aus einem Effekt der Ansicht.
    setOffen((alt) => (alt[bereich] === anzahl ? alt : { ...alt, [bereich]: anzahl }));
  }, []);

  const bare = new URLSearchParams(location.search).has('bare');
  const [guides, setGuides] = useState<GuideVisibility>(() =>
    bare ? {} : { trim: true, safety: true, gutter: true, diagnostics: true },
  );

  /**
   * Bildadressen samt Fassung der gedrehten Fotos (`bildadresse.tsx`).
   *
   * Hier gebaut und nicht über den Haken geholt: Der Kontext, aus dem der Haken
   * liest, wird eine Zeile weiter unten von genau dieser Karte gefüllt.
   */
  const fassungen = info?.bildFassungen ?? {};
  const imageSrc = bildSrcVon(fassungen);

  const hatZeitstrahl = spread?.timelineOverride !== false;

  // --------------------------------------------------------------- Navigation

  /**
   * Zu einer Doppelseite.
   *
   * Ohne Platz: Wer aus der Übersicht, dem Baum oder dem Verlauf hierher
   * springt, meint das Blatt. Auf ein *Bild* springt allein die Abnahme, und
   * die baut ihre Adresse selbst (`Link` mit `slotId`) — ein zweiter Weg
   * dorthin über diesen Helfer stand hier und hatte keinen Aufrufer.
   */
  const zeigeSpread = useCallback(
    (i: number, opt?: NavOptionen) => navigieren({ view: 'spread', index: i }, opt),
    [navigieren],
  );

  /**
   * Der ausgewählte Platz — abgeleitet aus der Adresse, nicht gehalten.
   *
   * Er schaltet die Tastenbelegung um (bei gewähltem Platz justieren die
   * Pfeiltasten den Ausschnitt statt zu blättern) und stand deshalb hier einmal
   * als `useState`. Seit die Abnahme auf ein **Bild** springt, muss er in der
   * Adresse stehen: Zwei Wahrheiten darüber, welches Bild gemeint ist, wären
   * genau der Fall, in dem der Sprung ins Leere zeigt.
   *
   * Nebenbei entfällt damit ein Effekt: Blättern trägt keinen Platz mit, also
   * fällt die Auswahl beim Seitenwechsel von selbst weg. Vorher zog das ein
   * `useEffect` auf `index` nach.
   */
  const selectedSlotId = route.view === 'spread' ? (route.slotId ?? null) : null;

  /**
   * Einen Platz wählen. Ersetzend, denn eine Auswahl ist eine Verfeinerung
   * derselben Ansicht und keine neue Station — dieselbe Regel wie beim Filter
   * der Gruppenliste.
   */
  const waehlePlatz = useCallback(
    (slotId: string | null) => {
      if (route.view !== 'spread') return;
      navigieren(
        { view: 'spread', index: route.index, ...(slotId ? { slotId } : {}) },
        { ersetzen: true },
      );
    },
    [navigieren, route],
  );

  /**
   * Blättern – eine Station im Verlauf für die ganze Folge.
   *
   * Mit Pfeiltasten durch achtzig Doppelseiten zu gehen, darf nicht achtzig
   * Verlaufseinträge kosten: Dann wäre die Zurück-Taste kein Weg zurück, sondern
   * eine Kurbel. Also verschmelzen aufeinanderfolgende Blättersprünge, solange
   * sie schneller als 1,5 s kommen — dieselbe Regel wie beim Zurücknehmen am
   * Server. Der Klick auf eine Kachel in der Übersicht bekommt dagegen seine
   * eigene Station, denn er ist ein Sprung und keine Folge.
   */
  const blaettern = useCallback(
    (i: number) => zeigeSpread(i, { verschmelzen: 'blaettern' }),
    [zeigeSpread],
  );

  /** Die Adresse, auf die ein Reiter zeigt. */
  const reiterRoute = (v: View): Route =>
    v === 'spread' ? { view: 'spread', index: letzterSpread } : { view: v };

  /**
   * Gewählte Gruppe in die Adresse. `useCallback`, weil die Gruppenliste sie aus
   * einem Effekt heraus aufruft: Eine bei jedem Rendern neue Funktion wäre eine
   * Meldung bei jedem Rendern.
   */
  const gruppeInAdresse = useCallback(
    (id: string | null) =>
      navigieren({ view: 'groups', ...(id ? { groupId: id } : {}) }, { ersetzen: true }),
    [navigieren],
  );

  useEffect(() => {
    if (route.view === 'spread') setLetzterSpread(route.index);
  }, [route]);

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

  /**
   * Zählt die offenen Prüfpunkte, einmal nach dem Anlauf.
   *
   * Im Hintergrund und ohne dass jemand darauf wartet: Der Abnahmebericht kostet
   * rund 20 ms, die Doppel anderthalb Sekunden Bildvergleich. Wer währenddessen
   * blättert, sieht den Reiter ohne Zahl — das ist richtiger, als eine Zahl zu
   * zeigen, die gleich eine andere ist.
   *
   * **Danach wird nicht mehr von hier gezählt.** Die geöffneten Bereiche melden
   * ihre Zahlen selbst (`Pruefung.onOffen`), und alles andere wäre ein
   * Bildvergleich je Handgriff. Der Preis: Wer Fotos in einer anderen Ansicht
   * aussortiert, sieht die Zahl erst beim nächsten Öffnen der Prüfung
   * nachziehen. Für eine Klammer am Reiter ist das der richtige Tausch.
   */
  useEffect(() => {
    if (anlauf !== null) return;
    let lebt = true;
    void abnahmeLaden()
      .then((b) => {
        if (lebt) merkeOffen('buch', b.bilanz.schwer + b.bilanz.leicht);
      })
      .catch(() => {
        // Ohne Zahl bleibt der Reiter ohne Klammer. Kein Fehler für den
        // Benutzer: Er hat nicht danach gefragt.
      });
    void doppelLaden()
      .then((d) => {
        if (lebt)
          merkeOffen('bestand', d.doppel.filter((x) => x.behaltenSeit === undefined).length);
      })
      .catch(() => {});
    return () => {
      lebt = false;
    };
  }, [anlauf, merkeOffen]);

  useEffect(() => {
    if (view !== 'spread' && !bare) return;
    setSpread(null);
    // Ein Fahrschein für diese eine Anfrage: Wer schnell blättert, feuert eine
    // neue an, bevor die vorherige zurück ist, und deren Antwort träfe sonst
    // ein, nachdem man längst weitergezogen ist – eine ältere Doppelseite
    // überschriebe die neuere.
    const fahrschein = ++spreadFahrschein.current;
    doppelseiteLaden(index)
      .then((geladen) => {
        if (fahrschein === spreadFahrschein.current) setSpread(geladen);
      })
      .catch((e: unknown) => {
        // Während des Anlaufs still bleiben: `loadInfo` wartet bereits und
        // holt die Doppelseite nach, sobald der Server steht. Zwei Stellen, die
        // dasselbe pollen, wären doppelte Last und ein doppelter Satz.
        if (e instanceof ApiFehler && e.status === 503) return;
        if (fahrschein === spreadFahrschein.current) setError(fehlertext(e));
      });
  }, [index, view, bare, renderVersion]);

  /**
   * Eine Datei, die *neben* eine Abwurfstelle fällt, darf die Arbeit nicht beenden.
   *
   * Ohne diesen Wächter deutet der Browser den Zug als Navigation und zeigt das
   * Bild statt des Buches – samt Auswahl, Griffen und allem, was noch nicht
   * gespeichert war. Hier und nicht in den Ansichten: Es geht um das Fenster, und
   * eingeworfen wird an mehreren Stellen (Doppelseite, Fotopool, Baum). Nur
   * Dateizüge; das Ziehen von Bildern innerhalb der Oberfläche stört das nicht.
   */
  useEffect(() => {
    const halte = (ev: DragEvent) => {
      if (!ev.dataTransfer?.types.includes('Files')) return;
      // Ein Dateifeld nimmt Drops selbst an, und `preventDefault` wirkt auch aus
      // der Bubble-Phase: Ohne diese Ausnahme wäre jedes künftige `<input
      // type="file">` als Ablage tot, ohne dass der Grund am Feld zu sehen wäre.
      const ziel = ev.target;
      if (ziel instanceof HTMLInputElement && ziel.type === 'file') return;
      ev.preventDefault();
    };
    window.addEventListener('dragover', halte);
    window.addEventListener('drop', halte);
    return () => {
      window.removeEventListener('dragover', halte);
      window.removeEventListener('drop', halte);
    };
  }, []);

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
      //
      // Ersetzend, weil ein Zurücknehmen keine Station im Verlauf ist: Die
      // Browser-Zurück-Taste würde sonst zwischen zwei Bedeutungen von „zurück"
      // hin und her springen.
      if (d.spreadIndex !== undefined) zeigeSpread(d.spreadIndex, { ersetzen: true });
      setNote(
        `${wort}: ${d.label}` +
          (d.spreadIndex !== undefined ? ` (Doppelseite ${d.spreadIndex + 1})` : ''),
      );
    },
    [loadInfo, neuRendern, zeigeSpread],
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
          if (e.key === 'ArrowRight') blaettern(Math.min(index + 1, (info?.spreadCount ?? 1) - 1));
          if (e.key === 'ArrowLeft') blaettern(Math.max(0, index - 1));
        }
        if (e.key === 'Escape') {
          if (selectedSlotId) waehlePlatz(null);
          else navigieren({ view: 'overview' });
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
  }, [
    bare,
    info?.spreadCount,
    view,
    index,
    selectedSlotId,
    waehlePlatz,
    zurueck,
    vor,
    blaettern,
    navigieren,
  ]);

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
    pageNumbers?: boolean;
  }) {
    await einstellungenAendern(patch);
    loadInfo();
    neuRendern();
  }

  /**
   * Wechselt das Buchformat.
   *
   * Wie `setSetting` ohne Neuanordnen – die Vorlagen sind normiert, die
   * Aufteilung übersteht den Wechsel. Neu gezeichnet werden muss trotzdem
   * alles: Jede Doppelseite hat danach ein anderes Maß, und die Auflösung je
   * Bild bewertet der Server neu. Was der Wechsel nach sich zieht, sagen die
   * Sätze des Servers – sie werden unverändert angezeigt.
   */
  async function setFormat(printProfileId: string) {
    const antwort = await formatWechseln(printProfileId);
    loadInfo();
    neuRendern();
    if (antwort.hinweise.length > 0) setNote(antwort.hinweise.join(' '));
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
    const bilder = spread ? imageBoxes(spread).length : 0;
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
      // Ersetzend: Die gelöschte Seite soll keine Station bleiben, zu der die
      // Zurück-Taste zurückführt – dort ist jetzt eine andere Seite.
      zeigeSpread(Math.max(0, Math.min(index, (daten.spreadCount ?? 1) - 1)), { ersetzen: true });
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
      zeigeSpread(Math.max(0, Math.min(index, (daten.spreadCount ?? 1) - 1)), { ersetzen: true });
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

  async function exportAbzug() {
    setBusy('Ziehe das Buch ab …');
    setNote(null);
    try {
      const data = await abzugExportieren();
      meldeDatei(`${data.outputPath} — ${data.pages} Blatt, ${data.images} Bilder`, data.fileName);
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
      meldeDatei(`${data.outputPath} — ${data.pages} Seiten, ${data.images} Bilder`, data.fileName);
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
          onIndex: blaettern,
          onLocked: (v) => void setSpreadLocked(v),
          onZeitstrahl: (v) => void setSpreadTimeline(v),
          onEinfuegen: setEinfuegenAn,
          onSeiteLoeschen: (seite) => void removePage(seite),
          onSpreadLoeschen: () => void removeSpread(),
          onGruppeOeffnen: (id) => navigieren({ view: 'groups', groupId: id }),
          onGeaendert: loadInfo,
          onNeuRendern: () => {
            loadInfo();
            neuRendern();
          },
        }
      : null;

  return (
    <BildfassungenProvider fassungen={fassungen}>
      <div style={S.app}>
        <header style={S.kopf}>
          <span style={S.marke}>
            <strong style={S.name}>Franibook</strong>
            {spanne && <span style={S.spanne}>{spanne}</span>}
          </span>

          {/*
          Echte Links und keine Knöpfe: Damit öffnet ⌘-Klick den Reiter in einem
          neuen Tab, und „Adresse kopieren" liefert die Stelle, die man jemandem
          schicken will. Der einfache Klick wird abgefangen, sonst lädt der
          Browser die Anwendung neu.
        */}
          <nav style={B.segRahmen}>
            {REITER.map((r) => (
              <Link
                key={r.id}
                route={reiterRoute(r.id)}
                onNavigieren={navigieren}
                style={view === r.id ? B.segAn : B.segAus}
              >
                {r.label}
                {/*
                Die offenen Prüfpunkte in Rot — eine Aussage über das Buch und
                nicht über die Bedienung, wie „3 zu klein" in den Kennzahlen.
                Türkis bleibt der Auswahl vorbehalten (`.claude/rules/web.md`).

                Erst wenn beide Bereiche gezählt haben: Eine Zahl, die von 12 auf
                61 springt, weil der zweite Teil nachlädt, sieht aus wie ein
                Fehler.
              */}
                {r.id === 'pruefung' && pruefpunkte !== null && (
                  <span style={S.pruefzahl}> ({pruefpunkte})</span>
                )}
              </Link>
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
              title={
                info?.undo.vor ? `Wiederholen: ${info.undo.vor} (⇧⌘Z)` : 'Nichts zu wiederholen'
              }
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
            <button onClick={() => navigieren({ view: 'sources' })} style={S.offline}>
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
            <>
              {/*
              Der Abzug steht neben dem Druck-PDF und nicht darin versteckt: Er
              ist der Griff, den man beim Arbeiten am häufigsten braucht — nur
              eben nicht der, mit dem das Buch bestellt wird. Deshalb daneben und
              schlicht statt in Cyan.
            */}
              <button
                onClick={() => void exportAbzug()}
                disabled={!!busy}
                style={B.knopf}
                title="Das ganze Buch klein und blätterbar, mit Seitenzahlen zum Notieren — dahinter ein Kontaktbogen der Fotos, die nicht im Buch stehen."
              >
                Korrekturabzug
              </button>
              <button
                onClick={() => void exportPdf(view !== 'spread')}
                disabled={!!busy}
                style={B.knopfPrimaer}
              >
                {view === 'spread' ? 'Diese Seite als PDF' : 'Buch als PDF'}
              </button>
            </>
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
            onZeigeSpread={(i) => zeigeSpread(i)}
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
                onOpen={(i) => zeigeSpread(i)}
                onInsert={setEinfuegenAn}
              />
            </div>
            <BuchPanel
              settings={info.settings}
              profile={info.profile}
              formate={info.profiles}
              handwork={info.handwork}
              busy={!!busy}
              onNeuAnordnen={(patch) => void regenerate(patch)}
              onFormat={(id) => void setFormat(id)}
              onDarstellung={(patch) => void setSetting(patch)}
              onNeuEinlesen={() => void reimport()}
              onNotankerZurueck={(satz) => {
                // Wie nach einem Zurücknehmen: Der Stand ist ein anderer, und
                // welche Ansicht davon betroffen ist, weiß niemand.
                loadInfo();
                neuRendern();
                setStandVersion((v) => v + 1);
                // Nur die gemerkte Stelle, nicht die Ansicht: Der Notanker wird
                // aus der Übersicht geworfen, und dort soll man auch bleiben. Die
                // Seitenzahl von vorher gilt danach aber für ein anderes Buch.
                setLetzterSpread(0);
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
              onSelect={waehlePlatz}
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
            focusGroupId={route.view === 'groups' ? (route.groupId ?? null) : null}
            // Die gewählte Gruppe steht in der Adresse, also muss ein Wechsel des
            // Filters dort ankommen – sonst zeigt sie eine Gruppe, die längst nicht
            // mehr gefiltert ist. Ersetzend, denn ein Filterklick ist eine
            // Verfeinerung derselben Ansicht und keine neue Station.
            onGruppeGewaehlt={gruppeInAdresse}
            standVersion={standVersion}
            onOpenSpread={(i) => zeigeSpread(i)}
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
              zeigeSpread(i);
              // Die Auftaktseite hat sich geändert, also neu holen.
              neuRendern();
            }}
          />
        ) : view === 'fotodaten' ? (
          <Fotodaten
            standVersion={standVersion}
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
          // Derselbe Gegenstand in zwei Fassungen: der Baum zum Ziehen, das JSON
          // für den großen Umbau. Welche gilt, steht im Pfad (`/aufteilung/json`).
          route.view === 'edit' && route.json ? (
            <LayoutEditor
              imageSrc={imageSrc}
              onNavigieren={navigieren}
              onApplied={() => {
                loadInfo();
                neuRendern();
              }}
            />
          ) : (
            <Baum
              standVersion={standVersion}
              onNavigieren={navigieren}
              onChanged={() => {
                loadInfo();
                neuRendern();
              }}
            />
          )
        ) : view === 'cover' ? (
          <Cover imageSrc={imageSrc} standVersion={standVersion} />
        ) : route.view === 'pruefung' ? (
          <Pruefung
            {...(route.teil ? { teil: route.teil } : {})}
            onNavigieren={navigieren}
            standVersion={standVersion}
            onOffen={merkeOffen}
            // Beide Bereiche ändern den Projektzustand — eine Abnahme wie ein
            // Aussortieren. Der Rückgängig-Knopf muss wissen, was er zurücknähme,
            // und die Doppelseiten dahinter können ein Bild verloren haben.
            onChanged={() => {
              loadInfo();
              neuRendern();
            }}
          />
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
              neuRendern();
              zeigeSpread(neu);
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
            {/*
            Der Weg vom Pfad zum Blättern. Ohne ihn endete jeder Export mit einer
            Zeile, die man von Hand in den Finder tippt — und gerade der Abzug
            lebt davon, sofort durchgesehen zu werden. Ein neuer Tab und nicht
            dieser: Wer den Abzug ansieht, will danach in der Oberfläche
            weitermachen, wo er war.
          */}
            {!busy && notiz?.datei && (
              <a
                href={`/api/export/${notiz.datei}`}
                target="_blank"
                rel="noreferrer"
                style={S.toastLink}
              >
                Öffnen
              </a>
            )}
            {!busy && (
              <button onClick={() => setNote(null)} style={S.toastZu} title="Ausblenden">
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </BildfassungenProvider>
  );
}

const S = {
  app: { height: '100%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  /**
   * Die offenen Prüfpunkte am Reiter.
   *
   * Rot, weil es eine Aussage über das Buch ist und keine über die Bedienung —
   * dieselbe Farbe wie „3 zu klein" in den Kennzahlen. Türkis bleibt der Auswahl
   * vorbehalten (`.claude/rules/web.md`). Ziffern gleich breit, damit der Reiter
   * beim Zählen nicht wackelt.
   */
  pruefzahl: { color: T.fehler, fontVariantNumeric: 'tabular-nums' as const },
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
  /**
   * Der Öffnen-Link im Toast.
   *
   * Heller als der Schließknopf und mit Rahmen: Er ist das Angebot, nicht das
   * Wegräumen. `whiteSpace: nowrap`, weil der Dateipfad davor lang ist und die
   * beiden Wörter sonst umbrechen.
   */
  toastLink: {
    flexShrink: 0,
    padding: '4px 10px',
    border: '1px solid var(--warm-600)',
    borderRadius: T.rSm,
    color: 'var(--warm-50)',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
  },
} satisfies Record<string, React.CSSProperties>;
