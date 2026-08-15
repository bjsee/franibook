/**
 * Der Abnahmebericht: was dem Druck im Weg steht, an einer Stelle.
 *
 * Die Engine meldet jeden Befund dort, wo er entsteht — `renderSpread` an der
 * Bildbox, `renderCover` am Umschlag, `bookStats` als Kennzahl. Was fehlte, ist
 * die Zusammenfassung über das ganze Buch: Vor einer Bestellung musste man 80
 * Doppelseiten einzeln durchklicken, um zu wissen, ob noch etwas übrig ist.
 *
 * **Hier wird nichts neu gerechnet, hier wird gesammelt.** Jeder Fund stammt aus
 * einer Warnung des RSM oder des RCM oder aus einem Vergleich mit dem
 * Druckprofil; eine zweite Auflösungsrechnung neben `render/render-spread.ts`
 * wäre genau die zweite Wahrheit, die auseinanderläuft. Die drei Ausnahmen sind
 * Lagen, für die es keine Warnung gibt und geben soll — Text am Rand und im
 * Falz, leere Plätze, die Seitenzahl gegen das Profil: Das RSM warnt je Bildbox,
 * und keine dieser drei Aussagen hängt an einem Bild.
 *
 * **Zwei Einstiege, eine Rechnung.** `seitenbefunde` ist der Bericht einer
 * einzelnen Doppelseite — die Doppelseitenansicht blendet ihn am Bild ein, ohne
 * das ganze Buch zu rechnen. `pruefeBuch` ruft dieselbe Funktion für jede Seite
 * und legt darüber, was nur das ganze Buch weiß: Seitenzahl, Umschlag,
 * Gliederung, und die Bündelungen. Zwei Fassungen desselben Befundes wären genau
 * der Fall, in dem Liste und Papier verschiedene Dinge behaupten.
 *
 * **Der Bericht entscheidet nichts und blockiert nichts.** Manche Funde nimmt
 * man bewusst in Kauf: Ein randabfallendes Bild reicht definitionsgemäß in den
 * Beschnitt, und ein Gesicht im Beschnitt ist je nach Motiv gewollt. `schwer`
 * sortiert die Liste, es verbietet nichts — ein Export, den dieser Bericht
 * verhindert, wäre die falsche Richtung. Was man gesehen und für gut befunden
 * hat, wird abgenickt (`Befund.schluessel`) und nicht weiter angemerkt.
 *
 * Eigene Ebene und nicht in `render/`: Der Bericht liest das RSM **und** das
 * RCM, und `cover/` liegt über `render/` (`cover/rendered-cover.ts` importiert
 * die Boxtypen von dort). Umgekehrt wäre der Weg ein Ring.
 */
import {
  coverWarningText,
  type CoverWarning,
  type RenderedCover,
} from '../cover/rendered-cover.js';
import { isValidPageCount, nextValidPageCount, type PrintProfile } from '../print/profile.js';
import { BACKGROUND_SLOT_ID } from '../render/render-spread.js';
import { PAGE_NUMBER_SLOT_PREFIX } from '../render/page-number.js';
import { SIDE_TIMELINE_SLOT_PREFIX } from '../render/side-timeline.js';
import { TIMELINE_SLOT_PREFIX } from '../render/timeline.js';
import { imageBoxes, type RenderedSpread, type RenderWarning } from '../render/rendered-spread.js';

/**
 * Die Arten von Befunden, in der Reihenfolge des Berichts.
 *
 * Eine Tabelle für drei Dinge — Reihenfolge, Überschrift, Gewicht —, weil alle
 * drei dieselbe Frage beantworten: Wie schwer wiegt dieser Fund? Drei getrennte
 * Tabellen wären dreimal die Gelegenheit, sie in unterschiedliche Ordnungen
 * geraten zu lassen.
 *
 * `schwer` heißt „das würde man am gedruckten Buch sehen und bereuen", nicht
 * „verboten". Die Oberfläche sortiert und färbt danach; abgelehnt wird nichts.
 */
