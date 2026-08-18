/**
 * Wer sonst noch am Buch sitzt — und was er gerade geändert hat.
 *
 * Das Buch lässt sich in mehreren Fenstern öffnen, und bis hierher merkte
 * keines davon etwas vom anderen: Wer im zweiten Tab eine Doppelseite umbaute,
 * sah im ersten weiter den Stand von vorhin und schrieb ihn beim nächsten Griff
 * zurück. Der Server ist die einzige Wahrheit über das Buch — er weiß es also,
 * er hat es nur nie gesagt.
 *
 * Hier sagt er es. Jedes offene Fenster hält eine Verbindung
 * (`GET /api/ereignisse`), und nach jedem Griff, der gewirkt hat, geht eine
 * Zeile an **alle anderen**. Was sie damit tun, ist ihre Sache; die Oberfläche
 * lädt nach.
 *
 * **Server-Sent Events und kein WebSocket.** Der Verkehr geht nur in eine
 * Richtung — Änderungen wandern über die vorhandenen Endpunkte zum Server, nie
 * über diesen Kanal zurück. Dafür ist SSE das kleinere Werkzeug: keine
 * Abhängigkeit, kein zweites Protokoll, kein eigener Handshake, und der Browser
 * verbindet nach einem Abbruch von selbst neu. Ein WebSocket hätte `ws` als
 * Abhängigkeit und einen zweiten Weg gebracht, auf dem etwas ins Buch gelangen
 * kann — genau das, was der Origin-Schutz an den Routen verhindern soll.
 *
 * **Zugestellt wird die Bezeichnung, nicht der neue Stand.** Es wäre verlockend,
 * die geänderte Doppelseite gleich mitzuschicken; dann hätte der Kanal aber eine
 * zweite Fassung jeder Antwortform (`spreadAntwort`, `gruppenAntwort` …), und
 * eine davon wäre irgendwann die ältere. Die Zeile sagt nur, **dass** und
 * **was** sich geändert hat; abgeholt wird über dieselben Endpunkte wie sonst.
 * Denselben Weg geht das Zurücknehmen in der Oberfläche schon (`nachSchritt` in
 * `App.tsx`): grob nachladen statt fein diffen.
 *
 * **Der Absender bekommt sein eigenes Echo nicht.** Wer den Griff getan hat, hat
 * die Antwort darauf schon — sie ersetzt seinen Zustand. Bekäme er die Meldung
 * auch, lüde er unmittelbar nach jedem eigenen Griff alles neu, und bei einem
 * gezogenen Regler wäre das eine Neuladung je Zwischenstellung.
 *
 * Erkannt wird er an einer Kennung je Fenster, und die kommt auf **zwei** Wegen:
 * mutierende Anfragen tragen sie im Kopf `x-franibook-fenster`, die Leitung
 * selbst in ihrer Adresse (`?fenster=`). Das ist keine Doppelung aus Bequemlich-
 * keit — `EventSource` kann keine eigenen Kopfzeilen setzen, und mit dem Kopf
 * allein blieb jede Leitung namenlos. Ein namenloses Fenster bekommt
 * absichtlich alles, also bekam jedes sein eigenes Echo (`fensterVon` in
 * `routes/ereignisse.ts`).
 */

/** Der Kopf, an dem eine Anfrage ihr Fenster nennt. */
export const FENSTER_KOPF = 'x-franibook-fenster';

/** Wie oft ein Lebenszeichen durch eine stille Verbindung geht. */
export const HERZSCHLAG_MS = 25_000;

/**
 * Was sich geändert hat.
 *
 * `label` und `spreadIndex` kommen unverändert aus `UNDO_ROUTEN` — dieselbe
 * Tabelle, die den Knopf „Zurück: Ausschnitt gesetzt" beschriftet. Das ist kein
 * Zufall, sondern der Grund, warum diese Meldung so wenig Code kostet: Was eine
 * Route ändert und wie das auf Deutsch heißt, steht dort bereits lückenlos, von
 * `undo.test.ts` gegen die angemeldeten Routen geprüft. Eine zweite Tabelle
 * dafür wäre eine, die man vergisst zu pflegen.
 */
export interface Aenderung {
  /**
   * Fortlaufend ab 1 – **je Server, nicht je Fenster.**
   *
   * Taugt damit ausdrücklich **nicht** als Lückenerkennung: Der Absender bekommt
   * sein eigenes Echo nicht, also fehlen jedem Fenster im Normalbetrieb genau
   * die Nummern seiner eigenen Griffe. Wer daraus auf einen Verbindungsabbruch
   * schlösse, meldete nach jedem eigenen Handgriff einen. Dass die Leitung weg
   * war, merkt der Browser selbst (`onWiederVerbunden` in `api.ts`).
   *
   * Wozu sie dann gut ist: Sie macht im Netzwerkmitschnitt und im Test die
   * Reihenfolge der Meldungen lesbar.
   */
  nr: number;
  /** Deutscher Satzanfang, wie am Zurück-Knopf: „Ausschnitt gesetzt". */
  label: string;
  /** Welche Doppelseite es betrifft, wenn es eine gibt. */
  spreadIndex?: number;
}

