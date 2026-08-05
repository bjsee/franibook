/**
 * Das Buch als Baum: Jahr → Doppelseite → Bilder.
 *
 * Die Auskunft hinter der Aufteilungsansicht. Sie nennt je Doppelseite, welche
 * Bilder darauf liegen und was an ihr auffällt — bewusst ohne die Bilddaten
 * selbst: Die holt die Oberfläche über `GET /api/photos`, wie die Fotodaten
 * auch, und eine zweite Fassung derselben Angaben wäre ein zweiter Weg zur
 * Wahrheit.
 *
 * Das Jahr steht an jeder Seite und nicht nur am Kapitelauftakt, weil der Baum
 * daraus seine Gliederung baut. Abgeleitet wird es aus den Kapitelanfängen —
 * dieselbe Rechnung, mit der die Übersicht ihre Jahresmarken setzt, und damit
 * keine zweite Meinung darüber, wo ein Jahrgang beginnt.
 */
import type { RenderedSpread, Spread } from '@franibook/core';
import { isJustified } from '@franibook/core';

/** Was diese Auskunft vom Projekt braucht. */
export interface Baumstand {
  spreads: readonly Spread[];
  chapters(): { year: number; photoCount: number; firstSpreadIndex: number }[];
  groupMarks(): { spreadIndex: number; id: string; title: string }[];
  render(index: number): RenderedSpread | undefined;
}

export interface BaumSeite {
  index: number;
  /**
   * Die belegten Plätze in Slotreihenfolge.
   *
   * Mit dem Slotnamen und nicht nur der Bildkennung: Ein Zug nennt seine Quelle
   * als Platz (`MoveSource`), und die Oberfläche soll ihn nicht aus dem
   * gerenderten Blatt zusammensuchen müssen.
   */
  bilder: { slotId: string; photoId: string }[];
  templateId: string;
  /** Jahrgang, in dem diese Doppelseite steht. Fehlt, solange es keine Kapitel gibt. */
  year?: number;
  /** Fotogruppe, die auf dieser Doppelseite beginnt. */
  groupTitle?: string;
  /** Vom Neuanordnen ausgenommen – und damit kein Ziel zum Umhängen. */
  locked: boolean;
  /**
   * Auftaktseite mit Textplätzen. Ebenfalls kein Ziel: Ihre Platzzahl ist
   * gesetzt und nicht gerechnet (`movePhotos` lehnt solche Züge ab).
   */
  auftakt: boolean;
  /** Ohne Bilder – etwa, weil ein Stapel sie leer gezogen hat. */
  leer: boolean;
  /**
   * Ob an dieser Seite Handarbeit hängt, die eine neue Anordnung verwirft:
   * Ausschnitte, Neigungen, Rahmen, Unterschriften, gesetzte Kästen.
   *
   * Als Ja/Nein und nicht als Zahl: Vor dem Zug will man wissen, ob etwas auf
   * dem Spiel steht, nicht wie viel.
   */
  handarbeit: boolean;
  /** Bilder, deren Auflösung für ihren Platz nicht reicht. */
  zuKlein: number;
  /**
   * Bilder, die quer zu ihrem Platz stehen – hochkant im Querformat oder
   * umgekehrt. Häufigste Ursache ist eine Ausrichtungskorrektur: Das Bild
   * kippt, sein Platz nicht.
   */
  falscheLage: number;
}

/** Ob an dieser Doppelseite Handarbeit hängt, die eine Neuanordnung verwirft. */
function handarbeit(spread: Spread): boolean {
  return spread.slots.some(
    (sl) =>
      sl.crop.mode === 'manual' ||
      sl.rotateDeg !== undefined ||
      sl.frame !== undefined ||
      sl.caption !== undefined ||
      // Justierte Seiten tragen in jedem Slot ein Rechteck, aber gerechnet und
      // nicht gesetzt – der Neuaufbau stellt es wieder her.
      (sl.rect !== undefined && !isJustified(spread.templateId)),
  );
}

export function baum(z: Baumstand): BaumSeite[] {
  // Jahr je Seite aus den Kapitelanfängen: Ab dem Auftakt eines Jahrgangs gilt
  // er, bis der nächste anfängt.
  const anfaenge = z
    .chapters()
    .map((c) => ({ year: c.year, ab: c.firstSpreadIndex }))
    .sort((a, b) => a.ab - b.ab);

  const gruppeAn = new Map(z.groupMarks().map((g) => [g.spreadIndex, g.title]));

  let jahrgang = 0;
  return z.spreads.map((spread, index) => {
    while (jahrgang + 1 < anfaenge.length && anfaenge[jahrgang + 1]!.ab <= index) jahrgang++;
    const jahr = anfaenge[jahrgang];

    const bilder = spread.slots
      .filter((sl) => sl.photoId !== null)
      .map((sl) => ({ slotId: sl.slotId, photoId: sl.photoId! }));

    // Einmal gerendert, zwei Zahlen daraus: Beide Befunde stehen als Warnung
    // an der Bildbox, und ein zweiter Durchlauf wäre dieselbe Rechnung.
    const bildboxen = (z.render(index)?.boxes ?? []).filter((b) => b.kind === 'image');
    const mit = (code: string) =>
      bildboxen.filter((b) => b.warnings.some((w) => w.code === code)).length;

    const titel = gruppeAn.get(index);

    return {
      index,
      bilder,
      templateId: spread.templateId,
      ...(jahr && jahr.ab <= index ? { year: jahr.year } : {}),
      ...(titel ? { groupTitle: titel } : {}),
      locked: spread.locked === true,
      auftakt: (spread.texts?.length ?? 0) > 0,
      leer: bilder.length === 0,
      handarbeit: handarbeit(spread),
      zuKlein: mit('below-min-dpi'),
      falscheLage: mit('orientation-mismatch'),
    };
  });
}