export const BEFUNDARTEN = [
  { art: 'foto-fehlt', titel: 'Bild nicht im Bestand', schwer: true },
  /**
   * Dasselbe Bild an zwei Stellen im Buch.
   *
   * Die einzige Art, die kein Renderer melden kann: Eine Doppelseite weiß
   * nichts von den übrigen 79. Gezählt werden nur Motive — ein Bild, das
   * zusätzlich als Hintergrund einer Seite steht, ist eine Gestaltung.
   *
   * Der Anlass war ein festgehaltener Gruppenauftakt, dessen Hauptbild die
   * Automatik ein zweites Mal setzte. Aufgefallen ist das niemandem: Die
   * Kennzahlen zählen platzierte Bilder als Menge (`bookStats`), und dort ist
   * eine Dublette unsichtbar.
   */
  { art: 'foto-doppelt', titel: 'Bild zweimal im Buch', schwer: true },
  /**
   * Das Bild steht im Bestand, seine Datei aber nicht mehr auf der Platte.
   *
   * Der Unterschied zu `foto-fehlt` ist die Richtung: Dort kennt das Buch eine
   * Kennung, die der Bestand nicht führt; hier führt der Bestand ein Foto,
   * dessen Datei verschwunden ist — umbenannt, verschoben, ein Ordner
   * abgehängt. Am Bildschirm sieht man es nicht unbedingt: Die Vorschau liegt
   * im Cache und zeigt weiter, was längst nicht mehr da ist. Auffallen würde es
   * beim Export, und dort ist es zu spät.
   *
   * Wie `unter-ziel-dpi` eine Art, die nur der Buchbericht kennt: Ob eine Datei
   * existiert, weiß der Kern nicht — er bekommt die Auskunft von außen, so wie
   * er die abgenickten Funde von außen bekommt.
   */
  { art: 'datei-fehlt', titel: 'Bilddatei nicht auffindbar', schwer: true },
  { art: 'unter-mindest-dpi', titel: 'Unter der Mindestauflösung', schwer: true },
  { art: 'im-rand', titel: 'Text im Sicherheitsabstand', schwer: true },
  { art: 'im-falz', titel: 'Text in der Falzzone', schwer: true },
  { art: 'seitenzahl', titel: 'Seitenzahl passt nicht zum Format', schwer: true },
  { art: 'profil-ungeprueft', titel: 'Druckprofil nicht verifiziert', schwer: true },
  { art: 'gliederung-veraltet', titel: 'Buch älter als die Gliederung', schwer: false },
  { art: 'gruppen-veraltet', titel: 'Buch älter als die Gruppen', schwer: false },
  { art: 'lage-quer', titel: 'Bild und Platz stehen quer', schwer: false },
  { art: 'gesicht-am-rand', titel: 'Gesicht im Beschnitt oder im Falz', schwer: false },
  { art: 'hintergrund-weich', titel: 'Hintergrundbild zu weich', schwer: false },
  /**
   * Die eine Art, die als **Summe** im Bericht steht und nicht je Bild.
   *
   * Die Zielauflösung ist ein Wunsch, die Mindestauflösung eine Grenze: Am
   * echten Bestand (2048 px lange Kante, 270 mm Seite) verfehlen Hunderte
   * Bilder das Ziel und keines ist deswegen unbrauchbar. Als Einzelzeilen
   * begrabe das die neun Funde, auf die es ankommt — als eine Zeile mit Zahl
   * und schwächstem Wert ist es die Auskunft, die man wirklich sucht. Am
   * einzelnen Bild steht die Zahl ohnehin (Diagnoseband der Bühne), deshalb
   * kommt diese Art in `seitenbefunde` nicht vor.
   */
  { art: 'unter-ziel-dpi', titel: 'Unter der Zielauflösung', schwer: false },
  { art: 'ruecken-zu-schmal', titel: 'Buchrücken zu schmal für Text', schwer: false },
  { art: 'seite-ohne-bild', titel: 'Doppelseite ohne Bild', schwer: false },
  { art: 'platz-leer', titel: 'Platz ohne Bild', schwer: false },
] as const;

export type Befundart = (typeof BEFUNDARTEN)[number]['art'];

/** Rang und Gewicht je Art — aus der Tabelle, damit es eine Quelle gibt. */
const ART_INFO = new Map<Befundart, { rang: number; schwer: boolean }>(
  BEFUNDARTEN.map((a, rang) => [a.art, { rang, schwer: a.schwer }]),
);

/**
 * Wo ein Befund sitzt — und damit das Sprungziel der Oberfläche.
 *
 * `slotId` steht daneben und nicht im Text: Die Oberfläche wählt damit den Platz
 * aus, wenn sie zur Doppelseite springt (`/doppelseite/12/platz/r2c`). Beim
 * Umschlag trägt ihn der Text, denn dort kommt der Wortlaut aus
 * `coverWarningText` und nennt ihn schon.
 */
