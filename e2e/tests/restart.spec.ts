import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { expect, test } from "@playwright/test"
import { createBoard, grabRectangle, openBoard } from "./support/board"
import { addRectangle } from "./support/canvas"
import { newContext } from "./support/contexts"

const repoRoot = new URL("../..", import.meta.url).pathname
const port = 4012
const origin = `http://127.0.0.1:${String(port)}`
const assetWatchersReady = ["build finished", "Done in"]
const screenshotDir = process.env.E2E_SCREENSHOT_DIR

let server: ChildProcess | undefined
let serverOutput = ""

function startServer(): ChildProcess {
  serverOutput = ""
  const child = spawn("mix", ["phx.server"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const collect = (chunk: Buffer): void => {
    serverOutput += chunk.toString()
  }
  child.stdout.on("data", collect)
  child.stderr.on("data", collect)
  return child
}

async function stopServer(): Promise<void> {
  const running = server
  server = undefined
  if (running === undefined) return
  if (running.exitCode !== null || running.signalCode !== null) return
  const exited = once(running, "exit")
  running.kill("SIGTERM")
  await exited
}

test.afterAll(async () => {
  await stopServer()
})

test.skip(process.env.E2E_BASE_URL !== undefined, "starts its own server; deployment persistence is covered by deploy-persistence.spec.ts")

test("completed positions survive a server restart", async ({ browser, request }, testInfo) => {
  const serverUp = async (): Promise<number> => {
    try {
      return (await request.get(origin)).status()
    } catch {
      return 0
    }
  }
  const serverReady = async (): Promise<boolean> =>
    (await serverUp()) === 200 && assetWatchersReady.every((line) => serverOutput.includes(line))

  server = startServer()
  await expect.poll(serverReady, { timeout: 90_000 }).toBe(true)

  const context = await newContext(browser, { baseURL: origin })
  const page = await context.newPage()
  const rectangle = page.locator("[data-element][data-kind='rectangle']")
  const path = await createBoard(page)
  await addRectangle(page)
  await expect(rectangle).toHaveAttribute("x", "100")

  const start = await grabRectangle(page, rectangle)
  await page.mouse.move(start.x + 250, start.y + 120, { steps: 20 })
  await page.mouse.up()
  await expect(rectangle).toHaveAttribute("data-version", "1")
  await expect(rectangle).toHaveAttribute("x", "350")
  await context.close()

  await stopServer()
  await expect.poll(serverUp, { timeout: 30_000 }).toBe(0)

  server = startServer()
  await expect.poll(serverReady, { timeout: 90_000 }).toBe(true)

  const reopened = await newContext(browser, { baseURL: origin, viewport: { width: 640, height: 480 } })
  const restarted = await reopened.newPage()
  await openBoard(restarted, path)
  const restoredRectangle = restarted.locator("[data-element][data-kind='rectangle']")
  await expect(restoredRectangle).toHaveAttribute("x", "350")
  await expect(restoredRectangle).toHaveAttribute("y", "220")
  await expect(restoredRectangle).toHaveAttribute("data-version", "1")

  const summary = `x=350 y=220 data-version=1 (board ${path})`
  await testInfo.attach("restored-state", { body: summary, contentType: "text/plain" })
  if (screenshotDir !== undefined) await restarted.screenshot({ path: `${screenshotDir}/restart.png` })
  await reopened.close()
})
