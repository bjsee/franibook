/**
 * Doppel vorschlagen: mehrere Aufnahmen desselben Augenblicks.
 *
 * Die Rechnung steht im Kern (`structure/doppel.ts`) und in zwei Schritten:
 * Die Zeit schlägt Kandidaten vor, ein gemessener Bildabstand bestätigt sie.
 * Dieses Modul ist das Bindeglied — es holt die Vorschauen, lässt vergleichen
 * (`vision.ts`) und übersetzt zwischen Gruppenindizes und Fotokennungen.
 *
 * **Der Vorschlag selbst wird nicht gespeichert.** Kein Feld am `Photo`, kein
 * Eintrag im Projekt: Er hängt am Bestand und an den Datumskorrekturen, und ein
 * gespeicherter wäre nach der nächsten Korrektur falsch. Gerechnet kostet er
 * rund anderthalb Sekunden für den ganzen Bestand, und das nur, wenn jemand die
 * Liste öffnet.
 *
 * **Gespeichert wird allein die Entscheidung darüber** (`doppelBehalten` im
 * Projekt): Wer „beide behalten" drückt, will das Doppel nicht beim nächsten
 * Aufruf wiedersehen. Genau wie ein abgenickter Befund im Abnahmebericht — und
 * wie dort bleibt es in der Antwort stehen, damit die Entscheidung umkehrbar
 * ist.
 *
 * Was der Benutzer sonst damit tut, ist die vorhandene Route: Aussortieren über
 * `DELETE /api/photos/:id` samt Merkliste. Ein Doppel löst sich nicht selbst
 * auf — welches der drei das gute ist, entscheidet kein Abstandsmaß.
 */
import {
  type Bildabstand,
  type Doppel,
  type DoppelKandidat,
  type DoppelOptions,
  type Photo,
  type PhotoId,
  DOPPEL_FENSTER_S,
  DOPPEL_HOECHSTABSTAND,
  bestaetigeDoppel,
  doppelSchluessel,
  findeDoppelKandidaten,
} from '@franibook/core';
import type { PreviewCache } from '../previews.js';
import type { AbstandsErkennung } from '../vision.js';

/** Was dieses Modul vom Projekt anfasst. */
export interface Doppelstand {
  photos: Map<PhotoId, Photo>;
  effectivePhotoList(): Photo[];
  /** Doppel, die ausdrücklich stehen bleiben — Schlüssel → Zeitpunkt. */
  doppelBehalten: Record<string, string>;
}

export interface DoppelVorschlag extends Doppel {
  /**
   * Welches Foto die Automatik behielte — das schärfste.
   *
   * Ein Vorschlag und keine Setzung: Die Schärfe trennt innerhalb eines
   * Doppels zwar deutlich (gemessen Faktor 3–6, `docs/spikes/serien.md`), aber
   * das schärfere Bild ist nicht immer das bessere. Fehlt allen Fotos die
   * Qualitätsmessung, steht hier das erste — die Reihenfolge der Aufnahme.
   */
  behalten: PhotoId;
  /** Die Kennung, unter der ein „beide behalten" gemerkt wird. */
  schluessel: string;
  /**
   * Wann „beide behalten" gedrückt wurde, sofern es das wurde.
   *
   * Das Doppel bleibt trotzdem in der Antwort — wie ein abgenickter Befund im
   * Abnahmebericht. Die Oberfläche blendet es aus und sagt am Fuß, wie viele es
   * sind; ganz zu verschweigen hieße, eine Entscheidung unwiderruflich zu
   * machen, die keine sein muss.
   */
  behaltenSeit?: string;
}

export interface DoppelBericht {
  doppel: DoppelVorschlag[];
  /** Fotos in allen Vorschlägen zusammen. */
  fotos: number;
  /**
   * Ob ein Bildvergleich stattgefunden hat.
   *
   * `false` heißt: Das Vergleichswerkzeug fehlt, und die Vorschläge stammen
   * allein aus der Zeit. Das ist eine schwächere Aussage — zwei Kameras auf
   * demselben Fest stehen dann als Doppel darin —, und die Oberfläche soll das
   * sagen können, statt einen ungeprüften Vorschlag als geprüften auszugeben.
   */
  bestaetigt: boolean;
  /**
   * Die Schwellen, mit denen gerechnet wurde.
   *
   * Sie gehören in die Antwort, weil die Oberfläche den Vorschlag begründen
   * soll: „0,59 von höchstens 0,85" ist eine Auskunft, „0,59" allein eine Zahl.
   * Und weil beide über die Query verstellbar sind, wäre eine feste zweite
   * Fassung davon in der Ansicht früher oder später die falsche.
   */
  fensterSekunden: number;
  hoechstabstand: number;
  millisekunden: number;
}

