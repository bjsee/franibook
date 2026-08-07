/**
 * Wohin der automatische Ausschnitt zielt.
 *
 * `coverCrop` nimmt seit immer einen Fokuspunkt, und die Automatik setzte ihn
 * nirgends — sie rechnete mit der Bildmitte. Am echten Bestand schneidet die
 * Mitte damit 16 % der Köpfe in querformatigen Plätzen an und 30 % in
 * Panoramaplätzen; genau daran erkennt man automatisch gesetzte Fotobücher.
 * Messwerte und Verfahren: `docs/spikes/gesichter.md`.
 *
 * Die Rechnung liegt im Kern und ist eine reine Funktion aus Foto und Platz —
 * keine Pixel, kein Zufall. Was Pixel braucht (die Rechtecke selbst), steht als
 * Datum am `Photo` und entsteht beim Import.
 */
import { coverCrop } from './crop.js';
import type { FocusRect, Photo } from './photo.js';

/** Ein Bereich gilt als erhalten, wenn höchstens ein Zehntel fehlt. */
const GANZ = 0.9;

/** Anteil der Fläche eines Bereichs, der im Ausschnitt liegt. */
export function visibleShare(
  r: FocusRect,
  crop: { x: number; y: number; w: number; h: number },
): number {
  const bx = Math.max(0, Math.min(r.x + r.w, crop.x + crop.w) - Math.max(r.x, crop.x));
  const by = Math.max(0, Math.min(r.y + r.h, crop.y + crop.h) - Math.max(r.y, crop.y));
  const flaeche = r.w * r.h;
  return flaeche > 0 ? (bx * by) / flaeche : 0;
}

/**
 * Fokuspunkt für den automatischen Ausschnitt, oder `undefined` für die Mitte.
 *
 * Rangfolge: Gesichter schlagen den Aufmerksamkeitsschwerpunkt, der schlägt die
 * Bildmitte. Ein von Hand gesetzter Ausschnitt kommt hier nie an — er wird
 * gespeichert und nicht neu gerechnet.
 *
 * **Der Flächenschwerpunkt wäre der naheliegende Punkt und ist der falsche.**
 * Bei einer verteilten Gruppe landet er zwischen den Gesichtern, und dann fallen
 * die äußeren heraus, während die Bildmitte zufällig günstiger lag: In
 * hochkanten Plätzen verlor er am Bestand 9 Köpfe und rettete 7.
 *
 * Stattdessen eine Suche. Sie ist billig, weil `coverCrop` immer **eine**
 * Dimension voll ausnutzt — beschnitten wird entweder waagerecht oder senkrecht,
 * nie beides. Also ist die Lage eindimensional, und die Kandidaten sind endlich:
 * die Positionen, an denen eine Bereichskante an einer Ausschnittkante liegt,
 * dazu Schwerpunkt und Mitte.
 *
 * Bewertet wird in drei Stufen: Zahl der ganz enthaltenen Bereiche, dann
 * sichtbare Fläche, dann Nähe zur Bildmitte. Die dritte Stufe ist kein
 * Schönheitsmaß, sondern macht das Ergebnis eindeutig — ohne sie entschiede die
 * Reihenfolge der Kandidaten, und der Determinismus hinge an einer Sortierung.
 */
export function focalForCrop(
  photo: Pick<Photo, 'width' | 'height' | 'faces' | 'salience'>,
  slotAspect: number,
): { x: number; y: number } | undefined {
  const bereiche = bereicheVon(photo);
  if (bereiche.length === 0) return undefined;

  const photoAspect = photo.width / photo.height;
  if (!Number.isFinite(photoAspect) || photoAspect <= 0) return undefined;
  if (!Number.isFinite(slotAspect) || slotAspect <= 0) return undefined;

  const probe = coverCrop(photoAspect, slotAspect);
  // Welche Achse beschnitten wird, sagt der Ausschnitt selbst. Bei gleicher Form
  // ist nichts zu verschieben, dann ist die Mitte so gut wie jeder Punkt.
  const waagerecht = probe.w < 1;
  const laenge = waagerecht ? probe.w : probe.h;
  if (laenge >= 1) return undefined;

  const halb = laenge / 2;
  const kandidaten = new Set<number>([
    0.5,
    waagerecht ? schwerpunkt(bereiche).x : schwerpunkt(bereiche).y,
  ]);
  for (const b of bereiche) {
    const von = waagerecht ? b.x : b.y;
    const bis = waagerecht ? b.x + b.w : b.y + b.h;
    kandidaten.add(von + halb); // Bereich an der linken bzw. oberen Kante
    kandidaten.add(bis - halb); // an der rechten bzw. unteren
    kandidaten.add((von + bis) / 2); // Bereichsmitte in der Ausschnittmitte
  }

  let beste: { x: number; y: number } | undefined;
  let bestesMass: readonly number[] = [-1, -1, -1];
  // Sortiert, damit die Schleife bei gleichwertigen Kandidaten immer dieselbe
  // Reihenfolge sieht — der Determinismus soll nicht an der Einfügereihenfolge
  // einer Menge hängen.
  for (const roh of [...kandidaten].sort((a, b) => a - b)) {
    const wert = Math.min(1 - halb, Math.max(halb, roh));
    const fokus = waagerecht ? { x: wert, y: 0.5 } : { x: 0.5, y: wert };
    const crop = coverCrop(photoAspect, slotAspect, fokus);

    let ganz = 0;
    let sichtbar = 0;
    for (const b of bereiche) {
      const anteil = visibleShare(b, crop);
      if (anteil >= GANZ) ganz++;
      sichtbar += anteil * b.w * b.h;
    }
    const mass = [ganz, sichtbar, -Math.abs(wert - 0.5)];
    if (besser(mass, bestesMass)) {
      bestesMass = mass;
      beste = fokus;
    }
  }
  return beste;
}

