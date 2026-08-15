---
paths:
  - 'packages/core/src/layout/**/*'
  - 'packages/core/src/structure/**/*'
  - 'packages/core/src/templates/**/*'
---

# Anordnen: Gliederung, Vorlagen, Plätze

Hier entsteht die Aufteilung des Buchs: welche Fotos auf welche Doppelseite kommen,
welche Vorlage sie trägt, wo jedes Bild darin sitzt. Was daraus wird, ist ein
Layout-Dokument; gezeichnet wird es woanders (`render/`).

## Der Weg durch die Engine

`buildStructure` (`structure/segment.ts`) → Kalendergliederung (Jahr → Kapitel,
Monat → Segment, Tag → Serie) → `distributeBudget` (`layout/grouping.ts`) verteilt
das Seitenbudget → `generateBook` (`layout/generate.ts`) wählt Templates, ordnet
Slots zu, berechnet Ausschnitte → `renderSpread` erzeugt das RSM.

`rebuild.ts` ist das Gegenstück zu `generate.ts`: Die Fotoverteilung steht schon
fest (bearbeitetes Layout-Dokument), nur Vorlage, Slots und Ausschnitte werden neu
bestimmt.

Zeitliche Lücken gliedern das Buch bewusst **nicht** (der Bestand ist
vorausgewählt, Mediangap 1,2 Tage → 502 Zerfallsgruppen). Stattdessen gliedert der
Kalender, ergänzt um vom Benutzer bestätigte `PhotoGroup`s aus Kalenderanlässen,
der Ortsauflösung und Tagesballungen — in dieser Rangfolge, denn ein Anlass ist
belegt, ein Ort erschlossen, ein dichter Tag nur vermutet
(`structure/suggest-groups.ts`).

## Eigene Doppelseiten

**Nicht jede Doppelseite kommt aus der Automatik.** `POST /api/spreads` fügt eine
selbst gestaltete Seite ein – leer (`spread.leer`) oder mit einem Gruppenauftakt
als Ausgangsform. Sie ist `locked` und geht damit als `kept` durch `generateBook`
(`layout/keep.ts`): unverändert übernommen, Bilder als vergeben, zwei Seiten vom
Budget. Ihren Platz findet sie über `Spread.anchor` – ein Foto und eine Richtung,
nicht einen Index, denn der stimmt nach einem Neuaufbau nicht mehr. Im
Layout-Dokument steht sie als `keep: "<Kennung>"` ohne Inhalt. Begründung:
`docs/konzept.md`, Abschnitt „Eigene Doppelseiten".

**Was eine festgehaltene Seite schon leistet, baut die Automatik nicht noch
einmal** (`keptOpeners` in `layout/keep.ts`): Ein festgehaltener Jahresauftakt
nimmt seinem Jahrgang den zweiten, ein festgehaltener Gruppenauftakt seiner
Gruppe. Ohne das bekam ein festgehaltener Jahresauftakt sein Jahr zweimal, und
beim Gruppenauftakt stand zusätzlich das Hauptbild an zwei Stellen im Buch —
`keptPhotos` nimmt nur den Fluss aus, nicht eine zweite Auftaktseite. Das Jahr
steht als `chapterYear` am Spread, die Gruppe wird über die Bilder der Seite
bestimmt und ausdrücklich nicht über den Titel: Der ist editierbar. Die
eingesparten Auftakte gehen ins Seitenbudget zurück, sonst wäre das Buch je
festgehaltenem Auftakt zwei Seiten zu kurz.

## Eine einzelne Buchseite einfügen

`POST /api/spreads/page`, `layout/single-page.ts`. Das kippt die Parität: Was
rechts stand, steht danach links. Verlustfrei möglich ist es, weil kein Slot der
Flussvorlagen über dem Falz liegt – die Blätter zerfallen in Buchseiten
(`templates/halves.ts`), die neue Seite wird eingeschoben, und die Folge wird neu
gepaart. **Kein Foto wechselt dabei seinen Platz im Buch, nur seine
Blattzugehörigkeit.** Auftakte, justierte Zeilen und festgehaltene Blätter bleiben
ganz; vor einem solchen stellt eine leere Halbseite die Parität wieder her, und
dahinter ist das Buch unverändert. Am echten Buch sind davon 1–2 Blätter
betroffen, weil 57 von 80 unzerlegbar sind.

