import { expect, test, type Page } from "@playwright/test"
import {
  SKETCH_END_JITTER,
  clickAt,
  closeSession,
  expectBox,
  moveTo,
  openSharedBoard,
  pressAt,
  sketchedStrokeDeviation,
  type Segment,
} from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const element = '[data-element][data-kind="arrow"]'
const stroke = `${element} > path[data-line-stroke]`
const drawPreview = '[data-draw][data-kind="arrow"]'
const drawStroke = `${drawPreview} > path[data-line-stroke]`
const headMarker = "url(#arrowhead)"

function originOf({ x1, y1, x2, y2 }: Segment): { x: number; y: number } {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2) }
}

function localSegment(segment: Segment): Segment {
  const { x, y } = originOf(segment)
  return { x1: segment.x1 - x, y1: segment.y1 - y, x2: segment.x2 - x, y2: segment.y2 - y }
}

async function expectSegment(page: Page, wrapper: string, segment: Segment): Promise<void> {
  const { x, y } = originOf(segment)
  await expect(page.locator(wrapper)).toHaveAttribute("transform", `translate(${String(x)} ${String(y)})`)
  const hit = page.locator(`${wrapper} > line[data-line-hit]`)
  await expect(hit).toHaveCount(1)
  for (const [name, value] of Object.entries(localSegment(segment))) {
    await expect(hit).toHaveAttribute(name, String(value))
  }
  const stroke = `${wrapper} > path[data-line-stroke]`
  await expect(page.locator(stroke)).toHaveCount(1)
  await expect
    .poll(() => sketchedStrokeDeviation(page, stroke, localSegment(segment)))
    .toBeLessThanOrEqual(SKETCH_END_JITTER)
}

function relativePoints(segment: Segment): string {
  const { x1, y1, x2, y2 } = localSegment(segment)
  return `${String(x1)},${String(y1)} ${String(x2)},${String(y2)}`
}

async function expectArrows(page: Page, count: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(count)
}

async function expectArrow(page: Page, segment: Segment, version: number): Promise<void> {
  await expectArrows(page, 1)
  await expectSegment(page, element, segment)
  await expect(page.locator(stroke)).toHaveAttribute("marker-end", headMarker)
  const { x1, y1, x2, y2 } = segment
  const { x, y } = originOf(segment)
  await expectBox(page, element, { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) })
  await expect(page.locator(element)).toHaveAttribute("data-points", relativePoints(segment))
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
}

async function drawArrow(page: Page, { x1, y1, x2, y2 }: Segment): Promise<void> {
  await pressAt(page, x1, y1)
  await moveTo(page, x2, y2)
  await page.mouse.up()
}

test("A draws an arrow right-to-left, drags its head, B mirrors each step and it persists", async ({ browser }) => {
  const session = await openSharedBoard(browser, "arrow")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("a")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 200, 220)
    const drawn = { x1: 400, y1: 300, x2: 200, y2: 220 }
    await expectSegment(pageB, drawPreview, drawn)
    await expect(pageB.locator(drawStroke)).toHaveAttribute("marker-end", headMarker)
    await expectArrows(pageB, 0)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      await expectArrow(page, drawn, 0)
      await expect(page.locator(drawPreview)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator('rect[data-handle="end"]')).toHaveCount(1)

    await pressAt(pageA, 200, 220)
    await moveTo(pageA, 250, 400)
    const edited = { x1: 400, y1: 300, x2: 250, y2: 400 }
    await expectSegment(pageB, element, edited)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectArrow(page, edited, 1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/arrow.png` })

    await pageB.reload()
    await expectArrow(pageB, edited, 1)
  } finally {
    await closeSession(session)
  }
})

test("the 5 shortcut draws an arrow whose head is at the end of the drag", async ({ browser }) => {
  const session = await openSharedBoard(browser, "arrow-digit")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("5")
    const drawn = { x1: 100, y1: 300, x2: 300, y2: 300 }
    await drawArrow(pageA, drawn)
    for (const page of [pageA, pageB]) await expectArrow(page, drawn, 0)
  } finally {
    await closeSession(session)
  }
})

test("an arrow is a translated wrapper: a move changes only the transform and an endpoint drag redraws it, arrowhead kept, in both browsers", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "arrow-move")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("a")
    const drawn = { x1: 100, y1: 300, x2: 260, y2: 200 }
    await drawArrow(pageA, drawn)
    for (const page of [pageA, pageB]) await expectArrow(page, drawn, 0)

    await pageA.keyboard.press("v")
    await pressAt(pageA, 180, 250)
    await moveTo(pageA, 380, 200)
    const moved = { x1: 300, y1: 250, x2: 460, y2: 150 }
    for (const page of [pageA, pageB]) {
      await expectSegment(page, element, moved)
      await expect(page.locator(stroke)).toHaveAttribute("marker-end", headMarker)
      await expect(page.locator(element)).toHaveAttribute("data-points", relativePoints(drawn))
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectArrow(page, moved, 1)

    await pressAt(pageA, 460, 150)
    await moveTo(pageA, 600, 90)
    const lengthened = { ...moved, x2: 600, y2: 90 }
    for (const page of [pageA, pageB]) {
      await expectSegment(page, element, lengthened)
      await expect(page.locator(stroke)).toHaveAttribute("marker-end", headMarker)
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectArrow(page, lengthened, 2)
  } finally {
    await closeSession(session)
  }
})
