---
paths:
  - 'packages/core/src/print/**/*'
---

# Das Druckprofil: der einzige Ort, an dem ein Anbieter steckt

**Der Druckdienstleister steckt ausschließlich im `PrintProfile`** (`print/profile.ts`,
Daten in `print/profiles/*.json`). Die Engine kennt nie einen Anbieternamen, keine
Produktbezeichnung und keine gerundete Zahl aus einem Katalog. Wer einen zweiten
Anbieter anbinden will, legt eine JSON-Datei an und ändert sonst nichts.

## Das Format ist eine Wahl, keine Konstante

Acht Profile, am 05.08.2026 aus dem Profibereich des Anbieters abgelesen und mit
`provenance.verifiedAt` als geprüft markiert. Vorgabe ist `saal-28x28` — 160 Seiten,
das größte quadratische Format. Ein neues Profil trägt seine Herkunft in
`provenance` ein; abgeschriebene Maße ohne Datum sind wertlos, weil niemand mehr
nachprüfen kann, gegen welchen Katalog sie stimmten.

## Die Produktnamen des Anbieters sind gerundet

„28 × 28" heißt 270 × 270 mm Endformat: Die Doppelseite wird als eine Datei von
546 × 276 mm abgegeben, davon 3 mm Beschnitt ringsum. **Wer in Millimetern rechnet,
nimmt `page.trimWidthMm` und nie die Zahl aus dem Namen.**

## Der Wechsel ordnet nichts neu

`PATCH /api/format` setzt `settings.printProfileId` — mehr nicht. Jede Vorlage ist
auf ihre Referenz-Doppelseite von 600 × 300 mm normiert, also übersteht die
Aufteilung samt Handarbeit den Wechsel. Was sich ändert, ist die Größe jedes Bildes
auf dem Papier — und damit seine Auflösung. Eine Seitenzahl, die das neue Format
nicht hergibt (160 gibt es nur in drei der acht), wird geklemmt und das als Satz
gemeldet.

Diese Eigenschaft ist der Grund für die Normierung. Wer eine Vorlage in
Millimetern des Zielformats anlegt, nimmt sie dem Buch.

## Der Umschlag misst seitlich anders als oben und unten

`cover.bleed` und `cover.overhang` sind deshalb Paare aus `sideMm`/`topMm`; ein
gemeinsamer Wert traf die Umschlagbreite um 4 mm daneben.

## Zwei Zahlen am Falz, und sie meinen Verschiedenes

`page.gutterSafeMm` ist eine **Gestaltungsreserve**: die Zone je Seite der Achse,
in der nichts Wesentliches stehen soll. `page.gutterLossMm` ist dagegen ein
**Messwert der Bindung**: was ein durchlaufendes Bild dort tatsächlich an Papier
verliert. Das erste warnt, das zweite rechnet — es lässt den verschluckten
Streifen doppelt drucken (`.claude/rules/rendern.md`, „Der Falz frisst mit").

In allen acht Profilen steht 0, weil sie layflat sind und niemand gemessen hat.
Das ist Absicht: Ein geratener Zuschlag dupliziert einen Streifen, der dann
sichtbar bleibt — schlimmer als kein Zuschlag. Wer einen Wert einträgt, nennt in
`provenance` den Testdruck, an dem er ihn gemessen hat.

`cover.hingeSafeMm` ist der Falzbereich des Anbieters — die Zone links und rechts
des Rückens, in der kein Text stehen darf. Sie ist breiter als das Gelenkfeld und
ragt in die Deckelflächen hinein, weshalb `safeArea()` Vorder- und Rückseite zur
Rückenseite hin stärker einrückt als zum Papierrand.
