/**
 * Bildunterschriften mengenwertig setzen.
 *
 * `SlotAssignment.caption` gab es längst, aber jede Zeile musste getippt werden.
 * Dieser Zug füllt sie aus Ort und Datum — über eine Doppelseite, eine Gruppe
 * oder das ganze Buch.
 *
 * **Mengenwertig aus demselben Grund wie `PATCH /api/photos`:** Vierzig
 * Unterschriften sind ein Cmd+Z und nicht vierzig.
 *
 * **Und er überschreibt nur, was er selbst erzeugt hat** (`captionAuto`). Wer
 * eine Zeile getippt hat, findet sie nach dem zweiten Klick wieder; wer die
 * getippten ausdrücklich ersetzen will, sagt es (`ueberschreiben`). Ohne diese
 * Regel fräße ein zweiter Klick die Handarbeit, und zwar unbemerkt — die alte
 * Zeile stünde nirgends mehr.
 */
import {
  type CaptionForm,
  type PhotoGroup,
  type PhotoId,
  type Spread,
  bildunterschrift,
  frameHatFuss,
} from '@franibook/core';
import type { FrameId } from '@franibook/core';

/** Worauf der Zug wirkt. */
export type Unterschriftenbereich =
  { kind: 'spread'; index: number } | { kind: 'group'; id: string } | { kind: 'book' };

export interface UnterschriftenErgebnis {
  /** Wie viele Zeilen gesetzt oder geändert wurden. */
  geaendert: number;
  /**
   * Wo nichts geschah, und warum — je Grund eine Zahl.
   *
   * Als Auskunft und nicht als Fehler: Ein Bild ohne Ort ist kein Fehlgriff,
   * sondern der Bestand. Verschwiegen dürfte es trotzdem nicht werden, sonst
   * sucht man nach Zeilen, die absichtlich fehlen.
   */
  uebersprungen: {
    /** Zeile getippt, `ueberschreiben` nicht gesetzt. */
    handarbeit: number;
    /** Ort oder Datum fehlt, die Form braucht sie aber. */
    ohneAngabe: number;
    /** Der Rahmen dieses Bildes hat keinen Fuß – der Text bliebe unsichtbar. */
    ohneFuss: number;
  };
  /** Die berührten Doppelseiten, für die Antwort der Route. */
  seiten: number[];
  /**
   * Die genannte Gruppe gibt es nicht.
   *
   * Kein leeres Ergebnis, sondern eine Auskunft: Sonst meldete der Zug „nichts
   * gesetzt" ohne Grund, und die Route kann daraus einen 404 machen.
   */
  unbekannteGruppe?: true;
}

/** Was der Zug am Projekt anfasst. */
export interface Unterschriftenstand {
  spreads: Spread[];
  groups: PhotoGroup[];
  /** Effektiver Ort und effektives Datum eines Fotos. */
  angabenVon: (photoId: PhotoId) => { place?: { key: string; label: string }; date: string | null };
  /**
   * Der Rahmen, der auf diesem Platz **wirklich** wirkt – aus dem gerenderten
   * Modell und nicht aus `slot.frame ?? settings.frame`.
   *
   * Der Unterschied ist nicht theoretisch: Ein randabfallender Kasten bekommt
   * beim Rendern `keiner`, auch wenn am Slot ein Polaroid steht (`render-spread`,
   * dieselbe Regel wie bei der Neigung). Aus den Feldern gerechnet schriebe der
   * Zug dort eine Zeile, die nie erscheint — und zählte sie als Erfolg.
   */
  rahmenVon: (spreadIndex: number, slotId: string) => FrameId;
}

export interface UnterschriftenOptionen {
  bereich: Unterschriftenbereich;
  form: CaptionForm;
  /** Auch getippte Zeilen ersetzen. Ohne Angabe: nein. */
  ueberschreiben?: boolean;
}

/**
 * Setzt die Unterschriften und meldet, was dabei liegen blieb.
 *
 * Der Rahmen ohne Fuß wird **gezählt und trotzdem gefüllt**? Nein — er wird
 * gezählt und übersprungen. Text ins Nichts zu schreiben wäre die schlechtere
 * Antwort: Er stünde im Projekt, wäre nirgends zu sehen, und beim nächsten
 * Rahmenwechsel erschienen vierzig Zeilen, die niemand mehr gelesen hat.
 */
