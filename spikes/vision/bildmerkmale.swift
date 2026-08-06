// Gesichter und Aufmerksamkeitsschwerpunkt eines Bildes, als JSON auf stdout.
//
// Spike zu Issue #17: Der automatische Ausschnitt zentriert auf die Bildmitte
// (`coverCrop` ohne `focal`), und die schneidet zuverlässig Köpfe an. Vision
// liefert die Rechtecke, ohne ein Modell ins Repo zu holen — dieselbe
// Bordmittel-Begründung wie beim `sips`-Pfad für HEIC.
//
// Aufruf:  bildmerkmale <datei> [<datei> …]
// Ausgabe: eine JSON-Zeile je Datei (NDJSON), damit ein Aufrufer streamen kann.
//
// Koordinaten sind **relativ und mit Ursprung oben links** — also so, wie das
// Projekt sie in `Crop` führt. Vision selbst rechnet von unten links; die
// Umrechnung steht an genau einer Stelle (`nachOben`).

import CoreImage
import Foundation
import Vision

struct Rechteck: Encodable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct Befund: Encodable {
    let datei: String
    var breite: Int = 0
    var hoehe: Int = 0
    /// Orientierung aus der Datei, 1..8 — zur Kontrolle, in welchem System die
    /// Rechtecke stehen.
    var orientierung: Int = 1
    var gesichter: [Rechteck] = []
    /// Schwerpunkt der Aufmerksamkeitskarte, für Bilder ohne Gesicht.
    var salienz: Rechteck?
    var fehler: String?
    var millisekunden: Int = 0
}

/// Vision rechnet normalisiert von unten links, das Projekt von oben links.
func nachOben(_ r: CGRect) -> Rechteck {
    Rechteck(x: Double(r.minX), y: Double(1 - r.maxY), w: Double(r.width), h: Double(r.height))
}

func merkmale(_ pfad: String) -> Befund {
    var befund = Befund(datei: pfad)
    let start = DispatchTime.now()
    let url = URL(fileURLWithPath: pfad)

    guard let quelle = CGImageSourceCreateWithURL(url as CFURL, nil),
        let eigenschaften = CGImageSourceCopyPropertiesAtIndex(quelle, 0, nil)
            as? [CFString: Any]
    else {
        befund.fehler = "nicht lesbar"
        return befund
    }

    let rohBreite = eigenschaften[kCGImagePropertyPixelWidth] as? Int ?? 0
    let rohHoehe = eigenschaften[kCGImagePropertyPixelHeight] as? Int ?? 0
    befund.orientierung = eigenschaften[kCGImagePropertyOrientation] as? Int ?? 1

    // Maße des **angezeigten** Bildes, also bei Orientierung 5..8 getauscht —
    // dieselbe Regel wie in `apps/server/src/import.ts` (`swap`), und dieselbe,
    // in der die Rechtecke unten stehen. Ungetauscht gemeldet ergäbe ein
    // Seitenverhältnis, das zu den Rechtecken nicht passt: An einem Bild mit
    // Orientierung 6 nachgemessen, das Rechteck wandert mit.
    let gekippt = befund.orientierung >= 5 && befund.orientierung <= 8
    befund.breite = gekippt ? rohHoehe : rohBreite
    befund.hoehe = gekippt ? rohBreite : rohHoehe

    // `VNImageRequestHandler` mit der Orientierung aus der Datei: Damit stehen
    // die Rechtecke im **angezeigten** Bild und nicht im rohen Sensorbild. Der
    // Ausschnitt im Projekt bezieht sich ebenfalls auf das angezeigte Bild
    // (`prepare-image.ts` dreht vor `extract`), also ist das die passende Wahl —
    // der Spike prüft es an einem Bild mit Orientierung 6 nach.
    guard let cgOrientierung = CGImagePropertyOrientation(rawValue: UInt32(befund.orientierung))
    else {
        befund.fehler = "unbekannte Orientierung"
        return befund
    }

    let handler = VNImageRequestHandler(url: url, orientation: cgOrientierung, options: [:])
    let gesichter = VNDetectFaceRectanglesRequest()
    let salienz = VNGenerateAttentionBasedSaliencyImageRequest()

    do {
        try handler.perform([gesichter, salienz])
    } catch {
        befund.fehler = "\(error)"
        return befund
    }

    befund.gesichter =
        (gesichter.results ?? [])
        .map { nachOben($0.boundingBox) }
        .sorted { $0.w * $0.h > $1.w * $1.h }

    // Die Aufmerksamkeitskarte liefert ein „salient object" als Rechteck. Nur
    // das erste: Mehrere sind bei einem Fotobuchmotiv die Ausnahme, und der
    // Fokuspunkt braucht ohnehin einen.
    if let beobachtung = salienz.results?.first,
        let objekt = beobachtung.salientObjects?.first
    {
        befund.salienz = nachOben(objekt.boundingBox)
    }

    befund.millisekunden = Int(
        (DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
    return befund
}

let kodierer = JSONEncoder()
for pfad in CommandLine.arguments.dropFirst() {
    let daten = try kodierer.encode(merkmale(pfad))
    print(String(data: daten, encoding: .utf8) ?? "{}")
}
