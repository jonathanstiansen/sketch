import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const rectangle = '#elements > [data-element][data-kind="rectangle"]'
const arrow = '#elements > [data-element][data-kind="arrow"]'

interface Point {
  x: number
  y: number
}

async function draw(page: Page, key: string, from: Point, to: Point): Promise<void> {
  await page.keyboard.press(key)
  await pressAt(page, from.x, from.y)
  await moveTo(page, to.x, to.y)
  await page.mouse.up()
  await page.keyboard.press("Escape")
}

async function arrowEnds(page: Page): Promise<Point[]> {
  return page.locator(arrow).evaluate((node) => {
    const x = Number(node.getAttribute("x"))
    const y = Number(node.getAttribute("y"))
    const pairs = (node.getAttribute("live-points") ?? "").split(" ").map((pair) => pair.split(",").map(Number))
    return pairs.map(([px = 0, py = 0]) => ({ x: x + px, y: y + py }))
  })
}

async function expectArrowStart(pages: Page[], start: Point, end: Point): Promise<void> {
  for (const page of pages) await expect.poll(() => arrowEnds(page)).toEqual([start, end])
}

async function dragFrom(page: Page, from: Point, by: Point): Promise<void> {
  await pressAt(page, from.x, from.y)
  await moveTo(page, from.x + by.x, from.y + by.y)
}

test("an arrow drawn from a shape stays attached when anyone moves the shape, through undo and reload, and stays put when the shape is erased", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "binding")
  const { pageA, pageB } = session
  try {
    await draw(pageA, "r", { x: 100, y: 100 }, { x: 260, y: 200 })
    await draw(pageA, "a", { x: 200, y: 150 }, { x: 500, y: 400 })
    const rectangleId = await pageA.locator(rectangle).getAttribute("data-element")
    for (const page of [pageA, pageB]) await expect(page.locator(arrow)).toHaveAttribute("data-start-target", rectangleId ?? "")
    await expectArrowStart([pageA, pageB], { x: 200, y: 150 }, { x: 500, y: 400 })
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/bound-before-move.png` })

    await dragFrom(pageA, { x: 120, y: 120 }, { x: 200, y: 100 })
    await expectArrowStart([pageA], { x: 400, y: 250 }, { x: 500, y: 400 })
    await expectArrowStart([pageB], { x: 400, y: 250 }, { x: 500, y: 400 })
    await pageA.mouse.up()
    await expect(pageA.locator(rectangle)).toHaveAttribute("data-version", "1")
    await expectArrowStart([pageA, pageB], { x: 400, y: 250 }, { x: 500, y: 400 })
    await expect(pageA.locator(arrow)).toHaveAttribute("data-version", "0")
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/bound-after-move-seen-by-b.png` })

    await pageA.keyboard.press("Escape")
    await pageA.keyboard.press("ControlOrMeta+z")
    await expectArrowStart([pageA, pageB], { x: 200, y: 150 }, { x: 500, y: 400 })
    await expect(pageA.locator(rectangle)).toHaveAttribute("data-version", "2")
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expectArrowStart([pageA, pageB], { x: 400, y: 250 }, { x: 500, y: 400 })

    await pageB.reload()
    await expectArrowStart([pageB], { x: 400, y: 250 }, { x: 500, y: 400 })
    await expect(pageB.locator(arrow)).toHaveAttribute("data-start-target", rectangleId ?? "")

    await clickAt(pageA, 320, 220)
    await pageA.keyboard.press("Delete")
    for (const page of [pageA, pageB]) {
      await expect(page.locator(rectangle)).toHaveCount(0)
      await expect(page.locator(arrow)).not.toHaveAttribute("data-start-target")
    }
    await expectArrowStart([pageA, pageB], { x: 400, y: 250 }, { x: 500, y: 400 })
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/target-erased-arrow-stays.png` })
  } finally {
    await closeSession(session)
  }
})

test("an arrow moved on its own lets go of the shape, and dragging its end onto a shape binds it", async ({ browser }) => {
  const session = await openSharedBoard(browser, "binding-rebind")
  const { pageA, pageB } = session
  try {
    await draw(pageA, "r", { x: 100, y: 100 }, { x: 260, y: 200 })
    await draw(pageA, "a", { x: 200, y: 150 }, { x: 500, y: 400 })

    await dragFrom(pageA, { x: 350, y: 275 }, { x: 100, y: 0 })
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expect(page.locator(arrow)).not.toHaveAttribute("data-start-target")
    await expectArrowStart([pageA, pageB], { x: 300, y: 150 }, { x: 600, y: 400 })

    await dragFrom(pageA, { x: 300, y: 150 }, { x: -80, y: 20 })
    await pageA.mouse.up()
    const rectangleId = await pageA.locator(rectangle).getAttribute("data-element")
    for (const page of [pageA, pageB]) await expect(page.locator(arrow)).toHaveAttribute("data-start-target", rectangleId ?? "")
    await expectArrowStart([pageA, pageB], { x: 220, y: 170 }, { x: 600, y: 400 })
  } finally {
    await closeSession(session)
  }
})
