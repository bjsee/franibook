/**
 * Offline-Ortsauflösung.
 *
 * Ordnet GPS-Koordinaten einen Ortsnamen zu, ohne Netz. Grundlage sind die
 * GeoNames-Städtedaten (CC BY 4.0), reduziert auf 58.185 Orte: Deutschland und
 * die Nachbarländer ab 1.000 Einwohnern, der Rest der Welt ab 15.000.
 *
 * Die Benennungsregel folgt der Art, wie man über Orte spricht:
 *
 *   Inland          → Stadt            "Bremerhaven", "Dorum"
 *   bekannte Insel  → Insel            "Kreta", "Mallorca"
 *   Großstadt       → Stadt            "Wien", "Paris", "London"
 *   sonst Ausland   → Land             "Dänemark", "Niederlande"
 *
 * Ein Strandurlaub in Jütland heißt „Dänemark", eine Städtereise heißt
 * „Paris" – und beides ist umbenennbar, wenn es im Einzelfall nicht passt.
 */
import places from './places.json' with { type: 'json' };

export interface PlaceLookup {
  /** Der Name, unter dem der Ort im Buch erscheint. */
  label: string;
  /** Wodurch der Name zustande kam. */
  kind: 'city' | 'island' | 'country';
  /** Nächstgelegener Ort aus der Datenbank. */
  nearestCity: string;
  countryCode: string;
  /** Entfernung zum nächstgelegenen Ort in Kilometern. */
  distanceKm: number;
  /** Verwaltungsregion, sofern bekannt. */
  region?: string;
}

interface PlacesDb {
  names: string[];
  lat: number[];
  lon: number[];
  cc: string[];
  adm1: string[];
  pop: number[];
  regions: Record<string, string>;
  source: string;
}

const DB = places as unknown as PlacesDb;

/** Länder, in denen Orte statt Ländernamen benannt werden. */
const HOME_COUNTRIES = new Set(['DE']);

/** Ab dieser Einwohnerzahl gilt ein Ort als Großstadt und wird namentlich genannt. */
const CITY_THRESHOLD = 100_000;

/**
 * Regionen, die als Insel benannt werden.
 *
 * Bewusst kuratiert statt automatisch: Nur wo der Regionsname tatsächlich der
 * gebräuchliche Inselname ist, ergibt er als Gruppenname Sinn. „Südägäis"
 * würde niemand sagen – dort greift die Stadt- oder Länderregel.
 */
const ISLAND_REGIONS: Record<string, string> = {
  'GR.ESYE43': 'Kreta',
  'GR.ESYE22': 'Ionische Inseln',
  'ES.07': 'Mallorca',
  'ES.53': 'Balearen',
  'ES.54': 'Kanaren',
  'IT.15': 'Sizilien',
  'IT.14': 'Sardinien',
  'PT.30': 'Madeira',
  'PT.20': 'Azoren',
  'FR.76': 'Korsika',
  'HR.13': 'Dalmatien',
  'IS.00': 'Island',
  'MT.00': 'Malta',
};

/**
 * Einzugsradius eines Ortes in Kilometern.
 *
 * Ohne ihn gewinnt bei einer Aufnahme in Paris der nächstgelegene Stadtteil –
 * gemessen kamen „Paris 16 Passy" und für London „Shadwell" heraus. Eine
 * Millionenstadt strahlt weiter als ein Dorf, deshalb wächst der Radius mit
 * der Wurzel der Einwohnerzahl.
 */
function radiusKm(population: number): number {
  return Math.max(2, Math.sqrt(population) / 60);
}

/**
 * Deutsche Städtenamen.
 *
 * GeoNames führt die meisten Städte unter ihrem englischen oder lokalen Namen –
 * „Vienna", „Rome", „Copenhagen". Für Ländernamen erledigt `Intl` das
 * Übersetzen; für Städte gibt es nichts Vergleichbares, deshalb diese Liste.
 * Sie deckt die europäischen Städte ab, deren deutscher Name abweicht; alles
 * andere bleibt, wie es in der Datenbank steht.
 */
