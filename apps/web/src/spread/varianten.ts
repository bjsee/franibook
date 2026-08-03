/**
 * Drei Rahmen um dieselbe Bühne, umschaltbar.
 *
 * Ob eine feste Seitenspalte, eine schwebende Leiste oder fast nichts besser
 * trägt, merkt man beim Durcharbeiten von achtzig Doppelseiten und nicht am
 * Entwurf. Also stehen alle drei zur Wahl, bis eine gewonnen hat.
 *
 * Zwei Wege dorthin, weil zum Vergleichen beide gebraucht werden: `?ui=a|b|c` in
 * der Adresse — dieselbe Konvention wie `?bare` und `?cover` — für zwei Fenster
 * nebeneinander, und ein Umschalter in der Kopfzeile für den schnellen Wechsel.
 * Die Adresse gewinnt, wenn sie etwas sagt; sonst gilt, was zuletzt gewählt
 * wurde.
 */

export type Variante = 'a' | 'b' | 'c';

export const VARIANTEN: { id: Variante; name: string; hinweis: string }[] = [
  {
    id: 'a',
    name: 'Inspektor',
    hinweis: 'Feste Spalte rechts, die der Auswahl folgt. Nachbarn und Fotopool im Fuß.',
  },
  {
    id: 'b',
    name: 'Werkbank',
    hinweis: 'Das ganze Buch als Kachelbaum links, Werkzeuge schwebend über der Seite.',
  },
  {
    id: 'c',
    name: 'Lesetisch',
    hinweis: 'Dunkler Grund, Filmstreifen, alles andere auf Tastendruck.',
  },
];

const SCHLUESSEL = 'franibook.ui';

function istVariante(wert: string | null): wert is Variante {
  return wert === 'a' || wert === 'b' || wert === 'c';
}

/** Welche Variante beim Laden gilt. */
export function varianteLesen(): Variante {
  const ausAdresse = new URLSearchParams(location.search).get('ui');
  if (istVariante(ausAdresse)) return ausAdresse;
  try {
    const gemerkt = localStorage.getItem(SCHLUESSEL);
    if (istVariante(gemerkt)) return gemerkt;
  } catch {
    // Privates Fenster oder abgeschalteter Speicher: dann eben die Vorgabe.
  }
  return 'a';
}

/**
 * Wahl merken und in die Adresse schreiben.
 *
 * `replaceState` und nicht `pushState`: Ein Variantenwechsel ist keine Station
 * im Verlauf, sondern eine Einstellung — sonst müsste man sich mit der
 * Zurück-Taste durch fünf Wechsel arbeiten.
 */
export function varianteMerken(v: Variante) {
  try {
    localStorage.setItem(SCHLUESSEL, v);
  } catch {
    // siehe oben
  }
  const url = new URL(location.href);
  url.searchParams.set('ui', v);
  history.replaceState(null, '', url);
}
