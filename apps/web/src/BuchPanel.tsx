/**
 * Die Einstellungen, die das ganze Buch betreffen.
 *
 * Sie stehen in der Seitenspalte der Übersicht, weil man dort das Ergebnis sieht:
 * Ob ein Seitenbudget aufgeht oder Jahresauftakte den Rhythmus tragen, erkennt man
 * am ganzen Buch und nicht an einer Doppelseite.
 *
 * Die Spalte ist in zwei Teile geteilt, und die Trennung ist die wichtigste
 * Auskunft dieser Ansicht: **oben, was das Buch neu baut** und dabei jede
 * Handarbeit verwirft, **unten, was nur die Darstellung ändert** und nichts
 * kostet. Vorher standen beide Sorten als Kästchen in einer Reihe, und der
 * Unterschied zwischen „Zeitstrahl aus" (folgenlos) und „Jahresauftakte aus"
 * (vierzehn Ausschnitte weg) war nirgends zu sehen.
 */
import {
  accentOn,
  FRAMES,
  type FrameId,
  MAX_TILT_DEG,
  sideAxisPasst,
  TIMELINE_ACCENTS,
  type TimelineFootVariant,
  type TimelineSideVariant,
} from '@franibook/core';
import { useEffect, useState } from 'react';
import { Notanker } from './Notanker.js';
import { B, T } from './theme.js';
import { ZeitleisteMini } from './ZeitleisteMini.js';

export interface BuchEinstellungen {
  targetPages: number;
  chapterOpeners: boolean;
  chapterOpenersDense: boolean;
  groupOpeners: boolean | 'auto';
  timeline: boolean;
  timelineStyle: 'foot' | 'side';
  timelineFootVariant: TimelineFootVariant;
  timelineSideVariant: TimelineSideVariant;
  timelineAccent: string;
  /** Papierton des Buches – die Miniaturen zeigen die Fassungen darauf. */
  background: string;
  chapterColors: boolean;
  tilt: number;
  frame: FrameId;
  pageNumbers: boolean;
  seed: number;
  /** Kennung des Druckprofils, also das Buchformat. */
  printProfileId: string;
  /**
   * Basisadresse der Videoverweise. Fehlt, solange keine eingerichtet ist – dann
   * druckt jeder QR-Code seine Zieladresse unmittelbar.
   */
  videoBase?: string;
}

/** Ein wählbares Buchformat. */
export interface Buchformat {
  id: string;
  /** Der Druckdienstleister. Gruppiert die Auswahl, sobald es mehr als einen gibt. */
  vendor: string;
  product: string;
  trimWidthMm: number;
  trimHeightMm: number;
  minPages: number;
  maxPages: number;
}

/**
 * Was die beiden Achsen beantworten.
 *
 * Der Satz steht unter dem Schalter und nicht in einem Tooltip: Es ist keine
 * Erklärung der Bedienung, sondern die Entscheidung selbst. Beide Achsen sind
 * richtig, sie antworten nur auf verschiedene Fragen.
 */
const ORT_ERKLAERUNG: Record<'foot' | 'side', string> = {
  foot: 'Im Fußraum, 14 mm hoch, über beide Seiten. Beantwortet: wie weit ist es seit der letzten Seite.',
  side: 'Senkrecht am äußeren Rand der linken Seite, hinter der Sicherheitslinie. Beantwortet: wo im Buch stehe ich.',
};

/**
 * Warum die Randachse in diesem Format nicht zur Wahl steht.
 *
 * Sie braucht ein Band hinter der Sicherheitslinie, und das hat nur Platz, wo
 * der Satzspiegel der Bibliothek weit genug nach innen rückt. Vorher lag sie
 * *im* Sicherheitsrand — dort wäre sie in jedem Format „möglich" gewesen und in
 * jedem Format vom Messer bedroht.
 */
const RANDACHSE_ZU_ENG =
  'In diesem Format kein Platz: Die Achse bräuchte ein Band hinter der Sicherheitslinie, ' +
  'und der Satzspiegel lässt dafür zu wenig frei. Am Fuß geht sie in jedem Format.';

