import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, expectBox, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const element = 'g[data-element][data-kind="line"]'
const stroke = `${element} line[data-line-stroke]`
const drawPreview = "line[data-draw]"

interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

async function expectSegment(page: Page, selector: string, segment: Segment): Promise<void> {
  for (const [name, value] of Object.entries(segment)) {
    await expect(page.locator(selector)).toHaveAttribute(name, String(value))
  }
}

function relativePoints({ x1, y1, x2, y2 }: Segment, x: number, y: number): string {
  return [
    [x1 - x, y1 - y],
    [x2 - x, y2 - y],
  ]
    .map((point) => point.map(String).join(","))
    .join(" ")
}

async function expectLines(page: Page, count: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(count)
}

async function expectLine(page: Page, segment: Segment, version: number): Promise<void> {
  await expectLines(page, 1)
  await expectSegment(page, stroke, segment)
  const { x1, y1, x2, y2 } = segment
  const [x, y] = [Math.min(x1, x2), Math.min(y1, y2)]
  await expectBox(page, element, { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) })
  await expect(page.locator(element)).toHaveAttribute("data-points", relativePoints(segment, x, y))
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
}

async function drawLine(page: Page, { x1, y1, x2, y2 }: Segment): Promise<void> {
  await pressAt(page, x1, y1)
  await moveTo(page, x2, y2)
  await page.mouse.up()
}

test("A draws, edits an endpoint of and moves a line; B sees each step live and it persists", async ({ browser }) => {
  const session = await openSharedBoard(browser, "line")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("l")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 200, 220)
    const drawn = { x1: 400, y1: 300, x2: 200, y2: 220 }
    await expectSegment(pageB, drawPreview, drawn)
    await expectLines(pageB, 0)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      await expectLine(page, drawn, 0)
      await expect(page.locator(drawPreview)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator('rect[data-handle="end"]')).toHaveCount(1)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(0)

    await pressAt(pageA, 200, 220)
    await moveTo(pageA, 250, 400)
    const edited = { x1: 400, y1: 300, x2: 250, y2: 400 }
    await expectSegment(pageB, stroke, edited)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, edited, 1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/line.png` })

    await pressAt(pageA, 325, 350)
    await moveTo(pageA, 425, 300)
    const moved = { x1: 500, y1: 250, x2: 350, y2: 350 }
    await expectSegment(pageB, stroke, moved)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, moved, 2)

    await pageB.reload()
    await expectLine(pageB, moved, 2)
  } finally {
    await closeSession(session)
  }
})

test("lines drawn in every direction, including flat ones, reach B with matching endpoints", async ({ browser }) => {
  const session = await openSharedBoard(browser, "line-directions")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("6")
    const segments = [
      { x1: 100, y1: 100, x2: 220, y2: 160 },
      { x1: 500, y1: 160, x2: 380, y2: 100 },
      { x1: 100, y1: 300, x2: 300, y2: 300 },
      { x1: 450, y1: 420, x2: 450, y2: 260 },
    ]
    for (const [index, segment] of segments.entries()) {
      await drawLine(pageA, segment)
      await expectLines(pageB, index + 1)
      const { x1, y1, x2, y2 } = segment
      const origin = `[data-x="${String(Math.min(x1, x2))}"][data-y="${String(Math.min(y1, y2))}"]`
      await expectSegment(pageB, `${element}${origin} line[data-line-stroke]`, segment)
    }
  } finally {
    await closeSession(session)
  }
})

test("a click with the Line tool creates nothing", async ({ browser }) => {
  const session = await openSharedBoard(browser, "line-click")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("l")
    await clickAt(pageA, 600, 350)
    const drawn = { x1: 100, y1: 100, x2: 200, y2: 150 }
    await drawLine(pageA, drawn)
    for (const page of [pageA, pageB]) await expectLine(page, drawn, 0)
  } finally {
    await closeSession(session)
  }
})

test("Esc while drawing a line creates nothing and clears B's preview", async ({ browser }) => {
  const session = await openSharedBoard(browser, "line-cancelled")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("l")
    await pressAt(pageA, 300, 300)
    await moveTo(pageA, 420, 380)
    await expect(pageB.locator(drawPreview)).toHaveCount(1)
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expect(page.locator(drawPreview)).toHaveCount(0)
    await pageA.mouse.up()
    await pageA.keyboard.press("l")
    const drawn = { x1: 100, y1: 100, x2: 200, y2: 150 }
    await drawLine(pageA, drawn)
    for (const page of [pageA, pageB]) await expectLine(page, drawn, 0)
  } finally {
    await closeSession(session)
  }
})
