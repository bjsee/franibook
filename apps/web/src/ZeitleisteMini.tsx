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
  pageNumberInsetMm,
  profileById,
  sideTimelineBoxes,
  sideTimelinePreviewWindowMm,
  spreadHeightMm,
  spreadWidthMm,
  timelineBoxes,
  timelineFootPreviewWindowMm,
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
 * Wie groß die Miniatur auf dem Bildschirm wird.
 *
 * Der Ausschnitt selbst kommt aus dem Kern (`timelineFootPreviewWindowMm`,
 * `sideTimelinePreviewWindowMm`) und ist damit in jedem der acht Formate der
 * Bereich, in dem die Fassungen auseinandergehen. Nur der Maßstab gehört der
 * Oberfläche, denn er hängt an der Spalte und nicht am Papier: Am Fuß gibt die
 * Zeilenbreite den Maßstab (336 px Spalte minus Polsterung von Abschnitt und
 * Knopf), am Rand die Zeilenhöhe.
 *
 * Vorher standen hier vier feste Millimeterwerte, gerechnet gegen ein
 * 30 × 30er Format, das es unter den Profilen nicht gibt — am Vorgabeformat
 * 28 × 28 lag das Fenster 30 mm unter dem Fußraum und neben dem Band der
 * Randachse, und alle acht Miniaturen waren leer.
 */
const MASS = {
  foot: { breitePx: 272 },
  side: { hoehePx: 128 },
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
  /**
   * Ob das Buch Seitenzahlen trägt. Dann rückt die Achse ein, hier wie dort —
   * die Miniatur ist keine Nachbildung, sondern dieselbe Rechnung.
   */
  seitenzahlen?: boolean;
}

export function ZeitleisteMini({
  ort,
  fassung,
  akzent,
  background,
  printProfileId,
  seitenzahlen,
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
              // Genau wie im Buch: Trägt es Seitenzahlen, rückt die Achse ein.
              // Ohne das zeigte die Miniatur, an der man die Fassung wählt, eine
              // andere Achse als die Seite darunter — und die Miniatur ist
              // ausdrücklich keine Nachbildung.
              ...(seitenzahlen ? { insetMm: pageNumberInsetMm() } : {}),
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
  }, [ort, fassung, akzent, background, profile, seitenzahlen]);

  // Das Fenster rechnet der Kern, der Maßstab folgt der Spalte: Am Fuß aus der
  // Zeilenbreite, am Rand aus der Zeilenhöhe. So bleibt die Zeile in jedem
  // Format gleich groß, obwohl der Ausschnitt in Millimetern verschieden ist.
  const fenster =
    ort === 'side'
      ? sideTimelinePreviewWindowMm(profile, {
          fromYear: BEISPIEL.bookYears.from,
          toYear: BEISPIEL.bookYears.to,
          at: BEISPIEL.at,
        })
      : timelineFootPreviewWindowMm(profile, {
          ...(seitenzahlen ? { insetMm: pageNumberInsetMm() } : {}),
        });
  const spanneX = fenster.x1 - fenster.x0;
  const spanneY = fenster.y1 - fenster.y0;
  const pxPerMm = ort === 'side' ? MASS.side.hoehePx / spanneY : MASS.foot.breitePx / spanneX;
  const breite = spanneX * pxPerMm;
  const hoehe = spanneY * pxPerMm;

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
          left: -fenster.x0 * pxPerMm,
          top: -fenster.y0 * pxPerMm,
        }}
      >
        <SpreadView
          spread={spread}
          widthPx={spreadWidthMm(profile) * pxPerMm}
          imageSrc={() => ''}
        />
      </div>
    </div>
  );
}