/**
 * Die Fassungen mit ihren Namen.
 *
 * „Heute" statt „classic" und an erster Stelle: Der Vergleich mit dem Bestand
 * ist der halbe Zweck des Feldes, und wer die Namen der übrigen Fassungen liest,
 * hat daneben die Zeichnung.
 */
const FASSUNGEN: {
  foot: readonly { id: TimelineFootVariant; name: string }[];
  side: readonly { id: TimelineSideVariant; name: string }[];
} = {
  foot: [
    { id: 'classic', name: 'Heute' },
    { id: 'band', name: 'Kalenderband' },
    { id: 'ruler', name: 'Monatsleiter' },
    { id: 'ribbon', name: 'Jahresband' },
  ],
  side: [
    { id: 'classic', name: 'Heute' },
    { id: 'ladder', name: 'Jahresleiter' },
    { id: 'bar', name: 'Fortschrittsbalken' },
    { id: 'column', name: 'Jahresspalte' },
  ],
};

/**
 * Das aktive Druckprofil, soweit dieses Panel es braucht.
 *
 * Nur zwei Maße, und für genau eine Frage: ob die Randachse des Zeitstrahls in
 * diesem Format hinter die Sicherheitslinie passt. Die Antwort gibt der Kern
 * (`sideAxisPasst`), damit Panel und Renderer nicht verschiedener Meinung
 * darüber sind, was gezeichnet wird.
 */
export type Druckprofil = Parameters<typeof sideAxisPasst>[0];

interface Props {
  settings: BuchEinstellungen;
  profile: Druckprofil;
  /** Die wählbaren Buchformate; das gewählte steht in `settings.printProfileId`. */
  formate: Buchformat[];
  /**
   * Doppelseiten, die ein Neuanordnen unverändert übersteht.
   *
   * Die einzige Zahl zur Handarbeit, die hier noch steht — und die einzige, die
   * sich ohne Rechnung sagen lässt. Was ein Neuaufbau *kostet*, hängt daran,
   * welches Buch dabei herauskommt, und das weiß erst die Probe
   * (`Neuanordnen.tsx`). Zwei Zahlen für dieselbe Frage standen hier vorher
   * nebeneinander und widersprachen sich.
   */
  festgehalten: number;
  busy: boolean;
  /**
   * Führt zur Vorschau auf das neu angeordnete Buch.
   *
   * Mit den Einstellungen, die den Neuaufbau auslösen — Seitenzahl, Auftakte,
   * Jahresfarben. Sie werden **in der Probe** gerechnet und nicht gespeichert:
   * „180 Seiten statt 160" ist genau die Frage, deren Antwort man vorher sehen
   * will, und ein Zahlenfeld, das ungefragt achtzig Doppelseiten umwirft, war
   * der unheimlichste Griff dieser Spalte.
   */
  onNeuAnordnen: (patch: Record<string, unknown>) => void;
  /** Wechselt das Format. Ordnet nichts neu, klemmt aber die Seitenzahl. */
  onFormat: (printProfileId: string) => void;
  /** Ändert nur die Darstellung. */
  onDarstellung: (patch: {
    timeline?: boolean;
    timelineStyle?: 'foot' | 'side';
    timelineFootVariant?: TimelineFootVariant;
    timelineSideVariant?: TimelineSideVariant;
    timelineAccent?: string;
    tilt?: number;
    frame?: FrameId;
    pageNumbers?: boolean;
    videoBase?: string | null;
  }) => void;
  onNeuEinlesen: () => void;
  /** Nach dem Zurückholen eines Notankers: alles neu laden. */
  onNotankerZurueck: (satz: string) => void;
}