export type Befundort =
  | { kind: 'spread'; index: number; slotId?: string }
  | { kind: 'umschlag' }
  /** Das ganze Buch — Seitenzahl, Gliederung, Druckprofil. */
  | { kind: 'buch' };

export interface Befund {
  art: Befundart;
  ort: Befundort;
  /** Der Fund als deutscher Satz, ohne die Stelle — die steht in `ort`. */
  text: string;
  /**
   * Der **Gegenstand** des Funds. Daran hängt ein „Weiß ich, ist ok".
   *
   * Nicht die Stelle, sondern das, worüber der Fund etwas sagt: ein Bildfund
   * hängt am Foto, ein Textfund am Textplatz, ein Buchfund an seiner Art. Das
   * ist der Unterschied, der die Abnahme haltbar macht — ein quer stehendes
   * Foto bleibt dasselbe Foto, wenn eine Neuanordnung es auf eine andere Seite
   * trägt, und die Randachse ist mit einem Klick für alle achtzig Doppelseiten
   * erledigt statt achtzigmal.
   *
   * Zwei Arten haben keinen solchen Gegenstand und hängen deshalb an der Seite:
   * Ein leerer Platz und eine Doppelseite ohne Bild sind Aussagen über das
   * Blatt. Nach einem Neuaufbau zeigt die Abnahme dort ins Leere — was
   * verschmerzbar ist, weil der Neuaufbau leere Plätze ohnehin auffüllt.
   */
  schluessel: string;
  /** Abgenickt und deshalb aus der offenen Liste heraus. */
  abgenommen?: true;
}

export interface AbnahmeEingabe {
  /** Das Buch, gerendert. Die Reihenfolge ist die Reihenfolge im Buch. */
  spreads: readonly RenderedSpread[];
  /** Der Umschlag, wenn es einen gibt. */
  cover?: RenderedCover | undefined;
  profile: PrintProfile;
  /** Ob sich die Gruppen geändert haben, seit das Buch gebaut wurde. */
  groupsPending?: boolean | undefined;
  /** Ob die Kalendergliederung von der abweicht, aus der das Buch gebaut wurde. */
  structurePending?: boolean | undefined;
  /**
   * Die Schlüssel der abgenickten Funde.
   *
   * Als Datum von außen und nicht als Zustand hier: Der Kern kennt kein Projekt
   * und keine Datei. Er markiert nur, was in dieser Menge steht — gestrichen
   * wird nichts, denn wer „auch abgenommene zeigen" wählt, will sie sehen.
   */
  abgenommen?: ReadonlySet<string> | undefined;
  /**
   * Fotos, deren Datei nicht mehr auffindbar ist.
   *
   * Von außen und aus demselben Grund wie `abgenommen`: Der Kern kennt kein
   * Dateisystem. Wer die Menge nicht mitgibt, bekommt die Prüfung nicht — das
   * ist die richtige Vorgabe, denn ein `stat` je Bild ist eine Frage an die
   * Platte und keine, die man beiläufig stellt.
   */
  fehlendeDateien?: ReadonlySet<string> | undefined;
}

export interface Abnahmebericht {
  /** Alle Funde, nach Art geordnet und innerhalb einer Art in Buchreihenfolge. */
  befunde: Befund[];
  /**
   * Wie viele wovon. Die Zahlen, die man vor einer Bestellung sehen will.
   *
   * `schwer` und `leicht` zählen nur die **offenen** Funde: Eine Bilanz, die
   * Abgenicktes mitzählt, wäre nach dem Abnicken unverändert und damit nutzlos.
   *
   * `abgenommen` sind die abgenickten Funde **dieses** Berichts, `gespeichert`
   * alle im Projekt vermerkten. Die Zahlen gehen auseinander, sobald ein
   * abgenickter Fund verschwindet — ein Foto ist gelöscht, eine Neuanordnung
   * hat es geradegerückt, die Randachse ist behoben. Der Eintrag bleibt dann
   * absichtlich stehen (der Fund kann zurückkommen), und ohne diese zweite Zahl
   * wüsste die Oberfläche nichts davon und böte kein Zurücknehmen mehr an.
   */
  bilanz: { schwer: number; leicht: number; abgenommen: number; gespeichert: number };
  /** Wogegen geprüft wurde. */
  umfang: { doppelseiten: number; seiten: number; bilder: number };
}

/**
 * Ein Zehntelmillimeter Nachsicht an den Grenzen.
 *
 * Die Textkästen entstehen aus Millimeterrechnungen mit Divisionen; ein Kasten,
 * der rechnerisch um 0,0000001 mm über der Sicherheitslinie liegt, liegt nicht
 * über ihr. 0,1 mm ist zugleich unterhalb dessen, was ein Schneidwerk trifft.
 */
