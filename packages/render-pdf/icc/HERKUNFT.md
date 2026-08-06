# Herkunft des ICC-Profils

## sRGB-IEC61966-2.1.icc

3024 Bytes, ICC-Version 2.0, Klasse `mntr`, Farbraum `RGB`, PCS `XYZ`.

Übernommen aus `pdfkit` (`js/data/sRGB_IEC61966_2_1.icc`, Paket MIT-lizenziert),
das es für seinen PDF/A-Ausgabe-Intent mitliefert. Dort ist es bitgleich zu dem
Profil, das die Vorlage für sRGB IEC61966-2.1 ist — der Farbraum, den auch das
Druckprofil ansagt (`print/profiles/*.json`, `color.workingSpace: "srgb"`).

Nur umbenannt (Bindestriche statt Unterstriche), damit der Dateiname dem Wert in
`color.iccProfilePath` entspricht. Kein Byte verändert.

**Warum eine eigene Kopie und nicht die Datei aus `pdfkit`:** Der Pfad dorthin
führt bei pnpm über `node_modules/.pnpm/pdfkit@<version>/…` und ändert sich mit
jeder Aktualisierung. Eine 3-KB-Datei im Repo ist die stabilere Zusage — dieselbe
Überlegung wie bei den Schriftdateien in `packages/fonts/files/`.

**Warum nicht das Systemprofil von macOS** (`/System/Library/ColorSync/Profiles/
sRGB Profile.icc`): Es ist Apples Fassung, sein Verbleib hängt an der
Betriebssystemversion, und es ins Repo zu kopieren wäre eine Lizenzfrage, die
sich hier nicht stellen muss.

Das Profil selbst gilt als frei verteilbar und ist in praktisch jeder
Bildbearbeitung enthalten. Eine förmliche Lizenzprüfung ist damit **nicht**
erfolgt — für eine Veröffentlichung des Repos wäre sie nachzuholen, wie bei den
Schriften in `packages/fonts/HERKUNFT.md`.
