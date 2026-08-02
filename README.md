# Franibook

Lokaler Fotobuch-Generator: aus einem Ordner mit mehreren hundert Fotos automatisch
einen Fotobuch-Entwurf erzeugen, ihn im Browser als Doppelseiten prüfen und korrigieren
und daraus ein druckfertiges PDF exportieren.

Konkreter Anlass: ein Fotobuch zum 18. Geburtstag mit rund 900 Fotos aus den Jahren
2008 bis 2026, Druck über PrintPartner.

## Stand

Konzeptphase. Es ist noch kein Code vorhanden.

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [docs/anforderungen.adoc](docs/anforderungen.adoc) | Fachliche Ausgangsanforderung |
| [docs/konzept.adoc](docs/konzept.adoc) | Technisches Konzept: Architektur, Datenmodell, Layout-Engine, PDF-Rendering, Teststrategie |
| [docs/implementierungsphasen.adoc](docs/implementierungsphasen.adoc) | Zerlegung in einzeln testbare Phasen |

## Leitidee

Die Layout-Engine erzeugt weder HTML noch PDF, sondern ein *Rendered Spread Model* —
absolut in Millimetern positionierte Boxen. Browser-Vorschau und PDF-Export sind zwei
dünne Adapter über derselben Quelle. Ein automatisierter Parity-Test vergleicht die
gerenderte Vorschau pixelweise mit der gerasterten PDF-Seite und sichert damit ab,
dass beide nicht auseinanderlaufen.

## Geplanter Stack

TypeScript-Monorepo (pnpm + Turborepo) · Node 22 + Fastify · React 19 + Vite ·
sharp · exiftool-vendored · pdfkit · Vitest + Playwright
