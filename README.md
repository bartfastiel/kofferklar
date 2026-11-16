# Kofferklar

Private Packliste als PWA: Ein paar Fragen zur Reise, und die Liste steht, nach Kategorien und Priorität sortiert, mit
Mengen nach Reisedauer und einer Begründung je Eintrag. Was unterwegs fehlt, merkt sich die App für passende Reisen.

- Keine Laufzeit-Abhängigkeiten, kein Framework. Vanilla TypeScript, esbuild, Node 24 (`node:sqlite`).
- Anmeldung nur per Passkey (Einladungslink), offline nutzbar, Abgleich zwischen Geräten.
- Listenformat zum Importieren: [docs/list-format.md](docs/list-format.md).

```sh
npm install
npm run local   # App mit Backend auf localhost:4180, druckt beim ersten Start einen Einladungslink
npm run check   # Typen, Tests, Build
npm run e2e     # Playwright im Format des Pixel 6 Pro
```

Deployment hinter Caddy: [infra/deploy.md](infra/deploy.md). Lizenz: MIT.
