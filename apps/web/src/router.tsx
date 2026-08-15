/**
 * Die Adresse ist der Zustand der Navigation.
 *
 * Welche Ansicht offen ist und welche Doppelseite gezeigt wird, stand vorher in
 * `useState` und war damit unteilbar: Kein Zurück, kein neuer Tab, kein Link an
 * jemanden, der dieselbe Stelle sehen soll. Jetzt steht es im Pfad, und
 * `App.tsx` liest es von dort statt es zu halten.
 *
 * Warum ein eigener Haken und keine Router-Bibliothek: Es sind acht flache
 * Routen ohne verschachtelte Layouts, ohne Datenlader, ohne Formulare — und die
 * Oberfläche kommt sonst mit `useState` aus (siehe `.claude/rules/web.md`). Was
 * eine Bibliothek dafür mitbrächte, wäre ein zweites Konzept von Zustand neben
 * dem vorhandenen.
 *
 * **Pfad oder Query ist keine Geschmacksfrage:** Im Pfad steht, *was* man
 * ansieht — das ist die Station im Verlauf. In der Query bleibt, *wie* es
 * dargestellt wird: `?ui=a|b|c` (Rahmen), `?bare`, `?original`, `?width` für den
 * Parity-Test. Deshalb überdauert die Query jede Navigation, und ein
 * Variantenwechsel erzeugt weiter keinen Verlaufseintrag
 * (`spread/varianten.ts`).
 *
 * Die Pfade sind deutsch wie die Reiterbeschriftungen, denn eine Adresse ist
 * sichtbarer Text. Die Doppelseite zählt darin ab 1 — `/doppelseite/1` ist die
 * erste, so wie „Doppelseite 1" in Kennzahlen, Dialogen und Meldungen steht.
 * Der Index im Code bleibt bei 0.
 */
import { useCallback, useEffect, useState } from 'react';

export type View =
  | 'overview'
  | 'spread'
  | 'groups'
  | 'years'
  | 'fotodaten'
  | 'sources'
  | 'edit'
  | 'cover'
  | 'pruefung'
  | 'neuanordnen';

export type Route =
  | { view: 'overview' }
  /**
   * Die Doppelseite, wahlweise mit dem Platz, auf den geschaut werden soll.
   *
   * Der Platz steht im Pfad und nicht in der Query, weil er sagt, *was* man
   * ansieht: Aus der Abnahme springt man nicht auf eine Seite, sondern auf ein
   * Bild — bei acht Bildern auf einem Blatt ist das der Unterschied zwischen
   * einer Auskunft und einem Suchbild. Als Unterpfad wie `/aufteilung/json`,
   * damit ⌘-Klick ihn in einen zweiten Tab mitnimmt.
   */
  | { view: 'spread'; index: number; slotId?: string }
  /** Ohne `groupId` steht die Liste auf „Alle Fotos". */
  | { view: 'groups'; groupId?: string }
  | { view: 'years' }
  | { view: 'fotodaten' }
  | { view: 'sources' }
  /**
   * Die Aufteilung. Ohne `json` der Baum, mit `json` der Texteditor auf
   * demselben Gegenstand – deshalb ein Unterpfad und keine zweite Ansicht.
   */
  | { view: 'edit'; json?: true }
  | { view: 'cover' }
  /**
   * Die Prüfung. Ohne `teil` der Abnahmebericht, mit `doppel` die
   * Doppelvorschläge.
   *
   * Ein Reiter und zwei Bereiche, weil es dieselbe Frage ist — „was ist vor dem
   * Druck noch zu tun?" —, nur einmal am Buch und einmal am Bestand. Als
   * Unterpfad wie `/aufteilung/json`, damit ⌘-Klick den Bereich in einen zweiten
   * Tab mitnimmt.
   */
  | { view: 'pruefung'; teil?: 'doppel' }
  /**
   * Die Vorschau auf ein neu angeordnetes Buch.
   *
   * Eine eigene Station und kein Dialog über der Übersicht: Man liest sie
   * durch – achtzig Doppelseiten im Vorher/Nachher –, und was man dabei
   * ansieht, gehört in die Adresse wie jede andere Ansicht. Ein Dialog wäre
   * außerdem nach dem ersten Browser-Zurück weg, mitsamt der gerechneten Probe.
   */
  | { view: 'neuanordnen' };