const RAND_TOLERANZ_MM = 0.1;

/**
 * Der Bericht einer einzelnen Doppelseite.
 *
 * Dieselben Funde wie im Buchbericht, nur ohne das, was erst das ganze Buch
 * weiß: Seitenzahl, Umschlag, Gliederung, und die Summenzeile der
 * Zielauflösung. Die Doppelseitenansicht blendet damit am Bild ein, was der
 * Bericht über es sagt, ohne achtzig Seiten zu rendern.
 *
 * `index` ist die Nummer der Seite im Buch — sie steht im `ort` und ist das
 * Sprungziel; die Funktion selbst rechnet nichts damit.
 */
export function seitenbefunde(
  spread: RenderedSpread,
  index: number,
  profile: PrintProfile,
): Befund[] {
  const befunde: Befund[] = [];
  const ort = (slotId?: string): Befundort => ({
    kind: 'spread',
    index,
    ...(slotId !== undefined ? { slotId } : {}),
  });

  const boxen = imageBoxes(spread);
  const motive = boxen.filter((b) => b.slotId !== BACKGROUND_SLOT_ID);

  for (const box of boxen) {
    for (const warnung of box.warnings) {
      const fund = ausBildwarnung(warnung);
      if (!fund) continue;
      befunde.push({
        ...fund,
        ort: ort(box.slotId),
        schluessel: `${fund.art}#foto:${box.photoId}`,
      });
    }
  }

  // Ein Hintergrundbild ist ein Bild: Eine Doppelseite, die nur eines trägt, ist
  // eine Gestaltung und kein leeres Blatt. Gezählt wird es trotzdem nicht als
  // Motiv — sonst hinge die Bilderzahl des Buches an einer Deko-Entscheidung.
  const hatHintergrund = boxen.length > motive.length;

  if (motive.length === 0 && !hatHintergrund) {
    // Was sonst darauf steht, entscheidet, ob das ein Versehen ist: Eine selbst
    // gebaute Titelseite trägt Text und kein Bild, eine leer gezogene nichts.
    const kaesten = spread.boxes.filter(
      (b) => b.kind === 'text' && b.content.trim().length > 0,
    ).length;
    befunde.push({
      art: 'seite-ohne-bild',
      ort: ort(),
      text:
        kaesten === 0
          ? 'ganz leer'
          : `nur Text, ${kaesten === 1 ? 'ein Kasten' : `${kaesten} Kästen`}`,
      schluessel: `seite-ohne-bild#seite:${index}`,
    });
  } else if (motive.length > 0) {
    // Nur bei einer Seite, die überhaupt Motive trägt: Auf einer leeren wären
    // das acht Funde für einen Umstand, den die Seitenzeile schon nennt.
    for (const box of spread.boxes) {
      if (box.kind !== 'empty') continue;
      befunde.push({
        art: 'platz-leer',
        ort: ort(box.slotId),
        // Das Maß und nicht der Umstand: Dass der Platz leer ist, sagt die
        // Überschrift der Gruppe. Wie groß das Loch ist, sagt nur diese Zahl.
        text: `${box.wMm.toFixed(0)} × ${box.hMm.toFixed(0)} mm frei`,
        schluessel: `platz-leer#seite:${index}:${box.slotId}`,
      });
    }
  }

  befunde.push(...textbefunde(spread, index, profile, ort));
  return befunde;
}

