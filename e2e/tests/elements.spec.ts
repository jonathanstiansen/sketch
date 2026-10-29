import { mkdirSync } from "node:fs"
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createBoard, openBoard } from "./support/board"

const recordingDir = process.env.E2E_RECORD_DIR
const evidenceDir = process.env.E2E_EVIDENCE_DIR
const recordingSize = { width: 960, height: 600 }
const element = "rect[data-element]"
const drawPreview = "rect[data-draw]"
const handle = (corner: string): string => `rect[data-handle="${corner}"]`

interface Session {
  pageA: Page
  pageB: Page
  contexts: BrowserContext[]
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function recordingOptions(name: string) {
  if (recordingDir === undefined) return {}
  const dir = `${recordingDir}/${name}`
  mkdirSync(dir, { recursive: true })
  return { recordVideo: { dir, size: recordingSize }, viewport: recordingSize }
}

async function openSharedBoard(browser: Browser, name: string): Promise<Session> {
  const contexts = await Promise.all([
    browser.newContext(recordingOptions(`${name}-a`)),
    browser.newContext(recordingOptions(`${name}-b`)),
  ])
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
  if (pageA === undefined || pageB === undefined) throw new Error("pages did not open")
  await openBoard(pageB, await createBoard(pageA))
  return { pageA, pageB, contexts }
}

async function closeSession({ contexts }: Session): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()))
}

async function canvasPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator("#canvas").boundingBox()
  if (box === null) throw new Error("canvas is not visible")
  return { x: box.x + x, y: box.y + y }
}

async function pressAt(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
}

async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.move(point.x, point.y, { steps: 30 })
}

async function expectBox(page: Page, selector: string, { x, y, width, height }: Box): Promise<void> {
  const shape = page.locator(selector)
  await expect(shape).toHaveAttribute("x", String(x))
  await expect(shape).toHaveAttribute("y", String(y))
  await expect(shape).toHaveAttribute("width", String(width))
  await expect(shape).toHaveAttribute("height", String(height))
}

async function expectElement(page: Page, box: Box, version: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(1)
  await expectBox(page, element, box)
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
  await expect(page.locator(element)).toHaveAttribute("data-kind", "rectangle")
}

test("A draws, resizes and moves a rectangle; B sees each step live and the result persists", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "draw-and-resize")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("r")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 200, 220)
    await expectBox(pageA, drawPreview, { x: 200, y: 220, width: 200, height: 80 })
    await expectBox(pageB, drawPreview, { x: 200, y: 220, width: 200, height: 80 })
    await expect(pageB.locator(element)).toHaveCount(0)
    await pageA.mouse.up()

    const drawn = { x: 200, y: 220, width: 200, height: 80 }
    for (const page of [pageA, pageB]) {
      await expectElement(page, drawn, 0)
      await expect(page.locator(drawPreview)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator(handle("se"))).toHaveCount(1)
    await expect(pageB.locator("rect[data-handle]")).toHaveCount(0)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/selection.png` })

    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 520, 380)
    const resized = { x: 200, y: 220, width: 320, height: 160 }
    await expectBox(pageB, element, resized)
    await expect(pageB.locator(element)).toHaveAttribute("data-version", "0")
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectElement(page, resized, 1)

    await pressAt(pageA, 300, 300)
    await moveTo(pageA, 350, 330)
    const moved = { x: 250, y: 250, width: 320, height: 160 }
    await expectBox(pageB, element, moved)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectElement(page, moved, 2)
    await expectBox(pageA, "rect[data-selection-outline]", { x: 246, y: 246, width: 328, height: 168 })

    await pageB.reload()
    await expectElement(pageB, moved, 2)
  } finally {
    await closeSession(session)
  }
})

test("a drawing dragged past the canvas edge is clamped to the canvas", async ({ browser }) => {
  const session = await openSharedBoard(browser, "draw-clamped")
  const { pageA, pageB } = session
  try {
    const canvasTop = (await canvasPoint(pageA, 0, 0)).y
    expect(canvasTop).toBeGreaterThan(40)
    await pageA.keyboard.press("2")
    await pressAt(pageA, 150, 90)
    await moveTo(pageA, 60, -canvasTop + 10)
    const clamped = { x: 60, y: 0, width: 90, height: 90 }
    await expectBox(pageB, drawPreview, clamped)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) await expectElement(page, clamped, 0)
  } finally {
    await closeSession(session)
  }
})

test("Esc or pointercancel while drawing creates nothing and clears B's preview", async ({ browser }) => {
  const session = await openSharedBoard(browser, "draw-cancelled")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("r")
    await pressAt(pageA, 300, 300)
    await moveTo(pageA, 420, 380)
    await expect(pageB.locator(drawPreview)).toHaveCount(1)
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expect(page.locator(drawPreview)).toHaveCount(0)
    await pageA.mouse.up()
    await expect(pageA.locator("#canvas-viewport")).toHaveAttribute("data-tool", "selection")

    await pageA.keyboard.press("r")
    await pressAt(pageA, 300, 300)
    await moveTo(pageA, 360, 340)
    await expect(pageB.locator(drawPreview)).toHaveCount(1)
    await pageA.locator("#canvas-viewport").dispatchEvent("pointercancel", { pointerId: 1 })
    for (const page of [pageA, pageB]) await expect(page.locator(drawPreview)).toHaveCount(0)
    await pageA.mouse.up()

    await clickAt(pageA, 600, 350)
    for (const page of [pageA, pageB]) {
      await expectElement(page, { x: 600, y: 350, width: 120, height: 80 }, 0)
    }
    await pageB.reload()
    await expect(pageB.locator(element)).toHaveCount(1)
  } finally {
    await closeSession(session)
  }
})
