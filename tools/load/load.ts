import { execFile } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { parseArgs } from "node:util"

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://127.0.0.1:4100" },
    scenario: { type: "string", default: "one-board" },
    steps: { type: "string", default: "5,10,20,40,80" },
    "users-per-board": { type: "string", default: "5" },
    "cursor-hz": { type: "string", default: "20" },
    seconds: { type: "string", default: "20" },
    "join-concurrency": { type: "string", default: "25" },
    "release-bin": { type: "string" },
    out: { type: "string", default: "load-results.jsonl" },
  },
})

const baseUrl = options["base-url"]
const wsUrl = baseUrl.replace(/^http/, "ws")
const cursorHz = Number(options["cursor-hz"])
const stepSeconds = Number(options.seconds)
const joinConcurrency = Number(options["join-concurrency"])
const usersPerBoard = Number(options["users-per-board"])
const steps = options.steps.split(",").map(Number)
const seqStride = 10_000_000
const heartbeatMs = 30_000

type Message = [string | null, string | null, string, string, Record<string, unknown>]

interface PageTokens {
  csrf: string
  cookie: string
  id: string
  session: string
  static: string
}

function attribute(html: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(html)
  if (match?.[1] === undefined) throw new Error(`page has no ${name}`)
  return match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"')
}

async function pageTokens(path: string): Promise<PageTokens> {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" })
  const html = await response.text()
  const main = /<div[^>]*data-phx-main[^>]*>/.exec(html)?.[0]
  if (main === undefined) throw new Error(`no LiveView on ${path} (HTTP ${String(response.status)})`)
  return {
    csrf: attribute(html, 'name="csrf-token" content'),
    cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "),
    id: attribute(main, "id"),
    session: attribute(main, "data-phx-session"),
    static: attribute(main, "data-phx-static"),
  }
}

class LiveClient {
  private socket!: WebSocket
  private ref = 0
  private readonly joinRef = "1"
  private topic = ""
  private readonly replies = new Map<string, (payload: Record<string, unknown>) => void>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  onPushEvent: (event: string, payload: Record<string, unknown>) => void = () => undefined

  async join(path: string): Promise<Record<string, unknown>> {
    const tokens = await pageTokens(path)
    this.topic = `lv:${tokens.id}`
    this.socket = new WebSocket(`${wsUrl}/live/websocket?_csrf_token=${encodeURIComponent(tokens.csrf)}&vsn=2.0.0`, {
      headers: { cookie: tokens.cookie },
    } as unknown as string[])
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true })
      this.socket.addEventListener("error", () => reject(new Error("websocket error")), { once: true })
    })
    this.socket.addEventListener("message", (event) => this.receive(event.data as string))
    this.heartbeat = setInterval(() => this.send(null, "phoenix", "heartbeat", {}), heartbeatMs)
    const reply = await this.request("phx_join", {
      url: `${baseUrl}${path}`,
      params: { _csrf_token: tokens.csrf, _mounts: 0 },
      session: tokens.session,
      static: tokens.static,
    })
    if (reply.status !== "ok") throw new Error(`join failed: ${JSON.stringify(reply.response)}`)
    return reply
  }

  pushHook(event: string, value: Record<string, unknown>): void {
    this.send(this.joinRef, this.topic, "event", { type: "hook", event, value })
  }

  click(event: string): Promise<Record<string, unknown>> {
    return this.request("event", { type: "click", event, value: {} })
  }

  close(): void {
    clearInterval(this.heartbeat)
    this.socket.close()
  }

  private request(event: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ref = this.send(this.joinRef, this.topic, event, payload)
    return new Promise((resolve) => this.replies.set(ref, resolve))
  }

  private send(joinRef: string | null, topic: string, event: string, payload: Record<string, unknown>): string {
    this.ref += 1
    const ref = String(this.ref)
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify([joinRef, ref, topic, event, payload]))
    return ref
  }

  private receive(data: string): void {
    const [, ref, , event, payload] = JSON.parse(data) as Message
    if (event === "phx_reply" && ref !== null) {
      this.replies.get(ref)?.(payload)
      this.replies.delete(ref)
    }
    const diff = event === "diff" ? payload : event === "phx_reply" ? (payload.response as Record<string, unknown> | undefined)?.diff : undefined
    const pushed = (diff as { e?: [string, Record<string, unknown>][] } | undefined)?.e ?? []
    for (const [name, body] of pushed) this.onPushEvent(name, body)
  }
}