export function pruefeBuch(e: AbnahmeEingabe): Abnahmebericht {
  const { profile } = e;
  let bilder = 0;
  /**
   * Zahl und schwächster Wert der Bilder unter der Zielauflösung — eine Zeile,
   * kein Chor. Mitgezählt statt gesammelt: Die Liste bräuchte niemand, und
   * `Math.min(...liste)` über tausend Bilder wäre ein Argumentstapel für ein
   * Minimum.
   */
  const zielVerfehlt = { anzahl: 0, schwaechstes: Number.POSITIVE_INFINITY };

  const ausSeiten: Befund[] = [];
  /** Wo jedes Motiv steht — für den einen Fund, den keine Seite allein sieht. */
  const stellen = new Map<string, { index: number; slotId: string }[]>();

  e.spreads.forEach((spread, index) => {
    ausSeiten.push(...seitenbefunde(spread, index, profile));
    for (const box of imageBoxes(spread)) {
      if (box.slotId !== BACKGROUND_SLOT_ID) {
        bilder++;
        const bisher = stellen.get(box.photoId);
        if (bisher) bisher.push({ index, slotId: box.slotId });
        else stellen.set(box.photoId, [{ index, slotId: box.slotId }]);
      }
      for (const warnung of box.warnings) {
        if (warnung.code === 'below-target-dpi') merkeZiel(zielVerfehlt, warnung.dpi);
      }
    }
  });

  const befunde = buendleTexte(ausSeiten);

  // Fehlende Dateien: je Bild ein Fund an seiner ersten Stelle. Nicht je
  // Vorkommen — man ersetzt das Foto, nicht den Platz; und der Bericht bündelt
  // die Arten ohnehin, sodass eine abgehängte Quelle als eine Zeile mit Zahl
  // erscheint statt als achthundert.
  if (e.fehlendeDateien?.size) {
    for (const [photoId, orte] of stellen) {
      if (!e.fehlendeDateien.has(photoId)) continue;
      const erste = orte[0]!;
      befunde.push({
        art: 'datei-fehlt',
        ort: { kind: 'spread', index: erste.index, slotId: erste.slotId },
        text: 'die Bilddatei ist nicht mehr auffindbar',
        schluessel: `datei-fehlt#foto:${photoId}`,
      });
    }
  }

  // Ein Bild, das zweimal im Buch steht. Gemeldet wird die *zweite* Stelle: Die
  // erste ist die, die man behalten will, und das Sprungziel soll dorthin
  // führen, wo etwas zu tun ist.
  for (const [photoId, orte] of stellen) {
    if (orte.length < 2) continue;
    const [erste, ...weitere] = orte as [
      { index: number; slotId: string },
      ...{ index: number; slotId: string }[],
    ];
    for (const ort of weitere) {
      befunde.push({
        art: 'foto-doppelt',
        ort: { kind: 'spread', index: ort.index, slotId: ort.slotId },
        text:
          ort.index === erste.index
            ? 'steht auf dieser Doppelseite noch ein zweites Mal'
            : `steht schon auf Doppelseite ${erste.index + 1}`,
        schluessel: `foto-doppelt#foto:${photoId}`,
      });
    }
  }

  const seiten = e.spreads.length * 2;
  if (e.spreads.length > 0 && !isValidPageCount(profile, seiten)) {
    const { min, max, step } = profile.pageCount;
    const naechste = nextValidPageCount(profile, seiten);
    befunde.push({
      art: 'seitenzahl',
      ort: { kind: 'buch' },
      text:
        `${seiten} Seiten — das Format nimmt ${min} bis ${max} in Schritten von ${step}. ` +
        `Die nächste zulässige Zahl ist ${naechste}.`,
      schluessel: 'seitenzahl',
    });
  }

  if (e.structurePending) {
    befunde.push({
      art: 'gliederung-veraltet',
      ort: { kind: 'buch' },
      text:
        'Die Kalendergliederung weicht von der ab, aus der das Buch gebaut wurde — ' +
        'ein Foto kann in einem anderen Jahr gehören, als es steht.',
      schluessel: 'gliederung-veraltet',
    });
  }
  if (e.groupsPending) {
    befunde.push({
      art: 'gruppen-veraltet',
      ort: { kind: 'buch' },
      text:
        'Die Gruppen haben sich geändert, seit das Buch gebaut wurde — ' +
        'Fotoverteilung und Auftaktseiten sind noch die alten.',
      schluessel: 'gruppen-veraltet',
    });
  }

  for (const warnung of e.cover?.warnings ?? []) {
    if (warnung.code === 'below-target-dpi') {
      merkeZiel(zielVerfehlt, warnung.dpi);
      continue;
    }
    const art = ausCoverwarnung(warnung);
    // Der Wortlaut kommt aus dem Kern und nennt den Platz selbst: Der
    // Umschlagreiter zeigt denselben Satz, und zwei Texte über dieselbe Ursache
    // ließen den Benutzer zwei Fehler suchen.
    befunde.push({
      art,
      ort: { kind: 'umschlag' },
      text: coverWarningText(warnung),
      schluessel: `${art}#umschlag${'slotId' in warnung ? `:${warnung.slotId}` : ''}`,
    });
  }

  if (zielVerfehlt.anzahl > 0) {
    const { anzahl, schwaechstes } = zielVerfehlt;
    befunde.push({
      art: 'unter-ziel-dpi',
      ort: { kind: 'buch' },
      text:
        `${anzahl === 1 ? 'Ein Bild' : `${anzahl} Bilder`} unter der Zielauflösung von ` +
        `${profile.resolution.targetDpi} dpi, das schwächste mit ${Math.round(schwaechstes)} dpi`,
      schluessel: 'unter-ziel-dpi',
    });
  }

  // Nach Rang sortiert, und `sort` ist stabil: Innerhalb einer Art bleibt die
  // Reihenfolge, in der die Funde entstanden sind — also die des Buchs.
  befunde.sort((a, b) => rang(a.art) - rang(b.art));

  const markiert = befunde.map((b) => markiere(b, e.abgenommen));
  const offen = markiert.filter((b) => !b.abgenommen);
  return {
    befunde: markiert,
    bilanz: {
      schwer: offen.filter((b) => istSchwer(b.art)).length,
      leicht: offen.filter((b) => !istSchwer(b.art)).length,
      abgenommen: markiert.length - offen.length,
      gespeichert: e.abgenommen?.size ?? 0,
    },
    umfang: { doppelseiten: e.spreads.length, seiten, bilder },
  };
}

