/**
 * Die Adresse eines Bildes — und warum die Fassung darin steht.
 *
 * Die Bild-Endpunkte liefern mit `Cache-Control: public, max-age=31536000,
 * immutable` aus. Das ist erlaubt, weil die Fotokennung ein Inhaltshash ist:
 * Andere Datei, andere Kennung, andere Adresse. Eine **Ausrichtungskorrektur**
 * bricht diese Zusage als einzige — sie ändert die Pixel, ohne die Datei
 * anzufassen. Der Vorschau-Cache trägt die Fassung deshalb längst im
 * Dateinamen (`<hash>-q1.webp`, `apps/server/src/previews.ts`); die Adresse tat
 * es nicht, und damit hielt der Browser das gedrehte Bild ein Jahr lang für
 * dasselbe und zeigte das alte. Beliebig oft gedreht, immer dieselben Pixel.
 *
 * Vorher stand an dieser Stelle eine **Bildversion**: ein Zähler in `App.tsx`,
 * der nach jedem Kippen hochlief und als `?v=` an den Adressen hing. Er hielt
 * genau eine Sitzung — beim nächsten Laden stand er wieder auf 0, die Adresse
 * fiel auf ihre kanonische Form zurück, und die lag im Cache. Und er hing nur an
 * vier der zehn Stellen, die Bildadressen bauen; die übrigen (Fotopool,
 * Gruppenlisten, Bildquellen, Hintergrundwahl) zeigten das gedrehte Bild
 * überhaupt nie.
 *
 * Jetzt kommt die Fassung vom Server (`ProjectInfo.bildFassungen`) und steht in
 * der Adresse: `?q=1`. Der Endpunkt liest sie nicht — er kennt die Drehung aus
 * dem Projekt —, sie ist allein der Schlüssel, unter dem der Browser die Pixel
 * ablegt. Damit ist `immutable` wieder wörtlich wahr.
 *
 * **Als Kontext und nicht als Prop**, obwohl die Oberfläche sonst ohne auskommt:
 * Bildadressen entstehen in zehn Dateien auf fünf Ebenen, und die Bildversion
 * hat vorgeführt, wohin das Durchreichen führt — sie kam in vier davon an. Ein
 * Wert, den *jede* Ansicht braucht und *keine* ändert, ist der Fall, für den es
 * Kontext gibt.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { MOSAIC_ID_PREFIX, istMosaikId } from '@franibook/core';

/** Kennung → Vierteldrehungen. Nur gedrehte Fotos stehen darin. */
export type Bildfassungen = Record<string, 1 | 2 | 3>;

const FassungenContext = createContext<Bildfassungen>({});

export function BildfassungenProvider({
  fassungen,
  children,
}: {
  fassungen: Bildfassungen;
  children: ReactNode;
}) {
  return <FassungenContext.Provider value={fassungen}>{children}</FassungenContext.Provider>;
}

/** Vorschau (1600 px lange Kante) oder Miniatur (320 px). */
export type Bildgroesse = 'preview' | 'thumb';

/**
 * Baut Bildadressen mit der Fassung darin.
 *
 * Als reine Funktion neben dem Haken, weil `App.tsx` sie braucht, *bevor* der
 * Kontext steht: Dort liegt die Karte, dort wird sie hineingegeben.
 *
 * `original` ist der Parity-Test: Er misst Geometrie gegen Geometrie und darf
 * deshalb keine WebP-Vorschau gegen ein JPEG-Original vergleichen. Die Fassung
 * bleibt auch dort dran — dasselbe Original kann gedreht gelten.
 */
export function bildSrcVon(
  fassungen: Bildfassungen,
): (photoId: string, groesse?: Bildgroesse) => string {
  const original = new URLSearchParams(location.search).has('original');

  return (photoId: string, groesse: Bildgroesse = 'preview') => {
    // Das Titelmosaik ist kein Foto des Bestands: Es hat keine Quelle, keine
    // Fassung und keine zwei Größen, sondern liegt fertig gebacken im Cache
    // (`core/cover/cover.ts`, `MOSAIC_ID_PREFIX`). Der Abdruck in seiner
    // Kennung ist die Adresse — andere Anweisung, anderes Bild, andere URL,
    // also gilt `immutable` auch hier.
    if (istMosaikId(photoId)) {
      return `/api/cover/mosaik/${photoId.slice(MOSAIC_ID_PREFIX.length)}`;
    }
    const q = fassungen[photoId];
    const stempel = q ? `q=${q}` : '';
    if (original) {
      return `/api/photos/${photoId}/original${stempel ? `?${stempel}` : ''}`;
    }
    const teile = [groesse === 'thumb' ? 'size=thumb' : '', stempel].filter(Boolean);
    return `/api/photos/${photoId}/preview${teile.length ? `?${teile.join('&')}` : ''}`;
  };
}

/** Dieselbe Rechnung, gespeist aus dem Kontext — für alles unterhalb von `App`. */
export function useBildSrc(): (photoId: string, groesse?: Bildgroesse) => string {
  return bildSrcVon(useContext(FassungenContext));
}

/**
 * Miniaturen in der Form, die der Renderer für `imageSrc` verlangt.
 *
 * Die Nachbarstreifen und der Buchnavigator zeichnen echte Doppelseiten in
 * Daumennagelgröße — dort ist die 320-px-Fassung die richtige, und der Renderer
 * nimmt eine Funktion mit genau einem Argument.
 */
export function useMiniaturSrc(): (photoId: string) => string {
  const bildSrc = useBildSrc();
  return (photoId: string) => bildSrc(photoId, 'thumb');
}