async function newBoardPath(): Promise<string> {
  const home = new LiveClient()
  await home.join("/")
  const reply = await home.click("new-board")
  home.close()
  const navigate = (reply.response as { live_redirect?: { to: string } } | undefined)?.live_redirect
  if (navigate === undefined) throw new Error(`new-board did not navigate: ${JSON.stringify(reply)}`)
  return navigate.to
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? Number.NaN
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

async function inBatches<T>(count: number, size: number, start: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = []
  for (let index = 0; index < count; index += size) {
    const batch = Array.from({ length: Math.min(size, count - index) }, (_, offset) => start(index + offset))
    results.push(...(await Promise.all(batch)))
  }
  return results
}

const serverStatsExpression = [
  "mem = :erlang.memory();",
  "[{:total, util, _} | _] = :scheduler.utilization(2);",
  "IO.puts(Jason.encode!(%{memory_mb: div(mem[:total], 1_048_576), process_mb: div(mem[:processes], 1_048_576),",
  "processes: :erlang.system_info(:process_count), run_queue: :erlang.statistics(:total_run_queue_lengths_all),",
  "scheduler_utilization: Float.round(util * 100, 1)}))",
].join(" ")

function serverStats(): Promise<Record<string, unknown> | undefined> {
  const bin = options["release-bin"]
  if (bin === undefined) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(bin, ["rpc", serverStatsExpression], (error, stdout) => {
      resolve(error === null ? (JSON.parse(stdout.trim()) as Record<string, unknown>) : { error: error.message })
    })
  })
}

interface StepResult {
  scenario: string
  users: number
  boards: number
  cursor_hz: number
  seconds: number
  join_ms_p50: number
  join_ms_p95: number
  sent: number
  expected_deliveries: number
  delivered: number
  delivered_pct: number
  latency_ms_p50: number
  latency_ms_p95: number
  latency_ms_p99: number
  latency_ms_max: number
  generator_loop_delay_ms_p99: number
  server?: Record<string, unknown>
}

async function runStep(users: number): Promise<StepResult> {
  const boardSize = options.scenario === "one-board" ? users : usersPerBoard
  const boardCount = Math.ceil(users / boardSize)
  const boards = await inBatches(boardCount, joinConcurrency, () => newBoardPath())
  const sentAt = new Map<number, number>()
  const latencies: number[] = []
  const joinTimes: number[] = []

  const clients = await inBatches(users, joinConcurrency, async (index) => {
    const client = new LiveClient()
    client.onPushEvent = (event, payload) => {
      if (event !== "cursor") return
      const started = sentAt.get(payload.seq as number)
      if (started !== undefined) latencies.push(performance.now() - started)
    }
    const started = performance.now()
    await client.join(boards[Math.floor(index / boardSize)] ?? "")
    joinTimes.push(performance.now() - started)
    return client
  })

  const loopDelay = monitorEventLoopDelay({ resolution: 10 })
  loopDelay.enable()
  let sent = 0
  let expected = 0
  const intervalMs = 1000 / cursorHz
  const timers = clients.map((client, index) => {
    const peers = Math.min(boardSize, users - Math.floor(index / boardSize) * boardSize) - 1
    let seq = index * seqStride
    let angle = Math.random() * Math.PI * 2
    return setInterval(() => {
      seq += 1
      angle += 0.2
      sentAt.set(seq, performance.now())
      client.pushHook("cursor", { x: Math.round(2000 + 500 * Math.cos(angle)), y: Math.round(2000 + 500 * Math.sin(angle)), seq })
      sent += 1
      expected += peers
    }, intervalMs)
  })

  const statsPromise = new Promise<Record<string, unknown> | undefined>((resolve) => {
    setTimeout(() => void serverStats().then(resolve), (stepSeconds * 1000) / 2)
  })
  await new Promise((resolve) => setTimeout(resolve, stepSeconds * 1000))
  for (const timer of timers) clearInterval(timer)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  loopDelay.disable()
  const server = await statsPromise
  for (const client of clients) client.close()

  latencies.sort((a, b) => a - b)
  joinTimes.sort((a, b) => a - b)
  return {
    scenario: options.scenario,
    users,
    boards: boardCount,
    cursor_hz: cursorHz,
    seconds: stepSeconds,
    join_ms_p50: round(percentile(joinTimes, 50)),
    join_ms_p95: round(percentile(joinTimes, 95)),
    sent,
    expected_deliveries: expected,
    delivered: latencies.length,
    delivered_pct: round(expected === 0 ? 100 : (latencies.length * 100) / expected),
    latency_ms_p50: round(percentile(latencies, 50)),
    latency_ms_p95: round(percentile(latencies, 95)),
    latency_ms_p99: round(percentile(latencies, 99)),
    latency_ms_max: round(latencies.at(-1) ?? Number.NaN),
    generator_loop_delay_ms_p99: round(loopDelay.percentile(99) / 1e6),
    ...(server === undefined ? {} : { server }),
  }
}

writeFileSync(options.out, "")
for (const users of steps) {
  const result = await runStep(users)
  appendFileSync(options.out, `${JSON.stringify(result)}\n`)
  console.log(JSON.stringify(result))
}
