/**
 * Die Anordnungsprobe: das neu angeordnete Buch ansehen, bevor es gilt.
 *
 * „Buch neu anordnen" war der einzige Griff im Werkzeug, dessen Wirkung man
 * erst nach dem Klick sah – und der zugleich der teuerste ist: Er baut achtzig
 * Doppelseiten neu und verwirft dabei jede Handarbeit an ihnen. Wer nicht
 * weiß, was herauskommt, drückt ihn nicht; wer ihn drückt, weiß hinterher
 * nicht, was sich geändert hat.
 *
 * Die Probe rechnet dasselbe Buch, setzt es aber nicht ein. Was die Vorschau
 * zeigt, ist deshalb **kein Vorschlag, sondern das Ergebnis**: `uebernehmen`
 * schiebt genau diese Doppelseiten in den Projektzustand. Auf die
 * Determinismusregel allein wollte ich mich nicht verlassen – sie sagt „gleiche
 * Eingaben, gleiches Buch", und zwischen Ansehen und Übernehmen liegt eine
 * Sitzung, in der sich Eingaben ändern können.
 *
 * Genau dagegen steht der Abdruck: Er hält fest, aus welchen Eingaben die Probe
 * entstand. Stimmt er beim Übernehmen nicht mehr, wird abgelehnt statt still
 * etwas anderes eingesetzt.
 *
 * Die Probe wird **nicht gespeichert**. Sie ist eine Frage, keine Entscheidung –
 * wie die Doppelvorschläge (`project/doppel.ts`), und aus demselben Grund: Ein
 * gespeicherter Vorschlag wäre nach der nächsten Änderung falsch.
 */
import { createHash } from 'node:crypto';
import {
  type Anordnungsvergleich,
  defaultProfile,
  nextValidPageCount,
  profileById,
  type GenerateResult,
  type PhotoGroup,
  type PhotoId,
  type PhotoOverride,
  type Photo,
  type Seitenvergleich,
  type Spread,
  type Structure,
  structureFingerprint,
  vergleicheAnordnung,
} from '@franibook/core';
import type { ProjectSettings } from '../project.js';
import {
  type Handarbeit,
  type Handarbeitsbilanz,
  handarbeitStueck,
  handarbeitSumme,
  handarbeitVerloren,
} from './handarbeit.js';

/** Was die Probe vom Projekt braucht. */
export interface Probenbuch {
  spreads: Spread[];
  settings: ProjectSettings;
  structure: Structure;
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides: Record<PhotoId, PhotoOverride>;
  groups: PhotoGroup[];
  yearEvents: Record<string, string[]>;
  /** Rechnet ein Buch, ohne es einzusetzen. */
  baueBuch(settings: ProjectSettings, behalten?: ReadonlySet<number>): GenerateResult;
  /** Setzt ein gerechnetes Buch samt seinen Einstellungen in Kraft. */
  uebernimmBuch(result: GenerateResult, settings: ProjectSettings): void;
}

/** Eine Doppelseite der Vorschau: der Vergleich plus, was sie kostet. */
export interface Probeseite extends Seitenvergleich {
  /**
   * Wie viele von Hand getroffene Entscheidungen an der bisherigen Seite der
   * Neuaufbau verwirft.
   *
   * Die Summe über das Buch steht schon am Knopf; hier steht sie an der
   * einzelnen Seite. Das ist die Auskunft, die man beim Durchsehen wirklich
   * braucht: nicht „zwölf Ausschnitte", sondern „ausgerechnet die Seite, an der
   * du gestern eine Stunde saßt".
   */
  handarbeit: number;
  /**
   * Ob diese Doppelseite auf Verlangen bleibt, wie sie ist.
   *
   * Nicht dasselbe wie `locked`: Das gilt dauerhaft und über jede künftige
   * Anordnung hinweg, das hier gilt für **diese** Probe. Wer beim Durchsehen an
   * einer Seite „so lassen" sagt, will genau das und nicht eine Entscheidung
   * fürs ganze Buchleben.
   */
  behalten: boolean;
}

