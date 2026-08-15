/**
 * Die Vorschau auf ein neu angeordnetes Buch.
 *
 * „Buch neu anordnen" war der teuerste Griff des Werkzeugs und der einzige, der
 * blind geschah: Der Knopf sagte, was an Handarbeit verloren geht, aber nicht,
 * was dafür herauskommt. Wer achtzig Doppelseiten durchgearbeitet hat, drückt
 * so einen Knopf nicht — und wer ihn drückt, sieht hinterher nicht, was sich
 * geändert hat.
 *
 * Diese Ansicht zeigt beides nebeneinander: links die Doppelseite, wie sie ist,
 * rechts, wie sie würde. Was sie zeigt, ist **kein Vorschlag, sondern das
 * Ergebnis** — „Übernehmen" setzt genau dieses Buch ein (`project/probe.ts`).
 *
 * Drei Entscheidungen an der Anordnung:
 *
 * - **Zeilen statt Kacheln.** Ein Gitter aus Miniaturen ist die Übersicht; hier
 *   ist der Gegenstand das *Paar*, und Paare liest man in Zeilen. Der Satz
 *   daneben sagt, was sich ändert, denn zwei ähnliche Miniaturen im Abstand von
 *   zwanzig Pixeln unterscheidet kein Auge.
 * - **Unveränderte Seiten sind ausgeblendet.** Am echten Buch bleibt die
 *   Mehrheit gleich; sie mitzuzeigen hieße, die Änderungen darin zu verstecken.
 *   Der Haken oben holt sie zurück — die Frage „was bleibt eigentlich?" ist
 *   dieselbe Frage.
 * - **Der Wurf ist ein eigener Knopf.** Beim Öffnen wird mit den Einstellungen
 *   von jetzt gerechnet: Dann zeigt die Vorschau genau die Folgen dessen, was
 *   sich am Bestand geändert hat. „Andere Anordnung" würfelt darüber hinaus am
 *   Seed — das ist eine zweite Frage und darf nicht die erste überschreiben.
 */
import { useState } from 'react';
import { SpreadView } from '@franibook/render-dom';
import type { Einstellungen, Handarbeit, SpreadResponse } from './api.js';
import { B, T } from './theme.js';
import { type Probe, type Probeseite, useProbe, useProbekacheln } from './useProbe.js';

/**
 * Miniaturbreite.
 *
 * 380 und nicht 248 wie in der Übersicht: Dort erkennt man den Rhythmus, hier
 * muss man zwei sehr ähnliche Seiten unterscheiden können. Zwei davon plus die
 * Textspalte füllen ein Fenster von 1100 px.
 */
const KACHEL_PX = 380;

interface Props {
  /** Die Einstellungen, wie sie im Projekt stehen – der Maßstab für den Patch. */
  settings: Einstellungen;
  /**
   * Die Einstellungen, deren Wirkung gefragt ist – leer, wenn nur die
   * Anordnung selbst gemeint ist. Sie werden gerechnet, nicht gespeichert.
   */
  patch: Record<string, unknown>;
  imageSrc: (photoId: string) => string;
  /** Nach dem Übernehmen: alles neu laden und zurück in die Übersicht. */
  onUebernommen: (satz: string) => void;
  /** Nach dem Verwerfen: zurück, ohne dass etwas geschehen ist. */
  onVerworfen: () => void;
}

/** Was mit dieser Doppelseite geschieht, in einem Satz. */
function satzZu(s: Probeseite): string {
  const zu = s.zugegangen.length;
  const ab = s.abgegangen.length;
  switch (s.art) {
    case 'neu':
      return `Kommt hinzu, mit ${zu} ${zu === 1 ? 'Bild' : 'Bildern'}.`;
    case 'entfaellt':
      return ab > 0
        ? `Fällt weg. ${ab} ${ab === 1 ? 'Bild wandert' : 'Bilder wandern'} an andere Stellen.`
        : 'Fällt weg.';
    case 'fotos': {
      const teile = [
        zu > 0 ? `${zu} ${zu === 1 ? 'Bild kommt' : 'Bilder kommen'} dazu` : null,
        ab > 0 ? `${ab} ${ab === 1 ? 'Bild geht' : 'Bilder gehen'} weg` : null,
      ].filter((t): t is string => t !== null);
      return `${teile.join(', ')}.`;
    }
    case 'vorlage':
      return s.templateVorher === s.templateNachher
        ? 'Dieselben Bilder, andere Plätze.'
        : 'Dieselben Bilder, andere Vorlage.';
    case 'gleich':
      return s.verschoben ? 'Bleibt, wie sie ist.' : 'Unverändert.';
  }
}

