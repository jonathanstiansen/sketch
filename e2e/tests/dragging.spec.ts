import { mkdirSync } from "node:fs"
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { addRectangle } from "./support/canvas"
import { newContext } from "./support/contexts"

const recordingDir = process.env.E2E_RECORD_DIR
const videoSize = { width: 640, height: 480 }
const boardPath = /\/b\/[0-9a-f-]{36}$/
const rectangle = "[data-element][data-kind='rectangle']"
const origin = { x: "100", y: "100" }
const connected = "[data-phx-main].phx-connected"

interface Session {
  pageA: Page
  pageB: Page
  contextA: BrowserContext
  contextB: BrowserContext
}

function recordingOptions(name: string) {
  if (recordingDir === undefined) return {}
  const dir = `${recordingDir}/${name}`
  mkdirSync(dir, { recursive: true })
  return { recordVideo: { dir, size: videoSize }, viewport: videoSize }
}

async function openSharedBoard(
  browser: Browser,
  name: string,
  prepareB: (page: Page) => Promise<void> = () => Promise.resolve(),
): Promise<Session> {
  const contextA = await newContext(browser, recordingOptions(`${name}-a`))
  const contextB = await newContext(browser, recordingOptions(`${name}-b`))
  const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])
  await prepareB(pageB)

  await pageA.goto("/")
  await expect(pageA.locator(connected)).toBeVisible()
  await pageA.locator("#new-board").click()
  await expect(pageA).toHaveURL(boardPath)
  await pageB.goto(new URL(pageA.url()).pathname)
  await expect(pageA.locator(connected)).toBeVisible()
  await expect(pageB.locator(connected)).toBeVisible()

  await addRectangle(pageA)
  await expect(pageA.locator(rectangle)).toHaveAttribute("x", origin.x)
  await expect(pageB.locator(rectangle)).toHaveAttribute("x", origin.x)
  return { pageA, pageB, contextA, contextB }
}

async function closeSession({ contextA, contextB }: Session): Promise<void> {
  await contextA.close()
  await contextB.close()
}

async function grabRectangle(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(rectangle).boundingBox()
  if (box === null) throw new Error("rectangle is not visible")
  const start = { x: Math.round(box.x + 20), y: Math.round(box.y + 20) }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  return start
}

async function expectPosition(page: Page, x: string, y: string, version: string): Promise<void> {
  const rect = page.locator(rectangle)
  await expect(rect).toHaveAttribute("x", x)
  await expect(rect).toHaveAttribute("y", y)
  await expect(rect).toHaveAttribute("data-version", version)
}

test("a drag renders locally, streams to the other browser and persists on release", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "live-drag")
  const { pageA, pageB } = session
  try {
    const start = await grabRectangle(pageA)

    await pageA.mouse.move(start.x + 200, start.y + 50, { steps: 30 })
    expect(await pageA.locator(rectangle).getAttribute("x")).toBe("300")
    expect(await pageA.locator(rectangle).getAttribute("y")).toBe("150")
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "300")
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "0")

    await pageA.mouse.move(start.x + 400, start.y + 100, { steps: 30 })
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "500")
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "0")

    await pageA.mouse.up()
    await expectPosition(pageB, "500", "200", "1")
    await expectPosition(pageA, "500", "200", "1")

    await pageB.reload()
    await expectPosition(pageB, "500", "200", "1")
  } finally {
    await closeSession(session)
  }
})

test("a cancelled drag reverts in both browsers and never commits", async ({ browser }) => {
  const session = await openSharedBoard(browser, "interrupted-drag")
  const { pageA, pageB } = session
  try {
    const start = await grabRectangle(pageA)
    await pageA.mouse.move(start.x + 300, start.y + 150, { steps: 30 })
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "400")

    await pageA.locator(rectangle).dispatchEvent("pointercancel", { pointerId: 1 })
    await expectPosition(pageA, origin.x, origin.y, "0")
    await expectPosition(pageB, origin.x, origin.y, "0")
    await pageA.mouse.up()

    await pageB.reload()
    await expectPosition(pageB, origin.x, origin.y, "0")
  } finally {
    await closeSession(session)
  }
})

test("a preview from a vanished dragger reverts after two seconds of silence", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "stale", (page) => page.clock.install())
  const { pageA, pageB } = session
  try {
    await pageB.clock.pauseAt(Date.now() + 1000)
    const start = await grabRectangle(pageA)
    await pageA.mouse.move(start.x + 200, start.y, { steps: 20 })
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "300")

    await pageA.close()
    await pageB.clock.runFor(1900)
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "300")
    await pageB.clock.runFor(200)
    await expectPosition(pageB, origin.x, origin.y, "0")
  } finally {
    await closeSession(session)
  }
})

test("a reconnect mid-drag restores the authoritative position without committing", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "reconnect")
  const { pageA, pageB } = session
  try {
    const start = await grabRectangle(pageA)
    await pageA.mouse.move(start.x + 200, start.y + 100, { steps: 20 })
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "300")

    await pageA.evaluate(() => {
      window.liveSocket.disconnect()
    })
    await expect(pageA.locator(rectangle)).toHaveAttribute("x", origin.x)
    await pageA.mouse.move(start.x + 300, start.y + 100, { steps: 5 })
    await pageA.mouse.up()
    await pageA.evaluate(() => {
      window.liveSocket.connect()
    })
    await expect(pageA.locator(connected)).toBeVisible()
    await expectPosition(pageA, origin.x, origin.y, "0")

    await expectPosition(pageB, origin.x, origin.y, "0")
    await pageB.reload()
    await expectPosition(pageB, origin.x, origin.y, "0")
  } finally {
    await closeSession(session)
  }
})