export function setzeUnterschriften(
  stand: Unterschriftenstand,
  opts: UnterschriftenOptionen,
): UnterschriftenErgebnis {
  const ergebnis: UnterschriftenErgebnis = {
    geaendert: 0,
    uebersprungen: { handarbeit: 0, ohneAngabe: 0, ohneFuss: 0 },
    seiten: [],
  };

  const fotos = fotosDesBereichs(stand, opts.bereich);
  if (fotos === 'unbekannt') return { ...ergebnis, unbekannteGruppe: true };

  stand.spreads.forEach((spread, index) => {
    if (opts.bereich.kind === 'spread' && opts.bereich.index !== index) return;
    let beruehrt = false;

    for (const slot of spread.slots) {
      if (!slot.photoId) continue;
      if (fotos && !fotos.has(slot.photoId)) continue;

      if (!frameHatFuss(stand.rahmenVon(index, slot.slotId))) {
        ergebnis.uebersprungen.ohneFuss++;
        continue;
      }

      if (slot.caption !== undefined && !slot.captionAuto && !opts.ueberschreiben) {
        ergebnis.uebersprungen.handarbeit++;
        continue;
      }

      const text = bildunterschrift(stand.angabenVon(slot.photoId), opts.form);
      if (text === undefined) {
        ergebnis.uebersprungen.ohneAngabe++;
        continue;
      }
      if (slot.caption === text && slot.captionAuto) continue;

      slot.caption = text;
      slot.captionAuto = true;
      ergebnis.geaendert++;
      beruehrt = true;
    }

    if (beruehrt) ergebnis.seiten.push(index);
  });

  return ergebnis;
}

/**
 * Die Fotos, auf die der Bereich einschränkt – oder `undefined` für „alle".
 *
 * Eine Gruppe grenzt über ihre Fotos ein und nicht über ihre Doppelseiten: Ihre
 * Bilder können auf einer Seite mit fremden stehen, und dort soll der Zug nur
 * die eigenen treffen.
 */
function fotosDesBereichs(
  stand: Unterschriftenstand,
  bereich: Unterschriftenbereich,
): Set<PhotoId> | undefined | 'unbekannt' {
  if (bereich.kind !== 'group') return undefined;
  const gruppe = stand.groups.find((g) => g.id === bereich.id);
  // Eine Gruppe, die es nicht gibt, ist keine leere Auswahl: Sonst meldete der
  // Zug „nichts gesetzt" ohne Grund, und man suchte den Fehler im Bestand.
  if (!gruppe) return 'unbekannt';
  return new Set(gruppe.photoIds);
}

/**
 * Nimmt die erzeugten Unterschriften wieder heraus.
 *
 * Das Gegenstück zum Zug, und nicht dasselbe wie Cmd+Z: Wer sie vor drei
 * Schritten gesetzt hat, käme sonst nicht mehr ohne Verlust an sie heran.
 * Getippte Zeilen bleiben — sie waren nie Teil des Zuges.
 */
export function loescheUnterschriften(
  stand: Unterschriftenstand,
  bereich: Unterschriftenbereich,
): UnterschriftenErgebnis {
  const ergebnis: UnterschriftenErgebnis = {
    geaendert: 0,
    uebersprungen: { handarbeit: 0, ohneAngabe: 0, ohneFuss: 0 },
    seiten: [],
  };
  const fotos = fotosDesBereichs(stand, bereich);
  if (fotos === 'unbekannt') return { ...ergebnis, unbekannteGruppe: true };

  stand.spreads.forEach((spread, index) => {
    if (bereich.kind === 'spread' && bereich.index !== index) return;
    let beruehrt = false;

    for (const slot of spread.slots) {
      if (!slot.captionAuto) continue;
      if (fotos && slot.photoId && !fotos.has(slot.photoId)) continue;

      delete slot.caption;
      delete slot.captionAuto;
      ergebnis.geaendert++;
      beruehrt = true;
    }

    if (beruehrt) ergebnis.seiten.push(index);
  });

  return ergebnis;
}
