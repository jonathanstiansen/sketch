import fc from "fast-check"
import { expect, test, type Page } from "@playwright/test"
import { createBoard, grabRectangle, openBoard } from "./support/board"

const rectangle = "[data-element][data-kind='rectangle']"
const evidenceDir = process.env.E2E_EVIDENCE_DIR

interface Offset {
  dx: number
  dy: number
}

interface Placement {
  x: number
  y: number
  version: number
}

const offset = fc.integer({ min: -4500, max: 4500 })
const dragPath = fc.array(fc.record({ dx: offset, dy: offset }), { minLength: 2, maxLength: 8 })

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max)
}

async function integerAttribute(page: Page, selector: string, name: string): Promise<number> {
  return Number(await page.locator(selector).getAttribute(name))
}

async function placement(page: Page): Promise<Placement> {
  return {
    x: await integerAttribute(page, rectangle, "x"),
    y: await integerAttribute(page, rectangle, "y"),
    version: await integerAttribute(page, rectangle, "data-version"),
  }
}

async function expectPlacement(page: Page, { x, y, version }: Placement): Promise<void> {
  const rect = page.locator(rectangle)
  await expect(rect).toHaveAttribute("x", String(x))
  await expect(rect).toHaveAttribute("y", String(y))
  await expect(rect).toHaveAttribute("data-version", String(version))
}

async function dragAlong(page: Page, path: Offset[]): Promise<void> {
  const rect = page.locator(rectangle)
  await rect.scrollIntoViewIfNeeded()
  const start = await grabRectangle(page, rect)
  for (const { dx, dy } of path) {
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 })
  }
}

test("any drag path converges in the other browser to its clamped end, one version per drag", async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])
    const board = await createBoard(pageA)
    await openBoard(pageB, board)
    await pageA.locator("#add-rectangle").click()
    await expect(pageB.locator(rectangle)).toHaveCount(1)

    const max = {
      x:
        (await integerAttribute(pageA, "#canvas-viewport", "data-canvas-width")) -
        (await integerAttribute(pageA, rectangle, "width")),
      y:
        (await integerAttribute(pageA, "#canvas-viewport", "data-canvas-height")) -
        (await integerAttribute(pageA, rectangle, "height")),
    }
    let screenshotTaken = false

    await fc.assert(
      fc.asyncProperty(dragPath, async (path) => {
        const before = await placement(pageB)
        const end = path.at(-1) ?? { dx: 0, dy: 0 }
        const target = { x: clamp(before.x + end.dx, max.x), y: clamp(before.y + end.dy, max.y) }
        const moved = target.x !== before.x || target.y !== before.y

        await dragAlong(pageA, path)
        try {
          await expectPlacement(pageB, { ...target, version: before.version })
          if (evidenceDir !== undefined && moved && !screenshotTaken) {
            await pageB.locator(rectangle).scrollIntoViewIfNeeded()
            await pageB.screenshot({ path: `${evidenceDir}/b-mid-convergence.png` })
            screenshotTaken = true
          }
        } finally {
          await pageA.mouse.up()
        }

        const committed = { ...target, version: before.version + (moved ? 1 : 0) }
        await expectPlacement(pageB, committed)
        await expectPlacement(pageA, committed)
      }),
      { seed: 1, numRuns: 5 },
    )

    await pageB.reload()
    await expectPlacement(pageB, await placement(pageA))
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