Für die zusätzliche Seite wird eine schon leere Halbseite verbraucht, wenn eine
vor dem nächsten unzerlegbaren Blatt liegt – sonst wächst das Buch um ein Blatt
(bei dichten Seiten unvermeidlich). Blätter, die durch das Umpaaren ganz leer
wären, entstehen nicht. `DELETE /api/spreads/page/:atPage` ist das Gegenstück:
dieselbe Rechnung, die Seite fällt heraus, ihre Bilder gehen in den Fotopool.

## Eine Buchseite umstellen lässt die andere stehen

`setHalfPage` in `layout/single-page.ts`: Das Blatt zerfällt an der Falzachse, nur
die gewählte Seite wird neu angeordnet (`layoutHalf` — dieselbe Zuordnungsrechnung
wie `layoutSpread`, ohne Vorlagenwahl), dann wird umgepaart. Die Gegenseite behält
jedes Bild in seinem Platz, samt Ausschnitt, Rahmen, Neigung, Ebene und
Bildunterschrift. Vorher setzte `setSpreadHalf` die Paarkennung zusammen und gab
sie an `setSpreadTemplate` weiter, und **der ordnet die ganze Doppelseite neu an**
— wer die rechte Seite umstellte, fand links andere Bilder in anderen Plätzen.

**Auch was in keine zwei Halbseiten zerfällt, wird getrennt** (`alsFreieKaesten`).
Justierte Zeilen haben keine Halbseitenkennung, wohl aber je Rechteck eine
Buchseite: Die Gegenseite wird dann **wörtlich übernommen** — jeder Kasten trägt
seine Lage selbst (`SlotAssignment.rect`, wie ein eingeworfenes Bild), die
Doppelseite heißt danach `paar:<gewählt>+halb:leer`. Der Preis steht in
`handwork().positionen`: Eine gerechnete Zeile stellt der Neuaufbau wieder her,
einen gesetzten Kasten nicht. Ganz bleibt nur, was als Doppelseite gedacht ist
(Auftakt, Hintergrundbild über beide Seiten, ein Kasten über dem Falz); dort
rechnet `choosePairFor` die Gegenseite wie bisher. Begründung: `docs/konzept.md`,
Abschnitt „Anordnung von Hand wählen".

## Justierte Zeilen

**Nicht jede Doppelseite kommt aus der Bibliothek.** Ab zehn Bildern rechnet
`layout/justify.ts` die Plätze aus den Bildern: Zeilen, die die Satzbreite füllen,
jedes Bild in seinem eigenen Seitenverhältnis. Übernommen wird das nur, wenn es
die beste Vorlage um 0,1 je Bild unterbietet (`justifySpread`) — die Bibliothek
gestaltet, die Rechnung rettet. Kennung `justiert.<n>`, aufgelöst über
`templateById` wie eine Paarkennung; die Rechtecke stehen als
`SlotAssignment.rect` und zählen in `handwork()` nicht als Handarbeit, weil der
Neuaufbau sie wiederherstellt. Am echten Buch senkt das die Bilder in falsch
ausgerichteten Plätzen von 108 auf 32, bei gleicher Bilddeckung. Begründung und
Messwerte: `docs/konzept.md`, Abschnitt „Justierte Zeilen".

## Auftaktseiten

**Der Jahresauftakt kann auch auf der Jahresseite Bilder tragen**
(`settings.chapterOpenersDense`, Vorgabe aus). Aus: sechs Bilder rechts, links nur
die Jahreszahl und fünf Ereigniszeilen. An: neun Bilder über beide Seiten
(`spread.chapter.dicht.*`), die Jahreszahl größer und in einem Band, das kein Bild
berührt — der Freiraum ist die Auszeichnung, nicht eine Farbfläche und nicht ein
Bild darunter. Alle dichten Fassungen **der Automatik** haben dieselbe Platzzahl,
weil der Auftakt zuerst über die Bilderzahl gewählt wird und erst danach über die
Passung; sonst entschiede die Platzzahl statt der Ausrichtung. Ein Jahrgang mit
weniger als achtzehn übrigen Bildern behält die schlanke Fassung. Am echten
Bestand sind das 57 Bilder mehr in den Auftakten, rund vier Doppelseiten.
Begründung und verworfene Fassungen: `docs/konzept.md`, Abschnitt „Auftaktseiten".

**Von Hand steht der Jahresauftakt für jede Bilderzahl von 1 bis 12 zur Wahl**, je
drei Fassungen (hochkant, quer, gemischt) — `chapterChoices()` gegen
`chapterTemplates()`. Der Unterschied ist das Tag **`nur-wahl`**: Die Automatik
nimmt die größte Fassung, für die ein Jahrgang genug Bilder hat, und füllte mit
allen zusammen jeden Auftakt mit acht statt sechs Bildern — Seitenzahl und
Bildverteilung des Buchs wären andere, ungefragt. Wer die Wahl von Hand erweitert,
schreibt `nur-wahl` dazu; wer die Automatik ändern will, ändert den Test in
`library.test.ts` mit.

