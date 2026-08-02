# Franibook

Lokaler Fotobuch-Generator: aus einem Ordner mit mehreren hundert Fotos automatisch
einen Fotobuch-Entwurf erzeugen, ihn im Browser als Doppelseiten prüfen und korrigieren
und daraus ein druckfertiges PDF exportieren.

Konkreter Anlass: ein Fotobuch zum 18. Geburtstag mit rund 900 Fotos aus den Jahren
2008 bis 2026, Druck über Saal Digital.

## Stand

Phase 0 abgeschlossen: Monorepo-Gerüst steht, die Umgebungsannahmen des
Konzepts sind gemessen. Als nächstes Phase 1 — der vertikale Prototyp.

## Dokumentation

| Dokument                                                             | Inhalt                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [docs/anforderungen.adoc](docs/anforderungen.adoc)                   | Fachliche Ausgangsanforderung                                                              |
| [docs/konzept.adoc](docs/konzept.adoc)                               | Technisches Konzept: Architektur, Datenmodell, Layout-Engine, PDF-Rendering, Teststrategie |
| [docs/implementierungsphasen.adoc](docs/implementierungsphasen.adoc) | Zerlegung in einzeln testbare Phasen                                                       |
| [docs/spikes/phase-0.adoc](docs/spikes/phase-0.adoc)                 | Messergebnisse zu HEIC, PDF-Speicher und Metadaten-Durchsatz                               |

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
