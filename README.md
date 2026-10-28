# Sketch

A small self-hosted collaborative canvas built with Ash, Phoenix LiveView and PostgreSQL.

See [docs/SPEC.md](docs/SPEC.md), [docs/SPEC-ADDENDUM.md](docs/SPEC-ADDENDUM.md) and [docs/adr](docs/adr).

## Development

1. Start PostgreSQL 18 (bound to `127.0.0.1:5432` only): `docker compose -f compose.dev.yaml up -d`
2. Install and set up dependencies: `mix setup`
3. Start the server: `mix phx.server`, then visit [`localhost:4000`](http://localhost:4000).

## Deployment (Docker Compose)

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` (URL-safe characters only) and `SECRET_KEY_BASE` (`mix phx.gen.secret`). Set `PHX_HOST` to the public host name.
2. `docker compose up -d --build --wait` builds the release image, starts PostgreSQL, runs the one-shot `migrate` service (`/app/bin/migrate`, which calls `Sketch.Release.migrate/0`) and then starts the app.
3. The app listens on `127.0.0.1:${APP_PORT:-4000}` of the host only. Put a TLS reverse proxy in front of it to serve other machines; it must set `X-Forwarded-Proto: https`, because the release forces HTTPS (except for `localhost`, `127.0.0.1` and `/healthz`) and builds share links as `https://$PHX_HOST/b/<id>`. PostgreSQL publishes no host port and is reachable only from the compose network. Data lives in the `pgdata` volume, which survives `docker compose down`.

The release reads `BIND_IP` (default `127.0.0.1`), `PORT`, `PHX_HOST`, `DATABASE_URL` and `SECRET_KEY_BASE`. Inside the container compose sets `BIND_IP=0.0.0.0`, because the container network interface is not the host loopback; the host port mapping `127.0.0.1:${APP_PORT:-4000}:4000` is what limits exposure. `GET /healthz` returns 200 only while the database answers a trivial read, and 503 otherwise.

Container checks run in the `compose-smoke` CI job. See [docs/LATENCY.md](docs/LATENCY.md) for collaboration latency.

## Checks

- `mix ci` runs every local check in CI order (format, strict compile, Credo, Dialyzer, migration consistency, TypeScript, ESLint, tests including architecture checks).
- `npm --prefix e2e test` runs the two-browser Playwright tests against a test server. With `E2E_BASE_URL=http://host:port` they run against an already deployed app instead.
- `MEASURE=1 npm --prefix e2e test -- latency` runs the `@measure` latency spec, which is excluded otherwise.

Architecture rules and how each is enforced are described in [ARCHITECTURE.md](ARCHITECTURE.md).