/** Setzt `abgenommen`, wenn der Schlüssel abgenickt ist. */
export function markiere(befund: Befund, abgenommen?: ReadonlySet<string>): Befund {
  return abgenommen?.has(befund.schluessel) ? { ...befund, abgenommen: true } : befund;
}

/** Ob diese Art dem Druck im Weg steht. Für die Oberfläche mitexportiert. */
export function istSchwer(art: Befundart): boolean {
  return ART_INFO.get(art)?.schwer ?? false;
}

function rang(art: Befundart): number {
  return ART_INFO.get(art)?.rang ?? BEFUNDARTEN.length;
}

/** Zählt ein Bild unter der Zielauflösung mit und hält den schwächsten Wert. */
function merkeZiel(stand: { anzahl: number; schwaechstes: number }, dpi: number): void {
  stand.anzahl++;
  stand.schwaechstes = Math.min(stand.schwaechstes, dpi);
}

/**
 * Eine Warnung des RSM als Befund.
 *
 * `null` für die drei Warnungen, die im Bericht nichts zu suchen haben:
 * `crosses-gutter` ist bei einem Bild kein Mangel, sondern eine Gestaltung — was
 * an der Bindung verlorengeht, ist eine Frage des Falzzuschlags und nicht dieses
 * Berichts. `outside-safety` an einer Bildbox ebenso: Ein randabfallendes Bild
 * liegt notwendig außerhalb des Sicherheitsabstands. Und `below-target-dpi`
 * sammelt `pruefeBuch` zu einer Zeile — siehe die Tabelle oben.
 */
function ausBildwarnung(w: RenderWarning): Pick<Befund, 'art' | 'text'> | null {
  switch (w.code) {
    case 'photo-missing':
      return { art: 'foto-fehlt', text: `Bild ${w.photoId} liegt nicht im Bestand` };
    case 'below-min-dpi':
      // Derselbe Wortlaut wie am Umschlag (`coverWarningText`), damit dieselbe
      // Ursache im Bericht nicht zweimal verschieden klingt.
      return {
        art: 'unter-mindest-dpi',
        text: `nur ${Math.round(w.dpi)} dpi – unter der Mindestauflösung von ${w.minDpi} dpi`,
      };
    case 'background-low-dpi':
      return {
        art: 'hintergrund-weich',
        text: `${Math.round(w.dpi)} dpi, empfohlen sind ${w.recommendedDpi} dpi`,
      };
    case 'orientation-mismatch':
      return {
        art: 'lage-quer',
        text: `nur ${Math.round(w.sichtbar * 100)} % der Bildfläche sind zu sehen`,
      };
    case 'face-at-edge':
      return {
        art: 'gesicht-am-rand',
        text:
          w.wo === 'beschnitt'
            ? `${gesichter(w.anzahl)} jenseits der Endformatkante`
            : `${gesichter(w.anzahl)} in der Falzzone`,
      };
    case 'crosses-gutter':
    case 'outside-safety':
    case 'below-target-dpi':
      return null;
  }
}

function gesichter(anzahl: number): string {
  return anzahl === 1 ? 'Ein Gesicht' : `${anzahl} Gesichter`;
}

/**
 * Eine Warnung des RCM als Befundart.
 *
 * Die Arten sind nach dem **Was** benannt und nicht nach dem Wo: Ein Bild unter
 * der Mindestauflösung ist derselbe Mangel, ob es auf Seite 12 oder auf dem
 * Umschlag liegt, und im Bericht soll es untereinander stehen. Wo es liegt,
 * sagt `ort`.
 */