/**
 * Die Marke am Anfang der Zeile.
 *
 * Ausgeschriebene Wortgruppen und keine Einzelwörter: „Bilder" und „Anordnung"
 * sagen nicht, ob sie sich ändern oder bleiben — und eine Marke, die man erst
 * mit dem Satz darunter versteht, kann man auch weglassen.
 */
const ARTWORT: Record<Probeseite['art'], string> = {
  gleich: 'unverändert',
  vorlage: 'andere Anordnung',
  fotos: 'andere Bilder',
  neu: 'neu',
  entfaellt: 'entfällt',
};

/**
 * Womit gerechnet wurde, in einem Satz.
 *
 * Der Satz steht neben der Überschrift, weil eine Vorschau ohne ihre Frage nur
 * eine halbe Antwort ist: „21 Doppelseiten ändern sich" heißt etwas anderes,
 * wenn man die Seitenzahl heraufgesetzt hat, als wenn man nur gewürfelt hat.
 *
 * Verglichen werden die Einstellungen **der Probe** mit denen des Projekts und
 * nicht der Patch, mit dem die Ansicht geöffnet wurde: Beim Öffnen kann eine
 * Probe von vorhin daliegen, und die hat ihre eigene Frage. Der Satz muss zu
 * dem gehören, was gezeigt wird — sonst behauptet er „mit den Einstellungen von
 * jetzt", während darunter etwas ganz anderes steht.
 */
function gerechnetMit(jetzt: Einstellungen, probe: Einstellungen): string {
  const worte: string[] = [];
  if (probe.targetPages !== jetzt.targetPages) {
    worte.push(`${jetzt.targetPages} → ${probe.targetPages} Seiten`);
  }
  for (const [feld, name] of [
    ['chapterOpeners', 'Jahresauftakte'],
    ['chapterOpenersDense', 'Bilder auf der Jahresseite'],
    ['chapterColors', 'Jahresfarben'],
  ] as const) {
    if (probe[feld] !== jetzt[feld]) worte.push(`${name} ${probe[feld] ? 'an' : 'aus'}`);
  }
  if (probe.groupOpeners !== jetzt.groupOpeners) {
    const wert = probe.groupOpeners;
    worte.push(`Gruppenauftakte ${wert === 'auto' ? 'wie Zeitstrahl' : wert ? 'immer' : 'nie'}`);
  }
  if (worte.length > 0) return `Gerechnet mit: ${worte.join(', ')}.`;
  return probe.seed !== jetzt.seed
    ? 'Eine andere Anordnung derselben Bilder.'
    : 'Gerechnet mit den Einstellungen von jetzt.';
}

/**
 * Wenn das Seitenziel im Format gar nicht geht.
 *
 * Ohne diesen Satz sieht eine Probe, die auf 180 Seiten gerechnet wurde und
 * 160 ergibt, nach einem Fehler der Vorschau aus — dabei ist es die Auskunft:
 * Mehr bindet dieser Anbieter nicht.
 */
function geklemmt(probe: Probe): string | null {
  if (!probe.geklemmt) return null;
  const { gewuenscht, wirksam } = probe.geklemmt;
  return `${gewuenscht} Seiten lässt dieses Format nicht — gerechnet wurde mit ${wirksam}.`;
}

/** Was ein Neuaufbau kostet, in Stücken – derselbe Wortlaut wie im Buchpanel. */
function verlustliste(h: Handarbeit): string[] {
  return [
    h.crops > 0 ? `${h.crops} Ausschnitte` : null,
    h.neigungen > 0 ? `${h.neigungen} von Hand gesetzte Neigungen` : null,
    h.rahmen > 0 ? `${h.rahmen} eigene Rahmen` : null,
    h.unterschriften > 0 ? `${h.unterschriften} Bildunterschriften` : null,
    h.hintergruende > 0 ? `${h.hintergruende} Hintergründe` : null,
    h.zeitstrahl > 0 ? `${h.zeitstrahl} Zeitstrahl-Ausnahmen` : null,
    h.positionen > 0 ? `${h.positionen} frei gesetzte Bilder` : null,
    h.ebenen > 0 ? `${h.ebenen} gestapelte Bilder` : null,
    h.texte > 0 ? `${h.texte} Textblöcke` : null,
    h.textplaetze > 0 ? `${h.textplaetze} bewegte Vorlagentexte` : null,
    h.plaetze > 0 ? `${h.plaetze} weggenommene Plätze` : null,
  ].filter((s): s is string => s !== null);
}

