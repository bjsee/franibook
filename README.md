# Franibook

Lokaler Fotobuch-Generator: aus einem Ordner mit mehreren hundert Fotos automatisch
einen Fotobuch-Entwurf erzeugen, ihn im Browser als Doppelseiten prüfen und korrigieren
und daraus ein druckfertiges PDF exportieren.

Konkreter Anlass: ein Fotobuch zum 18. Geburtstag mit rund 900 Fotos aus den Jahren
2008 bis 2026, Druck über PrintPartner.

## Stand

Der Durchstich steht: 820 Fotos werden importiert, chronologisch nach Jahren und
Fotogruppen gegliedert und zu 86 Doppelseiten gesetzt, die sich im Browser
durchblättern und über ein Layout-JSON umbauen lassen. Der Innenteil wird als PDF
exportiert (819 Bilder in 31 s), und der Parity-Test belegt, dass Vorschau und
Druck übereinstimmen.

Bis zum ersten Druckauftrag fehlen vier Dinge, alle als
[Issue](https://github.com/bjsee/franibook/issues) erfasst: verifizierte Maße von
Saal, ein Cover, eine kleinere PDF-Datei und eine exakt getroffene Seitenzahl
(derzeit 172 statt 160). Ausführlich in
[docs/implementierungsphasen.md](docs/implementierungsphasen.md).

## Dokumentation

| Dokument                                                         | Inhalt                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [docs/anforderungen.md](docs/anforderungen.md)                   | Fachliche Ausgangsanforderung                                                              |
| [docs/konzept.md](docs/konzept.md)                               | Technisches Konzept: Architektur, Datenmodell, Layout-Engine, PDF-Rendering, Teststrategie |
| [docs/implementierungsphasen.md](docs/implementierungsphasen.md) | Zerlegung in einzeln testbare Phasen                                                       |
| [docs/spikes/phase-0.md](docs/spikes/phase-0.md)                 | Messergebnisse zu HEIC, PDF-Speicher und Metadaten-Durchsatz                               |

## Entwicklung

```sh
pnpm install
pnpm test        # Vitest über alle Pakete
pnpm typecheck   # tsc über alle Pakete
pnpm lint
```

Die Spikes brauchen einen generierten Testbestand (~3,5 GB unter `spikes/out/`):

```sh
pnpm --filter @franibook/spikes fixtures
pnpm --filter @franibook/spikes exif
pnpm --filter @franibook/spikes heic
```

## Leitidee

Die Layout-Engine erzeugt weder HTML noch PDF, sondern ein _Rendered Spread Model_ —
absolut in Millimetern positionierte Boxen. Browser-Vorschau und PDF-Export sind zwei
dünne Adapter über derselben Quelle. Ein automatisierter Parity-Test vergleicht die
gerenderte Vorschau pixelweise mit der gerasterten PDF-Seite und sichert damit ab,
dass beide nicht auseinanderlaufen.

## Geplanter Stack

TypeScript-Monorepo (pnpm + Turborepo) · Node 22 + Fastify · React 19 + Vite ·
sharp · exiftool-vendored · pdfkit · Vitest + Playwright