/**
 * Wo ein Bildbereich auf dem Papier landet, in Millimetern.
 *
 * Die Umkehrung des Ausschnitts: Was im sichtbaren Rechteck liegt, wird auf den
 * Kasten abgebildet. Bereiche außerhalb des Ausschnitts ergeben Rechtecke
 * außerhalb des Kastens — der Aufrufer prüft das über `visibleShare`, statt hier
 * eine zweite Sichtbarkeitsregel zu haben.
 *
 * **Ohne Neigung.** Ein geneigtes Bild kippt um bis zu 4°, das verschiebt eine
 * Ecke bei 120 mm Kantenlänge um wenige Millimeter. Für eine Warnung über die
 * Lage im Falz ist das innerhalb der Zone, die ohnehin großzügig bemessen ist;
 * randabfallende Bilder — der andere Fall — werden nie geneigt.
 */
export function focusRectOnPage(
  r: FocusRect,
  crop: { x: number; y: number; w: number; h: number },
  rect: { xMm: number; yMm: number; wMm: number; hMm: number },
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const u = (r.x - crop.x) / crop.w;
  const v = (r.y - crop.y) / crop.h;
  return {
    xMm: rect.xMm + u * rect.wMm,
    yMm: rect.yMm + v * rect.hMm,
    wMm: (r.w / crop.w) * rect.wMm,
    hMm: (r.h / crop.h) * rect.hMm,
  };
}

/**
 * Die Bereiche, auf die gezielt wird.
 *
 * Gesichter, sonst der Aufmerksamkeitsschwerpunkt. **Nicht beides zusammen:**
 * Die Salienzkarte umfasst bei einem Porträt fast die ganze Person, also würde
 * sie den Fokus vom Kopf zur Körpermitte ziehen — sie ist die Antwort für Fotos
 * *ohne* Gesicht (Landschaft, Torte, Hund) und war am Bestand für 100 % der
 * Dateien verfügbar.
 */
function bereicheVon(photo: Pick<Photo, 'faces' | 'salience'>): readonly FocusRect[] {
  const gesichter = (photo.faces ?? []).filter(istBrauchbar);
  if (gesichter.length > 0) return gesichter;
  return photo.salience && istBrauchbar(photo.salience) ? [photo.salience] : [];
}

/**
 * Ein Bereich außerhalb des Bildes oder ohne Fläche ist keine Auskunft.
 *
 * Die Prüfung sitzt hier und nicht am Import, weil ein Projektstand von Hand
 * bearbeitet werden kann und der Kern dann nicht mit NaN weiterrechnen soll.
 */
function istBrauchbar(r: FocusRect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w > 0 &&
    r.y + r.h > 0 &&
    r.x < 1 &&
    r.y < 1
  );
}

/**
 * Flächengewichteter Schwerpunkt — als Kandidat, nicht als Ergebnis.
 *
 * Ein großes Gesicht im Vordergrund wiegt mehr als drei kleine im Hintergrund.
 * Als einziger Kandidat taugt er nicht (siehe oben), als einer unter mehreren
 * schon: Bei einem einzelnen Gesicht ist er die Antwort.
 */
function schwerpunkt(bereiche: readonly FocusRect[]): { x: number; y: number } {
  let summe = 0;
  let x = 0;
  let y = 0;
  for (const b of bereiche) {
    const gewicht = b.w * b.h;
    summe += gewicht;
    x += (b.x + b.w / 2) * gewicht;
    y += (b.y + b.h / 2) * gewicht;
  }
  return summe > 0 ? { x: x / summe, y: y / summe } : { x: 0.5, y: 0.5 };
}

/** Lexikografischer Vergleich der Bewertungsstufen. */
function besser(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const differenz = a[i]! - b[i]!;
    // Toleranz, weil die zweite Stufe eine Flächensumme ist: Zwei Lagen, die
    // dasselbe zeigen, sollen nicht über die letzte Binärstelle entschieden
    // werden, sondern über die dritte Stufe.
    if (Math.abs(differenz) > 1e-9) return differenz > 0;
  }
  return false;
}