**Seitenweise geht eine Jahresseite auch** — je Buchseite in ihrer eigenen
Familie (`templates/chapter-halves.ts`). In jeder Auftaktvorlage stehen alle
Textplätze auf _einer_ Seite: Sie ist die Textseite und wählt unter den
Jahresseiten-Fassungen (`jahrseite:…`, Jahreszahl plus 0 bis n Bilder), die
andere unter den Halbseiten des Flusses. Zusammengesetzt heißt das Blatt
`kapitel:<links>+<rechts>`, die Textplätze behalten ihre Kennung (`TextElement`
zeigt darauf), und `templateMeta` gibt weiter `chapterOnly` zurück — sonst
bekäme die Seite Seitenzahlen und fiele in die Vorlagenwahl des Flusses. Eine
Flusshälfte auf der Textseite nähme ihr die Jahreszahl: `setSpreadHalf` lehnt
sie ab, `halfChoices` bietet sie nicht an (`jahresseiten`, `textseite`).

## Die Bibliothek der Halbseiten

Für **jede** Bilderzahl von 1 bis 14 gibt es mindestens drei Halbseiten: Was die
Zerlegung der Vorlagen nicht hergibt — sieben, acht, dreizehn, vierzehn —, steht
als eigens entworfene Halbseite unter `halves` in `library.json`
(`libraryHalves`), hinten angehängt, damit keine abgeleitete ihre Kennung
verliert. Die Wahl in der Oberfläche zeigt die eigene Bilderzahl zuerst und die
übrigen darunter nach Abstand (`Faecher` in `TemplatePicker.tsx`).

## Bilder verschieben

**Die Bilder verteilt man im Baum** (`/aufteilung`, `apps/web/src/baum/`): das
ganze Buch als Liste, Jahr → Doppelseite → Bilder, jede Zeile ein Ziel. Der Zug
dahinter ist **mengenwertig** (`movePhotos` in `layout/move.ts`,
`POST /api/book/move` mit `moves`) — zwei Bilder von einer Achterseite auf eine
Viererseite ergeben in einem Zug 6 und 6 und **ein** Cmd+Z, statt zweier
Anordnungen und zweier Schritte; dieselbe Begründung wie bei `PATCH /api/photos`.

Zwei Regeln stehen quer zum Einzelzug und sind Absicht: Eine leer gezogene Seite
**bleibt stehen** (leere Vorlage, gemeldet über `leer`) statt den Stapel
abzulehnen, und **festgehaltene Seiten sind weder Ziel noch Quelle** – sie
verlören, wofür sie festgehalten wurden. **Ein Auftakt nimmt Bilder an**, wechselt
dabei innerhalb seiner Familie (`chapterChoices`, Textplätze bleiben) und lehnt
nur die Zahlen ab, für die es keine Fassung gibt – beim Jahresauftakt alles über
zwölf, entschieden in `anordnen`.

Die Auskunft je Seite liefert `GET /api/book/tree` (`project/baum.ts`), die
Bilddaten kommen weiter über `GET /api/photos`; der Texteditor der Aufteilung liegt
unter `/aufteilung/json`. Begründung und verworfene Fassungen: `docs/konzept.md`,
Abschnitt „Aufteilung im Baum".

## Eingeworfene Bilder

**Eine Datei lässt sich ins Buch werfen** (`project/einwurf.ts`,
`layout/einwurf.ts`): aus dem Finder auf das Papier, in den Fotopool oder auf eine
Zeile im Baum. Auf dem Papier bleibt die Anordnung, wie sie ist — das Bild bekommt
einen **freien Platz** (`SlotAssignment` mit `rect`, dessen `slotId` in keiner
Vorlage steht, aufgelöst über `wirksamePlaetze`) an der Fallstelle, ein Drittel
Seitenhöhe hoch und im Seitenverhältnis des Fotos. Ob die Seite dafür neu
angeordnet wird, **fragt** eine Karte auf der Bühne; von selbst geschieht es
nicht, denn das verwürfe die Ausschnitte der ganzen Seite. Im Baum wird dagegen
neu angeordnet — eine Zeile hat keine Stelle im Millimeterraster. Begründung:
`docs/konzept.md`, Abschnitt „Bilder einwerfen".

## Einen leeren Platz wegnehmen

