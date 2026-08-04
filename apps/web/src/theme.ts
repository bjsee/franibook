/**
 * Die Bausteine der Oberfläche.
 *
 * Zwei Ausfuhren: `T` sind die Werte aus `theme.css` als `var()`-Verweise, `B`
 * sind die daraus gebauten Stile — Knopf, Chip, Segmentschalter, Panelabschnitt.
 * Die Komponenten setzen ihre Stile weiter inline (so wie im ganzen Repo), aber
 * sie erfinden Rahmen, Radien und Polsterung nicht mehr je Datei neu: Vorher
 * standen sieben Fassungen desselben Knopfes in sieben Ansichten, und jede
 * wich um ein Pixel ab.
 *
 * `T` verweist auf Custom Properties statt auf Hexwerte, damit es genau eine
 * Quelle gibt. Der Preis ist, dass die Werte in TypeScript nicht rechenbar sind
 * — gebraucht wird das nur bei den Auflösungsfarben, und die stehen deshalb als
 * Funktion unten mit ihren Hexwerten.
 *
 * Die beiden Farbregeln aus `theme.css` gelten hier weiter: Türkis markiert
 * Auswahl und Aktion, sonst nichts. Rot, Gelb und Grün tragen ausschließlich
 * Zustände der Auflösung und der Bildquellen — ein rotes Feld ist also immer
 * eine Aussage über das Buch und niemals über die Bedienung.
 */

/** Die Werte aus `theme.css`, als `var()` für Inline-Stile. */
export const T = {
  fg1: 'var(--fg-1)',
  fg2: 'var(--fg-2)',
  fg3: 'var(--fg-3)',
  fg4: 'var(--fg-4)',
  bg1: 'var(--bg-1)',
  bg2: 'var(--bg-2)',
  bg3: 'var(--bg-3)',
  line: 'var(--line)',
  line2: 'var(--line-2)',
  cyan: 'var(--cyan-500)',
  cyanTief: 'var(--cyan-700)',
  cyanZart: 'var(--cyan-50)',
  cyanRand: 'var(--cyan-100)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  warnBg: 'var(--warn-bg)',
  warnRand: 'var(--warn-border)',
  warnText: 'var(--warn-text)',
  fehler: 'var(--error)',
  fehlerRand: 'var(--error-border)',
  display: 'var(--font-display)',
  mono: 'var(--font-mono)',
  rSm: 'var(--r-sm)',
  rMd: 'var(--r-md)',
  rLg: 'var(--r-lg)',
  rPill: 'var(--r-pill)',
  schattenBuehne: 'var(--shadow-stage)',
  schattenSchwebend: 'var(--shadow-float)',
  schattenSeg: 'var(--shadow-seg)',
} as const;

/** Zahlen, die die Oberfläche wiederholt braucht. */
export const MASSE = {
  /** Breite der Seitenspalte. Genug für „Trägt bis 214 × 160 mm." in zwei Zeilen. */
  spalte: 336,
  /** Höhe der Kopfzeile. */
  kopf: 60,
  /** Höhe der Kennzahlenzeile. */
  kennzahlen: 44,
} as const;

const knopfBasis = {
  font: 'inherit',
  fontSize: 13,
  padding: '7px 12px',
  borderRadius: T.rMd,
  cursor: 'pointer',
} as const;