const CITY_NAMES_DE: Record<string, string> = {
  Vienna: 'Wien',
  Rome: 'Rom',
  Prague: 'Prag',
  Copenhagen: 'Kopenhagen',
  Warsaw: 'Warschau',
  Milan: 'Mailand',
  Venice: 'Venedig',
  Florence: 'Florenz',
  Naples: 'Neapel',
  Turin: 'Turin',
  Genoa: 'Genua',
  Lisbon: 'Lissabon',
  Brussels: 'Brüssel',
  Antwerp: 'Antwerpen',
  Ghent: 'Gent',
  Bruges: 'Brügge',
  Geneva: 'Genf',
  Zurich: 'Zürich',
  Basel: 'Basel',
  Athens: 'Athen',
  Bucharest: 'Bukarest',
  Moscow: 'Moskau',
  'Saint Petersburg': 'Sankt Petersburg',
  Krakow: 'Krakau',
  Kraków: 'Krakau',
  Gothenburg: 'Göteborg',
  Seville: 'Sevilla',
  Cordoba: 'Córdoba',
  'The Hague': 'Den Haag',
  Nice: 'Nizza',
  Strasbourg: 'Straßburg',
  Dunkirk: 'Dünkirchen',
  Liege: 'Lüttich',
  Liège: 'Lüttich',
  Belgrade: 'Belgrad',
  Ljubljana: 'Laibach',
  Bratislava: 'Pressburg',
  Zagreb: 'Agram',
};

/** Deutscher Ländername. `Intl` erspart eine eigene Übersetzungstabelle. */
const COUNTRY_NAMES = new Intl.DisplayNames(['de'], { type: 'region' });

function cityName(name: string): string {
  return CITY_NAMES_DE[name] ?? name;
}

function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Entfernung in Kilometern, für kurze Strecken ausreichend genau. */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = bLat - aLat;
  const dLon = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111.32;
}

/**
 * Löst Koordinaten in einen Ortsnamen auf.
 *
 * Gesucht wird nicht schlicht der nächstgelegene Ort, sondern der größte, in
 * dessen Einzugsradius die Koordinate liegt. Nur wenn keiner passt, entscheidet
 * die reine Entfernung.
 */
export function lookupPlace(lat: number, lon: number): PlaceLookup | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const coslat = Math.cos((lat * Math.PI) / 180);
  let nearestIndex = -1;
  let nearestSq = Number.POSITIVE_INFINITY;
  let bestInRadius = -1;
  let bestPop = -1;

  for (let i = 0; i < DB.lat.length; i++) {
    const dLat = DB.lat[i]! - lat;
    const dLon = (DB.lon[i]! - lon) * coslat;
    const sq = dLat * dLat + dLon * dLon;

    if (sq < nearestSq) {
      nearestSq = sq;
      nearestIndex = i;
    }

    // Vorprüfung im Gradmaß, bevor die Wurzel gezogen wird
    const pop = DB.pop[i]!;
    if (pop > bestPop) {
      const r = radiusKm(pop) / 111.32;
      if (sq <= r * r) {
        bestInRadius = i;
        bestPop = pop;
      }
    }
  }

  if (nearestIndex < 0) return undefined;

  const index = bestInRadius >= 0 ? bestInRadius : nearestIndex;
  const cc = DB.cc[index]!;
  const city = DB.names[index]!;
  const regionKey = `${cc}.${DB.adm1[index]!}`;
  const region = DB.regions[regionKey];
  const km = distanceKm(lat, lon, DB.lat[index]!, DB.lon[index]!);

  const base = {
    nearestCity: city,
    countryCode: cc,
    distanceKm: Math.round(km * 10) / 10,
    ...(region ? { region } : {}),
  };

  if (HOME_COUNTRIES.has(cc)) {
    return { ...base, label: cityName(city), kind: 'city' };
  }

  const island = ISLAND_REGIONS[regionKey];
  if (island) {
    return { ...base, label: island, kind: 'island' };
  }

  if (DB.pop[index]! >= CITY_THRESHOLD) {
    return { ...base, label: cityName(city), kind: 'city' };
  }

  return { ...base, label: countryName(cc), kind: 'country' };
}

/** Kennung, unter der ein Ort im Projekt geführt wird. */
export function placeKey(place: PlaceLookup): string {
  return `${place.kind}:${place.label}`;
}

export const PLACES_SOURCE = DB.source;
export const PLACES_COUNT = DB.names.length;