/** Zeitfenster, in dem zwei Navigationen mit gleichem Schlüssel zu einer Station verschmelzen. */
const VERSCHMELZ_MS = 1500;

/** Pfad je Ansicht, ohne die Doppelseiten-Nummer und ohne Gruppenkennung. */
const PFADE: Record<View, string> = {
  overview: '/',
  spread: '/doppelseite',
  groups: '/gruppen',
  years: '/jahre',
  fotodaten: '/fotodaten',
  sources: '/bildquellen',
  edit: '/aufteilung',
  cover: '/umschlag',
  pruefung: '/pruefung',
  neuanordnen: '/neuanordnen',
};

/** Die Adresse zu einer Route — ohne Query, die hängt der Aufrufer daran. */
export function pfadVon(route: Route): string {
  if (route.view === 'spread') {
    const seite = `/doppelseite/${route.index + 1}`;
    return route.slotId ? `${seite}/platz/${encodeURIComponent(route.slotId)}` : seite;
  }
  if (route.view === 'groups' && route.groupId) {
    return `/gruppen/${encodeURIComponent(route.groupId)}`;
  }
  if (route.view === 'edit' && route.json) return '/aufteilung/json';
  if (route.view === 'pruefung' && route.teil) return `/pruefung/${route.teil}`;
  return PFADE[route.view];
}

/**
 * Die Route zu einer Adresse.
 *
 * Ein unbekannter Pfad ergibt die Übersicht statt einer Fehlerseite: Diese
 * Oberfläche hat keine Adressen, die von außen kommen, also ist ein Tippfehler
 * die einzige Quelle — und dann ist der Startpunkt die freundlichste Antwort.
 * `startRoute` schreibt sie anschließend in die Adresse zurück.
 *
 * Am Wurzelpfad gelten zusätzlich die alten Query-Adressen `?spread=n`
 * (0-basiert) und `?cover`. Sie sind in `docs/konzept.md` und im Parity-Test
 * verankert; sie fallenzulassen wäre eine Bruchstelle ohne Gegenwert.
 */
export function routeVon(pfad: string, suche = ''): Route {
  const teile = pfad.split('/').filter((t) => t.length > 0);
  const erstes = teile[0];

  if (erstes === undefined) {
    const q = new URLSearchParams(suche);
    if (q.has('cover')) return { view: 'cover' };
    const alt = q.get('spread');
    if (alt !== null) {
      const i = Number(alt);
      if (Number.isInteger(i) && i >= 0) return { view: 'spread', index: i };
    }
    return { view: 'overview' };
  }

  if (erstes === 'doppelseite') {
    const nr = Number(teile[1]);
    // Nach oben offen: Wie viele Doppelseiten das Buch hat, weiß hier niemand,
    // und der Server sagt es beim Laden deutlich genug.
    const index = Number.isInteger(nr) && nr >= 1 ? nr - 1 : 0;
    const platz = teile[2] === 'platz' ? teile[3] : undefined;
    return { view: 'spread', index, ...(platz ? { slotId: decodeURIComponent(platz) } : {}) };
  }

  if (erstes === 'gruppen') {
    const id = teile[1];
    return id ? { view: 'groups', groupId: decodeURIComponent(id) } : { view: 'groups' };
  }

  if (erstes === 'aufteilung') {
    return teile[1] === 'json' ? { view: 'edit', json: true } : { view: 'edit' };
  }

  if (erstes === 'pruefung') {
    return teile[1] === 'doppel' ? { view: 'pruefung', teil: 'doppel' } : { view: 'pruefung' };
  }

  // Die übrigen Ansichten tragen keine Kennung im Pfad.
  for (const view of ['years', 'fotodaten', 'sources', 'cover', 'neuanordnen'] as const) {
    if (PFADE[view] === `/${erstes}`) return { view };
  }
  return { view: 'overview' };
}

