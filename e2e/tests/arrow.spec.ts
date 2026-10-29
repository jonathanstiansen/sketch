import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, expectBox, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const element = 'g[data-element][data-kind="arrow"]'
const stroke = `${element} line[data-line-stroke]`
const drawPreview = "line[data-draw]"
const headMarker = "url(#arrowhead)"

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

async function expectArrows(page: Page, count: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(count)
}

async function expectArrow(page: Page, segment: Segment, version: number): Promise<void> {
  await expectArrows(page, 1)
  await expectSegment(page, stroke, segment)
  await expect(page.locator(stroke)).toHaveAttribute("marker-end", headMarker)
  const { x1, y1, x2, y2 } = segment
  const [x, y] = [Math.min(x1, x2), Math.min(y1, y2)]
  await expectBox(page, element, { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) })
  await expect(page.locator(element)).toHaveAttribute("data-points", relativePoints(segment, x, y))
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
    await expect(pageB.locator(drawPreview)).toHaveAttribute("marker-end", headMarker)
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
    await expectSegment(pageB, stroke, edited)
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
