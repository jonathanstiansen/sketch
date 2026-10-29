import { expect, test, type Page } from "@playwright/test"
import { canvasPoint, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const element = 'g[data-element][data-kind="freedraw"]'
const stroke = `${element} polyline[data-freedraw-stroke]`
const drawPreview = "polyline[data-draw]"

interface Pair {
  x: number
  y: number
}

interface Stroke {
  box: { x: number; y: number; width: number; height: number }
  points: Pair[]
  version: number
}

function parsePairs(value: string | null): Pair[] {
  if (value === null || value === "") return []
  return value.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number)
    return { x: x ?? Number.NaN, y: y ?? Number.NaN }
  })
}

async function readStroke(page: Page): Promise<Stroke> {
  const group = page.locator(element)
  const number = async (name: string): Promise<number> => Number(await group.getAttribute(name))
  return {
    box: { x: await number("x"), y: await number("y"), width: await number("width"), height: await number("height") },
    points: parsePairs(await group.getAttribute("data-points")),
    version: await number("data-version"),
  }
}

async function previewCount(page: Page): Promise<number> {
  return parsePairs(await page.locator(drawPreview).getAttribute("points")).length
}

async function expectStroke(page: Page, version: number): Promise<Stroke> {
  await expect(page.locator(element)).toHaveCount(1)
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
  const shape = await readStroke(page)
  const rendered = parsePairs(await page.locator(stroke).getAttribute("points"))
  expect(rendered).toEqual(shape.points.map(({ x, y }) => ({ x: x + shape.box.x, y: y + shape.box.y })))
  for (const { x, y } of shape.points) {
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(shape.box.width)
    expect(y).toBeLessThanOrEqual(shape.box.height)
  }
  return shape
}

function wave(from: number, to: number): Pair[] {
  const xs = Array.from({ length: Math.floor((to - from) / 10) + 1 }, (_, index) => from + index * 10)
  return xs.map((x) => ({ x, y: Math.round(300 + 50 * Math.sin((x - 300) / 25)) }))
}

async function trace(page: Page, path: Pair[]): Promise<void> {
  for (const { x, y } of path) await moveTo(page, x, y)
}

test("A draws a curvy stroke that B watches grow, then moves and resizes it and it persists", async ({ browser }) => {
  const session = await openSharedBoard(browser, "draw")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("p")
    const first = wave(300, 420)
    const second = wave(430, 600)
    const start = first[0]
    if (start === undefined) throw new Error("empty path")
    await pressAt(pageA, start.x, start.y)
    await trace(pageA, first)

    await expect.poll(() => previewCount(pageB)).toBeGreaterThanOrEqual(3)
    const early = await previewCount(pageB)
    await expect(pageB.locator(element)).toHaveCount(0)

    await trace(pageA, second)
    await expect.poll(() => previewCount(pageB)).toBeGreaterThan(early)
    await pageA.mouse.up()

    const drawn = await expectStroke(pageA, 0)
    expect(drawn.points.length).toBeGreaterThan(early)
    expect(drawn.points.length).toBeLessThanOrEqual(500)
    expect(drawn.box.height).toBeGreaterThan(40)
    expect(await expectStroke(pageB, 0)).toEqual(drawn)
    for (const page of [pageA, pageB]) await expect(page.locator(drawPreview)).toHaveCount(0)
    await expect(pageA.locator(stroke)).toHaveAttribute("stroke-linejoin", "round")
    await expect(pageA.locator(stroke)).toHaveAttribute("stroke-linecap", "round")

    await pageA.keyboard.press("v")
    await pressAt(pageA, start.x, start.y)
    await moveTo(pageA, start.x + 100, start.y + 60)
    await pageA.mouse.up()
    const moved = await expectStroke(pageA, 1)
    expect(moved.box).toEqual({ ...drawn.box, x: drawn.box.x + 100, y: drawn.box.y + 60 })
    expect(moved.points).toEqual(drawn.points)
    expect(await expectStroke(pageB, 1)).toEqual(moved)

    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    await expect(pageA.locator("rect[data-selection-outline]")).toHaveCount(1)
    const corner = { x: moved.box.x + moved.box.width, y: moved.box.y + moved.box.height }
    await pressAt(pageA, corner.x, corner.y)
    await moveTo(pageA, corner.x + 80, corner.y + 40)
    await pageA.mouse.up()
    const resized = await expectStroke(pageA, 2)
    expect(resized.box).toEqual({ ...moved.box, width: moved.box.width + 80, height: moved.box.height + 40 })
    expect(resized.points).toEqual(
      moved.points.map(({ x, y }) => ({
        x: Math.round((x * resized.box.width) / moved.box.width),
        y: Math.round((y * resized.box.height) / moved.box.height),
      })),
    )
    expect(await expectStroke(pageB, 2)).toEqual(resized)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/draw.png` })

    await pageB.reload()
    expect(await expectStroke(pageB, 2)).toEqual(resized)
  } finally {
    await closeSession(session)
  }
})

test("the 7 shortcut draws; a click, Esc and a cancelled stroke create nothing", async ({ browser }) => {
  const session = await openSharedBoard(browser, "draw-cancel")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("7")
    const click = await canvasPoint(pageA, 200, 200)
    await pageA.mouse.click(click.x, click.y)

    await pressAt(pageA, 200, 200)
    await moveTo(pageA, 260, 240)
    await moveTo(pageA, 320, 200)
    await expect.poll(() => previewCount(pageB)).toBeGreaterThanOrEqual(3)
    await pageA.keyboard.press("Escape")
    await pageA.mouse.up()
    await expect(pageB.locator(drawPreview)).toHaveCount(0)
    await expect(pageA.locator(drawPreview)).toHaveCount(0)

    await pageA.keyboard.press("p")
    await pressAt(pageA, 200, 400)
    await moveTo(pageA, 300, 460)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expect(page.locator(element)).toHaveCount(1)
  } finally {
    await closeSession(session)
  }
})
