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
const element = '[data-element][data-kind="line"]'
const drawPreview = '[data-draw][data-kind="line"]'
const handleSize = 10

function originOf({ x1, y1, x2, y2 }: Segment): { x: number; y: number } {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2) }
}

function localSegment(segment: Segment): Segment {
  const { x, y } = originOf(segment)
  return { x1: segment.x1 - x, y1: segment.y1 - y, x2: segment.x2 - x, y2: segment.y2 - y }
}

function pointsOf(segment: Segment): string {
  const { x1, y1, x2, y2 } = localSegment(segment)
  return `${String(x1)},${String(y1)} ${String(x2)},${String(y2)}`
}

async function expectDrawn(page: Page, wrapper: string, segment: Segment): Promise<void> {
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

async function expectLines(page: Page, count: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(count)
}

async function expectCommitted(page: Page, segment: Segment, version: number): Promise<void> {
  const { x1, y1, x2, y2 } = segment
  const { x, y } = originOf(segment)
  const wrapper = page.locator(element)
  await expect(wrapper).toHaveAttribute("data-version", String(version))
  await expect(wrapper).toHaveAttribute("data-x", String(x))
  await expect(wrapper).toHaveAttribute("data-y", String(y))
  await expect(wrapper).toHaveAttribute("data-width", String(Math.abs(x2 - x1)))
  await expect(wrapper).toHaveAttribute("data-height", String(Math.abs(y2 - y1)))
  await expect(wrapper).toHaveAttribute("data-points", pointsOf(segment))
}

async function expectLine(page: Page, segment: Segment, version: number): Promise<void> {
  await expectLines(page, 1)
  await expectDrawn(page, element, segment)
  const { x1, y1, x2, y2 } = segment
  await expectBox(page, element, { ...originOf(segment), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) })
  await expectCommitted(page, segment, version)
}

async function expectHandles(page: Page, { x1, y1, x2, y2 }: Segment): Promise<void> {
  for (const [name, x, y] of [
    ["start", x1, y1],
    ["end", x2, y2],
  ] as const) {
    const handle = page.locator(`rect[data-handle="${name}"]`)
    await expect(handle).toHaveAttribute("x", String(x - handleSize / 2))
    await expect(handle).toHaveAttribute("y", String(y - handleSize / 2))
  }
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
    await expectDrawn(pageB, drawPreview, drawn)
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
    await expectDrawn(pageB, element, edited)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, edited, 1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/line.png` })

    await pressAt(pageA, 325, 350)
    await moveTo(pageA, 425, 300)
    const moved = { x1: 500, y1: 250, x2: 350, y2: 350 }
    await expectDrawn(pageB, element, moved)
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
      const { x, y } = originOf(segment)
      await expectDrawn(pageB, `${element}[data-x="${String(x)}"][data-y="${String(y)}"]`, segment)
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

test("a line is a translated wrapper: a move changes only the transform and an endpoint drag redraws the line, in both browsers", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "line-move")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("l")
    await drawLine(pageA, { x1: 100, y1: 300, x2: 260, y2: 200 })
    const drawn = { x1: 100, y1: 300, x2: 260, y2: 200 }
    for (const page of [pageA, pageB]) await expectLine(page, drawn, 0)

    await pageA.keyboard.press("v")
    await pressAt(pageA, 180, 250)
    await moveTo(pageA, 380, 200)
    const moved = { x1: 300, y1: 250, x2: 460, y2: 150 }
    for (const page of [pageA, pageB]) {
      await expectDrawn(page, element, moved)
      await expectCommitted(page, drawn, 0)
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, moved, 1)

    await pressAt(pageA, 460, 150)
    await moveTo(pageA, 600, 90)
    const lengthened = { ...moved, x2: 600, y2: 90 }
    for (const page of [pageA, pageB]) {
      await expectDrawn(page, element, lengthened)
      await expectCommitted(page, moved, 1)
    }
    await expectHandles(pageA, lengthened)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, lengthened, 2)

    await pressAt(pageA, 300, 250)
    await moveTo(pageA, 700, 330)
    const swung = { ...lengthened, x1: 700, y1: 330 }
    for (const page of [pageA, pageB]) await expectDrawn(page, element, swung)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, swung, 3)
    await expectHandles(pageA, swung)
  } finally {
    await closeSession(session)
  }
})

test("a remote commit mid-endpoint-drag updates the committed points without snapping the dragged line, and Esc reverts to them", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "line-remote-commit")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("l")
    const drawn = { x1: 100, y1: 100, x2: 300, y2: 200 }
    await drawLine(pageA, drawn)
    for (const page of [pageA, pageB]) await expectLine(page, drawn, 0)

    await pageA.keyboard.press("v")
    await clickAt(pageA, 200, 150)
    await pressAt(pageA, 300, 200)
    await moveTo(pageA, 380, 260)
    const draggedByA = { ...drawn, x2: 380, y2: 260 }
    await expectDrawn(pageB, element, draggedByA)

    await clickAt(pageB, 110, 105)
    await expectDrawn(pageB, element, drawn)
    await pressAt(pageB, 100, 100)
    await moveTo(pageB, 60, 40)
    await pageB.mouse.up()
    const committedByB = { ...drawn, x1: 60, y1: 40 }
    await expectLine(pageB, committedByB, 1)

    await expectCommitted(pageA, committedByB, 1)
    await expectDrawn(pageA, element, draggedByA)
    await expectHandles(pageA, draggedByA)

    await pageA.keyboard.press("Escape")
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectLine(page, committedByB, 1)
  } finally {
    await closeSession(session)
  }
})
