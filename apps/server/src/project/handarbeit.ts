/**
 * Was an einer Doppelseite Handarbeit ist – und ein Neuaufbau verwürfe.
 *
 * Gezählt, nicht geraten: Der Knopf „Neu anordnen" baut das Buch komplett neu,
 * und was dabei verloren geht, soll vorher dranstehen.
 *
 * Die Zählung läuft **je Doppelseite** und wird erst danach summiert. So kann
 * die Anordnungsprobe an jeder Seite ihrer Vorschau dranschreiben, was
 * ausgerechnet dort verloren geht – die Summe über achtzig Seiten sagt einem,
 * dass es teuer wird, aber nicht, ob es die eine Seite trifft, an der man
 * gestern eine Stunde saß.
 *
 * Festgehaltene Seiten zählen nicht mit: Sie gehen unverändert durch den
 * Generator (`layout/keep.ts`), und was an ihnen Arbeit war, überlebt.
 */
import { isJustified, type Spread } from '@franibook/core';

/** Was ein Neuaufbau an einer Doppelseite verwirft, nach Art getrennt. */
export interface Handarbeit {
  /** Von Hand gezogene Ausschnitte. */
  crops: number;
  /**
   * Von Hand gesetzte Neigungen.
   *
   * Auch die ausdrücklich geradegestellten: Eine gesetzte 0 ist eine
   * Entscheidung, die der Neuaufbau verwirft.
   */
  neigungen: number;
  /**
   * Bilder mit einem eigenen Rahmen, abweichend von der Buchvorgabe.
   *
   * Wie bei der Neigung zählt das ausdrückliche „keiner" mit: Ein Bild aus dem
   * Rahmen des Buches herauszunehmen ist eine Entscheidung.
   */
  rahmen: number;
  /** Bildunterschriften im Fuß eines Rahmens. */
  unterschriften: number;
  hintergruende: number;
  zeitstrahl: number;
  /**
   * Frei gesetzte Bildkästen.
   *
   * Justierte Doppelseiten tragen in jedem Slot ein Rechteck, aber gerechnet
   * und nicht gesetzt: Der Neuaufbau stellt es wieder her, also zählt es nicht.
   */
  positionen: number;
  /**
   * Bilder mit einer von Hand gesetzten Ebene im Stapel.
   *
   * Gezählt wird der Slot mit einem `layer`, nicht der Stapel: Ein Zug
   * nummeriert alle Plätze der Doppelseite neu, also trägt danach jeder eine
   * Ebene. Die Zahl sagt damit „auf so vielen Bildern liegt eine Aussage über
   * das Vorn und Hinten" – und die verwirft der Neuaufbau, weil die neuen
   * Plätze aus der Vorlage kommen.
   */
  ebenen: number;
  /** Von Hand gesetzte Textblöcke. */
  texte: number;
  /**
   * Vorlagentexte, die von Hand verschoben, aufgezogen oder gedreht wurden –
   * Jahreszahlen, Gruppentitel, Ereigniszeilen. Der Neuaufbau stellt sie an
   * den Platz der Vorlage zurück.
   *
   * Gezählt wird die Geometrie, dazu der Wortlaut der Jahreszahl, wo er von
   * `chapterYear` abweicht. Ein umbenannter Gruppentitel bleibt ungezählt:
   * Was die Automatik hinschreiben würde, steht in der Gruppe und wäre hier
   * ein zweiter Weg zur Wahrheit – die Zahl soll eine untere Schranke sein,
   * keine geratene.
   */
  textplaetze: number;
  /**
   * Weggenommene Plätze (`Spread.hiddenSlots`).
   *
   * Der Neuaufbau holt sie zurück: Die Plätze kommen aus der Vorlage, und die
   * wählt er neu. Gezählt wird der Platz und nicht die Doppelseite — wer drei
   * Löcher auf einer Seite geschlossen hat, verliert drei Entscheidungen.
   */
  plaetze: number;
}

/** Die Bilanz über das ganze Buch: was geht – und was bleibt. */
export interface Handarbeitsbilanz extends Handarbeit {
  /** Doppelseiten, die das Neuanordnen unverändert übersteht. */
  festgehalten: number;
}

