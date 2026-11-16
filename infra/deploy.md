# Deployment

Static files and backend live on the volume of a small Docker host. Caddy serves the app and asks the backend before
every request outside the sign-in page (`forward_auth`). The host's infrastructure repository holds these two pieces.

## Caddy

```
# Kofferklar: Daniels private Packliste (Repo kofferklar) unter kofferklar.DOMAIN, nur nach Anmeldung per Passkey –
# Aufbau wie Liederbuch. Ohne Sitzung sind nur Anmeldeseite (/login/), Symbole und Manifest erreichbar; alles andere
# prüft Caddy vorher beim Backend (forward_auth, Container kofferklar-api). Statische Dateien auf dem Volume
# (/mnt/frag-daniel/kofferklar/app/). Keine Kamera, kein Mikrofon, keine Vorschauen.
(kofferklar) {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		X-Robots-Tag "noindex, nofollow"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
		-Server
	}
	@immutable path_regexp .*/assets/.*
	header @immutable Cache-Control "private, max-age=31536000, immutable"
	@mutable not path_regexp .*/assets/.*
	header @mutable Cache-Control "no-cache"
	encode zstd gzip
	handle /api/* {
		reverse_proxy kofferklar-api:8080
	}
	@public path /login/* /icon.svg /icon-180.png /icon-192.png /icon-512.png /manifest.webmanifest /robots.txt
	handle @public {
		root * /kofferklar/app
		file_server
	}
	handle {
		forward_auth kofferklar-api:8080 {
			uri /api/auth/check
		}
		root * /kofferklar/app
		file_server
	}
}

kofferklar.{$DOMAIN} {
	tls force_automate
	import kofferklar
}
```

## Container (docker compose)

```yaml
  kofferklar-api:   # Backend der Packliste Kofferklar (Passkeys, Gegenstände, Reisen, Abgleich); main.mjs legt das kofferklar-Deployment ab
    logging: *logging
    image: node:24-alpine
    command: ["sh", "-c", "while [ ! -f /srv/server/main.mjs ]; do sleep 30; done; exec node /srv/server/main.mjs"]
    environment:
      ORIGIN: "<https address of the app>"
      DATA_DIR: /data
      TRUST_PROXY: "1"
      PORT: "8080"
    volumes:
      - "${DATA_ROOT:-/mnt/frag-daniel}/kofferklar:/srv:ro"
      - "${DATA_ROOT:-/mnt/frag-daniel}/kofferklar-data:/data"   # SQLite (Personen, Passkeys, Gegenstände, Reisen), Besitzer uid 1000
    user: node
    read_only: true
    tmpfs: [/tmp]
    mem_limit: 128m
    restart: unless-stopped
```

Caddy mounts the static files read-only (`…/kofferklar:/kofferklar:ro`). A nightly job runs
`node /srv/server/cli.mjs backup /data/sicherung.db` in the container and archives the copy.
`tools/deploy.sh` uploads `dist/` and `dist-server/` and restarts the container.