/**
 * Ein offenes Fenster, aus Sicht des Stroms.
 *
 * Als Schnittstelle und nicht als Fastify-`reply`: Was eine Zeile auf die
 * Leitung schreibt, ist eine Zeile Transport, und ohne diese Naht ließe sich
 * keine Zustellung prüfen, ohne einen Server zu starten. Derselbe Gedanke wie
 * bei `Videowerkzeuge` in `video.ts` und den Schreibwerkzeugen in
 * `project/speichern.ts`.
 */
export interface Hoerer {
  /**
   * Welches Fenster hier zuhört — oder `undefined`, wenn es sich nicht nennt.
   *
   * Ein namenloses Fenster bekommt alles. Das ist die richtige Vorgabe: Wer
   * seine Kennung nicht mitschickt, kann auch kein Echo erkennen, und lieber
   * einmal zu viel nachladen als einen Stand zeigen, den es nicht mehr gibt.
   */
  fenster?: string | undefined;
  /**
   * Schickt eine Zeile.
   *
   * Darf werfen: Eine Leitung, die der Browser beim Neuladen ohne Abschied
   * gekappt hat, ist ein zugemachtes Fenster und kein Fehler, den jemand sehen
   * müsste. Der Strom fängt das und meldet den Hörer ab – siehe `#zustellen`.
   */
  schreibe(art: string, daten: unknown): void;
}

/**
 * Die offenen Fenster und was sie erfahren.
 *
 * Kein Projektzustand: Nichts hiervon wird gespeichert, nichts überlebt einen
 * Neustart, und ein Zurücknehmen hat damit nichts zu tun. Deshalb liegt der
 * Strom neben `Project` und nicht darin — wie die Anordnungsprobe eine Frage
 * ist und keine Entscheidung.
 */
export class Ereignisstrom {
  readonly #hoerer = new Set<Hoerer>();
  #nr = 0;

  /** Wie viele Fenster gerade offen sind. */
  get fenster(): number {
    return this.#hoerer.size;
  }

  /** Die Nummer der zuletzt gemeldeten Änderung; 0, solange keine kam. */
  get letzteNr(): number {
    return this.#nr;
  }

  /**
   * Meldet ein Fenster an und gibt den Griff zum Abmelden zurück.
   *
   * Die neue Fensterzahl geht sofort an alle, auch an das eben verbundene: Es
   * soll ohne zweite Anfrage wissen, ob es allein ist.
   */
  anmelden(hoerer: Hoerer): () => void {
    this.#hoerer.add(hoerer);
    this.#fensterzahlMelden();
    return () => {
      if (this.#hoerer.delete(hoerer)) this.#fensterzahlMelden();
    };
  }

  /**
   * Sagt allen anderen Fenstern, dass sich etwas geändert hat.
   *
   * @param ausser Das auslösende Fenster, das seine eigene Meldung nicht braucht.
   * @returns die zugestellte Änderung – für Tests und den Serverlog.
   */
  melde(was: { label: string; spreadIndex?: number | undefined }, ausser?: string): Aenderung {
    const aenderung: Aenderung = {
      nr: ++this.#nr,
      label: was.label,
      ...(was.spreadIndex !== undefined ? { spreadIndex: was.spreadIndex } : {}),
    };
    this.#zustellen('aenderung', aenderung, ausser);
    return aenderung;
  }

  #fensterzahlMelden(): void {
    this.#zustellen('fenster', { anzahl: this.#hoerer.size });
  }

  /**
   * Schreibt allen – und wirft keine Leitung dazwischen um.
   *
   * **Eine tote Leitung darf die übrigen nicht mitreißen.** Ohne diese Klammer
   * hinge die Zusage „alle offenen Fenster erfahren es" daran, dass sich jeder
   * Zuhörer an eine Absprache hält; ein einziger Wurf beendete die Schleife, und
   * die Fenster dahinter zeigten von da an einen Stand, den es nicht mehr gibt –
   * lautlos, denn niemand hat etwas bemerkt.
   *
   * Wer wirft, ist weg. Das `close`-Ereignis der Leitung ist der übliche Weg
   * hinaus, aber nicht der einzige: Eine halboffene Verbindung meldet sich nie
   * ab und bekäme sonst bis zum Serverende jede Zeile zugestellt. Abgemeldet
   * wird **nach** der Schleife – ein Abmelden meldet die neue Fensterzahl, und
   * das mitten in der Zustellung wäre eine Schleife in der Schleife.
   */
  #zustellen(art: string, daten: unknown, ausser?: string): void {
    let tot: Hoerer[] | undefined;
    for (const hoerer of this.#hoerer) {
      // Nur ein *benanntes* Fenster kann der Absender sein. Ohne diese Prüfung
      // schluckte ein `ausser`-Wert von `undefined` die Meldung an alle
      // namenlosen Zuhörer – und die sind gerade die, die jede brauchen.
      if (ausser !== undefined && hoerer.fenster === ausser) continue;
      try {
        hoerer.schreibe(art, daten);
      } catch {
        (tot ??= []).push(hoerer);
      }
    }
    if (!tot) return;
    let ging = false;
    for (const hoerer of tot) ging = this.#hoerer.delete(hoerer) || ging;
    if (ging) this.#fensterzahlMelden();
  }
}
