# Kofferklar

Daniels private Packliste als PWA (nicht uCORE; uCORE-Regeln gelten hier nicht). Ein Konfigurator fragt nach der Reise
(Urlaub, Dienstreise, Besuch, Ausflug; Nächte; Anreise; Ziel; Wetter; Vorhaben; Unterkunft; Mitreisende) und baut daraus
die Packliste. Lieber zu viele Einträge als zu wenige, dafür nach Priorität sortiert. Was unterwegs fehlt, trägt Daniel
über „Etwas fehlt?“ nach, und es kommt künftig bei passenden Reisen dazu. Leitlinie: **klein und einfach**, keine
Laufzeit-Abhängigkeiten. Antworten und Doku auf Deutsch, Code, Kommentare und Commits auf Englisch.

Live unter `kofferklar.wer-ist-daniel-schwarz.de`. Repo privat `bartfastiel/kofferklar`.

## Befehle

```sh
npm run dev                  # nur Oberfläche, lokaler Modus ohne Server (Startliste lokal)
npm run local                # mit echtem Backend auf :4180, Daten in .local/data, Einladungslink beim ersten Start
npm run typecheck | test | build | e2e
node tools/icons.mjs         # PNG-Symbole aus public/icon.svg
tools/kk.sh items            # ganze Liste im Textformat (docs/list-format.md) vom Server
tools/kk.sh import [--probe] < liste.txt   # neue Gegenstände einspielen (vorhandene Namen bleiben unberührt)
tools/kk.sh trips | invite --name … | users | audit | backup <datei>
tools/deploy.sh              # bauen, hochladen, Backend neu starten
```

## Aufbau

Gerüst wie Liederbuch und Herdgang (`../liederbuch`, `../rezepteapp`): Vanilla TypeScript, esbuild, `node --test`,
Playwright. Anmeldung nur per Einladungslink und Passkey (`server/webauthn.ts`, Cookie `__Host-kk`), Caddy
`forward_auth`. Local-first: IndexedDB (`src/data/store.ts`), Abgleich über `/api/records` (Stores `items`, `trips`,
neuere Änderung gewinnt, Löschen als Grabstein).

```
src/data/questions.ts   Fragen des Konfigurators; jede Antwort ist ein Merkmal (Tag), dazu abgeleitete: nacht, lang, ausland
src/data/types.ts       Item (when: Gruppen von Tags, ODER über Gruppen, UND in der Gruppe; unless; qty; trip = nur diese Reise), Trip
src/data/seed.ts        Startliste im Textformat; der Server schreibt sie einmal in eine leere Datenbank (server/seed.ts)
src/data/listformat.ts  Textformat lesen/schreiben (Import, Export, CLI)
src/plan.ts             Tags einer Reise, welche Gegenstände passen, Menge, Begründung („wegen Angeln“), Fortschritt
src/views/              wizard (Konfigurator), trip (Packliste), item (Etwas fehlt / Bearbeiten), items, home, settings
server/                 app.ts (Anmeldung, Sitzungen, Abgleich), db.ts, seed.ts, cli.ts
```

## Regeln

- Merkmale (Tags) sind stabile Bezeichner. Wer einen umbenennt, muss die Gegenstände in der Datenbank mitziehen.
- Nur relative Pfade in der App; Navigation über den Hash (`src/nav.ts`). CSP ohne `unsafe-inline`: keine `style`-Attribute.
- Keine Browser-Dialoge. Löschen ist zweistufig (`confirmButton`), Rückgängig über den Toast.
- Tippflächen ≥ 44 px, Layout zuerst für 412 px (Pixel 6 Pro), kein waagerechter Überlauf (E2E prüft das).
- Daniels echte Daten nur über die App oder `tools/kk.sh` ändern, nie per SQL. Vor größeren Eingriffen `backup`.
- Keine Attribution an KI-Werkzeuge, weder in Commits noch in PRs oder Dateien (wie in Daniels anderen Repos; der
  commit-msg-Hook lehnt solche Zeilen ab). Conventional Commits auf Englisch.
- Keine Links im Repo (pre-commit-Hook). Der Hostname steht nur in dieser Datei.

## Hosting

Wie Liederbuch auf dem frag-daniel-Server: statische Dateien nach `/mnt/frag-daniel/kofferklar/app`, Backend nach
`/mnt/frag-daniel/kofferklar/server` (Container `frag-daniel-kofferklar-api-1`, Daten in `/mnt/frag-daniel/kofferklar-data`).
Caddy-Block, Container und nächtliche Sicherung liegen im Repo `../frag-daniel` (`infra/Caddyfile.prod`,
`infra/compose.prod.yml`, `infra/terraform/cloud-init.yaml.tftpl`). Die Wildcard-DNS deckt die Subdomain schon ab.

## Offen

- Daniels eigene Packlisten einspielen (`tools/kk.sh import --probe`, dann ohne `--probe`).
- Verleih (wer hat was von mir geliehen): Entscheidung 2026-11-16, **eigene App**, noch nicht gebaut.
