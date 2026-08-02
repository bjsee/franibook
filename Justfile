# Franibook — häufige Handgriffe.
#
# `just` ohne Argument zeigt die Liste. Die Rezepte kapseln nichts Magisches,
# sondern die Aufrufe samt Umgebungsvariablen, die man sonst nachschlägt.

set shell := ["bash", "-uc"]

# Bildquelle. Wird ausschließlich gelesen.
quelle := env_var_or_default("FRANIBOOK_SOURCE", "/Users/see/nas/dokumente/Franziska/buch")

# Projektstand des echten Betriebs. Liegt unter apps/server, weil der Server
# dort sein Arbeitsverzeichnis hat.
projekt := "apps/server/.franibook-project"

# Wegwerf-Projektstand für Probeläufe.
#
# Hintergrund: Ein Lauf mit Limit oder mit frischem Import überschreibt sonst
# den echten Stand — 820 Fotos samt 61 bestätigten Gruppen. Genau das ist dem
# Parity-Test passiert, bevor er seinen eigenen Ordner bekam.
probe := "apps/server/.franibook-project-probe"

_default:
    @just --list --unsorted

# Server und Vorschau zusammen starten (5174 und 5173).
start:
    pnpm dev

# Vorschau im Browser öffnen. Der Server muss laufen.
open:
    open http://127.0.0.1:5173

# Nur den Server, ohne Watch — so startet ihn auch der Parity-Test.
server:
    FRANIBOOK_SOURCE={{ quelle }} pnpm --filter @franibook/server start

# Nur die Weboberfläche.
web:
    pnpm --filter @franibook/web dev

# Ein Kaltstart über den vollen Bestand importiert ~830 Fotos und erzeugt danach
# alle Vorschauen; beim Entwickeln lohnt das selten.
[doc("Schneller Start mit begrenztem Bestand, in einem Wegwerf-Projektstand")]
probe n="120":
    FRANIBOOK_SOURCE={{ quelle }} FRANIBOOK_LIMIT={{ n }} FRANIBOOK_PROJECT={{ probe }} \
        pnpm --filter @franibook/server start

# Alles neu importieren und ein Buch erzeugen — ebenfalls im Wegwerfstand.
neu n="120":
    FRANIBOOK_SOURCE={{ quelle }} FRANIBOOK_FRESH=1 FRANIBOOK_LIMIT={{ n }} \
        FRANIBOOK_PROJECT={{ probe }} pnpm --filter @franibook/server start

# Den echten Bestand neu importieren. Überschreibt den gespeicherten Stand.
neu-alles:
    @echo "Das ersetzt {{ projekt }} — vorher sichern? [Strg-C bricht ab]" && read -r _
    FRANIBOOK_SOURCE={{ quelle }} FRANIBOOK_FRESH=1 pnpm --filter @franibook/server start

# Der Parity-Test startet seine Server selbst und verlangt beide Ports exklusiv
# (`reuseExistingServer: false`, `strictPort`).
[doc("Ports 5173 und 5174 freigeben")]
stop:
    @for port in 5173 5174; do \
        pids=$(lsof -ti:$port -sTCP:LISTEN 2>/dev/null || true); \
        if [ -n "$pids" ]; then echo "beende $pids auf $port"; kill $pids; \
        else echo "$port ist frei"; fi; \
    done

# Welche Bildquelle gilt, und steht sie zur Verfügung?
quelle:
    @echo "{{ quelle }}"
    @test -d "{{ quelle }}" \
        && echo "erreichbar, $(ls -1 "{{ quelle }}" | wc -l | tr -d ' ') Einträge" \
        || echo "NICHT erreichbar — hängt das NAS?"

# Wer belegt die Ports?
ports:
    @lsof -nP -iTCP:5173 -iTCP:5174 -sTCP:LISTEN || echo "beide Ports frei"

# ----------------------------------------------------------------- Prüfen

# Unit-Tests über alle Pakete.
test:
    pnpm test

# Tests im Watch-Modus.
watch:
    pnpm test:watch

# Einzelne Datei oder einzelner Test: just t 'erkennt Kamera-Resets'
t muster:
    npx vitest run -t '{{ muster }}'

# Typen prüfen, ohne zu übersetzen.
typecheck:
    pnpm typecheck

# ESLint über das Repo.
lint:
    pnpm lint

# Prettier schreibend über das Repo.
format:
    pnpm format

# Startet beide Server selbst und braucht deshalb freie Ports sowie `pdftoppm`
# aus poppler. Referenzwerte: sechs Fälle grün, Hauptfall 0,242 %, mit
# Zeitstrahl 0,303 %, Schwelle 0,5 %.
[doc("Der wichtigste Test: Vorschau gegen gerastertes PDF")]
parity: stop
    pnpm test:parity

# Alles, was die Übergabe eines Zwischenstands verlangt.
check: typecheck test lint
    npx prettier --check .

# Mit Parity — dauert länger, beendet laufende Server.
check-alles: check parity

# ------------------------------------------------------------------ Export

# Ganzen Innenteil als PDF. Der Server muss laufen.
pdf:
    curl -fsS -X POST http://127.0.0.1:5174/api/export/pdf \
        -H 'content-type: application/json' -d '{}' | tail -c 2000; echo

# Eine einzelne Doppelseite: just pdf-spread 12
pdf-spread index:
    curl -fsS -X POST http://127.0.0.1:5174/api/export/pdf \
        -H 'content-type: application/json' \
        -d '{"spreadIndex": {{ index }}, "fileName": "spread-{{ index }}.pdf"}'; echo

# Umschlag als eigene PDF-Datei.
cover:
    curl -fsS -X POST http://127.0.0.1:5174/api/export/cover \
        -H 'content-type: application/json' -d '{}'; echo

# Wo die Ausgaben landen.
out:
    @ls -lh apps/server/.franibook-out 2>/dev/null || echo "noch nichts exportiert"

# ---------------------------------------------------------------- Aufräumen

# Der echte Projektstand bleibt: Er enthält die bestätigten Gruppen und das
# bearbeitete Layout, beides ist nicht wiederherstellbar.
[doc("Vorschau-Cache, Ausgaben und Wegwerf-Projektstand löschen")]
clean:
    rm -rf apps/server/.franibook-cache apps/server/.franibook-out {{ probe }}
    rm -rf tests/parity/.cache tests/parity/.out tests/parity/.artifacts tests/parity/.project
    @echo "{{ projekt }} wurde bewusst nicht angefasst."

# Projektstand sichern, mit Zeitstempel.
sichern:
    @ziel="{{ projekt }}.bak-$(date +%Y%m%d-%H%M%S)"; \
        cp -R {{ projekt }} "$ziel" && echo "gesichert nach $ziel"

# Kurzer Blick auf den Stand: Fotos, Doppelseiten, Gruppen.
stand:
    @node -e 'const p = require("./{{ projekt }}/project.json"); \
        console.log(p.photos.length + " Fotos, " + p.book.spreads.length + " Doppelseiten, " \
        + p.groups.length + " Gruppen, Quelle " + p.sourceRoot)' \
        2>/dev/null || echo "kein gespeichertes Projekt"
