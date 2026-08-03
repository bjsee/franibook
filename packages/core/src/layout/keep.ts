/**
 * Festgehaltene Doppelseiten.
 *
 * Das Buch entsteht beim Erzeugen komplett neu – das ist der Preis dafür, dass
 * eine geänderte Seitenzahl oder eine neue Gruppe wirklich durchschlägt. Für
 * eine selbst gebaute Seite ist dieser Preis untragbar: Sie besteht aus
 * Handarbeit und nichts anderem, und ein Neuaufbau hätte nichts, woraus er sie
 * wiederherstellen könnte.
 *
 * Deshalb `locked`: Solche Doppelseiten werden nicht gebaut, sondern
 * durchgereicht. Was das für die Engine bedeutet, steckt in diesen drei
 * Funktionen – ihre Bilder sind vergeben, ihre Seiten kosten Budget, und ihr
 * Platz im Buch hängt an einem Foto, nicht an einer Zahl.
 */
import type { PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';

/** Trennt die festgehaltenen Doppelseiten von denen, die neu gebaut werden. */
export function splitKept(spreads: readonly Spread[]): { kept: Spread[]; flow: Spread[] } {
  const kept: Spread[] = [];
  const flow: Spread[] = [];
  for (const spread of spreads) (spread.locked ? kept : flow).push(spread);
  return { kept, flow };
}

/**
 * Fotos, die auf festgehaltenen Doppelseiten liegen.
 *
 * Sie dürfen im Fluss nicht noch einmal vorkommen – ein Bild, das groß auf der
 * selbst gebauten Auftaktseite steht und zwei Seiten später klein im Raster
 * wieder auftaucht, ist der Fehler, den die Gruppenauftakte schon einmal
 * gemacht haben. Das Hintergrundbild gehört dazu: Es ist ebenso vergeben, nur
 * eben über die ganze Fläche.
 */
export function keptPhotos(kept: readonly Spread[]): Set<PhotoId> {
  const ids = new Set<PhotoId>();
  for (const spread of kept) {
    for (const slot of spread.slots) if (slot.photoId) ids.add(slot.photoId);
    if (spread.backgroundPhotoId) ids.add(spread.backgroundPhotoId);
  }
  return ids;
}

/**
 * Setzt festgehaltene Doppelseiten in den neu erzeugten Fluss zurück.
 *
 * Die Stelle kommt aus dem Anker: Die Seite steht wieder vor (oder hinter) der
 * Doppelseite, auf der ihr Ankerfoto gelandet ist. Ohne Anker – oder wenn das
 * Foto in keiner Doppelseite mehr liegt, etwa weil es aussortiert wurde – gilt
 * der gespeicherte `index`, auf die neue Buchlänge geklemmt. Das ist die
 * schwächere Auskunft, aber immer noch eine: Die Seite bleibt im Buch, statt
 * ans Ende zu rutschen oder zu verschwinden.
 *
 * Treffen mehrere auf dieselbe Stelle, entscheidet ihre bisherige Reihenfolge.
 * Die `index`-Felder werden am Ende durchgezählt; alles andere bleibt
 * unangetastet.
 */
export function insertKept(flow: readonly Spread[], kept: readonly Spread[]): Spread[] {
  if (kept.length === 0) return flow.map((spread, i) => ({ ...spread, index: i }));

  const spreadOfPhoto = new Map<PhotoId, number>();
  flow.forEach((spread, i) => {
    for (const slot of spread.slots) {
      if (slot.photoId !== null && !spreadOfPhoto.has(slot.photoId)) {
        spreadOfPhoto.set(slot.photoId, i);
      }
    }
  });

  const stelleVon = (spread: Spread): number => {
    const anchor = spread.anchor;
    const treffer = anchor ? spreadOfPhoto.get(anchor.photoId) : undefined;
    if (treffer !== undefined) {
      return anchor!.where === 'after' ? treffer + 1 : treffer;
    }
    return Math.min(Math.max(0, spread.index), flow.length);
  };

  // Nach Stelle gruppieren, innerhalb der Stelle in bisheriger Reihenfolge.
  const anStelle = new Map<number, Spread[]>();
  kept
    .map((spread, i) => ({ spread, stelle: stelleVon(spread), reihe: i }))
    .sort((a, b) => a.stelle - b.stelle || a.reihe - b.reihe)
    .forEach(({ spread, stelle }) => {
      const bestand = anStelle.get(stelle);
      if (bestand) bestand.push(spread);
      else anStelle.set(stelle, [spread]);
    });

  const ergebnis: Spread[] = [];
  for (let i = 0; i <= flow.length; i++) {
    for (const eigen of anStelle.get(i) ?? []) ergebnis.push(eigen);
    const spread = flow[i];
    if (spread) ergebnis.push(spread);
  }

  return ergebnis.map((spread, i) => ({ ...spread, index: i }));
}