function ausCoverwarnung(w: CoverWarning): Befundart {
  switch (w.code) {
    case 'photo-missing':
      return 'foto-fehlt';
    case 'below-min-dpi':
      return 'unter-mindest-dpi';
    // Nie erreicht — `pruefeBuch` sammelt die Zielauflösung vorher ein. Der
    // Zweig steht für die Vollständigkeit des `switch`: Kommt eine Warnung
    // dazu, soll der Übersetzer meckern und nicht der Bericht schweigen.
    case 'below-target-dpi':
      return 'unter-ziel-dpi';
    case 'in-hinge':
      return 'im-falz';
    case 'outside-safety':
      return 'im-rand';
    case 'spine-too-narrow-for-text':
      return 'ruecken-zu-schmal';
    case 'profile-unverified':
      return 'profil-ungeprueft';
  }
}

/**
 * Text, der zu weit außen oder zu weit innen steht.
 *
 * Die zwei Zonen, in denen im Innenteil kein Text stehen soll, und keine von
 * beiden ist eine Bildwarnung: `page.safetyMm` ab der Endformatkante nach innen
 * (dort schneidet das Werk) und `page.gutterSafeMm` je Seite der Falzachse
 * (dort verschwindet Fläche im Bund). Die Geometrie kommt aus dem RSM, die
 * Schwellen aus dem Profil — genau wie in `render/inspect.ts`.
 *
 * Geprüft wird **jeder** Textkasten, auch der des Zeitstrahls, und das hat sich
 * gelohnt: Die Randachse setzte ihre Jahreszahlen einmal in den Sicherheitsrand,
 * 1,8 mm vor der Schnittkante. Ausgenommen wurde sie nicht — eine Aussage über
 * das gedruckte Buch bleibt eine, gleich ob sie beabsichtigt war —, und behoben
 * ist sie inzwischen (`render/side-timeline.ts`, `sideAxisPasst`). Was über
 * achtzig Doppelseiten hinweg dieselbe Rechnung ist, bündelt `buendleTexte` zu
 * einer Zeile.
 *
 * Gerechnet wird mit dem ungedrehten Kasten. Ein gedrehter Text reicht über
 * seine Ecken weiter hinaus, als das Rechteck sagt; der Bericht meldet ihn
 * dadurch erst, wenn schon das Rechteck herausragt. Die Alternative wäre, vier
 * gedrehte Ecken zu rechnen — dann müsste dieses Modul den Drehpunkt
 * mitverstehen, den mehrzeiliger Text sich teilt, und das ist Wissen des
 * Renderers.
 */
function textbefunde(
  spread: RenderedSpread,
  index: number,
  profile: PrintProfile,
  ort: (slotId?: string) => Befundort,
): Befund[] {
  const { safetyMm, gutterSafeMm } = profile.page;
  const befunde: Befund[] = [];

  for (const box of spread.boxes) {
    if (box.kind !== 'text' || box.content.trim().length === 0) continue;

    // Der kleinste Abstand zu einer der vier Endformatkanten. Negativ heißt:
    // Der Kasten liegt schon im Beschnitt, wird also angeschnitten.
    const zurKante = Math.min(
      box.xMm - spread.bleedMm,
      box.yMm - spread.bleedMm,
      spread.widthMm - spread.bleedMm - (box.xMm + box.wMm),
      spread.heightMm - spread.bleedMm - (box.yMm + box.hMm),
    );
    if (zurKante < safetyMm - RAND_TOLERANZ_MM) {
      befunde.push({
        art: 'im-rand',
        ort: ort(box.slotId),
        text:
          `„${kurz(box.content)}" steht ${zurKante.toFixed(1)} mm von der Schnittkante, ` +
          `vorgesehen sind ${safetyMm} mm`,
        schluessel: textSchluessel('im-rand', box.slotId, index),
      });
    }

    // Und der Abstand zur Falzachse: 0, wenn der Kasten über ihr liegt.
    const zurAchse = Math.max(
      0,
      Math.max(spread.gutterXMm - (box.xMm + box.wMm), box.xMm - spread.gutterXMm),
    );
    if (gutterSafeMm > 0 && zurAchse < gutterSafeMm - RAND_TOLERANZ_MM) {
      befunde.push({
        art: 'im-falz',
        ort: ort(box.slotId),
        text:
          `„${kurz(box.content)}" steht ${zurAchse.toFixed(1)} mm von der Falzachse, ` +
          `vorgesehen sind ${gutterSafeMm} mm`,
        schluessel: textSchluessel('im-falz', box.slotId, index),
      });
    }
  }
  return befunde;
}