/**
 * Der Name eines Formats in der Auswahl.
 *
 * Der Produktname des Anbieters, wie er ihn schreibt, und dahinter das echte
 * Endformat: Wer „28 × 28" bestellt, bekommt 270 × 270 mm, und genau diese Zahl
 * braucht, wer eine Doppelseite gestaltet.
 *
 * Der Name wird **nicht** gekürzt. Eine Regel wie „streiche ‚Fotobuch
 * Hardcover'" wäre das Wissen über einen bestimmten Anbieter an der einen
 * Stelle, an der es nicht hingehört – beim nächsten stünde dort eine zweite
 * Regel. Kurz halten kann nur, wer das Feld schreibt: das Profil selbst.
 */
function formatName(f: Buchformat): string {
  return `${f.product} — ${f.trimWidthMm} × ${f.trimHeightMm} mm`;
}

/** Die Formate nach Anbieter, in der Reihenfolge ihres ersten Auftretens. */
function nachAnbieter(formate: Buchformat[]): { vendor: string; formate: Buchformat[] }[] {
  const gruppen: { vendor: string; formate: Buchformat[] }[] = [];
  for (const f of formate) {
    const treffer = gruppen.find((g) => g.vendor === f.vendor);
    if (treffer) treffer.formate.push(f);
    else gruppen.push({ vendor: f.vendor, formate: [f] });
  }
  return gruppen;
}

