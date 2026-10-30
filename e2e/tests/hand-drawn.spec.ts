import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, expectBox, moveTo, openSharedBoard, pressAt, type Box } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR

interface Drawn {
  kind: string
  key: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

const DRAWN: readonly Drawn[] = [
  { kind: "rectangle", key: "r", from: { x: 80, y: 80 }, to: { x: 240, y: 180 } },
  { kind: "diamond", key: "d", from: { x: 300, y: 80 }, to: { x: 460, y: 180 } },
  { kind: "ellipse", key: "o", from: { x: 520, y: 80 }, to: { x: 680, y: 180 } },
  { kind: "line", key: "l", from: { x: 80, y: 260 }, to: { x: 240, y: 360 } },
  { kind: "arrow", key: "a", from: { x: 300, y: 360 }, to: { x: 460, y: 260 } },
]

function boxOf({ from, to }: Drawn): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

function sketchOf(wrapper: string): string {
  return `${wrapper} > path:is([data-sketch], [data-line-stroke])`
}

async function pathOf(page: Page, wrapper: string): Promise<string> {
  const sketch = page.locator(sketchOf(wrapper))
  await expect(sketch).toHaveCount(1)
  const path = await sketch.getAttribute("d")
  if (!path?.startsWith("M ")) throw new Error(`${wrapper} has no hand-drawn path`)
  return path
}

async function expectSketch(page: Page, wrapper: string, seed: string, path: string): Promise<void> {
  await expect(page.locator(wrapper)).toHaveAttribute("data-seed", seed)
  await expect(page.locator(sketchOf(wrapper))).toHaveAttribute("d", path)
}

test("A's draw preview, B's remote preview and the committed element draw one hand-drawn path from A's seed, for every sketched kind", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "hand-drawn-draw")
  const { pageA, pageB } = session
  try {
    for (const drawn of DRAWN) {
      const preview = `[data-draw][data-kind="${drawn.kind}"]`
      const committed = `[data-element][data-kind="${drawn.kind}"]`
      await pageA.keyboard.press(drawn.key)
      await pressAt(pageA, drawn.from.x, drawn.from.y)
      await moveTo(pageA, drawn.to.x, drawn.to.y)
      await expectBox(pageA, preview, boxOf(drawn))
      const seed = (await pageA.locator(preview).getAttribute("data-seed")) ?? ""
      expect(seed).toMatch(/^\d+$/)
      const path = await pathOf(pageA, preview)

      await expectBox(pageB, preview, boxOf(drawn))
      await expectSketch(pageB, preview, seed, path)

      await pageA.mouse.up()
      for (const page of [pageA, pageB]) {
        await expect(page.locator(preview)).toHaveCount(0)
        await expectSketch(page, committed, seed, path)
      }
    }

    await pageB.reload()
    for (const { kind } of DRAWN) {
      const committed = `[data-element][data-kind="${kind}"]`
      const seed = (await pageA.locator(committed).getAttribute("data-seed")) ?? ""
      await expectSketch(pageB, committed, seed, await pathOf(pageA, committed))
    }
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/drawn-kinds.png` })
  } finally {
    await closeSession(session)
  }
})

test("a note drawn and typed by A keeps its preview's hand-drawn outline in both browsers", async ({ browser }) => {
  const session = await openSharedBoard(browser, "hand-drawn-note")
  const { pageA, pageB } = session
  const preview = '[data-draw][data-kind="note"]'
  const committed = '[data-element][data-kind="note"]'
  try {
    await pageA.keyboard.press("n")
    await pressAt(pageA, 120, 120)
    await moveTo(pageA, 340, 300)
    await pageA.mouse.up()
    const seed = (await pageA.locator(preview).getAttribute("data-seed")) ?? ""
    const path = await pathOf(pageA, preview)
    await pageA.keyboard.type("sketchy")
    await expectSketch(pageB, preview, seed, path)

    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) {
      await expect(page.locator(committed)).toHaveAttribute("data-text", "sketchy")
      await expectSketch(page, committed, seed, path)
    }
  } finally {
    await closeSession(session)
  }
})

test("a resize keeps the element's seed: A's live resize, B's remote preview, the commit and a reload draw the same path", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "hand-drawn-resize")
  const { pageA, pageB } = session
  const element = '[data-element][data-kind="rectangle"]'
  try {
    await pageA.keyboard.press("r")
    await pressAt(pageA, 160, 140)
    await moveTo(pageA, 400, 300)
    await pageA.mouse.up()
    await expect(pageB.locator(element)).toHaveAttribute("data-version", "0")
    const seed = (await pageA.locator(element).getAttribute("data-seed")) ?? ""
    const drawnPath = await pathOf(pageA, element)
    await expectSketch(pageB, element, seed, drawnPath)

    await pageA.keyboard.press("v")
    await clickAt(pageA, 280, 220)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 560, 420)
    const resized = { x: 160, y: 140, width: 400, height: 280 }
    for (const page of [pageA, pageB]) await expectBox(page, element, resized)
    const resizingPath = await pathOf(pageA, element)
    expect(resizingPath).not.toEqual(drawnPath)
    await expectSketch(pageB, element, seed, resizingPath)
    await expect(pageA.locator(`${element} > rect`)).toHaveAttribute("width", String(resized.width))

    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expect(page.locator(element)).toHaveAttribute("data-version", "1")
      await expectSketch(page, element, seed, resizingPath)
    }

    await pageB.reload()
    await expectSketch(pageB, element, seed, resizingPath)
  } finally {
    await closeSession(session)
  }
})
