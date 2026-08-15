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
 * durchgereicht. Was das für die Engine bedeutet, steckt in diesen vier
 * Funktionen – ihre Bilder sind vergeben, ihre Seiten kosten Budget, ihr Platz
 * im Buch hängt an einem Foto statt an einer Zahl, und was sie schon leisten,
 * baut die Automatik kein zweites Mal.
 */
import type { PhotoId } from '../model/photo.js';
import type { Spread, SpreadAnchor } from '../model/spread.js';
import { groupOpenerTemplates } from '../templates/index.js';

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
 * Auftakte, die unter den festgehaltenen Doppelseiten schon stehen.
 *
 * Ohne diese Auskunft baut `generateBook` sie ein zweites Mal: Die
 * Kapitelschleife setzt für jedes Jahr einen Auftakt, und die Gruppen bekommen
 * ihren aus der Reservierung – beide fragen nicht, ob der Fluss diese Seite
 * überhaupt noch beisteuern muss. Wer einen Jahresauftakt festhält und neu
 * anordnet, bekam so zwei Jahresseiten für dasselbe Jahr; beim Gruppenauftakt
 * stand zusätzlich das Hauptbild zweimal im Buch, weil `keptPhotos` nur den
 * Fluss ausnimmt und nicht die zweite Auftaktseite.
 *
 * Das Jahr steht am Spread (`chapterYear`) und ist damit eine Aussage. Die
 * Gruppe steht nirgends – sie wird über die Bilder der Seite bestimmt und
 * ausdrücklich nicht über den Titeltext: Der ist editierbar, und ein
 * umbenannter Auftakt bliebe sonst unerkannt.
 */
export function keptOpeners(
  kept: readonly Spread[],
  groupOf: ReadonlyMap<PhotoId, string>,
): { years: Set<number>; groups: Set<string> } {
  const years = new Set<number>();
  const groups = new Set<string>();
  const gruppenAuftakte = new Set(groupOpenerTemplates().map((t) => t.id));

  for (const spread of kept) {
    if (spread.chapterYear !== undefined) years.add(spread.chapterYear);
    if (!gruppenAuftakte.has(spread.templateId)) continue;
    for (const slot of spread.slots) {
      const gruppe = slot.photoId ? groupOf.get(slot.photoId) : undefined;
      if (gruppe !== undefined) {
        groups.add(gruppe);
        break;
      }
    }
  }
  return { years, groups };
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

  /**
   * Wie viele festgehaltene Seiten im bisherigen Buch vor dieser Stelle lagen.
   *
   * Für den Notnagel: `spread.index` zählt Blätter des **ganzen** Buches,
   * `flow` enthält die festgehaltenen aber gerade nicht. Beides gleichzusetzen
   * war der Fehler, der ein Buch mit vielen eigenen Seiten beim Neuanordnen
   * durcheinanderbrachte — am echten Bestand (21 festgehaltene Auftakte, davon
   * 18 mit einem Anker ins Leere) kam die Jahresfolge als 2008, 2012, 2009,
   * 2014, 2015, 2010 heraus: Jede festgehaltene Seite rutschte um die Zahl der
   * festgehaltenen vor ihr nach vorn, und der Fluss schob sich dazwischen.
   */
  const keptDavor = (index: number): number => kept.filter((k) => k.index < index).length;

  const stelleVon = (spread: Spread): number => {
    const anchor = spread.anchor;
    const treffer = anchor ? spreadOfPhoto.get(anchor.photoId) : undefined;
    if (treffer !== undefined) {
      return anchor!.where === 'after' ? treffer + 1 : treffer;
    }
    return Math.min(Math.max(0, spread.index - keptDavor(spread.index)), flow.length);
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

/**
 * Ein Anker für eine Doppelseite, die an dieser Stelle im Buch stehen soll.
 *
 * Zwei Aufrufer, eine Frage: Eine **neu eingefügte** Seite soll dort auftauchen,
 * wo man sie hingesetzt hat, und eine in der Vorschau **behaltene** dort
 * bleiben, wo sie steht. Beide Male ist der gespeicherte Index die schlechte
 * Antwort: Schiebt der Neuaufbau fünf Seiten davor ein, stünde die Seite fünf
 * Blätter zu früh, mitten im falschen Monat.
 *
 * Der Anker zeigt deshalb auf ein Foto der **Nachbarschaft** — vor das erste
 * Bild der Seite dahinter, am Buchende hinter das letzte Bild der Seite davor.
 * Das ist die Sprache, in der die Absicht formuliert ist: „bleibt dort, wo sie
 * im Buch steht", und nicht „bleibt auf Blatt 41".
 *
 * **Seiten, die selbst nicht im Fluss laufen, taugen nicht als Ankergeber**:
 * Ihre Bilder sind vergeben, `insertKept` findet sie dort nie. Das sind die
 * festgehaltenen — und über `ausgenommen` die in dieser Rechnung behaltenen,
 * die eigene eingeschlossen. Am echten Buch zeigten ohne diese Prüfung 18 von
 * 21 festgehaltenen Seiten aufeinander und damit ins Leere.
 *
 * `undefined`, wenn keine Nachbarseite ein Bild hat — dann bleibt es beim
 * Index, wie bei einer festgehaltenen Seite ohne Anker.
 */
export function ankerNeben(
  spreads: readonly Spread[],
  /** Die Stelle im Buch, an der die Seite steht oder stehen soll. */
  stelle: number,
  /** Seiten, deren Bilder nicht im Fluss laufen – die eigene eingeschlossen. */
  ausgenommen: ReadonlySet<number> = new Set(),
): SpreadAnchor | undefined {
  const bildAuf = (i: number, letztes: boolean): PhotoId | undefined => {
    const spread = spreads[i];
    if (!spread || ausgenommen.has(i) || spread.locked) return undefined;
    const ids = spread.slots.map((s) => s.photoId).filter((id): id is PhotoId => id !== null);
    return letztes ? ids[ids.length - 1] : ids[0];
  };

  for (let i = stelle; i < spreads.length; i++) {
    const foto = bildAuf(i, false);
    if (foto) return { photoId: foto, where: 'before' };
  }
  for (let i = stelle - 1; i >= 0; i--) {
    const foto = bildAuf(i, true);
    if (foto) return { photoId: foto, where: 'after' };
  }
  return undefined;
}
