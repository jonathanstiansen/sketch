# Concurrent users (capacity)

**One busy board holds about 80 people comfortably and breaks down between 160 and 240. Many small boards scale much further: 3,000 people on 600 boards stayed under 75 ms p99 at 31% server CPU.** Past that, the load generator and the server competed for the same laptop, so the server's real ceiling is not measured yet.

These numbers come from a native `mix release` on one development laptop, with the load generator on the same machine. Treat them as a floor for one node, not a deployment figure.

## What is measured

`tools/load/load.ts` opens real LiveView sessions over WebSocket, with no browsers. Each simulated person loads the board page, joins the LiveView like a browser does, and moves their cursor continuously at 20 updates a second, the client's maximum rate (`PREVIEW_INTERVAL_MS`). That is the worst case: in practice most people on a board are not moving at once.

The server relays each cursor update to everyone else on the board, so one board with N active people relays 20 × N × (N − 1) messages a second. Cursors are the heaviest steady traffic; drag and draw previews use the same relay at the same rate, and durable writes are much rarer.

For each step the generator logs, as one JSON line:

- **Delivery**: the share of expected relays that arrived, and send-to-receive latency (p50, p95, p99, max). Sender and receiver share a clock, because they are in one process.
- **Joins**: time from page request to a joined LiveView (p50, p95).
- **Server** (with `--release-bin`): BEAM memory, process count, run queue and scheduler utilisation over two seconds, sampled halfway through the step through `bin/sketch rpc`.
- **Generator health**: the generator's own event-loop delay (p99). When it rises well above about 15 ms, the generator, not the server, is limiting the result.

## Results

15 seconds per step, everyone moving, empty boards.

### Everyone on one board

| People | Delivered | p50 | p95 | p99 | Server CPU | Server memory |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 100% | 1.1 ms | 2.2 ms | 3.0 ms | 0.6% | 173 MB |
| 40 | 100% | 3.8 ms | 10.5 ms | 15.1 ms | 8% | 196 MB |
| 80 | 100% | 8.7 ms | 15.7 ms | 17.8 ms | 13.5% | 256 MB |
| 160 | 100% | 38 ms | 118 ms | 293 ms | 39% | 791 MB |
| 240 | 36% | 5.7 s | 11.8 s | 13.4 s | 60% | 6,611 MB |

At 240 the relays arrive faster than the sockets can send them, so they queue in process mailboxes. Memory reached 6.6 GB and fell back to 170 MB after the people left. **A single overcrowded board can therefore exhaust memory for every board on the node.** Nothing limits the size of a board today.

### Boards of five

| People | Boards | Delivered | p50 | p95 | p99 | Server CPU | Server memory | Generator delay p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 20 | 100% | 1.9 ms | 5.3 ms | 7.8 ms | 3.3% | 213 MB | 13 ms |
| 500 | 100 | 100% | 1.9 ms | 5.5 ms | 7.7 ms | 8.9% | 405 MB | 14 ms |
| 1,000 | 200 | 100% | 1.8 ms | 4.6 ms | 9.7 ms | 13% | 637 MB | 14 ms |
| 2,000 | 400 | 100% | 1.7 ms | 5.9 ms | 36 ms | 27% | 1,184 MB | 19 ms |
| 3,000 | 600 | 100% | 19 ms | 39 ms | 73 ms | 31% | 1,674 MB | 75 ms |

Each connected person costs about 0.5 MB on an empty board. Joins stayed between 30 and 40 ms at p95.

At 3,000 the generator's own delay reached 75 ms, so part of that latency is the generator. Runs at 6,000 and 9,000 with three generator processes saturated the laptop: the generators lagged by up to 0.7 s and the server got only about half of the CPU. Those runs are not reported as server limits.

## Not covered yet

- **The server's real ceiling**: needs the generator on a separate machine, or several.
- **Boards with content**: each LiveView keeps the board's elements in `BoardState`, so memory per person grows with board size. Every run here used an empty board.
- **Durable writes under load**: creates, moves and erases go to PostgreSQL through a pool of 10 connections (`POOL_SIZE`). The runs only send cursors.
- **The Docker Compose deployment**: container CPU and memory limits and container networking are not included.

## Environment

- Date: 2026-11-06
- Machine: Mac16,10 (Apple M4, 10 cores, 16 GB), macOS 26.5.1, shared by the server, PostgreSQL and the generator
- Runtime: Elixir 1.20.4, OTP 29; Node 24.3.0 for the generator
- Database: PostgreSQL 18 in the dev Docker container on 127.0.0.1, database `sketch_load`
- App: `MIX_ENV=prod mix release`, started with `bin/server`, `BIND_IP=127.0.0.1`, `PORT=4100`, after `bin/migrate`

## Running it

Build and start a release as in the environment above, then run one ramp per scenario:

```sh
node tools/load/load.ts --base-url http://127.0.0.1:4100 \
  --release-bin _build/prod/rel/sketch/bin/sketch \
  --scenario one-board --steps 10,40,80,160 --seconds 15 --out one-board.jsonl

node tools/load/load.ts --base-url http://127.0.0.1:4100 \
  --release-bin _build/prod/rel/sketch/bin/sketch \
  --scenario many-boards --users-per-board 5 --steps 100,500,1000,2000 --seconds 15 --out many-boards.jsonl
```

`bin/sketch rpc` needs the same release environment variables as the server. Other options: `--cursor-hz` (default 20) and `--join-concurrency` (default 25). To go past one generator's limit, run several processes against the same server, each with its own `--out`; their boards never overlap.
