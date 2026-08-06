/**
 * Miniatur einer Zeitleisten-Fassung.
 *
 * Der Wähler im Buchpanel zeigt Zeichnungen und keine Wörter: „Kalenderband"
 * sagt nichts darüber, ob man es haben will. Also zeichnet jede Zeile ihre
 * Fassung – und zwar mit derselben Geometrie, die auch ins Buch geht.
 *
 * **Keine zweite Wahrheit.** Die Boxen kommen aus `timelineBoxes` bzw.
 * `sideTimelineBoxes` im Kern, gezeichnet werden sie von `SpreadView`, also vom
 * Renderer der Bühne. Die Miniatur ist damit kein dritter Renderer, sondern
 * dieselbe Kette bei kleinerem Maßstab und auf einen Ausschnitt beschnitten.
 * Möglich ist das, weil `@franibook/core` I/O-frei und im Browser lauffähig ist;
 * gerechnet wird hier nichts, was das Buch betrifft.
 *
 * **Warum ein Ausschnitt.** Der Fußstrahl ist 584 mm breit, die Randachse
 * 248 mm hoch. Ganz gezeigt wäre beides ein Strich. Der Ausschnitt liegt
 * deshalb dort, wo eine Fassung sich von den anderen unterscheidet: am Fuß über
 * der Jahresgrenze und dem Marker, am Rand über dem Marker und der nächsten
 * Jahreszahl.
 */
import { useMemo } from 'react';
import {
  accentOn,
  defaultProfile,
  profileById,
  sideTimelineBoxes,
  spreadHeightMm,
  spreadWidthMm,
  timelineBoxes,
  type NaiveDateTime,
  type RenderedSpread,
  type TimelineFootVariant,
  type TimelineSideVariant,
} from '@franibook/core';
import { SpreadView } from '@franibook/render-dom';

/**
 * Das Profil des gewählten Formats.
 *
 * Nicht mehr fest `defaultProfile()`: Die Miniatur zeigt dieselbe Geometrie,
 * die ins Buch geht, und die hängt am Format. Aufgelöst wird hier und nicht
 * über den Server, weil `@franibook/core` im Browser läuft – die Oberfläche
 * hat die Profile bereits.
 */
function profilVon(id: string | undefined) {
  return (id ? profileById(id) : undefined) ?? defaultProfile();
}

/**
 * Die Doppelseite, die die Miniaturen vorführen.
 *
 * Vier Aufnahmen im Mai 2017, Median am 21. – eine Spanne von knapp zwei
 * Monaten, also etwas unter dem Median des Bestands von 2,6. Fest gewählt und
 * nicht aus dem geöffneten Buch genommen: Der Wähler soll vier Fassungen
 * vergleichbar zeigen, und das geht nur, wenn alle dieselbe Seite zeichnen.
 */
const BEISPIEL = {
  dates: [
    '2017-04-18T14:20:00',
    '2017-05-14T11:05:00',
    '2017-05-21T16:40:00',
    '2017-06-09T09:15:00',
  ] as NaiveDateTime[],
  label: 'Pfingsten am Meer',
  /** Der Median, den die Randachse als Stelle im Buch braucht. */
  at: '2017-05-21T16:40:00' as NaiveDateTime,
  bookYears: { from: 2008, to: 2026 },
};

/**
 * Die Ausschnitte, in Millimetern der Druckfläche.
 *
 * Am Fuß von der Jahresgrenze (108 mm) bis kurz hinter den Marker: Damit sind
 * die Jahreszahl, der Wechsel zwischen Randmonat und Kapiteljahr und der Marker
 * gleichzeitig zu sehen – die drei Stellen, an denen die vier Fassungen
 * auseinandergehen. Am Rand von der Beschnittkante bis in den Sicherheitsrand,
 * senkrecht um den Marker herum und weit genug, dass die Jahresleiter noch eine
 * ihrer Zahlen zeigt (alle fünf Jahre).
 */
const AUSSCHNITT = {
  // 200 mm auf 272 px: die Zeilenbreite der Seitenspalte (336 minus Polsterung
  // des Abschnitts und des Knopfes). Breiter geriete die Zeichnung über den
  // Rahmen des Knopfes hinaus.
  foot: { x0: 100, x1: 300, y0: 280.5, y1: 295.5, pxPerMm: 1.36 },
  side: { x0: 2.5, x1: 11.5, y0: 118, y1: 176, pxPerMm: 2.2 },
} as const;

export interface ZeitleisteMiniProps {
  ort: 'foot' | 'side';
  fassung: TimelineFootVariant | TimelineSideVariant;
  /**
   * Gewählte Akzentfarbe. Ohne Angabe leitet die Miniatur sie mit `accentOn`
   * aus dem Papierton ab – genau wie `render-spread` es für die Bühne tut. Der
   * Rückfallwert des Kerns (Kobalt) wäre hier falsch: Er kommt im Buch nie vor.
   */
  akzent?: string;
  /** Papierton der Doppelseite – die Miniatur zeigt das Buch, nicht die Oberfläche. */
  background: string;
  /** Kennung des Druckprofils; ohne Angabe die Vorgabe. */
  printProfileId?: string;
}

export function ZeitleisteMini({
  ort,
  fassung,
  akzent,
  background,
  printProfileId,
}: ZeitleisteMiniProps) {
  const profile = profilVon(printProfileId);
  const spread = useMemo<RenderedSpread>(() => {
    const accentColor = akzent ?? accentOn(background);
    const boxes =
      ort === 'side'
        ? sideTimelineBoxes(
            {
              background,
              fromYear: BEISPIEL.bookYears.from,
              toYear: BEISPIEL.bookYears.to,
              at: BEISPIEL.at,
              variant: fassung as TimelineSideVariant,
              accentColor,
            },
            profile,
          )
        : timelineBoxes(
            {
              background,
              dates: BEISPIEL.dates,
              label: BEISPIEL.label,
              variant: fassung as TimelineFootVariant,
              accentColor,
            },
            profile,
          );

    return {
      spreadId: `mini-${ort}-${fassung}`,
      widthMm: spreadWidthMm(profile),
      heightMm: spreadHeightMm(profile),
      bleedMm: profile.page.bleedMm,
      gutterXMm: profile.page.bleedMm + profile.page.trimWidthMm,
      background,
      boxes,
      guides: [],
    };
  }, [ort, fassung, akzent, background, profile]);

  const a = AUSSCHNITT[ort];
  const breite = (a.x1 - a.x0) * a.pxPerMm;
  const hoehe = (a.y1 - a.y0) * a.pxPerMm;

  return (
    <div
      style={{
        width: breite,
        height: hoehe,
        // Beschnitt statt eigener Zeichnung: Die Bühne rendert die ganze
        // Doppelseite, sichtbar ist nur das Fenster.
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        borderRadius: 2,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -a.x0 * a.pxPerMm,
          top: -a.y0 * a.pxPerMm,
        }}
      >
        <SpreadView
          spread={spread}
          widthPx={spreadWidthMm(profile) * a.pxPerMm}
          imageSrc={() => ''}
        />
      </div>
    </div>
  );
}
