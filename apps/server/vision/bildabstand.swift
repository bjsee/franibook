// Bildähnlichkeit über Apples FeaturePrint, als JSON auf stdout.
//
// Das Gegenstück zu `bildmerkmale.swift`, für Issue #18: Ob zwei Aufnahmen
// dieselbe Szene zeigen, entscheidet kein Wahrnehmungshash. Am Bestand
// gemessen (`docs/spikes/serien.md`) liegen echte Doppel beim dHash bei
// Abstand 12–45 und zwei zufällige Fotos im Median bei 28 — keine Trennung.
// `VNGenerateImageFeaturePrintRequest` beschreibt die Szene statt der Pixel
// und trennt brauchbar (Doppel median 0,73 gegen 1,08).
//
// Aufruf:  bildabstand <datei> … [-- <datei> …]
//          Die Dateien einer Gruppe werden untereinander verglichen, über
//          Gruppengrenzen hinweg nichts. Das spart die Vergleiche, die niemand
//          braucht: Über den ganzen Bestand wären es eine halbe Million, über
//          die Kandidaten rund hundert.
//
// Ausgabe: NDJSON, je Paar eine Zeile mit den Indizes **innerhalb der Gruppe**.
//          Eine Datei, deren Abdruck scheitert, kommt in keinem Paar vor — der
//          Aufrufer sieht sie als fehlende Messung und lässt sie heraus, statt
//          sie ungeprüft im Vorschlag zu behalten.

import Foundation
import Vision

struct Paarzeile: Encodable {
    let gruppe: Int
    let i: Int
    let j: Int
    let d: Double
}

struct Fehlerzeile: Encodable {
    let gruppe: Int
    let i: Int
    let datei: String
    let fehler: String
}

/// Der Merkmalsvektor eines Bildes.
///
/// Mit der Orientierung aus der Datei, wie im Gesichtswerkzeug: Ein Abdruck des
/// rohen Sensorbildes beschriebe bei Orientierung 6 eine um 90° gedrehte Szene,
/// und derselbe Moment aus zwei Kameras stünde sich unnötig fern.
func abdruck(_ pfad: String) -> (druck: VNFeaturePrintObservation?, fehler: String?) {
    let url = URL(fileURLWithPath: pfad)

    guard let quelle = CGImageSourceCreateWithURL(url as CFURL, nil),
        let eigenschaften = CGImageSourceCopyPropertiesAtIndex(quelle, 0, nil) as? [CFString: Any]
    else {
        return (nil, "nicht lesbar")
    }
    let roh = eigenschaften[kCGImagePropertyOrientation] as? Int ?? 1
    guard let orientierung = CGImagePropertyOrientation(rawValue: UInt32(roh)) else {
        return (nil, "unbekannte Orientierung")
    }

    let handler = VNImageRequestHandler(url: url, orientation: orientierung, options: [:])
    let anfrage = VNGenerateImageFeaturePrintRequest()
    do {
        try handler.perform([anfrage])
    } catch {
        return (nil, "\(error)")
    }
    guard let ergebnis = anfrage.results?.first as? VNFeaturePrintObservation else {
        return (nil, "kein Abdruck")
    }
    return (ergebnis, nil)
}

// Argumente in Gruppen zerlegen: `--` trennt.
var gruppen: [[String]] = [[]]
for argument in CommandLine.arguments.dropFirst() {
    if argument == "--" {
        gruppen.append([])
    } else {
        gruppen[gruppen.count - 1].append(argument)
    }
}

let kodierer = JSONEncoder()

func schreibe<T: Encodable>(_ zeile: T) {
    guard let daten = try? kodierer.encode(zeile),
        let text = String(data: daten, encoding: .utf8)
    else { return }
    print(text)
}

for (nummer, dateien) in gruppen.enumerated() where dateien.count > 1 {
    var abdruecke: [VNFeaturePrintObservation?] = []
    for (i, datei) in dateien.enumerated() {
        let (druck, fehler) = abdruck(datei)
        abdruecke.append(druck)
        if let grund = fehler {
            schreibe(Fehlerzeile(gruppe: nummer, i: i, datei: datei, fehler: grund))
        }
    }

    for i in 0..<abdruecke.count {
        guard let a = abdruecke[i] else { continue }
        for j in (i + 1)..<abdruecke.count {
            guard let b = abdruecke[j] else { continue }
            var abstand = Float(0)
            // `computeDistance` ist das eingebaute Maß des Vektors — kein
            // selbstgebauter Kosinus. Wer es selbst rechnet, muss die
            // Normierung kennen, und die ist nicht zugesagt.
            guard (try? a.computeDistance(&abstand, to: b)) != nil else { continue }
            schreibe(Paarzeile(gruppe: nummer, i: i, j: j, d: Double(abstand)))
        }
    }
}
