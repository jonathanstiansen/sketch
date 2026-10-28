import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { connected, createBoard, grabRectangle, openBoard, rectangleStates } from "./support/board"

const clientCount = 10
const viewport = { width: 1000, height: 700 }
const screenshotDir = process.env.E2E_SCREENSHOT_DIR
const rectangles = "rect[data-rect]"

test("ten concurrent browsers share creates and simultaneous drags", async ({ browser }) => {
  const contexts: BrowserContext[] = []
  try {
    for (let index = 0; index < clientCount; index++) {
      contexts.push(await browser.newContext({ viewport }))
    }
    const pages: Page[] = await Promise.all(contexts.map((context) => context.newPage()))
    const [first, ...others] = pages
    if (first === undefined) throw new Error("no pages")

    const path = await createBoard(first)
    await Promise.all(others.map((page) => openBoard(page, path)))

    const creators = [first, pages[3], pages[6], pages[9]]
    for (const [count, creator] of creators.entries()) {
      if (creator === undefined) throw new Error("missing creator")
      await creator.locator("#add-rectangle").click()
      for (const page of pages) await expect(page.locator(rectangles)).toHaveCount(count + 1)
    }

    const draggers = [pages[1], pages[2], pages[4], pages[5]]
    const moves = [
      { dx: 300, dy: 40 },
      { dx: 200, dy: 120 },
      { dx: 100, dy: 200 },
      { dx: 350, dy: 20 },
    ]
    await Promise.all(
      draggers.map(async (page, index) => {
        const move = moves[index]
        if (page === undefined || move === undefined) throw new Error("missing dragger")
        const rectangle = page.locator(rectangles).nth(index)
        const start = await grabRectangle(page, rectangle)
        await page.mouse.move(start.x + move.dx, start.y + move.dy, { steps: 25 })
        await page.mouse.up()
      }),
    )

    await first.reload()
    await expect(first.locator(connected)).toBeVisible()
    await expect(first.locator(`${rectangles}[data-version="1"]`)).toHaveCount(4)
    const persisted = await rectangleStates(first)
    expect(persisted.map((state) => state.version)).toEqual(["1", "1", "1", "1"])

    for (const page of pages) {
      await expect.poll(() => rectangleStates(page)).toEqual(persisted)
    }

    if (screenshotDir !== undefined) {
      for (const [index, page] of pages.entries()) {
        await page.screenshot({ path: `${screenshotDir}/client-${String(index).padStart(2, "0")}.png` })
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