export function Neuanordnen({ settings, patch, imageSrc, onUebernommen, onVerworfen }: Props) {
  const { probe, busy, fehler, wurf, rechnen, behalte, uebernehmen, verwerfen } = useProbe(
    settings.seed,
    patch,
  );
  const [alleZeigen, setAlleZeigen] = useState(false);
  /**
   * Die Zeilen, die abgehakt sind.
   *
   * Nur in der Ansicht und nicht am Server: Es ist die Auskunft „hier war ich
   * schon", nicht eine Entscheidung über das Buch. Bei einunddreißig Zeilen ist
   * sie trotzdem der Unterschied zwischen Durchsehen und Suchen.
   */
  const [gesehen, setGesehen] = useState<Set<string>>(new Set());

  // Der Schlüssel der geladenen Miniaturen: Eine andere Probe zeigt unter
  // derselben Nummer andere Bilder.
  const { containerRef, kacheln } = useProbekacheln(probe?.id ?? '—');

  const seiten = probe?.seiten ?? [];
  // Behaltene Seiten stehen im Vergleich als „gleich" – ohne diese Ausnahme
  // ließe der Klick auf „So lassen" die Zeile verschwinden, und damit auch den
  // Weg zurück.
  const gezeigt = alleZeigen ? seiten : seiten.filter((s) => s.art !== 'gleich' || s.behalten);
  const offen = gezeigt.filter((s) => !s.behalten && !gesehen.has(zeilenSchluessel(s)));

  function hakeAb(seite: Probeseite, ab: boolean) {
    const schluessel = zeilenSchluessel(seite);
    setGesehen((prev) => {
      const next = new Set(prev);
      if (ab) next.add(schluessel);
      else next.delete(schluessel);
      return next;
    });
  }

  async function jetztUebernehmen() {
    if (!probe) return;
    const geschafft = await uebernehmen();
    if (!geschafft) return;
    const b = probe.bilanz;
    onUebernommen(
      `Neu angeordnet: ${b.doppelNachher} Doppelseiten, ${b.seitenNachher} Seiten` +
        (b.geaendert + b.neu + b.entfallen > 0
          ? `, ${b.geaendert + b.neu + b.entfallen} davon anders als vorher`
          : ''),
    );
  }

  return (
    <div style={S.rahmen}>
      <header style={S.kopf}>
        <div style={S.kopfZeile}>
          <strong style={B.titel}>Buch neu anordnen</strong>
          <span style={B.leiser}>
            {probe ? gerechnetMit(settings, probe.settings) : 'Rechnet …'}
          </span>
          <span style={B.dehner} />
          <button
            onClick={() => rechnen(wurf + 1)}
            disabled={busy !== null}
            style={B.knopf}
            title="Dieselben Bilder, andere Vorlagen: der Seed wird weitergedreht"
          >
            Andere Anordnung
          </button>
          <button
            onClick={() => {
              void verwerfen().then(onVerworfen);
            }}
            disabled={busy !== null}
            style={B.knopf}
          >
            Verwerfen
          </button>
          <button
            onClick={() => void jetztUebernehmen()}
            disabled={busy !== null || !probe}
            style={B.knopfPrimaer}
            title="Setzt genau das Buch ein, das hier steht"
          >
            Übernehmen
          </button>
        </div>

        {busy !== null && <span style={B.leise}>{busy}</span>}
        {fehler !== null && <p style={B.fehlerfeld}>{fehler}</p>}

        {probe && <Bilanz probe={probe} />}
        {probe && geklemmt(probe) !== null && <p style={B.warnung}>{geklemmt(probe)}</p>}

        {probe && (
          <div style={S.kopfZeile}>
            <label style={B.haken}>
              <input
                type="checkbox"
                checked={alleZeigen}
                onChange={(e) => setAlleZeigen(e.target.checked)}
              />
              Auch die unveränderten zeigen
            </label>
            <span style={B.leiser}>
              {gezeigt.length === 0
                ? 'Diese Anordnung ändert nichts am Buch.'
                : offen.length === 0
                  ? `Alle ${gezeigt.length} durchgesehen.`
                  : `${gezeigt.length - offen.length} von ${gezeigt.length} durchgesehen`}
            </span>
          </div>
        )}
      </header>

      <div ref={containerRef} style={S.liste}>
        {gezeigt.map((s) => (
          <Zeile
            key={zeilenSchluessel(s)}
            seite={s}
            kacheln={kacheln}
            imageSrc={imageSrc}
            gesehen={gesehen.has(zeilenSchluessel(s))}
            onGesehen={(ab) => hakeAb(s, ab)}
            // Kein Griff an einer festgehaltenen Seite: Sie bleibt ohnehin, und
            // ein Knopf, der nichts tut, ist eine Zusage ohne Deckung.
            {...(s.altIndex !== null && !s.locked
              ? { onBehalten: (ja: boolean) => behalte(s.altIndex as number, ja) }
              : {})}
            busy={busy !== null}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Die Zahlen über dem Ganzen.
 *
 * Erst das Buch (Seiten, Doppelseiten), dann die Bilder, dann der Preis. In
 * dieser Reihenfolge, weil die letzte Zeile die ist, wegen der man abbricht.
 */
function Bilanz({ probe }: { probe: Probe }) {
  const b = probe.bilanz;
  const verlust = verlustliste(probe.handwork);
  const seitenGleich = b.seitenVorher === b.seitenNachher;

  return (
    <div style={S.bilanz}>
      <span style={S.paar}>
        <span style={S.zahl}>
          {seitenGleich ? b.seitenNachher : `${b.seitenVorher} → ${b.seitenNachher}`}
        </span>
        <span style={S.einheit}>Seiten</span>
      </span>
      <span style={S.paar}>
        <span style={S.zahl}>{b.gleich}</span>
        <span style={S.einheit}>
          bleiben{b.verschoben > 0 ? ` (${b.verschoben} rücken auf)` : ''}
        </span>
      </span>
      <span style={S.paar}>
        <span style={{ ...S.zahl, color: b.geaendert > 0 ? T.warn : T.fg1 }}>{b.geaendert}</span>
        <span style={S.einheit}>ändern sich</span>
      </span>
      {b.neu > 0 && (
        <span style={S.paar}>
          <span style={S.zahl}>{b.neu}</span>
          <span style={S.einheit}>kommen dazu</span>
        </span>
      )}
      {b.entfallen > 0 && (
        <span style={S.paar}>
          <span style={S.zahl}>{b.entfallen}</span>
          <span style={S.einheit}>fallen weg</span>
        </span>
      )}
      {b.festgehalten > 0 && (
        <span style={S.paar}>
          <span style={S.zahl}>{b.festgehalten}</span>
          <span style={S.einheit}>festgehalten</span>
        </span>
      )}

      <span style={B.trenner} />

      <span style={B.leise}>
        {b.insBuch === 0 && b.ausDemBuch === 0
          ? `${b.fotosNachher} Bilder, dieselben wie jetzt`
          : [
              b.insBuch > 0 ? `${b.insBuch} Bilder kommen neu ins Buch` : null,
              b.ausDemBuch > 0 ? `${b.ausDemBuch} fallen in den Fotopool` : null,
            ]
              .filter(Boolean)
              .join(', ')}
      </span>

      <span style={B.dehner} />

      {/*
        Der Preis steht rechts und gelb: Er ist der Grund, aus dem man diese
        Ansicht überhaupt liest — und die Zahl, wegen der man auch abbricht.
      */}
      <span style={verlust.length > 0 ? B.warnung : B.leiser}>
        {verlust.length > 0
          ? `Verworfen würden ${verlust.join(', ')}.`
          : 'Es geht keine Handarbeit verloren.'}
      </span>
    </div>
  );
}

/**
 * Eine Doppelseite im Vorher/Nachher – samt der Entscheidung darüber.
 *
 * Zwei Griffe, und sie meinen Verschiedenes: **Gesehen** ist eine Marke am
 * Durchgang und ändert nichts; **So lassen** ändert das Buch, das übernommen
 * würde. Deshalb steht das eine als Häkchen und das andere als Knopf, und die
 * behaltene Zeile bleibt sichtbar, statt aus der Liste zu fallen — sonst gäbe
 * es keinen Weg zurück.
 */
function Zeile({
  seite,
  kacheln,
  imageSrc,
  gesehen,
  onGesehen,
  onBehalten,
  busy,
}: {
  seite: Probeseite;
  kacheln: Map<string, SpreadResponse>;
  imageSrc: (photoId: string) => string;
  gesehen: boolean;
  onGesehen: (ab: boolean) => void;
  /** Fehlt bei einer Seite, die es vorher nicht gab – sie kann nicht bleiben. */
  onBehalten?: (behalten: boolean) => void;
  busy: boolean;
}) {
  const vorher = seite.altIndex !== null ? `a${seite.altIndex}` : undefined;
  const nachher = seite.neuIndex !== null ? `n${seite.neuIndex}` : undefined;
  const erledigt = seite.behalten || gesehen;

  return (
    <div
      data-zeile
      data-kacheln={[vorher, nachher].filter(Boolean).join(',')}
      style={{ ...S.zeile, ...(erledigt ? S.zeileErledigt : {}) }}
    >
      <div style={S.spalteText}>
        <div style={S.zeileKopf}>
          {/*
            Die Doppelseite steht ausgeschrieben da und nicht als nackte Zahl:
            „16 → 2" liest sich wie eine Rechnung, und niemand errät, dass links
            die heutige Nummer steht und rechts die künftige. Welche Blätter
            gemeint sind, steht zusätzlich an den Miniaturen — dort, wo man
            hinsieht.
          */}
          <span style={S.nummer}>
            {seite.altIndex !== null
              ? `Doppelseite ${seite.altIndex + 1}`
              : `Neue Doppelseite ${(seite.neuIndex ?? 0) + 1}`}
          </span>
          <span
            style={{
              ...S.art,
              ...(seite.behalten ? S.artBleibt : seite.art === 'gleich' ? S.artLeise : {}),
            }}
          >
            {seite.behalten ? 'bleibt' : ARTWORT[seite.art]}
          </span>
          {seite.locked && <span title="Festgehalten — bleibt unangetastet">🔒</span>}
        </div>
        <p style={B.leise}>
          {seite.behalten ? 'Bleibt, wie sie ist — auf deinen Wunsch.' : satzZu(seite)}
          {seite.verschoben && seite.neuIndex !== null && (
            <> Rückt auf Doppelseite {seite.neuIndex + 1}.</>
          )}
        </p>
        {seite.handarbeit > 0 && (
          <p style={B.warnung}>
            {seite.handarbeit === 1
              ? '1 Handgriff an dieser Seite geht verloren'
              : `${seite.handarbeit} Handgriffe an dieser Seite gehen verloren`}
          </p>
        )}

        <div style={S.griffe}>
          {!seite.behalten && (
            <button
              onClick={() => onGesehen(!gesehen)}
              style={gesehen ? B.knopfAn : B.knopfKlein}
              title="Nur eine Marke am Durchgang — am Buch ändert sie nichts"
            >
              {gesehen ? '✓ gesehen' : 'ok'}
            </button>
          )}
          {onBehalten && (
            <button
              onClick={() => onBehalten(!seite.behalten)}
              disabled={busy}
              style={seite.behalten ? B.knopfKlein : { ...B.knopfKlein, color: T.fehler }}
              title={
                seite.behalten
                  ? 'Diese Seite doch neu anordnen lassen'
                  : 'Diese Doppelseite bleibt, wie sie ist — das Buch wird drumherum gebaut'
              }
            >
              {seite.behalten ? 'doch neu anordnen' : 'so lassen'}
            </button>
          )}
        </div>
      </div>

      <Miniatur
        marke={seite.altIndex !== null ? `jetzt · Doppelseite ${seite.altIndex + 1}` : 'jetzt'}
        schluessel={vorher}
        kacheln={kacheln}
        imageSrc={imageSrc}
        leer="stand noch nicht im Buch"
      />
      <span style={S.pfeil}>{seite.behalten ? '=' : '→'}</span>
      <Miniatur
        marke={seite.neuIndex !== null ? `nachher · Doppelseite ${seite.neuIndex + 1}` : 'nachher'}
        schluessel={nachher}
        kacheln={kacheln}
        imageSrc={imageSrc}
        leer="fällt weg"
      />
    </div>
  );
}

/**
 * Woran eine Zeile wiedererkannt wird.
 *
 * Über die alte Stelle, wo es eine gibt: Sie überdauert jede Neurechnung. Für
 * eine hinzukommende Seite bleibt nur die neue Nummer — deren Marke „gesehen"
 * verrutscht nach einer Neurechnung, und das ist richtig so: Es ist dann eine
 * andere Seite.
 */
function zeilenSchluessel(seite: Probeseite): string {
  return seite.altIndex !== null ? `a${seite.altIndex}` : `n${seite.neuIndex}`;
}

function Miniatur({
  marke,
  schluessel,
  kacheln,
  imageSrc,
  leer,
}: {
  /** Was hier zu sehen ist, in drei Wörtern über dem Bild. */
  marke: string;
  schluessel: string | undefined;
  kacheln: Map<string, SpreadResponse>;
  imageSrc: (photoId: string) => string;
  leer: string;
}) {
  const spread = schluessel === undefined ? undefined : kacheln.get(schluessel);
  if (schluessel === undefined) {
    return (
      <div style={S.spalteBild}>
        <span style={S.marke}>{marke}</span>
        <div style={{ ...S.platzhalter, width: KACHEL_PX, height: KACHEL_PX / 2 }}>
          <span style={B.leiser}>{leer}</span>
        </div>
      </div>
    );
  }
  return (
    <div style={S.spalteBild}>
      <span style={S.marke}>{marke}</span>
      <div style={{ ...B.kachel, width: KACHEL_PX, cursor: 'default' }}>
        {spread ? (
          <SpreadView spread={spread} widthPx={KACHEL_PX} imageSrc={imageSrc} guides={{}} />
        ) : (
          <div style={{ ...S.laedt, width: KACHEL_PX, height: KACHEL_PX / 2 }} />
        )}
      </div>
    </div>
  );
}

const S = {
  rahmen: { display: 'flex', flexDirection: 'column' as const, minHeight: 0, flex: 1 },
  /**
   * Der Kopf bleibt stehen: Die beiden Knöpfe, um die es geht, sollen nach
   * vierzig gescrollten Zeilen nicht oben liegen geblieben sein.
   */
  kopf: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    padding: '16px 20px',
    background: T.bg1,
    borderBottom: `1px solid ${T.line}`,
  },
  kopfZeile: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const },
  bilanz: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap' as const,
  },
  paar: { display: 'flex', alignItems: 'baseline', gap: 6 },
  zahl: {
    fontFamily: T.display,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: 16,
    color: T.fg1,
  },
  einheit: { fontSize: 12, color: T.fg3, whiteSpace: 'nowrap' as const },

  liste: { display: 'flex', flexDirection: 'column' as const, overflowY: 'auto' as const },
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 20px',
    borderBottom: `1px solid ${T.line}`,
  },
  /** Durchgesehen oder behalten: zurückgenommen, aber nicht verschwunden. */
  zeileErledigt: { background: T.bg2, opacity: 0.72 },
  griffe: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 2 },
  spalteText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    width: 260,
    flexShrink: 0,
  },
  zeileKopf: { display: 'flex', alignItems: 'center', gap: 8 },
  /** Bild samt seiner Marke – die Marke steht darüber, nicht daneben. */
  spalteBild: { display: 'flex', flexDirection: 'column' as const, gap: 4, flexShrink: 0 },
  marke: {
    fontSize: 11,
    letterSpacing: 'var(--tracking-caps)',
    textTransform: 'uppercase' as const,
    color: T.fg3,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  nummer: {
    fontFamily: T.display,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: 15,
  },
  /** Die Art der Änderung als Wort, nicht als Farbfleck: Es sind fünf. */
  art: {
    fontSize: 11,
    letterSpacing: 'var(--tracking-caps)',
    textTransform: 'uppercase' as const,
    color: T.cyanTief,
  },
  artLeise: { color: T.fg3 },
  artBleibt: { color: T.fg2 },
  pfeil: { color: T.fg3, fontSize: 18, flexShrink: 0 },
  platzhalter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px dashed ${T.line2}`,
    background: T.bg3,
    flexShrink: 0,
  },
  laedt: { background: T.bg3 },
} satisfies Record<string, React.CSSProperties>;