export function BuchPanel({
  settings,
  profile,
  formate,
  festgehalten,
  busy,
  onNeuAnordnen,
  onFormat,
  onDarstellung,
  onNeuEinlesen,
  onNotankerZurueck,
}: Props) {
  const gewaehlt = formate.find((f) => f.id === settings.printProfileId);
  /** Ob die Randachse in diesem Format hinter die Sicherheitslinie passt. */
  const randachseGeht = sideAxisPasst(profile);
  const gruppen = nachAnbieter(formate);
  // `auto` heißt „aus dem Hintergrund ableiten" – dann bekommt der Kern gar
  // keine Farbe, statt einer geratenen.
  const akzent = settings.timelineAccent === 'auto' ? undefined : settings.timelineAccent;

  return (
    <aside style={S.spalte}>
      <div style={{ ...B.abschnitt, gap: 4 }}>
        <strong style={B.titel}>Das ganze Buch</strong>
        <p style={B.leiser}>
          Was hier oben steht, baut das Buch neu und verwirft dabei Handarbeit an den Doppelseiten.
        </p>
      </div>

      <div style={B.abschnitt}>
        <label style={{ ...B.haken, justifyContent: 'space-between' }}>
          Format
          <select
            value={settings.printProfileId}
            onChange={(e) => onFormat(e.target.value)}
            disabled={busy}
            style={B.auswahl}
          >
            {/*
              Ein Anbieter: eine flache Liste, denn die Überschrift wäre auf
              jeder Zeile dieselbe. Mehrere: nach Anbieter gruppiert, weil dann
              der Name die erste Unterscheidung ist und nicht das Maß.
            */}
            {gruppen.length === 1
              ? formate.map((f) => (
                  <option key={f.id} value={f.id}>
                    {formatName(f)}
                  </option>
                ))
              : gruppen.map((g) => (
                  <optgroup key={g.vendor} label={g.vendor}>
                    {g.formate.map((f) => (
                      <option key={f.id} value={f.id}>
                        {formatName(f)}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
        </label>
        {/*
          Der Satz steht hier, weil die Frage beim Wechseln aufkommt: Ein
          Formatwechsel verwirft nichts – jede Vorlage ist normiert, die
          Aufteilung übersteht ihn. Was er ändert, ist die Größe jedes Bildes
          auf dem Papier und damit seine Auflösung.
        */}
        <p style={B.leiser}>
          {gewaehlt
            ? `${gewaehlt.trimWidthMm} × ${gewaehlt.trimHeightMm} mm je Seite, ${gewaehlt.minPages} bis ${gewaehlt.maxPages} Seiten. Ein Wechsel behält die Aufteilung.`
            : 'Ein Wechsel behält die Aufteilung.'}
        </p>
        <label style={{ ...B.haken, justifyContent: 'space-between' }}>
          Seiten
          <input
            key={settings.targetPages}
            type="number"
            min={gewaehlt?.minPages ?? 24}
            max={gewaehlt?.maxPages ?? 400}
            step={2}
            defaultValue={settings.targetPages}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== settings.targetPages) onNeuAnordnen({ targetPages: v });
            }}
            disabled={busy}
            style={S.zahl}
          />
        </label>
        <label style={B.haken}>
          <input
            type="checkbox"
            checked={settings.chapterOpeners}
            onChange={(e) => onNeuAnordnen({ chapterOpeners: e.target.checked })}
            disabled={busy}
          />
          Jahresauftakte
        </label>
        {/*
          Eingerückt und nur sichtbar, solange es Auftakte gibt: Es ist keine
          eigene Entscheidung, sondern die Ausführung der darüber – ein Kästchen
          ohne Wirkung wäre eine Zusage, die niemand einlöst.
        */}
        {settings.chapterOpeners && (
          <label
            style={{ ...B.haken, marginLeft: 22 }}
            title="Neun Bilder über beide Seiten statt sechs rechts. Die Jahreszahl steht größer und in einem Band, das kein Bild berührt — am echten Bestand rund vier Doppelseiten weniger."
          >
            <input
              type="checkbox"
              checked={settings.chapterOpenersDense}
              onChange={(e) => onNeuAnordnen({ chapterOpenersDense: e.target.checked })}
              disabled={busy}
            />
            Bilder auf der Jahresseite
          </label>
        )}
        <label style={B.haken} title="Jeder Jahrgang bekommt eine eigene Hintergrundfarbe">
          <input
            type="checkbox"
            checked={settings.chapterColors}
            onChange={(e) => onNeuAnordnen({ chapterColors: e.target.checked })}
            disabled={busy}
          />
          Jahresfarben
        </label>
        {/*
          Dreiwertig: „wie Zeitstrahl" ist die Vorgabe und bedeutet das Gegenteil
          von ihm – trägt der Zeitstrahl den Gruppentitel auf jeder Doppelseite,
          kostet ein eigener Auftakt nur zwei Seiten, ohne etwas hinzuzufügen.
        */}
        <label style={{ ...B.haken, justifyContent: 'space-between' }}>
          Gruppenauftakte
          <select
            value={String(settings.groupOpeners)}
            onChange={(e) =>
              onNeuAnordnen({
                groupOpeners: e.target.value === 'auto' ? 'auto' : e.target.value === 'true',
              })
            }
            disabled={busy}
            style={B.auswahl}
          >
            <option value="auto">wie Zeitstrahl</option>
            <option value="true">immer</option>
            <option value="false">nie</option>
          </select>
        </label>
      </div>

      <div style={B.abschnitt}>
        <span style={B.marke}>Nur Darstellung — keine Handarbeit geht verloren</span>
        <label style={B.haken}>
          <input
            type="checkbox"
            checked={settings.timeline}
            onChange={(e) => onDarstellung({ timeline: e.target.checked })}
          />
          Zeitstrahl
        </label>
        <label style={B.haken}>
          <input
            type="checkbox"
            checked={settings.pageNumbers}
            onChange={(e) => onDarstellung({ pageNumbers: e.target.checked })}
          />
          Seitenzahlen
        </label>
        <p style={B.leiser}>
          Die Zahl steht außen im Fuß und wird aus dem Platz der Doppelseite gerechnet — ein
          eingeschobenes Blatt verschiebt alle folgenden von selbst. Auf Auftakten und über
          randabfallenden Bildern bleibt sie weg.
        </p>
      </div>

      {settings.timeline && (
        <>
          {/*
            Zwei Achsen, zwei Fragen: Der Fuß sagt, wie weit es seit der letzten
            Seite ist, der Rand, wo man im Buch steht. Ein Segmentschalter statt
            eines Selects, weil beides gleichrangig ist – ein Select mit zwei
            Einträgen versteckt die zweite Möglichkeit hinter einem Klick.
          */}
          <div style={{ ...B.abschnitt, gap: 8 }}>
            <span style={B.marke}>Ort</span>
            <div style={B.segRahmen}>
              {(['foot', 'side'] as const).map((ort) => {
                const geht = ort === 'foot' || randachseGeht;
                return (
                  <button
                    key={ort}
                    onClick={() => onDarstellung({ timelineStyle: ort })}
                    disabled={!geht}
                    title={geht ? undefined : RANDACHSE_ZU_ENG}
                    style={{
                      ...(settings.timelineStyle === ort ? B.segAn : B.segAus),
                      flex: 1,
                      ...(geht ? {} : { opacity: 0.45, cursor: 'not-allowed' }),
                    }}
                  >
                    {ort === 'foot' ? 'am Fuß' : 'am Rand'}
                  </button>
                );
              })}
            </div>
            <p style={B.leiser}>
              {!randachseGeht && settings.timelineStyle === 'side'
                ? RANDACHSE_ZU_ENG
                : ORT_ERKLAERUNG[settings.timelineStyle]}
            </p>
          </div>

          {/*
            Vier Zeilen statt eines Selects: Man wählt eine Zeichnung, kein Wort.
            Am Fuß steht der Name über der Miniatur und diese über die volle
            Zeilenbreite – der Strahl ist 584 mm breit, neben einem Wort wäre
            beides zu schmal. Am Rand ist die Achse hoch und schmal, dort steht
            die Miniatur links und der Name rechts daneben.
          */}
          <div style={{ ...B.abschnitt, gap: 8 }}>
            <span style={B.marke}>Fassung</span>
            {settings.timelineStyle === 'foot'
              ? FASSUNGEN.foot.map(({ id, name }) => (
                  <button
                    key={id}
                    onClick={() => onDarstellung({ timelineFootVariant: id })}
                    style={{
                      ...(settings.timelineFootVariant === id ? B.filterAn : B.filter),
                      ...S.fassungHoch,
                    }}
                  >
                    {name}
                    <ZeitleisteMini
                      seitenzahlen={settings.pageNumbers}
                      printProfileId={settings.printProfileId}
                      ort="foot"
                      fassung={id}
                      background={settings.background}
                      {...(akzent ? { akzent } : {})}
                    />
                  </button>
                ))
              : FASSUNGEN.side.map(({ id, name }) => (
                  <button
                    key={id}
                    onClick={() => onDarstellung({ timelineSideVariant: id })}
                    style={{
                      ...(settings.timelineSideVariant === id ? B.filterAn : B.filter),
                      ...S.fassungBreit,
                    }}
                  >
                    <ZeitleisteMini
                      seitenzahlen={settings.pageNumbers}
                      printProfileId={settings.printProfileId}
                      ort="side"
                      fassung={id}
                      background={settings.background}
                      {...(akzent ? { akzent } : {})}
                    />
                    {name}
                  </button>
                ))}
          </div>

          {/*
            Fünf Pillen und kein freier Farbwähler: Der Marker ist das einzige
            farbige Element im Innenteil, eine offene Farbwahl produziert dort
            Neonrosa. „Jahresfarbe" steht voran, weil es die Vorgabe ist – dann
            leitet der Kern den Ton aus dem Hintergrund der jeweiligen
            Doppelseite ab, und der Tupfen zeigt, was daraus auf diesem Papier
            wird.
          */}
          <div style={{ ...B.abschnitt, gap: 8 }}>
            <span style={B.marke}>Akzentfarbe</span>
            <div style={S.pillen}>
              {TIMELINE_ACCENTS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onDarstellung({ timelineAccent: value })}
                  style={{
                    ...(settings.timelineAccent === value ? B.chipAn : B.chip),
                    ...S.pille,
                  }}
                >
                  <span
                    style={{
                      ...S.tupfen,
                      background: value === 'auto' ? accentOn(settings.background) : value,
                    }}
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/*
        Wie der Zeitstrahl eine reine Darstellungssache: Die Neigung entsteht
        beim Rendern und rührt die Fotoverteilung nicht an. Ein Dreh am Regler
        kostet deshalb keine handgemachte Korrektur.
      */}
      <div style={B.abschnitt}>
        <label style={B.haken} title="Wie schief die Bilder auf den Seiten liegen">
          Neigung
          <input
            type="range"
            min={0}
            max={MAX_TILT_DEG}
            step={0.1}
            value={settings.tilt}
            onChange={(e) => onDarstellung({ tilt: Number(e.target.value) })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={S.reglerWert}>
            {settings.tilt === 0 ? 'aus' : `${settings.tilt.toFixed(1).replace('.', ',')}°`}
          </span>
        </label>

        {/*
          Der Rahmen gilt fürs ganze Buch und ist deshalb hier eine Wahl und im
          Bildpanel eine Ausnahme. Ebenfalls reine Darstellung: Er verkleinert
          das Bild in seinem Kasten, verschiebt aber kein Foto — und ändert
          damit die Auflösung jedes gerahmten Bildes, was der Bericht
          anschließend zeigt.
        */}
        <span style={{ ...B.marke, marginTop: 6 }}>Rahmen</span>
        <div style={S.rahmenGitter}>
          {FRAMES.map((f) => (
            <button
              key={f.id}
              onClick={() => onDarstellung({ frame: f.id })}
              style={settings.frame === f.id ? B.pilleAn : B.pilleAus}
              title={f.hinweis}
            >
              {f.name}
            </button>
          ))}
        </div>

        {/*
          Die Basisadresse der Videoverweise: reine Darstellung wie Rahmen und
          Neigung — sie ändert, was in einem QR-Code steht, und kein Foto wandert.

          Sie steht hier und nicht am einzelnen Bild, weil sie für das ganze Buch
          gilt: Der gedruckte Code trägt `<Basis>/<Kennung>`, und welche Kennung
          wohin führt, sagt die Umleitungsliste. Genau das ist ihr Zweck — zieht
          ein Video um, ändert man die Liste statt das Buch neu zu drucken. Ohne
          Basis druckt jeder Code seine Zieladresse unmittelbar; das geht sofort
          und macht einen Umzug zum Nachdruck.
        */}
        <span style={{ ...B.marke, marginTop: 6 }}>Videoverweise</span>
        <Videobasis basis={settings.videoBase} onDarstellung={onDarstellung} />
      </div>

      <div style={{ ...B.abschnitt, borderBottom: 'none', gap: 10 }}>
        <button
          onClick={onNeuEinlesen}
          disabled={busy}
          style={S.breit}
          title="Liest die Quellordner erneut ein. Das Buch bleibt stehen, neue Fotos landen im Fotopool."
        >
          Bilder neu einlesen
        </button>
        {/*
          Kein `window.confirm` mehr davor: Eine Warnung, die nur zählt, was
          verloren geht, hält vom Klicken ab, ohne zu sagen, wofür. Der Knopf
          führt jetzt in die Probe — dort steht beides, und sie ändert nichts,
          bis jemand übernimmt.
        */}
        <button
          onClick={() => onNeuAnordnen({ seed: settings.seed + 1 })}
          disabled={busy}
          style={{ ...S.breit, borderColor: T.fehlerRand, color: T.fehler }}
          title="Würfelt eine andere Anordnung und zeigt vorher, was sich ändert. Bilder werden nicht neu eingelesen."
        >
          Buch neu anordnen …
        </button>
        <p style={B.leiser}>
          Zeigt erst die Vorschau: was sich an jeder Doppelseite ändert und was an Handarbeit
          verloren ginge. Übernommen wird nichts, bis du es sagst.
          {festgehalten > 0 &&
            ` ${festgehalten} festgehaltene Doppelseite(n) bleiben ohnehin unangetastet.`}
        </p>

        {/*
          Ganz unten und zugeklappt: Der Notanker gehört zu den Knöpfen darüber –
          vor jedem von ihnen fällt einer –, ist aber der Notausgang und nicht
          eine Einstellung.
        */}
        <Notanker onZurueckgeholt={onNotankerZurueck} busy={busy} />
      </div>
    </aside>
  );
}

/**
 * Die Basisadresse der Videoverweise samt Umleitungsliste.
 *
 * Eigene Unterkomponente, weil sie das einzige Feld dieses Panels mit einem
 * eigenen Zwischenzustand ist: Eine Adresse tippt man fertig, bevor sie gilt —
 * ein `onChange` je Zeichen schriebe zwanzig halbe Domänen ins Projekt und legte
 * zwanzig Undo-Schritte an.
 *
 * Die Liste wird **nicht** hier angezeigt, sondern heruntergeladen: Sie gehört
 * auf den Rechner, der die Umleitung bedient, und nicht in eine Ansicht, in der
 * man sie abschreiben müsste. `_redirects` ist das Format, das statische
 * Hosting-Dienste lesen — eine Datei, kein Server.
 */
function Videobasis({
  basis,
  onDarstellung,
}: {
  basis: string | undefined;
  onDarstellung: (patch: { videoBase?: string | null }) => void;
}) {
  const [wert, setWert] = useState(basis ?? '');
  useEffect(() => setWert(basis ?? ''), [basis]);

  const geaendert = wert.trim() !== (basis ?? '');

  return (
    <>
      <span style={S.videoZeile}>
        <input
          type="text"
          value={wert}
          onChange={(e) => setWert(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && geaendert) onDarstellung({ videoBase: wert.trim() || null });
          }}
          placeholder="fb.example/v"
          style={{ ...B.feld, flex: 1 }}
          title="Kurzadresse, hinter der die Videokennung steht. Leer: der Code trägt die Zieladresse selbst."
        />
        <button
          onClick={() => onDarstellung({ videoBase: wert.trim() || null })}
          style={geaendert ? B.knopfPrimaer : B.knopf}
          disabled={!geaendert}
        >
          Merken
        </button>
      </span>
      <span style={S.videoHinweis}>
        {basis
          ? 'Die Codes tragen diese Adresse und die Videokennung. Ein Umzug ist ein Griff an der Umleitungsliste.'
          : 'Ohne Basis druckt jeder Code seine Zieladresse. Das geht sofort – aber ein Umzug des Videos kostet dann einen Nachdruck.'}
      </span>
      <a href="/api/videos/umleitungen?format=redirects" download="_redirects" style={S.videoLink}>
        Umleitungsliste holen
      </a>
    </>
  );
}

const S = {
  videoZeile: { display: 'flex', gap: 6, alignItems: 'center' },
  videoHinweis: { fontSize: 11, color: T.fg2, lineHeight: 1.4 },
  videoLink: { fontSize: 11, color: T.cyanTief, alignSelf: 'flex-start' as const },
  // Die fünf Rahmen umbrechen, statt sie in eine Zeile zu zwingen: Das Panel ist
  // schmal, und „Passepartout" lässt sich nicht abkürzen.
  rahmenGitter: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  spalte: {
    width: 336,
    flexShrink: 0,
    background: T.bg1,
    borderLeft: `1px solid ${T.line}`,
    overflowY: 'auto' as const,
  },
  zahl: {
    width: '5rem',
    font: 'inherit',
    fontSize: 13,
    padding: '6px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
  },
  /** Eine Fassung des Fußstrahls: Name über der Miniatur, beide linksbündig. */
  fassungHoch: {
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 5,
    padding: '7px 8px',
  },
  /** Eine Fassung der Randachse: Miniatur links, Name rechts daneben. */
  fassungBreit: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 10,
    padding: '7px 8px',
  },
  pillen: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  pille: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  /** Der Farbtupfen einer Akzentpille – die Farbe des Buches, nicht der Oberfläche. */
  tupfen: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
    // Ein zarter Rand, damit auch ein heller Tupfen auf weißem Chip eine Kante
    // hat: Ohne ihn verschwindet die Jahresfarbe auf Papierweiß.
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
  },
  reglerWert: {
    fontFamily: T.display,
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: '2.8rem',
    textAlign: 'right' as const,
  },
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
} satisfies Record<string, React.CSSProperties>;