export const B = {
  // ─────────────────────────────────────────────────────────── Knöpfe

  /** Der Normalfall: weiß auf warmem Grund, sichtbarer Rahmen. */
  knopf: {
    ...knopfBasis,
    border: `1px solid ${T.line2}`,
    background: T.bg1,
    color: T.fg1,
  },
  /**
   * Ein eingeschalteter Umschalter — Hilfslinien, Bildinfos, Fotopool.
   *
   * Türkis und nicht fett: Der Zustand ist die Aussage, nicht die Wichtigkeit.
   */
  knopfAn: {
    ...knopfBasis,
    border: `1px solid ${T.cyanRand}`,
    background: T.cyanZart,
    color: T.cyanTief,
  },
  /** Die eine Aktion, die auf einer Ansicht zählt. Höchstens eine je Ansicht. */
  knopfPrimaer: {
    font: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    padding: '9px 18px',
    border: 'none',
    borderRadius: T.rMd,
    background: T.cyan,
    color: '#fff',
    cursor: 'pointer',
  },
  /**
   * Was etwas aus dem Buch oder von der Platte nimmt.
   *
   * Rot am Rahmen und in der Schrift, nie in der Fläche: Ein rot gefüllter
   * Knopf zieht mehr Blick als der Vorgang wert ist, und es sind mehrere.
   */
  knopfWeg: {
    ...knopfBasis,
    border: `1px solid ${T.fehlerRand}`,
    background: T.bg1,
    color: T.fehler,
  },
  /** Kleiner Griff in einer Zeile, die schon voll ist. */
  knopfKlein: {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg2,
    cursor: 'pointer',
  },
  /** Ein Wort im Fließtext, das etwas tut („neu anordnen"). */
  knopfText: {
    font: 'inherit',
    padding: 0,
    border: 'none',
    background: 'none',
    color: T.fehler,
    textDecoration: 'underline',
    cursor: 'pointer',
  },

  // ────────────────────────────────────── Segmentschalter und Reiter

  /**
   * Der Kasten um einen Segmentschalter.
   *
   * Die Vertiefung sitzt außen und die Erhebung innen: Das gewählte Segment
   * liegt weiß auf dem warmen Grund, statt farbig zu leuchten. Bei sieben
   * Reitern in der Kopfzeile ist das der Unterschied zwischen Navigation und
   * Jahrmarkt.
   */
  segRahmen: {
    display: 'flex',
    gap: 2,
    background: T.bg3,
    padding: 3,
    borderRadius: 6,
  },
  /*
   * `textDecoration` und `display` stehen mit dabei, weil die Reiter der
   * Kopfzeile Links sind (⌘-Klick in einen neuen Tab, Adresse kopieren) und ein
   * `<a>` sonst unterstrichen und ohne senkrechte Polsterung erscheint. Für die
   * übrigen Segmentschalter, die Knöpfe sind, ändert es nichts.
   */
  segAn: {
    font: 'inherit',
    fontSize: 13,
    display: 'inline-block',
    padding: '6px 13px',
    border: 'none',
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    fontWeight: 600,
    boxShadow: T.schattenSeg,
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
  },
  segAus: {
    font: 'inherit',
    fontSize: 13,
    display: 'inline-block',
    padding: '6px 13px',
    border: 'none',
    borderRadius: T.rMd,
    background: 'none',
    color: T.fg2,
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
  },

  // ──────────────────────────────── Pillen (schwebende Leisten, 1b/1c)

  pilleAn: {
    font: 'inherit',
    fontSize: 13,
    padding: '6px 12px',
    border: 'none',
    borderRadius: T.rPill,
    background: T.cyanZart,
    color: T.cyanTief,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pilleAus: {
    font: 'inherit',
    fontSize: 13,
    padding: '6px 12px',
    border: 'none',
    borderRadius: T.rPill,
    background: 'none',
    color: T.fg2,
    cursor: 'pointer',
  },

  // ─────────────────────────────────────────────────────────── Chips

  /** Eine Marke, die auch ein Sprung sein kann — Gruppe, Textblock. */
  chip: {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 10px',
    border: `1px solid ${T.line}`,
    borderRadius: T.rPill,
    background: T.bg1,
    color: T.fg3,
    cursor: 'pointer',
    maxWidth: '14rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chipAn: {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 10px',
    border: `1px solid ${T.cyanRand}`,
    borderRadius: T.rPill,
    background: T.cyanZart,
    color: T.cyanTief,
    cursor: 'pointer',
    maxWidth: '14rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // ───────────────────────────────────────────── Listen und Filter

  /** Eine Zeile in der Gruppenliste: Titel links, Zahl rechts. */
  filter: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 8px',
    border: '1px solid transparent',
    borderRadius: T.rMd,
    background: 'none',
    color: T.fg1,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    textAlign: 'left' as const,
  },
  filterAn: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 8px',
    border: `1px solid ${T.cyanRand}`,
    borderRadius: T.rMd,
    background: T.cyanZart,
    color: T.cyanTief,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'left' as const,
  },
  /** Winzige Umschalter, die nur eine Reihenfolge wählen. */
  sortAn: {
    font: 'inherit',
    fontSize: 11,
    padding: '3px 8px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rPill,
    background: T.bg3,
    color: T.fg1,
    fontWeight: 600,
    cursor: 'pointer',
  },
  sortAus: {
    font: 'inherit',
    fontSize: 11,
    padding: '3px 8px',
    border: '1px solid transparent',
    borderRadius: T.rPill,
    background: 'none',
    color: T.fg3,
    cursor: 'pointer',
  },

  // ───────────────────────────────────────────────────────── Felder

  feld: {
    font: 'inherit',
    fontSize: 13,
    padding: '9px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
  },
  feldMono: {
    fontFamily: T.mono,
    fontSize: 13,
    padding: '9px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
  },
  auswahl: {
    font: 'inherit',
    fontSize: 13,
    padding: '7px 10px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    maxWidth: '14rem',
  },
  /** Ein Kästchen mit Beschriftung. */
  haken: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    color: T.fg2,
    cursor: 'pointer',
  },
  regler: { width: 96 },

  // ────────────────────────────────────────── Panels und Abschnitte

  /**
   * Ein Abschnitt der Seitenspalte.
   *
   * Getrennt durch Haarlinien und nicht durch Karten: Die Spalte ist schmal,
   * und acht gerahmte Kästen darin verschenken je zwei Pixel an jeder Kante an
   * Rahmen, die nichts abgrenzen, was nicht schon die Linie abgrenzt.
   */
  abschnitt: {
    padding: '18px 20px',
    borderBottom: `1px solid ${T.line}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  /** Die Überschrift eines Abschnitts: Versalien, weit gesperrt, klein. */
  marke: {
    fontSize: 11,
    letterSpacing: 'var(--tracking-caps)',
    textTransform: 'uppercase' as const,
    color: T.fg3,
  },
  /** Ein schwebendes Panel — nur in der Werkbank und am Lesetisch. */
  schwebend: {
    background: T.bg1,
    border: `1px solid ${T.line}`,
    borderRadius: T.rLg,
    boxShadow: T.schattenSchwebend,
    padding: 16,
  },

  // ─────────────────────────────────────────────────────────── Text

  titel: {
    fontFamily: T.display,
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  /** Eine Kennzahl: Displayschrift, Ziffern gleich breit. */
  zahl: {
    fontFamily: T.display,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  leise: { fontSize: 13, color: T.fg2 },
  leiser: { fontSize: 12, color: T.fg3, lineHeight: 1.5 },
  dateiname: { fontFamily: T.mono, fontSize: 13, color: T.fg1 },

  // ────────────────────────────────────────────────────── Meldungen

  /**
   * Ein Hinweis, der zum Handeln auffordert, aber nichts blockiert.
   *
   * Gelb hinterlegt: Es ist die Sorte Meldung, die stehen bleibt, bis man etwas
   * tut („Gruppen geändert"), und die deshalb nicht in der Farbe des Fehlers
   * stehen darf.
   */
  warnung: {
    fontSize: 12,
    color: T.warn,
    background: T.warnBg,
    border: `1px solid ${T.warnRand}`,
    borderRadius: T.rMd,
    padding: '4px 10px',
    lineHeight: 1.5,
  },
  fehlerfeld: {
    fontSize: 13,
    color: T.fehler,
    background: T.bg1,
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: T.rMd,
    padding: '6px 10px',
    lineHeight: 1.5,
  },
  /** Was gerade geschehen ist. Verschwindet mit der nächsten Handlung. */
  meldung: { fontSize: 13, color: T.fg2, fontFamily: T.mono },

  // ───────────────────────────────────────────────────────── Sonstiges

  /** Die Bühne: Papier, das über der Fläche liegt. */
  buehne: { boxShadow: T.schattenBuehne, lineHeight: 0 },
  /** Eine Miniatur einer Doppelseite. */
  /* `display: block`, weil die Kachel in der Übersicht ein Link ist – siehe `segAn`. */
  kachel: {
    display: 'block',
    padding: 0,
    border: `1px solid ${T.line}`,
    background: T.bg1,
    cursor: 'pointer',
    lineHeight: 0,
    overflow: 'hidden',
  },
  kachelAn: { borderColor: T.cyan },
  dehner: { flex: 1 },
  trenner: { width: 1, height: 18, background: T.line, flexShrink: 0 },
} satisfies Record<string, React.CSSProperties>;

/**
 * Die Farbe einer Auflösungsangabe.
 *
 * Zwei Schwellen und nicht eine, aus einem gemessenen Grund: Bei 30 × 30 cm
 * liegt ein großer Teil dieses Bestands unter der Zielauflösung von 300 dpi.
 * Eine rote Marke dort markiert den Normalfall und ist damit wertlos. Rot ist
 * deshalb nur, was unter die Mindestauflösung fällt; dazwischen steht Gelb für
 * „trägt, aber knapp".
 *
 * Hexwerte statt `var()`, weil die Funktion einen einzelnen Farbwert liefert und
 * an Stellen benutzt wird, die ihn weiterrechnen (Balkenfüllung, Kachelrahmen).
 */
export function dpiFarbe(dpi: number, minDpi: number, targetDpi: number): string {
  if (dpi < minDpi) return '#b9442b';
  if (dpi < targetDpi) return '#c98a14';
  return '#2f8f5b';
}
