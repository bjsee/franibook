// Bildähnlichkeit über Apples FeaturePrint, als NDJSON auf stdout.
//
// Spike zu Issue #18, zweiter Weg. Der erste (dHash) ist am Bestand gemessen
// und trennt nicht: Serien liegen bei Hamming-Abstand 12–45, zwei zufällige
// Fotos im Median bei 28. Der Grund ist der Bestand selbst — die Serien darin
// sind keine bitnahen Bursts, sondern verschiedene Aufnahmen desselben Moments.
// Genau dafür ist `VNGenerateImageFeaturePrintRequest` gedacht: Es beschreibt
// die Szene, nicht die Pixel.
//
// Aufruf:  featureprint <datei> [<datei> …]
// Ausgabe: je Datei eine Zeile, danach je Paar eine Zeile mit dem Abstand.
//          Der Aufrufer bestimmt über die Zahl der Dateien, wie groß das wird
//          (n² Paare) — deshalb keine Filterung hier: Die Verteilung ist die
//          Messung, und wer sie filtert, misst sie nicht mehr.

import Foundation
import Vision

struct Dateizeile: Encodable {
    let typ = "datei"
    let i: Int
    let pfad: String
    var fehler: String?
    var millisekunden: Int = 0
}

struct Paarzeile: Encodable {
    let typ = "paar"
    let i: Int
    let j: Int
    let d: Double
}

/// Der Merkmalsvektor eines Bildes.
///
/// Wie beim Gesichtswerkzeug mit der Orientierung aus der Datei: Ein
/// FeaturePrint des rohen Sensorbildes beschriebe bei Orientierung 6 eine um
/// 90° gedrehte Szene, und der Abstand zu demselben Motiv aus einer anderen
/// Kamera wäre unnötig groß.
func abdruck(_ pfad: String) -> (VNFeaturePrintObservation?, String?, Int) {
    let start = DispatchTime.now()
    let url = URL(fileURLWithPath: pfad)

    guard let quelle = CGImageSourceCreateWithURL(url as CFURL, nil),
        let eigenschaften = CGImageSourceCopyPropertiesAtIndex(quelle, 0, nil) as? [CFString: Any]
    else {
        return (nil, "nicht lesbar", 0)
    }
    let roh = eigenschaften[kCGImagePropertyOrientation] as? Int ?? 1
    guard let orientierung = CGImagePropertyOrientation(rawValue: UInt32(roh)) else {
        return (nil, "unbekannte Orientierung", 0)
    }

    let handler = VNImageRequestHandler(url: url, orientation: orientierung, options: [:])
    let anfrage = VNGenerateImageFeaturePrintRequest()
    do {
        try handler.perform([anfrage])
    } catch {
        return (nil, "\(error)", 0)
    }
    let ms = Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
    return (anfrage.results?.first as? VNFeaturePrintObservation, nil, ms)
}

let pfade = Array(CommandLine.arguments.dropFirst())
let kodierer = JSONEncoder()
var abdruecke: [VNFeaturePrintObservation?] = []

for (i, pfad) in pfade.enumerated() {
    let (druck, fehler, ms) = abdruck(pfad)
    abdruecke.append(druck)
    var zeile = Dateizeile(i: i, pfad: pfad)
    zeile.fehler = fehler
    zeile.millisekunden = ms
    print(String(data: try kodierer.encode(zeile), encoding: .utf8) ?? "{}")
}

for i in 0..<abdruecke.count {
    guard let a = abdruecke[i] else { continue }
    for j in (i + 1)..<abdruecke.count {
        guard let b = abdruecke[j] else { continue }
        var abstand = Float(0)
        // `computeDistance` ist das eingebaute Abstandsmaß des Vektors — kein
        // selbstgebauter Kosinus. Wer es selbst rechnet, muss die Normierung
        // kennen, und die ist nicht zugesagt.
        try a.computeDistance(&abstand, to: b)
        print(
            String(
                data: try kodierer.encode(Paarzeile(i: i, j: j, d: Double(abstand))),
                encoding: .utf8) ?? "{}")
    }
}