/** Was die Oberfläche über eine Probe erfährt. */
export interface Probeauskunft {
  id: string;
  /** Die Einstellungen, mit denen gerechnet wurde – oft mit anderem Seed. */
  settings: ProjectSettings;
  /**
   * Wenn die gewünschte Seitenzahl in diesem Format nicht geht.
   *
   * Fehlt, wenn sie ging. Die Oberfläche schreibt daraus einen Satz – die Zahl
   * in `settings` ist dann schon die eingerastete.
   */
  geklemmt?: { gewuenscht: number; wirksam: number };
  bilanz: {
    doppelVorher: number;
    doppelNachher: number;
    seitenVorher: number;
    seitenNachher: number;
    gleich: number;
    verschoben: number;
    geaendert: number;
    neu: number;
    entfallen: number;
    festgehalten: number;
    /** Bilder, die vorher in keiner Doppelseite standen und jetzt schon. */
    insBuch: number;
    /** Bilder, die aus dem Buch fallen – sie liegen danach im Fotopool. */
    ausDemBuch: number;
    fotosVorher: number;
    fotosNachher: number;
  };
  /** Was der Neuaufbau an Handarbeit verwirft. */
  handwork: Handarbeitsbilanz;
  /** Die Kennzahlen des gerechneten Buches – Auflösung, nicht platzierte Bilder. */
  report: GenerateResult['report'];
  /**
   * Doppelseiten, die auf Verlangen bleiben, wie sie sind – als Stellen im
   * bisherigen Buch (siehe `Seitenvergleich.altIndex`).
   */
  behalten: number[];
  seiten: Probeseite[];
}

/** Eine gerechnete, noch nicht eingesetzte Anordnung. */
export interface Anordnungsprobe {
  id: string;
  settings: ProjectSettings;
  result: GenerateResult;
  vergleich: Anordnungsvergleich;
  /** Aus welchen Eingaben sie entstand. */
  abdruck: string;
  auskunft: Probeauskunft;
}

/**
 * Abdruck der Eingaben, aus denen ein Buch entsteht.
 *
 * Alles, was `baueBuch` liest, plus die Doppelseiten selbst – die stehen darin,
 * weil festgehaltene Seiten unverändert durchgereicht werden und weil die
 * Vorschau ein „vorher" zeigt, das noch stimmen muss.
 *
 * Über die Gliederung nicht der Rohbestand, sondern ihr Fingerabdruck
 * (`structureFingerprint`): Eine Datumskorrektur um fünf Minuten, die keine
 * Reihenfolge kippt, soll eine offene Probe nicht verwerfen – dieselbe Grenze,
 * die auch `structurePending()` zieht.
 */
export function eingabenAbdruck(z: Probenbuch): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        spreads: z.spreads,
        settings: z.settings,
        struktur: structureFingerprint(z.structure),
        gruppen: z.groups,
        overrides: z.overrides,
        fotos: [...z.photos.keys()],
        jahresereignisse: z.yearEvents,
      }),
    )
    .digest('hex');
}

/** Die Bilder, die in einer Anordnung stehen. */
function platzierte(spreads: readonly Spread[]): number {
  let n = 0;
  for (const spread of spreads) for (const slot of spread.slots) if (slot.photoId) n++;
  return n;
}

/**
 * Rechnet eine Probe.
 *
 * Die Einstellungen der Probe entstehen wie bei `POST /api/generate` aus dem
 * Rumpf der Anfrage – regelmäßig ist das ein neuer Seed, denn „nochmal anders"
 * ist der halbe Zweck des Knopfes.
 *
 * Die Seitenzahl wird dabei **auf das Druckprofil eingerastet**, und zwar hier
 * und nicht erst in der Engine: Die Probe wird übernommen, wie sie ist, und
 * eine Vorgabe von 180 Seiten stünde danach dauerhaft im Projekt, obwohl dieses
 * Format bei 160 endet. Was daraus wurde, sagt die Probe in `geklemmt` – sonst
 * sähe eine Vorschau, die auf 180 gerechnet wurde und 160 ergibt, nach einem
 * Fehler der Vorschau aus.
 */
