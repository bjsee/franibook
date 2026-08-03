/**
 * Wie groß die Bühne sein darf.
 *
 * Die App scrollt nicht als Ganzes, also bekommt die Doppelseite den Platz, der
 * zwischen Kopf-, Fuß- und Seitenleisten übrig bleibt — und muss sich in beide
 * Richtungen einpassen. Ein Blatt von 606 × 306 mm ist fast doppelt so breit wie
 * hoch; in einem hohen, schmalen Fenster begrenzt die Breite, in einem breiten,
 * flachen die Höhe. Gerechnet wird deshalb aus beidem, und übrig bleibt die
 * kleinere der zwei möglichen Breiten.
 *
 * Gemessen wird der Kasten und nicht das Blatt: Das Blatt bekommt seine Breite
 * von hier, es kann sie also nicht selbst hergeben.
 *
 * Und gemessen wird der **Inhaltskasten**, nicht `clientWidth`/`clientHeight` —
 * die zählen die Polsterung mit. Bei der Werkbank sind das 102 Pixel senkrecht
 * (28 oben, 74 unten, damit die schwebende Leiste nicht auf dem Papier liegt);
 * mitgerechnet ergaben sie eine um gut zweihundert Pixel zu breite Bühne, die
 * den Fotopool aus dem Bild schob. `ResizeObserver` liefert die Maße des
 * Inhaltskastens ohnehin frei Haus.
 */
import { useEffect, useRef, useState } from 'react';

/** Kleinste Breite, unter der die Bühne nicht mehr zu gebrauchen ist. */
const MINDESTBREITE = 320;

export function usePlatz(seitenverhaeltnis: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [platz, setPlatz] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /** Ohne Beobachter-Eintrag: aus dem Rahmenkasten die Polsterung herausrechnen. */
    const messen = () => {
      const s = getComputedStyle(el);
      setPlatz({
        w: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
        h: el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom),
      });
    };
    messen();

    const ro = new ResizeObserver((eintraege) => {
      const kasten = eintraege[0]?.contentBoxSize?.[0];
      if (kasten) setPlatz({ w: kasten.inlineSize, h: kasten.blockSize });
      else messen();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const breite =
    platz.w <= 0 || platz.h <= 0
      ? MINDESTBREITE
      : Math.max(MINDESTBREITE, Math.min(platz.w, platz.h * seitenverhaeltnis));

  return { ref, breite: Math.floor(breite) };
}