**Ein Platz ohne Bild muss nicht stehen bleiben.** `PATCH
/api/spreads/:index/slots/:slotId/hidden` trägt ihn in `Spread.hiddenSlots` ein,
`wirksamePlaetze` lässt ihn heraus — und damit entfällt alles Weitere von
selbst: kein leerer Kasten im RSM, kein Ziel für einen Zug, kein `platz-leer`
im Abnahmebericht. Die übrigen Bilder rühren sich nicht; die Seite wird
ausdrücklich **nicht** neu angeordnet, denn das kostete die Ausschnitte aller
anderen. Ein Abnicken wäre die falsche Antwort gewesen: Der Fund stimmt ja, man
will den Platz nicht.

Drei Festlegungen dazu, die man beim Erweitern beibehält:

- **Ein Bild schlägt den Eintrag.** Bekommt der Platz doch eine Zuordnung, wird
  er wieder gezeichnet — sonst verschluckte ein alter Vermerk ein neu
  eingesetztes Foto.
- **Ein belegter Platz wird nicht weggenommen** (`409` mit Satz): Erst das Bild
  heraus, dann der Platz.
- **Ein freier Platz** (eingeworfenes Bild, `SlotAssignment` mit `rect`) fällt
  ganz aus der Liste statt vermerkt zu werden. Er steht in keiner Vorlage, also
  zeigte der Vermerk auf etwas, das nichts mehr beschreibt.

Gezählt wird das in `handwork().plaetze`: Der Neuaufbau holt die Plätze aus der
Vorlage zurück.

## Neu anordnen zeigt vorher, was dabei herauskommt

**Der Weg zum Neuaufbau führt über die Probe** (`project/probe.ts`,
`/api/anordnung/…`, Ansicht `apps/web/src/Neuanordnen.tsx`): Sie rechnet das
Buch, setzt es aber nicht ein, und `POST /api/anordnung/uebernehmen` schiebt
**genau die gezeigten** Doppelseiten in den Zustand — abgesichert über einen
Abdruck der Eingaben, nicht über die Zusage des Determinismus. `POST
/api/generate` bleibt daneben der direkte Weg.