export function probeRechnen(
  z: Probenbuch,
  patch: Partial<ProjectSettings>,
  behalten: readonly number[] = [],
): Anordnungsprobe {
  const gewuenscht: ProjectSettings = { ...z.settings, ...patch };
  const profil = profileById(gewuenscht.printProfileId) ?? defaultProfile();
  const wirksam = nextValidPageCount(profil, gewuenscht.targetPages);
  const settings: ProjectSettings = { ...gewuenscht, targetPages: wirksam };
  const vorher = z.spreads;
  // Nur Stellen, die es gibt, und jede einmal: Eine Liste, die auf eine Seite
  // von vorhin zeigt, wäre sonst eine stille Zusage, die niemand einlöst.
  const bleiben = [...new Set(behalten)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < vorher.length)
    .sort((a, b) => a - b);
  const result = z.baueBuch(settings, new Set(bleiben));
  // Erst nach `baueBuch`: Es zieht die Kalendergliederung nach, und ein Abdruck
  // von vorher wäre schon beim Anlegen veraltet.
  const abdruck = eingabenAbdruck(z);
  const vergleich = vergleicheAnordnung(vorher, result.spreads);

  const verluste: Handarbeit[] = [];
  const seiten: Probeseite[] = vergleich.seiten.map((s) => {
    const alt = s.altIndex === null ? undefined : vorher[s.altIndex];
    const neu = s.neuIndex === null ? undefined : result.spreads[s.neuIndex];
    // Festgehaltenes kostet nichts: Es geht unverändert durch den Neuaufbau.
    if (!alt || alt.locked) return { ...s, handarbeit: 0, behalten: false };
    if (s.altIndex !== null && bleiben.includes(s.altIndex)) {
      return { ...s, handarbeit: 0, behalten: true };
    }
    const verlust = handarbeitVerloren(alt, neu);
    verluste.push(verlust);
    return { ...s, handarbeit: handarbeitStueck(verlust), behalten: false };
  });

  const auskunft: Probeauskunft = {
    id: createHash('sha1')
      .update(`${abdruck}:${JSON.stringify(settings)}:behalten=${bleiben.join(',')}`)
      .digest('hex')
      .slice(0, 16),
    settings,
    ...(wirksam !== gewuenscht.targetPages
      ? { geklemmt: { gewuenscht: gewuenscht.targetPages, wirksam } }
      : {}),
    bilanz: {
      doppelVorher: vorher.length,
      doppelNachher: result.spreads.length,
      seitenVorher: vorher.length * 2,
      seitenNachher: result.spreads.length * 2,
      gleich: vergleich.gleich,
      verschoben: vergleich.verschoben,
      geaendert: vergleich.geaendert,
      neu: vergleich.neu,
      entfallen: vergleich.entfallen,
      festgehalten: vergleich.festgehalten,
      insBuch: vergleich.insBuch.length,
      ausDemBuch: vergleich.ausDemBuch.length,
      fotosVorher: platzierte(vorher),
      fotosNachher: platzierte(result.spreads),
    },
    // Aus dem Vergleich summiert und nicht über `handwork()` gezählt: Diese
    // Zahl soll sagen, was *diese* Anordnung kostet, und muss deshalb mit den
    // Zahlen an den einzelnen Seiten zusammengehen (siehe `handarbeitVerloren`).
    handwork: {
      ...handarbeitSumme(verluste),
      festgehalten: vergleich.festgehalten,
      // Halbseitige Schlösser zählt der Vergleich nicht mit: Sie sagen nichts
      // darüber, wie viele Blätter dieser Lauf unangetastet lässt. Die Zahl
      // steht in `handwork()` am Buch.
      halbFestgehalten: result.spreads.filter((sp) => sp.lockedSide !== undefined).length,
    },
    report: result.report,
    behalten: bleiben,
    seiten,
  };

  return { id: auskunft.id, settings, result, vergleich, abdruck, auskunft };
}

/** Ob die Probe noch zu dem Stand passt, aus dem sie gerechnet wurde. */
export function probeGilt(z: Probenbuch, probe: Anordnungsprobe): boolean {
  return eingabenAbdruck(z) === probe.abdruck;
}

/**
 * Setzt die Probe in Kraft.
 *
 * @returns ein deutscher Satz, wenn nicht – die Route macht daraus einen 409.
 */
export function probeUebernehmen(
  z: Probenbuch,
  probe: Anordnungsprobe | null,
  id: string | undefined,
): { ok: true; result: GenerateResult } | { ok: false; error: string } {
  if (!probe) {
    return { ok: false, error: 'Es liegt keine Probe vor. Rechne sie neu, dann geht es weiter.' };
  }
  if (id !== undefined && id !== probe.id) {
    return {
      ok: false,
      error: 'Die Probe ist eine andere als die angezeigte. Lade die Vorschau neu.',
    };
  }
  if (!probeGilt(z, probe)) {
    return {
      ok: false,
      error:
        'Am Projekt hat sich etwas geändert, seit die Probe gerechnet wurde. ' +
        'Rechne sie neu – sonst käme etwas anderes heraus als die Vorschau zeigt.',
    };
  }
  z.uebernimmBuch(probe.result, probe.settings);
  return { ok: true, result: probe.result };
}