/** Das schärfste Foto eines Doppels, oder das erste. */
function schaerfstes(ids: readonly PhotoId[], photos: ReadonlyMap<PhotoId, Photo>): PhotoId {
  let beste = ids[0]!;
  let bester = -1;
  for (const id of ids) {
    const wert = photos.get(id)?.quality?.sharpness;
    if (wert !== undefined && wert > bester) {
      bester = wert;
      beste = id;
    }
  }
  return beste;
}

/**
 * Schlägt Doppel für den ganzen Bestand vor.
 *
 * @param datiert Die Fotos mit aufgelöstem Datum, in beliebiger Reihenfolge —
 * der Kern sortiert selbst. Undatierte gehören nicht hinein: Ohne Zeitpunkt
 * gibt es keine zeitliche Nähe, und ein Doppel aus zwei undatierten Fotos wäre
 * geraten.
 */
export async function doppelVorschlagen(
  datiert: readonly DoppelKandidat[],
  stand: Doppelstand,
  previews: PreviewCache,
  abstaende: AbstandsErkennung,
  opts: DoppelOptions = {},
): Promise<DoppelBericht> {
  const t0 = Date.now();
  // Die geltenden Schwellen an einer Stelle: Sie stehen in der Antwort, damit
  // die Oberfläche den Vorschlag begründen kann, und die Vorgaben dazu im Kern
  // (`DoppelOptions`) — hier wird nur eingesetzt, was der Aufrufer nicht sagt.
  const schwellen = {
    fensterSekunden: opts.fensterSekunden ?? DOPPEL_FENSTER_S,
    hoechstabstand: opts.hoechstabstand ?? DOPPEL_HOECHSTABSTAND,
  };

  const kandidaten = findeDoppelKandidaten(datiert, opts);
  if (kandidaten.length === 0) {
    return {
      doppel: [],
      fotos: 0,
      bestaetigt: !abstaende.abgeschaltet,
      ...schwellen,
      millisekunden: 0,
    };
  }

  // Die Vorschauen der beteiligten Fotos, über die effektiven Fotos: Der Cache
  // trägt die Drehung im Namen, ein rohes Foto zeigte auf eine zweite Datei.
  const effektiv = new Map(stand.effectivePhotoList().map((p) => [p.id, p]));
  const gruppen: string[][] = [];
  const idsJeGruppe: PhotoId[][] = [];

  for (const kandidat of kandidaten) {
    const pfade: string[] = [];
    const ids: PhotoId[] = [];
    for (const id of kandidat.photoIds) {
      const foto = effektiv.get(id);
      if (!foto) continue;
      try {
        pfade.push(await previews.get(foto, 'thumb'));
        ids.push(id);
      } catch {
        // Ohne Vorschau kein Vergleich. Das Foto fällt aus dem Vorschlag —
        // dieselbe Haltung wie bei einer fehlenden Messung im Kern.
      }
    }
    gruppen.push(pfade);
    idsJeGruppe.push(ids);
  }

  const gemessen = await abstaende.vergleiche(gruppen);

  // Ohne Werkzeug bleibt es bei den Kandidaten aus der Zeit. Das ist die
  // schwächere Auskunft, aber eine ehrliche — und `bestaetigt: false` sagt es.
  if (abstaende.abgeschaltet) {
    return fertig(kandidaten, stand, false, schwellen, t0);
  }

  const bildabstaende: Bildabstand[] = [];
  for (const [gruppe, paare] of gemessen) {
    const ids = idsJeGruppe[gruppe];
    if (!ids) continue;
    for (const paar of paare) {
      const a = ids[paar.i];
      const b = ids[paar.j];
      if (a && b) bildabstaende.push({ a, b, distanz: paar.distanz });
    }
  }

  return fertig(bestaetigeDoppel(kandidaten, bildabstaende, opts), stand, true, schwellen, t0);
}

function fertig(
  doppel: readonly Doppel[],
  stand: Doppelstand,
  bestaetigt: boolean,
  schwellen: { fensterSekunden: number; hoechstabstand: number },
  t0: number,
): DoppelBericht {
  const mitVorschlag = doppel.map((d) => {
    const schluessel = doppelSchluessel(d.photoIds);
    const seit = stand.doppelBehalten[schluessel];
    return {
      ...d,
      behalten: schaerfstes(d.photoIds, stand.photos),
      schluessel,
      // Ein gemerktes Doppel bleibt in der Antwort — die Oberfläche blendet es
      // aus und sagt am Fuß, wie viele es sind. Es zu verschweigen machte eine
      // Entscheidung unwiderruflich, die keine sein muss.
      ...(seit !== undefined ? { behaltenSeit: seit } : {}),
    };
  });
  return {
    doppel: mitVorschlag,
    fotos: mitVorschlag.reduce((n, d) => n + d.photoIds.length, 0),
    ...schwellen,
    bestaetigt,
    millisekunden: Date.now() - t0,
  };
}