**In der Vorschau lässt sich jede Doppelseite einzeln behalten** („so lassen"):
Sie geht dann als `kept` durch den Neuaufbau, und das ganze Buch wird
drumherum **neu gerechnet** — eine behaltene Seite nimmt ihre Bilder aus dem
Fluss und zwei Seiten aus dem Budget. Ihren Platz bekommt sie über
`ankerNeben`, nicht über ihre alte Nummer. Das ist **nicht** `locked`: Behalten
gilt für diese Probe, Festhalten dauerhaft.

Zwei Dinge gehören dazu und sind leicht zu übersehen:

- **Der Vergleich läuft über die Fotos** (`layout/vergleich.ts`), nicht über den
  Index: Eine eingeschobene Doppelseite verschiebt alles dahinter, und nach
  Nummer verglichen wäre das ganze Buch „geändert".
- **Die Jahresfarbe ist keine Handarbeit** (`Spread.backgroundAuto`). Der
  Generator setzt sie an jede Doppelseite und markiert sie dabei; ohne den
  Marker zählte `handwork()` sie als verworfene Entscheidung. Wer eine neue
  Eigenschaft einführt, die der Generator selbst setzt, entscheidet dieselbe
  Frage: Steht sie am Spread, weil jemand sie wollte — oder weil die Rechnung
  sie hingeschrieben hat?

**Ein Anker darf nie auf eine Seite zeigen, die selbst nicht im Fluss läuft.**
`ankerNeben` (`layout/keep.ts`) ist die eine Stelle, die das entscheidet — für
eingefügte Seiten (`project/seiten.ts`) wie für behaltene. Zeigt er trotzdem
ins Leere, rechnet `insertKept` den gespeicherten Buchindex in eine
**Flussposition** um (`index − festgehaltene davor`); ihn roh zu nehmen war der
Fehler, der ein Buch mit 21 eigenen Auftakten beim Neuanordnen
entchronologisierte.

## Was die Automatik verwirft und was sie bewahrt

`handwork()` sagt vor einem Neuaufbau, was er kostet: Positionen (frei gesetzte
Kästen), Ebenen, Textplätze und weggenommene Plätze überlebt er **nicht**,
justierte Zeilen und gerechnete Ausschnitte stellt er wieder her, `locked`
bewahrt eine ganze Doppelseite. Wer eine neue Handarbeit einführt, entscheidet zuerst diese Frage und
trägt sie dort ein.

**Ein gekipptes Bild bekommt keinen neuen Platz von selbst.** `renderSpread`
meldet `orientation-mismatch` mit dem sichtbaren Flächenanteil, und
`PATCH /api/spreads/:index/template` mit `templateId: "auto"` ordnet diese eine
Doppelseite neu an (Auftakte bleiben unter sich). **An einer festgehaltenen
Doppelseite lehnt `auto` ab** — `locked` heißt, dass die Automatik die Finger
davon lässt, und ein Knopf, der die Rechnung doch darüberlaufen ließe, hebelte
das aus. Eine **namentlich gewählte** Vorlage bleibt dort erlaubt: Jede
eingefügte Doppelseite ist `locked`, also wäre sie sonst die einzige, die man nie
gestalten könnte. Die Oberfläche blendet den Knopf entsprechend ab
(`NeuAnordnenKnopf` in `spread/BildPanel.tsx`). Nicht automatisch beim Kippen:
Das verwürfe die Ausschnitte der ganzen Seite. Begründung: `docs/konzept.md`,
Abschnitt „Wenn Bild und Platz quer zueinander stehen".

Die Slot-Zuordnung (`layout/scoring.ts`) kennt den Bildfokus **nicht** — er
verschiebt nur den Ausschnitt und verkleinert ihn nicht, also darf er die
Bildverteilung des Buchs nicht ändern.

**Das Gewicht eines Fotos kennt sie** (`weightMismatch`, bis 0,5): `hero` will den
Ankerslot, `filler` den kleinen — **gemessen an der Buchseite, nicht an der
Doppelseite** (`prominenceScale` in `layout/scoring.ts`). Die deklarierte Prominenz
der Bibliothek meint die ganze Doppelseite, und dabei bleibt eine Buchseite
regelmäßig ohne jede Abstufung: `spread.12up.mosaic-quer` gibt allen acht linken
Plätzen `prominence: 1`, obwohl die oberen mehr als das Doppelte der unteren messen
— links war die Auszeichnung damit wirkungslos, und zwar unsichtbar. Gerechnet wird
die Kantenlänge, linear zwischen kleinstem und größtem Platz **derselben** Seite auf
1 bis 3; die deklarierte Prominenz bleibt Untergrenze (die Bibliothek darf
auszeichnen, nicht abwerten), eine Seite ohne Abstufung behält sie ganz, und ein
Zehntel Doppelseitenanteil bricht den Gleichstand zwischen den Ankerplätzen beider
Seiten — sonst landete ein einzelnes Hauptbild im kleineren der beiden.
**Nur für ausgezeichnete Bilder**: Dieselbe Feinstufung auf `normal` angewandt legte
am echten Stand 46 von 80 Doppelseiten anders, ohne dass jemand etwas ausgezeichnet
hätte. Für ein ausgezeichnetes Bild rechnet dann aber **auch `qualityPenalty`**
damit — zwei Begriffe von „großer Platz" in derselben Summe schoben ein leicht
unscharfes Hauptbild aus dem Ankerplatz heraus. Gesetzt wird das Gewicht von Hand in `PhotoOverride.weight`
(`PATCH /api/photos` mit `weight`), also am **Foto** und nicht am Slot — es gilt
weiter, wenn eine Neuanordnung das Bild auf eine andere Doppelseite trägt, und ist
darum keine Handarbeit im Sinne von `handwork()`. Wirksam wird es beim nächsten
Anordnen; von selbst ordnet nichts um. **Justierte Zeilen sind ausgenommen**: Ihre
Plätze sind alle gleich gewichtet, also überspringt `layoutSpread` sie, sobald ein
Bild der Seite ausgezeichnet ist (27 von 80 Doppelseiten am echten Buch — ohne das
wäre die Auszeichnung dort unsichtbar wirkungslos).

**Die Bildschärfe kennt sie sehr wohl** (`qualityPenalty`), und der Unterschied
ist genau dieser: Sie soll die Verteilung ändern — der große Platz gehört dem
besseren Bild (Issue #19). Die Kennlinie läuft zwischen dem zehnten Perzentil des
Bestands und seinem Median (316 und 1.036, gemessen in `docs/spikes/serien.md`)
und wiegt mit höchstens 0,3 leichter als der Orientierungsbruch. Im kleinsten
Platz entfällt sie ganz: Ein verwackeltes Foto soll nicht aus dem Buch fallen, es
soll nur nicht die Seite tragen. Wirksam wird das erst beim nächsten Anordnen —
es ist eine Layoutentscheidung und keine Rechnung beim Rendern.