/** Beschriftung je Ansicht, für den Fenstertitel. */
const WORTE: Record<View, string> = {
  overview: 'Übersicht',
  spread: 'Doppelseite',
  groups: 'Gruppen',
  years: 'Jahre',
  fotodaten: 'Fotodaten',
  sources: 'Bildquellen',
  edit: 'Aufteilung',
  cover: 'Umschlag',
  pruefung: 'Prüfung',
  neuanordnen: 'Neu anordnen',
};

/**
 * Was im Fenstertitel steht.
 *
 * Nicht Zierde, sondern der Grund, warum die Verlaufsliste des Browsers benutzbar
 * ist: Achtzig Stationen namens „Franibook" wären eine Liste ohne Auskunft.
 */
export function titelVon(route: Route): string {
  if (route.view === 'spread') return `Franibook — Doppelseite ${route.index + 1}`;
  // Der Bereich gehört in den Titel: Beide Bereiche der Prüfung sind eigene
  // Stationen, und zwei Einträge namens „Prüfung" wären in der Verlaufsliste
  // genau die Auskunft, die sie sein sollen — keine.
  if (route.view === 'pruefung' && route.teil === 'doppel') return 'Franibook — Prüfung: Doppel';
  return `Franibook — ${WORTE[route.view]}`;
}

/** Route und Query der aktuellen Adresse. */
function ausAdresse(): Route {
  return routeVon(location.pathname, location.search);
}

/**
 * Query ohne die alten Navigationsparameter.
 *
 * `?spread` und `?cover` werden einmal beim Start gelesen und danach vom Pfad
 * abgelöst. Bleiben sie stehen, widersprechen sie ab der ersten Navigation der
 * Adresse, die sie erzeugt haben.
 */
export function querySauber(suche: string): string {
  // Von Hand zerlegt und nicht über `URLSearchParams.toString()`: Das
  // serialisiert einen Parameter ohne Wert als `bare=` und ändert damit die
  // Adresse, die der Parity-Test aufruft. Hier soll nichts geschehen außer dem,
  // was dasteht — zwei Parameter entfernen.
  const teile = suche
    .replace(/^\?/, '')
    .split('&')
    .filter((t) => t.length > 0 && !/^(spread|cover)(=|$)/.test(t));
  return teile.length > 0 ? `?${teile.join('&')}` : '';
}

/** Volle Adresse zu einer Route, mit der Query des aktuellen Fensters. */
function adresseVon(route: Route): string {
  return pfadVon(route) + querySauber(location.search);
}

/**
 * Route beim Laden — und die Adresse gleich in ihre Normalform.
 *
 * `/?spread=3` und `/doppelseite/4` sind dieselbe Stelle; nach dem Start ist nur
 * noch eine davon in der Adressleiste zu sehen. Das ist `replaceState`, weil das
 * Aufrufen der alten Adresse keine eigene Station im Verlauf ist.
 */
function startRoute(): Route {
  const route = ausAdresse();
  const soll = adresseVon(route);
  if (soll !== location.pathname + location.search) history.replaceState(null, '', soll);
  return route;
}

/**
 * Einen Darstellungsparameter in der Query setzen, ohne eine Station zu erzeugen.
 *
 * Für die Einstellungen, die in der Query stehen und nicht im Pfad – die
 * Bildgröße im Baum ist die erste, die sich zur Laufzeit ändert. Sie steht hier
 * und nicht in der Ansicht, weil die Adresse dem Router gehört: Ein zweiter
 * Ort, der `history` anfasst, ist genau der Anfang, an dessen Ende Adresse und
 * Ansicht auseinanderlaufen (der Architekturtest prüft es).
 *
 * `null` entfernt den Parameter.
 */
