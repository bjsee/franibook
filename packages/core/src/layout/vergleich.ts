/**
 * Zwei Anordnungen desselben Buches vergleichen.
 *
 * „Buch neu anordnen" baut alles neu, und bis hierher war das ein Sprung ins
 * Dunkle: Der Knopf sagte, was an Handarbeit verloren geht, aber nicht, was
 * dafür herauskommt. Wer achtzig Doppelseiten durchgearbeitet hat, drückt so
 * einen Knopf nicht. Diese Funktion liefert die Auskunft, aus der die Vorschau
 * entsteht – **was sich tatsächlich ändert**, Doppelseite für Doppelseite.
 *
 * Verglichen wird über die **Fotos**, nicht über den Index. Baut die Engine ein
 * Jahr um zwei Doppelseiten kürzer, verschiebt sich alles dahinter; ein
 * Vergleich nach Nummer meldete dann achtzig geänderte Seiten, obwohl
 * achtundsiebzig davon dieselben Bilder in derselben Vorlage tragen. Zugeordnet
 * wird deshalb nach der größten Schnittmenge – und danach erst gefragt, was
 * sich an dem Paar geändert hat.
 *
 * Die Funktion ist rein und arbeitet auf dem Modell: derselbe Vergleich läuft
 * im Test ohne Bilddateien wie am echten Buch.
 */
import type { PhotoId } from '../model/photo.js';
import type { Spread } from '../model/spread.js';
import type { TemplateId } from '../model/template.js';

/**
 * Was aus einer Doppelseite geworden ist.
 *
 * `gleich` heißt: dieselben Bilder auf denselben Plätzen derselben Vorlage. Es
 * heißt **nicht**, dass die Seite unverändert aussieht – ein von Hand gesetzter
 * Ausschnitt ist danach fort. Was das kostet, zählt der Server je Seite dazu;
 * hier steht nur, was die Anordnung selbst tut.
 */
export type Aenderungsart = 'gleich' | 'vorlage' | 'fotos' | 'neu' | 'entfaellt';

export interface Seitenvergleich {
  /**
   * Stelle im bisherigen Buch; `null` bei einer neu hinzukommenden Seite.
   *
   * Sie ist zugleich die Kennung, unter der eine Seite ansprechbar ist — „diese
   * so lassen", „diese habe ich gesehen". `Spread.id` wäre die naheliegendere
   * Wahl und taugt dafür **nicht**: Der Generator vergibt `spread-<n>` je Lauf
   * neu, festgehaltene Seiten behalten ihre alte Kennung, und am echten Buch
   * kommt `spread-38` deshalb zweimal vor. Der Index dagegen ist eindeutig,
   * solange das bisherige Buch steht — und genau so lange gilt eine Probe.
   */
  altIndex: number | null;
  /** Stelle im neuen Buch; `null`, wenn die Seite wegfällt. */
  neuIndex: number | null;
  art: Aenderungsart;
  /** Gleicher Inhalt, andere Stelle im Buch. */
  verschoben: boolean;
  /** Festgehalten – die Seite geht unverändert durch den Neuaufbau. */
  locked: boolean;
  templateVorher: TemplateId | null;
  templateNachher: TemplateId | null;
  fotosVorher: number;
  fotosNachher: number;
  /** Bilder, die neu auf diese Doppelseite kommen. */
  zugegangen: PhotoId[];
  /** Bilder, die von ihr verschwinden. */
  abgegangen: PhotoId[];
}

export interface Anordnungsvergleich {
  /** In der Reihenfolge des neuen Buches; entfallene an ihrer alten Stelle. */
  seiten: Seitenvergleich[];
  /** Seiten, die inhaltlich bleiben, wie sie sind – ganz gleich an welcher Stelle. */
  gleich: number;
  /** Wie viele davon an eine andere Stelle im Buch rutschen. */
  verschoben: number;
  /** Seiten, die es vorher und nachher gibt, aber anders. */
  geaendert: number;
  neu: number;
  entfallen: number;
  festgehalten: number;
  /** Bilder, die vorher in keiner Doppelseite standen und jetzt schon. */
  insBuch: PhotoId[];
  /** Bilder, die aus dem Buch fallen – sie liegen danach im Fotopool. */
  ausDemBuch: PhotoId[];
}

/** Die Bilder einer Doppelseite in der Reihenfolge ihrer Plätze. */
function fotos(spread: Spread): PhotoId[] {
  return spread.slots.map((s) => s.photoId).filter((id): id is PhotoId => id !== null);
}

/** Gleiche Bilder auf gleichen Plätzen – dann sieht die Seite gleich aus. */
function gleicheBelegung(a: Spread, b: Spread): boolean {
  if (a.slots.length !== b.slots.length) return false;
  return a.slots.every((slot, i) => {
    const gegen = b.slots[i];
    return gegen !== undefined && gegen.slotId === slot.slotId && gegen.photoId === slot.photoId;
  });
}

/**
 * Ordnet alte und neue Doppelseiten einander zu.
 *
 * Gierig über die Schnittmenge der Bilder: das Paar mit den meisten
 * gemeinsamen Fotos zuerst, dann das nächste. Bei gleicher Schnittmenge
 * entscheidet die Nähe im Buch und danach die Nummer – der Vergleich muss
 * deterministisch sein wie die Engine selbst, sonst zeigt zweimal dieselbe
 * Probe zweimal etwas anderes.
 *
 * Ein zweiter Durchgang paart, was übrig bleibt und dieselbe Vorlage trägt:
 * Eine Auftaktseite ohne Bild fände sonst nie ihre Entsprechung und stünde als
 * „entfällt" neben einem „neu", das dasselbe ist.
 */