/**
 * Der Gegenstand eines Textfunds — und damit, was eine Abnahme mit erledigt.
 *
 * **Was die Engine auf jeder Doppelseite gleich zeichnet, ist ein Fund; was auf
 * einer Seite von Hand steht, ist einer je Seite.** Der Zeitstrahl setzt seine
 * Beschriftung überall nach derselben Rechnung — steht sie zu weit außen, ist
 * das eine Entscheidung und nicht achtzig. Ein Vorlagentext dagegen trägt auf
 * jeder Seite dieselbe Kennung (`t-year` auf jedem Jahresauftakt), steht aber
 * nur dort zu weit außen, wo ihn jemand hingezogen hat; ohne die Seite im
 * Schlüssel erledigte eine Abnahme auch die neunzehn anderen Auftakte
 * mit. Dasselbe gilt für Bildunterschriften (`caption-r2c`).
 */
function textSchluessel(art: 'im-rand' | 'im-falz', slotId: string, index: number): string {
  const ausDerEngine =
    slotId.startsWith(TIMELINE_SLOT_PREFIX) ||
    slotId.startsWith(SIDE_TIMELINE_SLOT_PREFIX) ||
    slotId.startsWith(PAGE_NUMBER_SLOT_PREFIX);
  return ausDerEngine ? `${art}#text:${slotId}` : `${art}#text:${slotId}@seite:${index}`;
}

/**
 * Textfunde zu einer Zeile je Textplatz, statt einer je Doppelseite.
 *
 * Ein Textplatz, der auf achtzig Doppelseiten zu weit außen sitzt, ist **eine**
 * Entscheidung und nicht achtzig Funde: Die Randachse des Zeitstrahls füllte den
 * Bericht am echten Buch sonst mit 240 Zeilen, die alle dasselbe sagten, und
 * begrub die neun Bilder unter der Mindestauflösung. Gebündelt wird über den
 * Schlüssel — also über genau das, woran auch die Abnahme hängt, und damit
 * erledigt ein „ist ok" alle achtzig Seiten auf einmal.
 *
 * Als Sprungziel steht die erste betroffene Doppelseite, im Satz die Zahl aller —
 * verschwiegen wird nichts. Der Zitattext ist ebenfalls der der ersten: Bei
 * einem Platz, der auf jeder Seite anderen Text trägt (die Jahreszahl der
 * Auftakte), wäre jede andere Wahl willkürlich, und die erste ist die, zu der
 * der Sprung führt.
 *
 * Alle übrigen Arten laufen unverändert durch: Ein quer stehendes Bild ist an
 * jeder Stelle ein eigener Handgriff.
 */
function buendleTexte(befunde: readonly Befund[]): Befund[] {
  const seiten = new Map<string, number>();
  for (const b of befunde) {
    if (b.art !== 'im-rand' && b.art !== 'im-falz') continue;
    seiten.set(b.schluessel, (seiten.get(b.schluessel) ?? 0) + 1);
  }

  const gesehen = new Set<string>();
  const heraus: Befund[] = [];
  for (const b of befunde) {
    if (b.art !== 'im-rand' && b.art !== 'im-falz') {
      heraus.push(b);
      continue;
    }
    if (gesehen.has(b.schluessel)) continue;
    gesehen.add(b.schluessel);

    const anzahl = seiten.get(b.schluessel) ?? 1;
    const weitere =
      anzahl === 1
        ? ''
        : ` — ebenso auf ${anzahl - 1} weiteren ${anzahl === 2 ? 'Doppelseite' : 'Doppelseiten'}`;
    heraus.push({ ...b, text: `${b.text}${weitere}` });
  }
  return heraus;
}

/**
 * Der Anfang eines Textes, damit die Zeile im Bericht eine Zeile bleibt.
 *
 * Ein Textblock kann ein Absatz sein; im Bericht steht er neben achtzig anderen
 * Zeilen. Vierzig Zeichen genügen zum Wiedererkennen — gefunden wird der Text
 * ohnehin über den Sprung zur Doppelseite und nicht über sein Zitat.
 */
function kurz(text: string): string {
  const eine = text.replace(/\s+/g, ' ').trim();
  return eine.length > 40 ? `${eine.slice(0, 39)}…` : eine;
}
