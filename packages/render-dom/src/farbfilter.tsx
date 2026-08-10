/**
 * Die Bildanpassung in der Vorschau: ein SVG-Filter je angepasstem Bild.
 *
 * Ein SVG-Filter und nicht die CSS-Kurzformen (`filter: brightness(…)
 * contrast(…) sepia(…)`): Die Kurzformen sind zwar über dieselben Matrizen
 * definiert, aber der Kern liefert eine einzige verkettete Abbildung, und die
 * ließe sich in Kurzformen gar nicht ausdrücken – die Wärme hat keine, und die
 * Reihenfolge der Verkettung wäre eine zweite Wahrheit über dieselbe Rechnung.
 * Hier wird die Matrix aus dem Modell nur noch hingeschrieben.
 *
 * `color-interpolation-filters="sRGB"` ist dabei nicht Beiwerk, sondern der
 * ganze Punkt: SVG rechnet Filter **ohne** diese Angabe in linearem Licht, und
 * dann käme etwas anderes heraus als bei sharp – nicht ein Digit anders,
 * sondern sichtbar anders. Der Parity-Test misst genau das.
 *
 * Eine eigene Datei, weil Doppelseite und Umschlag beide Bildboxen zeichnen und
 * dieselbe Anpassung tragen: Zwei Fassungen wären zwei Gelegenheiten, eine der
 * beiden Angaben zu vergessen.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { ColorMatrix, CoverBox, ImageBox, RenderBox } from '@franibook/core';

/**
 * Die angepassten Bildboxen einer Liste.
 *
 * Hier und nicht über `imageBoxes` aus dem Kern: Ein Adapter darf aus
 * `@franibook/core` Typen frei beziehen, Werte aber nur aus `geometry/units.ts`
 * und `render/typography.ts` (`.claude/rules/adapter-parity.md`, geprüft von
 * `tests/architektur/`). Die Grenze ist eng gezogen, damit gar nicht erst eine
 * Rechnung des Kerns in einem Renderer landet – und für ein Prädikat auf
 * `kind === 'image'` sie aufzuweichen wäre der falsche Tausch.
 */
function angepassteBilder(boxes: readonly (RenderBox | CoverBox)[]): ImageBox[] {
  return boxes.filter(
    (b): b is ImageBox =>
      b.kind === 'image' &&
      !!b.colorMatrix &&
      // Ein Bild über der Falzachse steht als zwei Boxen mit derselben Kennung;
      // die Filterkennung entsteht daraus. Zwei `<filter id="…">` mit gleicher
      // Kennung wären ein doppelt vergebener Name, und beide Hälften brauchen
      // ohnehin dieselbe Matrix – eine Definition genügt für beide.
      b.gutterPart !== 'rechts',
  );
}

/** Die zwanzig Werte einer `feColorMatrix` aus der affinen Abbildung. */
export function farbmatrixWerte(cm: ColorMatrix): string {
  const [rr, rg, rb, gr, gg, gb, br, bg, bb] = cm.m;
  return [
    `${rr} ${rg} ${rb} 0 ${cm.o[0]}`,
    `${gr} ${gg} ${gb} 0 ${cm.o[1]}`,
    `${br} ${bg} ${bb} 0 ${cm.o[2]}`,
    '0 0 0 1 0',
  ].join(' ');
}

/**
 * Die Filterdefinitionen aller angepassten Bilder, als unsichtbares SVG.
 *
 * `praefix` macht die Kennungen im Dokument eindeutig – in der Übersicht stehen
 * Dutzende Doppelseiten nebeneinander. Er kommt vom Aufrufer aus `useId`.
 */
export function Farbfilter({
  praefix,
  boxes,
}: {
  praefix: string;
  boxes: readonly (RenderBox | CoverBox)[];
}): ReactNode {
  const angepasst = angepassteBilder(boxes);
  if (angepasst.length === 0) return null;

  return (
    <svg aria-hidden width="0" height="0" style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {angepasst.map((box) => (
          <filter
            key={box.slotId}
            id={`${praefix}-${box.slotId}`}
            colorInterpolationFilters="sRGB"
            // Der Filterbereich genau auf das Bild: Die Vorgabe wäre 110 % in
            // jede Richtung, und ein größerer Bereich verschiebt die Rasterung
            // der gefilterten Fläche gegenüber der ungefilterten. Bei einer
            // reinen Farbabbildung ist nichts auszudehnen.
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feColorMatrix type="matrix" values={farbmatrixWerte(box.colorMatrix!)} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

/** Der Stil, der ein Bild auf seinen Filter verweist – oder nichts. */
export function farbfilterStil(praefix: string, box: ImageBox): CSSProperties {
  return box.colorMatrix ? { filter: `url(#${praefix}-${box.slotId})` } : {};
}

/**
 * Filterkennungen ohne die Doppelpunkte, die React in `useId` einbaut.
 *
 * Sie stehen in `url(#…)` zwar zulässig, aber niemand liest das gern im
 * Fehlerfall.
 */
export function filterPraefix(id: string): string {
  return id.replace(/:/g, '');
}