function zuordnen(alt: readonly Spread[], neu: readonly Spread[]): Map<number, number> {
  const paare: { a: number; n: number; schnitt: number }[] = [];
  const altFotos = alt.map((s) => new Set(fotos(s)));

  neu.forEach((spread, n) => {
    const ids = fotos(spread);
    alt.forEach((_, a) => {
      const menge = altFotos[a];
      if (!menge) return;
      const schnitt = ids.filter((id) => menge.has(id)).length;
      if (schnitt > 0) paare.push({ a, n, schnitt });
    });
  });

  paare.sort(
    (x, y) =>
      y.schnitt - x.schnitt || Math.abs(x.a - x.n) - Math.abs(y.a - y.n) || x.a - y.a || x.n - y.n,
  );

  const zuAlt = new Map<number, number>();
  const vergebeneAlt = new Set<number>();
  for (const { a, n } of paare) {
    if (zuAlt.has(n) || vergebeneAlt.has(a)) continue;
    zuAlt.set(n, a);
    vergebeneAlt.add(a);
  }

  // Zweiter Durchgang: gleiche Vorlage, gleiches Kapiteljahr, nächstgelegen.
  const uebrigAlt = alt.map((_, i) => i).filter((i) => !vergebeneAlt.has(i));
  neu.forEach((spread, n) => {
    if (zuAlt.has(n)) return;
    const treffer = uebrigAlt
      .filter((a) => {
        const vorher = alt[a];
        return (
          vorher !== undefined &&
          vorher.templateId === spread.templateId &&
          vorher.chapterYear === spread.chapterYear
        );
      })
      .sort((x, y) => Math.abs(x - n) - Math.abs(y - n) || x - y)[0];
    if (treffer === undefined) return;
    zuAlt.set(n, treffer);
    vergebeneAlt.add(treffer);
    uebrigAlt.splice(uebrigAlt.indexOf(treffer), 1);
  });

  return zuAlt;
}

export function vergleicheAnordnung(
  alt: readonly Spread[],
  neu: readonly Spread[],
): Anordnungsvergleich {
  const zuAlt = zuordnen(alt, neu);
  const seiten: Seitenvergleich[] = [];

  neu.forEach((spread, n) => {
    const a = zuAlt.get(n);
    const vorher = a === undefined ? undefined : alt[a];
    const neueFotos = fotos(spread);

    if (!vorher || a === undefined) {
      seiten.push({
        altIndex: null,
        neuIndex: n,
        art: 'neu',
        verschoben: false,
        locked: spread.locked === true,
        templateVorher: null,
        templateNachher: spread.templateId,
        fotosVorher: 0,
        fotosNachher: neueFotos.length,
        zugegangen: neueFotos,
        abgegangen: [],
      });
      return;
    }

    const alteFotos = fotos(vorher);
    const alteMenge = new Set(alteFotos);
    const neueMenge = new Set(neueFotos);
    const belegung = gleicheBelegung(vorher, spread);
    const art: Aenderungsart = belegung
      ? vorher.templateId === spread.templateId
        ? 'gleich'
        : 'vorlage'
      : alteFotos.length === neueFotos.length && alteFotos.every((id) => neueMenge.has(id))
        ? 'vorlage'
        : 'fotos';

    seiten.push({
      altIndex: a,
      neuIndex: n,
      art,
      verschoben: a !== n,
      locked: spread.locked === true,
      templateVorher: vorher.templateId,
      templateNachher: spread.templateId,
      fotosVorher: alteFotos.length,
      fotosNachher: neueFotos.length,
      zugegangen: neueFotos.filter((id) => !alteMenge.has(id)),
      abgegangen: alteFotos.filter((id) => !neueMenge.has(id)),
    });
  });

  const vergeben = new Set(zuAlt.values());
  alt.forEach((spread, a) => {
    if (vergeben.has(a)) return;
    const alteFotos = fotos(spread);
    seiten.push({
      altIndex: a,
      neuIndex: null,
      art: 'entfaellt',
      verschoben: false,
      locked: spread.locked === true,
      templateVorher: spread.templateId,
      templateNachher: null,
      fotosVorher: alteFotos.length,
      fotosNachher: 0,
      zugegangen: [],
      abgegangen: alteFotos,
    });
  });

  // In der Reihenfolge des neuen Buches. Eine entfallene Seite steht an ihrer
  // alten Stelle – dort sucht sie, wer sie vermisst.
  seiten.sort(
    (x, y) =>
      (x.neuIndex ?? x.altIndex ?? 0) - (y.neuIndex ?? y.altIndex ?? 0) ||
      (x.neuIndex === null ? 1 : 0) - (y.neuIndex === null ? 1 : 0),
  );

  const imBuch = (spreads: readonly Spread[]): Set<PhotoId> => {
    const ids = new Set<PhotoId>();
    for (const spread of spreads) for (const id of fotos(spread)) ids.add(id);
    return ids;
  };
  const alteBilder = imBuch(alt);
  const neueBilder = imBuch(neu);

  return {
    seiten,
    gleich: seiten.filter((s) => s.art === 'gleich').length,
    verschoben: seiten.filter((s) => s.art === 'gleich' && s.verschoben).length,
    geaendert: seiten.filter((s) => s.art === 'vorlage' || s.art === 'fotos').length,
    neu: seiten.filter((s) => s.art === 'neu').length,
    entfallen: seiten.filter((s) => s.art === 'entfaellt').length,
    festgehalten: neu.filter((s) => s.locked === true).length,
    insBuch: [...neueBilder].filter((id) => !alteBilder.has(id)),
    ausDemBuch: [...alteBilder].filter((id) => !neueBilder.has(id)),
  };
}
