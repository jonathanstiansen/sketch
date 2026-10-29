import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { createBoard, grabRectangle, openBoard } from "./support/board"

const recordingDir = process.env.E2E_RECORD_DIR
const videoSize = { width: 640, height: 480 }
const rectangle = "[data-element][data-kind='rectangle']"
const steps = 40
const targetA = { dx: 350, dy: 0 }
const targetB = { dx: 0, dy: 150 }

interface Position {
  x: string | null
  y: string | null
  version: string | null
}

async function position(page: Page): Promise<Position> {
  const rect = page.locator(rectangle)
  return {
    x: await rect.getAttribute("x"),
    y: await rect.getAttribute("y"),
    version: await rect.getAttribute("data-version"),
  }
}

function recordingOptions(name: string) {
  if (recordingDir === undefined) return { viewport: videoSize }
  const dir = `${recordingDir}/${name}`
  mkdirSync(dir, { recursive: true })
  return { recordVideo: { dir, size: videoSize }, viewport: videoSize }
}

test("simultaneous drags of one rectangle converge on the persisted row", async ({ browser }, testInfo) => {
  const contexts = await Promise.all(
    ["a", "b", "c"].map((name) => browser.newContext(recordingOptions(`same-rect-${name}`))),
  )
  try {
    const [pageA, pageB, pageC] = await Promise.all(contexts.map((context) => context.newPage()))
    if (pageA === undefined || pageB === undefined || pageC === undefined) throw new Error("no pages")

    const path = await createBoard(pageA)
    await Promise.all([openBoard(pageB, path), openBoard(pageC, path)])
    await pageA.locator("#add-rectangle").click()
    for (const page of [pageA, pageB, pageC]) {
      await expect(page.locator(rectangle)).toHaveAttribute("x", "100")
    }

    const startA = await grabRectangle(pageA, pageA.locator(rectangle))
    const startB = await grabRectangle(pageB, pageB.locator(rectangle))

    const midDrag: { step: number; a: Position; b: Position; c: Position }[] = []
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps
      await Promise.all([
        pageA.mouse.move(startA.x + targetA.dx * progress, startA.y + targetA.dy * progress),
        pageB.mouse.move(startB.x + targetB.dx * progress, startB.y + targetB.dy * progress),
      ])
      const [a, b, c] = await Promise.all([position(pageA), position(pageB), position(pageC)])
      midDrag.push({ step, a, b, c })
    }

    await Promise.all([pageA.mouse.up(), pageB.mouse.up()])

    for (const page of [pageA, pageB, pageC]) {
      await expect(page.locator(rectangle)).toHaveAttribute("data-version", "2")
    }
    await pageC.reload()
    await expect(pageC.locator(rectangle)).toHaveAttribute("data-version", "2")
    const persisted = await position(pageC)
    await expect.poll(() => position(pageA)).toEqual(persisted)
    await expect.poll(() => position(pageB)).toEqual(persisted)

    const disagreements = midDrag.filter(
      ({ a, b, c }) => a.x !== c.x || a.y !== c.y || b.x !== c.x || b.y !== c.y,
    ).length
    const observed = {
      steps,
      samplesWhereCDisagreedWithAOrB: disagreements,
      cMatchedA: midDrag.filter(({ a, c }) => a.x === c.x && a.y === c.y).length,
      cMatchedB: midDrag.filter(({ b, c }) => b.x === c.x && b.y === c.y).length,
      lastSample: midDrag.at(-1),
      persisted,
    }
    await testInfo.attach("mid-drag-samples", {
      body: JSON.stringify(midDrag, null, 1),
      contentType: "application/json",
    })
    await testInfo.attach("summary", { body: JSON.stringify(observed, null, 1), contentType: "application/json" })
    expect(persisted.version).toBe("2")

    for (const [name, page] of [["a", pageA], ["b", pageB], ["c", pageC]] as const) {
      await testInfo.attach(`final-${name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      })
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
