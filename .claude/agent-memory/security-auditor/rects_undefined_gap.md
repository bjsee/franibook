---
name: rects-undefined-gap
description: setSlotRects (mengenwertige Rect-Route) fehlt das `?? null`-Fallback, das die singuläre setSlotRect-Route für ein fehlendes `rect`-Feld hat — TypeError statt 400
metadata:
  type: project
---

Bei der Prüfung von `PATCH /api/spreads/:index/slots/rects` (Mehrfachauswahl-Feature,
2026-08) fiel eine Lücke auf, die die singuläre Schwester-Route nicht hat:

- `PATCH /api/spreads/:index/slots/:slotId/rect` (`routes/slots.ts`) ruft
  `project.setSlotRect(index, slotId, req.body?.rect ?? null)` auf — ein fehlendes
  `rect`-Feld wird auf Route-Ebene defensiv zu `null` normalisiert.
- Die neue mengenwertige Fassung reicht `req.body?.rects` dagegen roh durch.
  `project.setSlotRects` (`project.ts`) prüft nur `rect !== null`, nicht
  `rect !== undefined` — ein Array-Element `{slotId: "x"}` ganz ohne `rect`-Schlüssel
  lässt `rect.x` mit einem synchronen `TypeError` crashen (500 statt sauberem 400).
  Die Prüfung passiert in der Validierungsschleife _vor_ jeder Mutation, also keine
  Teilanwendung — nur eine hässliche Antwort statt der im Projekt sonst
  durchgehaltenen Konvention „ein wirkungsloser Versuch meldet, warum" ([[csrf_model]]
  grenzt das nicht ab, das ist ein reiner Server-Konventions-Punkt aus
  `.claude/rules/server.md`).

**Bei künftigen mengenwertigen Endpunkten prüfen**: Wird ein optionales Feld je
Array-Element genauso normalisiert wie beim singulären Vorbild, oder nur der
Array-Container selbst (`Array.isArray(rects)`) validiert? Die Normalisierung
gehört pro Element, nicht nur einmal am Container.

Impact ist gering (localhost-only, kein Auth-Bypass, keine Datenkorruption) —
daher LOW severity, aber ein guter Kandidat für "beim nächsten Berühren dieser
Datei mit reinnehmen".
