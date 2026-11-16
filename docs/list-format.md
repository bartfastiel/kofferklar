# Listenformat

Ein Gegenstand je Zeile, Felder durch `|` getrennt. Kategorien beginnen mit `#`. Leere Felder darf man am Ende weglassen.

```
# Angeln
Name | Priorität | wenn | außer | Menge | Notiz
Sturmfeuerzeug | 2 | angeln, zelt | flug | | nicht im Flugzeug erlaubt
Feuerzeug | 3 | angeln+flug, zelt+flug
Socken | 1 | nacht | | Tag +1 max 8
```

- **Priorität**: 1 unverzichtbar, 2 wichtig (Standard), 3 optional.
- **wenn**: Gruppen durch Komma getrennt (ODER), Merkmale in einer Gruppe mit `+` verbunden (alle müssen zutreffen).
  Leer heißt: bei jeder Reise.
- **außer**: Merkmale durch Komma getrennt. Trifft eines zu, wird der Gegenstand nie vorgeschlagen.
- **Menge**: `Tag` oder `Nacht` (Tage = Nächte + 1), danach optional `/n` (eins je n), `+n` (zusätzlich), `max n`.
  Leer heißt: einmal.

## Merkmale

| Frage | Merkmale |
|---|---|
| Art | `urlaub`, `dienstreise`, `besuch`, `ausflug` |
| abgeleitet | `nacht` (mindestens 1 Nacht), `lang` (ab 5 Nächten), `ausland` (`eu` oder `welt`) |
| Anreise | `auto`, `flug`, `handgepaeck` (setzt `flug`), `bahn`, `fahrrad` |
| Ziel | `inland`, `eu`, `welt` |
| Wetter | `warm`, `mild`, `kalt`, `regen` |
| Vorhaben | `angeln`, `wintersport`, `wandern`, `baden`, `sport`, `radtour`, `festlich`, `arbeit` |
| Unterkunft (nur mit Nacht) | `hotel`, `ferienwohnung`, `zelt`, `freunde` |
| Mitreisende | `kinder`, `partner` |

Import: in der App unter Einstellungen → „Liste als Text“ oder mit `tools/kk.sh import [--probe] < liste.txt`. Neue
Namen kommen dazu; Namen, die es schon gibt, bleiben unverändert.
