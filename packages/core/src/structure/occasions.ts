/**
 * Kalenderanlässe.
 *
 * Nach der Bestandsanalyse die wertvollste Auskunft überhaupt: Weil zeitliche
 * Lücken bei einem vorausgewählten Bestand keine Ereignisgrenzen mehr markieren,
 * sind Kalendermarken die einzige inhaltliche Gliederung, die sich ohne
 * Bildanalyse verlässlich setzen lässt. Für ein Buch zum 18. Geburtstag liefert
 * allein die Geburtstagserkennung 18 sichere Ankerpunkte.
 *
 * Die Erkennung mündet in Fotogruppen (`suggestOccasionGroups`) und nicht mehr
 * in einen Titel am Segment. Der Unterschied ist kein technischer: Was im Buch
 * steht, soll in der Gruppenansicht auffindbar, umbenennbar und auflösbar sein.
 * Ein Titel, der aus einem Detektor kam und nirgends aufzufinden war, stand
 * gedruckt im Buch, ohne dass jemand ihn anfassen konnte.
 */
import type { NaiveDateTime } from '../model/photo.js';

export interface DetectionContext {
  /** Geburtsdatum der Person, um die das Buch geht. */
  birthDate?: string;
  name?: string;
}

/**
 * Ostersonntag nach der anonymen gregorianischen Berechnung.
 *
 * Ostern verschiebt sich jedes Jahr, ein fester Kalendereintrag reicht also
 * nicht. Die Formel ist für alle Jahre des gregorianischen Kalenders gültig.
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Anlass eines einzelnen Tages, sofern der Kalender einen kennt.
 *
 * Macht aus „18. April 2020" ein „12. Geburtstag" – der Unterschied
 * entscheidet darüber, ob ein Gruppentitel im Buch etwas erzählt oder nur
 * eine Datumsangabe wiederholt.
 *
 * Der Geburtstag gilt ± 3 Tage: Gefeiert wird am Wochenende, nicht am Stichtag.
 * Weil dieselbe Funktion die Fotos eines Anlasses zusammenfasst, hält dieses
 * Fenster die Feier und den eigentlichen Tag in einer Gruppe.
 */
export function occasionOfDay(date: NaiveDateTime, ctx: DetectionContext = {}): string | undefined {
  const jahr = Number(date.slice(0, 4));
  const monat = Number(date.slice(5, 7));
  const tag = Number(date.slice(8, 10));

  if (ctx.birthDate) {
    const gMonat = Number(ctx.birthDate.slice(5, 7));
    const gTag = Number(ctx.birthDate.slice(8, 10));
    const gJahr = Number(ctx.birthDate.slice(0, 4));

    // Tagesdifferenz in Millisekunden statt getrenntem Monat/Tag-Vergleich:
    // Ein Geburtstag am Monatsende (30./31.) oder -anfang (1.-3.) läge sonst
    // außerhalb des Fensters, obwohl er nur wenige Kalendertage entfernt ist.
    // Drei Bezugsjahre für die Feier probieren, weil derselbe Vergleich auch
    // den Jahreswechsel abdeckt (Feier am 30.12., Foto vom 2.1. des
    // Folgejahres liegt in einem anderen Kalenderjahr als das Foto).
    for (const feierjahr of [jahr, jahr - 1, jahr + 1]) {
      const alter = feierjahr - gJahr;
      if (alter < 0 || alter > 120) continue;
      const diffTage =
        (Date.UTC(jahr, monat - 1, tag) - Date.UTC(feierjahr, gMonat - 1, gTag)) / 86_400_000;
      if (Math.abs(diffTage) <= 3) {
        return alter === 0 ? 'Geburt' : `${alter}. Geburtstag`;
      }
    }
  }

  if (monat === 12 && tag >= 24 && tag <= 26) return `Weihnachten ${jahr}`;
  if (monat === 12 && tag === 31) return `Silvester ${jahr}`;
  if (monat === 1 && tag === 1) return `Neujahr ${jahr}`;

  const ostern = easterSunday(jahr);
  const diffOstern =
    (Date.UTC(jahr, monat - 1, tag) - Date.UTC(jahr, ostern.month - 1, ostern.day)) / 86_400_000;
  if (diffOstern >= -2 && diffOstern <= 1) {
    return `Ostern ${jahr}`;
  }

  return undefined;
}
