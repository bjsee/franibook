/**
 * Doppelseiten als Miniaturen laden – nur die, die man sieht.
 *
 * Zwei Ansichten brauchen dasselbe: die Übersicht mit allen achtzig Kacheln und
 * der Buchnavigator der Werkbank. Bei achtzig Doppelseiten mit je bis zu zwölf
 * Bildern wäre alles auf einmal weder für den Speicher noch für das Netz
 * sinnvoll, also lädt ein `IntersectionObserver` nach, was in Sichtweite kommt.
 *
 * Der Beobachter hängt an `[data-index]`: Die Kachel sagt selbst, welche
 * Doppelseite sie zeigt. Damit muss dieser Haken nichts über die Anordnung
 * wissen – Gitter, Jahresblöcke oder eine Reihe funktionieren gleich.
 */
import { useEffect, useRef, useState } from 'react';
import type { RenderedSpread } from '@franibook/core';
import { doppelseiteLaden } from '../api.js';

/** Was die Kacheln über eine Doppelseite hinaus brauchen. */
export type Kachel = RenderedSpread & { locked?: boolean; splittable?: boolean };

export function useSpreadTiles(spreadCount: number, version = 0) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [geladen, setGeladen] = useState<Map<number, Kachel>>(new Map());
  const [sichtbar, setSichtbar] = useState<Set<number>>(new Set());

  // Ein Neuaufbau des Buches macht jede geladene Kachel ungültig: Dieselbe
  // Nummer zeigt danach andere Bilder.
  useEffect(() => setGeladen(new Map()), [version, spreadCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setSichtbar((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset['index']);
            if (entry.isIntersecting) next.add(idx);
          }
          return next;
        });
      },
      { root: null, rootMargin: '400px' },
    );

    for (const kachel of el.querySelectorAll('[data-index]')) observer.observe(kachel);
    return () => observer.disconnect();
  }, [spreadCount]);

  useEffect(() => {
    const fehlend = [...sichtbar].filter((i) => !geladen.has(i));
    if (fehlend.length === 0) return;

    let abgebrochen = false;
    void Promise.all(
      fehlend.map((i) =>
        doppelseiteLaden(i)
          .then((data) => [i, data] as const)
          .catch(() => [i, null] as const),
      ),
    ).then((paare) => {
      if (abgebrochen) return;
      setGeladen((prev) => {
        const next = new Map(prev);
        for (const [i, data] of paare) if (data) next.set(i, data);
        return next;
      });
    });

    return () => {
      abgebrochen = true;
    };
  }, [sichtbar, geladen]);

  return { containerRef, geladen };
}
