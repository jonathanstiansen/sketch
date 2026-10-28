# Collaboration latency (Gate 5)

SPEC section 7 asks for p50, p95 and p99 collaboration latency and the test environment, with no performance target.

**These numbers come from a native `mix release` on a development laptop, not from the Docker Compose containers.** Docker was not available when they were taken, so container networking and the container CPU limits are not included. Treat them as a best-case floor for one machine, not as a deployment figure.

## Results

200 samples per scenario after 5 discarded warm-up samples, one run.

| Scenario | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- |
| Create: A clicks "Add rectangle" until B's DOM gains the rectangle | 0.9 ms | 1.4 ms | 1.6 ms | 0.6 ms | 2.0 ms |
| Drag preview: A's pointer move until B's rectangle `x` changes | 2.3 ms | 2.6 ms | 3.6 ms | 1.0 ms | 4.1 ms |

Evidence: `docs/evidence/gate-5/latency.png`.

## What is measured

Both browsers are Chromium contexts of one Playwright browser on the same machine, so they share one clock. Timestamps are `performance.timeOrigin + performance.now()` taken inside the pages. Chrome rounds that clock to 0.1 ms, so the minimums are coarse.

- Create: A's page records the time immediately before it calls `click()` on `#add-rectangle`. A `MutationObserver` in B's page records when a `rect[data-rect]` node is added. The next sample starts only after B has seen the previous one.
- Drag preview: A's page records each `pointermove` in the capture phase. A `MutationObserver` in B's page records each change of a rectangle's `x` attribute. A alternates between two positions 40 px apart so every move changes `x`. Before each move the test waits until 60 ms have passed since A's last move, so the move is not delayed by the client's 50 ms preview throttle and the number reflects delivery, not throttling.

This is browser-to-browser time through LiveView, PubSub and the server, on loopback. It excludes network latency between real machines. The durable commit path (database write) is part of the create scenario, not the preview scenario.

## Environment

- Date: 2026-10-28
- Machine: Mac16,10 (Apple M4, 10 cores, 16 GB), macOS 26.5.1
- Runtime: Elixir 1.20.4, OTP 29
- Database: PostgreSQL 18.6 (Homebrew, native) on 127.0.0.1
- Browser: Playwright 1.64.1 Chromium, two contexts
- App: `MIX_ENV=prod mix release`, started with `bin/server`, `BIND_IP=127.0.0.1`, `PORT=4100`, database `sketch_release` after `bin/migrate`
- Command: `E2E_BASE_URL=http://127.0.0.1:4100 MEASURE=1 npx playwright test latency`

The same spec ran against the dev server for a sanity check: create p50 1.4 ms and drag preview p50 3.0 ms. The machine was otherwise busy with development tools, so expect run-to-run variation.