/** Die Arten in einer Liste – Summieren und Zählen brauchen sie beide. */
const ARTEN = [
  'crops',
  'neigungen',
  'rahmen',
  'unterschriften',
  'hintergruende',
  'zeitstrahl',
  'positionen',
  'ebenen',
  'texte',
  'textplaetze',
  'plaetze',
] as const satisfies readonly (keyof Handarbeit)[];

function leer(): Handarbeit {
  return {
    crops: 0,
    neigungen: 0,
    rahmen: 0,
    unterschriften: 0,
    hintergruende: 0,
    zeitstrahl: 0,
    positionen: 0,
    ebenen: 0,
    texte: 0,
    textplaetze: 0,
    plaetze: 0,
  };
}

/** Was an dieser einen Doppelseite von Hand entschieden wurde. */
export function handarbeitAn(spread: Spread): Handarbeit {
  return {
    crops: spread.slots.filter((sl) => sl.crop.mode === 'manual').length,
    neigungen: spread.slots.filter((sl) => sl.rotateDeg !== undefined).length,
    rahmen: spread.slots.filter((sl) => sl.frame !== undefined).length,
    unterschriften: spread.slots.filter((sl) => sl.caption !== undefined).length,
    // Die Jahresfarbe der Automatik zählt nicht (`Spread.backgroundAuto`): Sie
    // steht bei eingeschalteten Jahresfarben auf jeder Doppelseite, und der
    // Neuaufbau setzt sie genauso wieder.
    hintergruende:
      (spread.background !== undefined && spread.backgroundAuto !== true) ||
      spread.backgroundPhotoId !== undefined
        ? 1
        : 0,
    zeitstrahl: spread.timeline !== undefined ? 1 : 0,
    positionen: isJustified(spread.templateId)
      ? 0
      : spread.slots.filter((sl) => sl.rect !== undefined).length,
    ebenen: spread.slots.filter((sl) => sl.layer !== undefined).length,
    texte: spread.blocks?.length ?? 0,
    textplaetze: (spread.texts ?? []).filter(
      (t) =>
        t.rect !== undefined ||
        t.rotateDeg !== undefined ||
        (t.role === 'year' &&
          spread.chapterYear !== undefined &&
          t.content !== String(spread.chapterYear)),
    ).length,
    plaetze: spread.hiddenSlots?.length ?? 0,
  };
}

/**
 * Was an dieser Seite wirklich verloren geht, wenn `nachher` an ihre Stelle
 * tritt.
 *
 * Der Unterschied zu `handarbeitAn` ist der Hintergrund: Steht nachher
 * derselbe Ton auf der Seite, ist nichts verloren, auch wenn er von Hand
 * gewählt war. Die Vorschau soll sagen, was *diese* Anordnung kostet, und
 * nicht, was theoretisch daran hängt – wer an jeder Seite etwas gemeldet
 * bekommt, liest ab der dritten nicht mehr hin.
 *
 * Die Jahresfarbe der Automatik fällt schon eine Ebene früher heraus, an
 * `Spread.backgroundAuto`.
 *
 * Ohne `nachher` – die Seite fällt weg – bleibt es bei der vollen Zählung.
 */
export function handarbeitVerloren(alt: Spread, nachher?: Spread): Handarbeit {
  const teile = handarbeitAn(alt);
  const bleibt =
    nachher !== undefined &&
    alt.background === nachher.background &&
    alt.backgroundPhotoId === nachher.backgroundPhotoId;
  return bleibt ? { ...teile, hintergruende: 0 } : teile;
}

/** Wie viele Entscheidungen an dieser Seite hängen – die Summe über alle Arten. */
export function handarbeitStueck(teile: Handarbeit): number {
  return ARTEN.reduce((summe, art) => summe + teile[art], 0);
}

/** Addiert, was über mehrere Doppelseiten zusammenkommt. */
export function handarbeitSumme(teile: readonly Handarbeit[]): Handarbeit {
  const summe = leer();
  for (const eines of teile) for (const art of ARTEN) summe[art] += eines[art];
  return summe;
}

/** Die Bilanz über ein ganzes Buch. */
export function handarbeitsbilanz(spreads: readonly Spread[]): Handarbeitsbilanz {
  const summe = leer();
  let festgehalten = 0;
  for (const spread of spreads) {
    if (spread.locked) {
      festgehalten++;
      continue;
    }
    const teile = handarbeitAn(spread);
    for (const art of ARTEN) summe[art] += teile[art];
  }
  return { ...summe, festgehalten };
}