export function queryErsetzen(name: string, wert: string | null): void {
  const url = new URL(location.href);
  if (wert === null) url.searchParams.delete(name);
  else url.searchParams.set(name, wert);
  history.replaceState(history.state, '', url.toString());
}

export interface NavOptionen {
  /** Keine neue Station im Verlauf, sondern die aktuelle ersetzen. */
  ersetzen?: boolean;
  /**
   * Verschmelzschlüssel — zwei Navigationen mit gleichem Schlüssel innerhalb
   * von 1,5 s werden eine Station, wie beim Zurücknehmen am Server
   * (`routes/undo.ts`).
   *
   * Gedacht fürs Blättern: Wer mit den Pfeiltasten durch achtzig Doppelseiten
   * geht, will danach mit einem Zurück da sein, wo er losging, und nicht
   * achtzigmal drücken. Wer eine Seite aus der Übersicht anklickt, bekommt
   * dagegen eine Station — deshalb kein Schlüssel dort.
   */
  verschmelzen?: string;
}

/** Zustand der Verschmelzung. Modulweit, weil auch der Verlauf modulweit ist. */
let letzterSchluessel: string | null = null;
let letzteZeit = 0;

/**
 * Route lesen und setzen.
 *
 * Kein Kontext und kein Provider: Es gibt genau einen Aufrufer (`App.tsx`), und
 * alles darunter bekommt die Stelle wie vorher als Prop. Ein Provider würde
 * jeden Untermieter dazu verleiten, sich selbst zu navigieren — und damit wäre
 * die Frage, wo eine Navigation herkommt, nicht mehr an einer Stelle
 * beantwortet.
 */
export function useRoute(): [Route, (ziel: Route, opt?: NavOptionen) => void] {
  const [route, setRoute] = useState<Route>(startRoute);

  useEffect(() => {
    const onPop = () => setRoute(ausAdresse());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = titelVon(route);
  }, [route]);

  const navigieren = useCallback((ziel: Route, opt?: NavOptionen) => {
    const soll = adresseVon(ziel);
    const jetzt = Date.now();
    const verschmilzt =
      opt?.verschmelzen !== undefined &&
      opt.verschmelzen === letzterSchluessel &&
      jetzt - letzteZeit < VERSCHMELZ_MS;
    letzterSchluessel = opt?.verschmelzen ?? null;
    letzteZeit = jetzt;

    // Gleiche Adresse: gar nichts. Kein Verlaufseintrag, und auch kein
    // `setRoute` — eine Ansicht, die ihren Stand zurückmeldet (die Gruppenliste
    // tut das aus einem Effekt heraus), bekäme sonst ein neues Routenobjekt,
    // rendert daraufhin neu, meldet erneut, und das dreht sich endlos.
    if (soll === location.pathname + location.search) return;
    if (opt?.ersetzen || verschmilzt) history.replaceState(null, '', soll);
    else history.pushState(null, '', soll);
    setRoute(ziel);
  }, []);

  return [route, navigieren];
}

/**
 * Ein Reiter, der ein echter Link ist.
 *
 * Ein `<button>` mit `onClick` reicht für die Navigation, aber nicht für die
 * Handgriffe, die man an einem Reiter erwartet: Mittelklick und ⌘-Klick in einen
 * neuen Tab, Adresse kopieren, ziehen. Dafür braucht es ein `href` — und damit
 * der Browser nicht die Seite neu lädt, fängt `onClick` den einfachen Klick ab
 * und lässt jeden Klick mit Zusatztaste durch.
 */
export function Link({
  route,
  onNavigieren,
  style,
  title,
  children,
}: {
  route: Route;
  onNavigieren: (ziel: Route) => void;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={pfadVon(route)}
      title={title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onNavigieren(route);
      }}
      style={style}
    >
      {children}
    </a>
  );
}
