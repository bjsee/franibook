# Herkunft der Schriften

## Buchschrift

`files/FranibookSans-Regular.ttf` und `files/FranibookSans-SemiBold.ttf` sind abgeleitet
von **Source Sans 3** (Adobe, Robert Slimbach), SIL Open Font License 1.1. Die
Lizenz liegt unverändert als `files/OFL.txt` daneben.

## Warum diese Schrift

Ausschlaggebend waren drei Anforderungen, in dieser Reihenfolge:

1. **Einbettbar.** Saal verlangt eingebettete Schriften; die OFL erlaubt die
   Einbettung ausdrücklich. Der bisherige Zustand – pdfkits Helvetica, gar nicht
   eingebettet – war nicht druckfähig.
2. **Lesbar bei 8 pt.** Der Zeitstrahl am Seitenfuß (Issue #10) setzt zwei Zeilen
   in 4 mm und 3,5 mm Kastenhöhe, also rund 8 pt. Source Sans 3 ist eine
   humanistische Grotesk mit großer x-Höhe (0,486 em) und eindeutigen Ziffern;
   1/l/I und 0/O sind auch klein unterscheidbar.
3. **Vollständiger deutscher Zeichensatz** samt ß, Umlauten, „Anführungen“ und
   Halbgeviertstrich – und darüber hinaus Latin Extended-A, damit europäische
   Ortsnamen nicht als Kästchen erscheinen.

## Verworfene Alternativen

| Schrift                    | Warum nicht                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Helvetica (pdfkit-Vorgabe) | Nicht eingebettet und nicht einbettbar lizenziert. Genau der Zustand, den Issue #5 behebt.                                              |
| EB Garamond                | Für die Jahreszahlen schön, bei 8 pt aber zu feine Haarstriche – im Vierfarbdruck auf 170-g-Bilderdruck bricht das weg.                 |
| Inter                      | Bei kleinen Größen ausgezeichnet, wirkt aber wie eine Benutzeroberfläche, nicht wie ein Fotobuch. Zudem nur als Variable Font gepflegt. |
| Lato                       | Kaum Nachteile, aber schwächere Ziffern – und „Lato“ ist ebenfalls ein Reserved Font Name, der Aufwand wäre derselbe.                   |
| Systemschrift des Browsers | Vorschau und PDF liefen zwangsläufig auseinander; der Parity-Test wäre nur noch mit Toleranz grün zu halten.                            |

## Warum umbenannt

Die OFL reserviert für Source Sans den Namensbestandteil „Source“ (Reserved Font
Name). Ausgeliefert wird hier eine **geänderte** Fassung – statische Instanz aus
der Variable Font, reduzierter Zeichensatz –, und für die verbietet die Lizenz
den reservierten Namen. Deshalb Familie `Franibook Sans`, PostScript-Namen
`FranibookSans-Regular` bzw. `-SemiBold`. Die Namenstabelle nennt die Herkunft
(Name-ID 10), die Lizenz liegt bei.

## Was geändert wurde

Ausgangsdatei: `SourceSans3[wght].ttf` aus
`https://github.com/google/fonts/tree/main/ofl/sourcesans3` (Version 3.052).

```sh
# 1. Statische Schnitte aus der Variable Font ziehen.
#    Variable Fonts scheiden aus: fontkit (pdfkit) würde die Standardinstanz
#    einbetten, der Browser dagegen die per font-weight angeforderte — der
#    Halbfette wäre im PDF plötzlich mager.
fonttools varLib.instancer -o inst-Regular.ttf  SourceSans3\[wght\].ttf wght=400
fonttools varLib.instancer -o inst-SemiBold.ttf SourceSans3\[wght\].ttf wght=600

# 2. Zeichensatz reduzieren: Latein, deutsche Interpunktion, Währung, Pfeil.
#    Ohne Reduktion 646 KB, danach 37 KB je Schnitt — und das Repo trägt die
#    Dateien.
#    --layout-features+=kern, weil pyftsubset Kerning sonst wegwirft: Vorschau
#    und PDF blieben dann zwar konsistent, aber beide schlecht.
UNI="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013-2014,U+2018-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2192,U+2009,U+202F,U+2212"
pyftsubset inst-Regular.ttf  --output-file=FranibookSans-Regular.ttf  --unicodes="$UNI" --layout-features+=kern --name-IDs='*' --name-legacy --notdef-outline
pyftsubset inst-SemiBold.ttf --output-file=FranibookSans-SemiBold.ttf --unicodes="$UNI" --layout-features+=kern --name-IDs='*' --name-legacy --notdef-outline

# 3. Namenstabelle neu setzen (siehe oben, Reserved Font Name).
```

Die Metriken der Dateien – `unitsPerEm` 1000, Ascender 1024, Descender −400,
Versalhöhe 660 – stehen als Konstanten in
`packages/core/src/render/typography.ts`, weil beide Renderer daraus die
Grundlinie rechnen. `src/index.test.ts` liest sie aus den Dateien zurück und
schlägt an, wenn eine ausgetauschte Schrift andere Werte mitbringt.

## Zusatzschriften für Textblöcke

Von Hand gesetzte Textblöcke (`TextBlock`) können außer der Buchschrift drei
weitere verwenden. Sie sind **unverändert** aus dem Google-Fonts-Repository
übernommen (`github.com/google/fonts/ofl/<familie>`, Stand 3. August 2026), alle
unter SIL Open Font License 1.1; die Lizenztexte liegen je Schrift daneben.

| Kennung   | Schrift       | Schnitte          | Datei                                              | Wofür                                        |
| --------- | ------------- | ----------------- | -------------------------------------------------- | -------------------------------------------- |
| `serif`   | Crimson Text  | Regular, SemiBold | `CrimsonText-*.ttf`, `CrimsonText-OFL.txt`         | längere Zeilen, Zitate, Erzähltext           |
| `hand`    | Kalam         | Regular, Bold     | `Kalam-*.ttf`, `Kalam-OFL.txt`                     | Persönliches, eine Bildunterschrift von Hand |
| `display` | Abril Fatface | nur Regular       | `AbrilFatface-Regular.ttf`, `AbrilFatface-OFL.txt` | ein einzelnes großes Wort                    |

**Warum unverändert.** Die Buchschrift musste umbenannt werden, weil sie eine
geänderte Fassung ist und „Source" ein Reserved Font Name der OFL. Diese drei
werden bitgenau übernommen, deshalb behalten sie ihre Namen — und deshalb steht
im Test das Gegenteil der RFN-Prüfung: Der Familienname in der Datei muss genau
der sein, mit dem Vorschau und PDF sie ansprechen.

**Warum keine Variable Fonts.** EB Garamond, Playfair Display und Caveat lagen
nur als Variable Font mit Gewichtsachse vor. pdfkit bettet daraus die
Standardinstanz ein; ein zweiter Schnitt wäre nur über statisch instanziierte
Dateien zu haben, und die wären wieder geändert und damit umzubenennen. Die drei
gewählten Familien liegen von Haus aus statisch vor.

**Warum nur ein Schnitt bei Abril Fatface.** Die Schrift ist selbst schon fett;
ein zweiter Schnitt wäre keine Steigerung, sondern ein Klumpen. `resolveWeight`
in `core` fängt die Wahl „halbfett" ab und gibt den einzigen vorhandenen zurück.

**Versalhöhen.** Sie gehen auseinander — 0,660 em (Buchschrift), 0,641 (Crimson),
0,739 (Kalam), 0,700 (Abril). Weil die Grundlinie am Versalband hängt, rechnet
`textBaselineOffsetMm` sie je Familie; mit einem festen Wert säße dieselbe Zeile
je nach Schrift sichtbar anders im Kasten.

**Größe.** Zusammen rund 1,2 MB im Repo, davon 0,9 MB Kalam — eine Handschrift
braucht viele Glyphen. Ins PDF kommt nur, was auf den ausgegebenen Seiten
tatsächlich vorkommt, und davon nur die benutzten Zeichen (pdfkit subsettet).
Geprüft: Eine Doppelseite ohne Textblöcke bettet allein die Buchschrift ein.
