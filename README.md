# Sketch

A small self-hosted collaborative canvas built with Ash, Phoenix LiveView and PostgreSQL.

See [docs/SPEC.md](docs/SPEC.md), [docs/SPEC-ADDENDUM.md](docs/SPEC-ADDENDUM.md) and [docs/adr](docs/adr).

## Development

1. Start PostgreSQL 18 (bound to `127.0.0.1:5432` only): `docker compose -f compose.dev.yaml up -d`
2. Install and set up dependencies: `mix setup`
3. Start the server: `mix phx.server`, then visit [`localhost:4000`](http://localhost:4000).

## Checks

- `mix ci` runs every local check in CI order (format, strict compile, Credo, Dialyzer, migration consistency, TypeScript, ESLint, tests including architecture checks).
- `npm --prefix e2e test` runs the two-browser Playwright tests against a test server.

Architecture rules and how each is enforced are described in [ARCHITECTURE.md](ARCHITECTURE.md).
