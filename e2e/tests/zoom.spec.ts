import { readFileSync } from "node:fs"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { createBoard } from "./support/board"
import { closeSession, openSharedBoard } from "./support/canvas"

const viewport = "#canvas-viewport"
const svg = "#canvas"
const rectangle = '#elements [data-element][data-kind="rectangle"]'
const textElement = '#elements [data-element][data-kind="text"]'
const noteElement = '#elements [data-element][data-kind="note"]'
const editor = "textarea[data-text-editor]"
const selectedHandle = (name: string): string => `#selection [data-handle="${name}"]`
const remoteCursor = "#remote-cursors [data-cursor]"
const menu = "#export-menu"
const TOLERANCE = 2
const STROKE_ALLOWANCE = 8
const HANDLE_ON_SCREEN = 11.5

interface Spot {
  x: number
  y: number
}

interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

async function zoomOf(page: Page): Promise<number> {
  return Number(await page.locator(viewport).getAttribute("data-zoom") ?? "1")
}

async function expectZoom(page: Page, zoom: number): Promise<void> {
  await expect.poll(() => zoomOf(page)).toBeCloseTo(zoom, 5)
}

async function setZoom(page: Page, zoom: number): Promise<void> {
  await page.keyboard.press("Control+0")
  const key = zoom > 1 ? "Control+=" : "Control+-"
  const steps = zoom === 1 ? 0 : { 2: 2, 0.5: 2 }[zoom]
  if (steps === undefined) throw new Error(`no steps to reach ${String(zoom)}`)
  for (let step = 0; step < steps; step += 1) await page.keyboard.press(key)
  await expectZoom(page, zoom)
  await scrollHome(page)
}

async function scrollHome(page: Page): Promise<void> {
  await page.locator(viewport).evaluate((el) => {
    el.scrollTo(0, 0)
  })
  await expect.poll(() => page.locator(viewport).evaluate((el) => el.scrollLeft + el.scrollTop)).toBe(0)
}

async function screenAt(page: Page, x: number, y: number): Promise<Spot> {
  const box = await page.locator(svg).boundingBox()
  if (box === null) throw new Error("canvas is not visible")
  const zoom = await zoomOf(page)
  return { x: box.x + x * zoom, y: box.y + y * zoom }
}

async function dragCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const start = await screenAt(page, ...from)
  const end = await screenAt(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 20 })
  await page.mouse.up()
}

async function dragScreen(page: Page, from: Spot, byX: number, byY: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + byX, from.y + byY, { steps: 20 })
  await page.mouse.up()
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const before = await page.locator(rectangle).count()
  await page.keyboard.press("r")
  await dragCanvas(page, from, to)
  await expect(page.locator(rectangle)).toHaveCount(before + 1)
  await page.keyboard.press("v")
}

async function boxOf(locator: Locator): Promise<CanvasBox> {
  const read = async (name: string): Promise<number> => Number(await locator.getAttribute(name))
  return { x: await read("x"), y: await read("y"), width: await read("width"), height: await read("height") }
}

async function expectBoxNear(locator: Locator, expected: CanvasBox, tolerance = TOLERANCE): Promise<void> {
  await expect
    .poll(async () => {
      const box = await boxOf(locator)
      return Math.max(
        Math.abs(box.x - expected.x),
        Math.abs(box.y - expected.y),
        Math.abs(box.width - expected.width),
        Math.abs(box.height - expected.height),
      )
    })
    .toBeLessThanOrEqual(tolerance)
}

async function expectCommittedNear(locator: Locator, expected: CanvasBox, tolerance = TOLERANCE): Promise<void> {
  await expect
    .poll(async () => {
      const read = async (name: string): Promise<number> => Number(await locator.getAttribute(`data-${name}`))
      return Math.max(
        Math.abs((await read("x")) - expected.x),
        Math.abs((await read("y")) - expected.y),
        Math.abs((await read("width")) - expected.width),
        Math.abs((await read("height")) - expected.height),
      )
    })
    .toBeLessThanOrEqual(tolerance)
}

async function center(locator: Locator): Promise<Spot> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error("element is not visible")
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function cursorSpot(page: Page, name: string): Promise<Spot> {
  const transform = (await page.locator(`${remoteCursor}[data-name="${name}"]`).getAttribute("transform")) ?? ""
  const [x = NaN, y = NaN] = (/translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform) ?? []).slice(1).map(Number)
  return { x, y }
}

async function viewerName(page: Page): Promise<string> {
  return (await page.locator("#viewer-name .font-semibold").innerText()).trim()
}

async function downloadSvg(page: Page): Promise<string> {
  if (!(await page.locator(menu).isVisible())) {
    await page.locator("#export-button").click()
    await expect(page.locator(menu)).toBeVisible()
  }
  const download = page.waitForEvent("download")
  await page.locator(`${menu} [data-export-action="download_svg"]`).click()
  return readFileSync(await (await download).path(), "utf8")
}

for (const zoom of [2, 0.5]) {
  test(`at ${String(zoom * 100)}% a dragged rectangle gets the canvas box under the pointer, and B at 100% sees it there`, async ({ browser }) => {
    const session = await openSharedBoard(browser, `zoom-draw-${String(zoom)}`)
    const { pageA, pageB } = session
    try {
      await setZoom(pageA, zoom)
      await drawRectangle(pageA, [100, 80], [260, 170])
      await expectBoxNear(pageA.locator(rectangle), { x: 100, y: 80, width: 160, height: 90 })
      await expectCommittedNear(pageA.locator(rectangle), { x: 100, y: 80, width: 160, height: 90 })
      await expectCommittedNear(pageB.locator(rectangle), { x: 100, y: 80, width: 160, height: 90 })
      const seenByB = await pageB.locator(rectangle).boundingBox()
      const canvasB = await pageB.locator(svg).boundingBox()
      expect(Math.abs((seenByB?.x ?? NaN) - ((canvasB?.x ?? NaN) + 100))).toBeLessThanOrEqual(STROKE_ALLOWANCE)
      expect(Math.abs((seenByB?.y ?? NaN) - ((canvasB?.y ?? NaN) + 80))).toBeLessThanOrEqual(STROKE_ALLOWANCE)
      expect(await zoomOf(pageB)).toBe(1)
    } finally {
      await closeSession(session)
    }
  })
}

for (const zoom of [0.5, 2]) {
  test(`at ${String(zoom * 100)}% moving and resizing commit the canvas coordinates`, async ({ browser }) => {
    const session = await openSharedBoard(browser, `zoom-edit-${String(zoom)}`)
    const { pageA, pageB } = session
    try {
      await setZoom(pageA, zoom)
      await drawRectangle(pageA, [100, 80], [260, 170])
      const shape = pageA.locator(rectangle)
      await dragScreen(pageA, await center(shape), 60 * zoom, 40 * zoom)
      const moved = { x: 160, y: 120, width: 160, height: 90 }
      await expectCommittedNear(shape, moved)
      await expectCommittedNear(pageB.locator(rectangle), moved)

      await dragScreen(pageA, await center(pageA.locator(selectedHandle("se"))), 40 * zoom, 30 * zoom)
      const resized = { x: 160, y: 120, width: 200, height: 120 }
      await expectCommittedNear(shape, resized)
      await expectCommittedNear(pageB.locator(rectangle), resized)

      await dragScreen(pageA, await center(pageA.locator(selectedHandle("nw"))), 20 * zoom, 10 * zoom)
      await expectCommittedNear(pageB.locator(rectangle), { x: 180, y: 130, width: 180, height: 110 })
    } finally {
      await closeSession(session)
    }
  })
}

test("at 50% a line's endpoint drag and an eraser stroke use canvas coordinates", async ({ browser }) => {
  const session = await openSharedBoard(browser, "zoom-line")
  const { pageA, pageB } = session
  try {
    await setZoom(pageA, 0.5)
    await pageA.keyboard.press("l")
    await dragCanvas(pageA, [200, 200], [600, 200])
    await pageA.keyboard.press("v")
    const line = pageA.locator('#elements [data-element][data-kind="line"]')
    await expect(line).toHaveCount(1)
    await expectCommittedNear(pageB.locator('#elements [data-element][data-kind="line"]'), { x: 200, y: 200, width: 400, height: 0 })
    const middle = await screenAt(pageA, 400, 200)
    await pageA.mouse.click(middle.x, middle.y)
    await dragScreen(pageA, await center(pageA.locator(selectedHandle("end"))), 0, 100)
    await expectCommittedNear(pageB.locator('#elements [data-element][data-kind="line"]'), { x: 200, y: 200, width: 400, height: 200 })

    await pageA.keyboard.press("e")
    await dragCanvas(pageA, [100, 300], [700, 300])
    await expect(pageA.locator("#elements [data-element]")).toHaveCount(0)
    await expect(pageB.locator("#elements [data-element]")).toHaveCount(0)
  } finally {
    await closeSession(session)
  }
})

for (const zoom of [2, 0.5]) {
  test(`a line's hit area stays 14px wide on screen at ${String(zoom * 100)}%`, async ({ page }) => {
    await createBoard(page)
    await setZoom(page, zoom)
    await page.keyboard.press("l")
    await dragCanvas(page, [100, 100], [300, 100])
    await page.keyboard.press("v")
    await expect(page.locator('#elements [data-kind="line"]')).toHaveCount(1)
    const middle = await screenAt(page, 200, 100)
    const hits = (offset: number): Promise<boolean> =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-element]") != null,
        { x: middle.x, y: middle.y + offset },
      )
    expect(await hits(4)).toBe(true)
    expect(await hits(-4)).toBe(true)
    expect(await hits(10)).toBe(false)
    expect(await hits(-10)).toBe(false)
  })
}

test("Ctrl+wheel and pinch zoom around the pointer, so the canvas point under it stays under it", async ({ page }) => {
  await createBoard(page)
  await drawRectangle(page, [300, 200], [500, 320])
  const anchor = await screenAt(page, 400, 260)
  await page.mouse.move(anchor.x, anchor.y)

  const startZoom = await zoomOf(page)
  await page.keyboard.down("Control")
  for (const delta of [-200, -200, -200, 200, 200]) {
    await page.mouse.wheel(0, delta)
    await expect.poll(() => zoomOf(page)).not.toBe(startZoom)
    const under = await screenAt(page, 400, 260)
    expect(Math.abs(under.x - anchor.x)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(under.y - anchor.y)).toBeLessThanOrEqual(1.5)
    await page.mouse.move(anchor.x, anchor.y)
  }
  await page.keyboard.up("Control")
  expect(await zoomOf(page)).toBeGreaterThan(startZoom)
})

test("a plain wheel scrolls and does not zoom", async ({ page }) => {
  await createBoard(page)
  await page.mouse.move(400, 400)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => page.locator(viewport).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await zoomOf(page)).toBe(1)
})

test("the keys and the zoom control step through the levels, clamp at 10% and 400%, and reset", async ({ page }) => {
  await createBoard(page)
  const level = page.locator("#zoom-level")
  await expect(level).toHaveText("100%")
  await page.keyboard.press("Control+=")
  await expect(level).toHaveText("150%")
  await page.keyboard.press("Control+Shift+=")
  await expect(level).toHaveText("200%")
  await page.keyboard.press("Control+-")
  await expect(level).toHaveText("150%")
  await page.locator("#zoom-reset").click()
  await expect(level).toHaveText("100%")
  await page.locator("#zoom-in").click()
  await expect(level).toHaveText("150%")
  await page.locator("#zoom-out").click()
  await page.locator("#zoom-out").click()
  await expect(level).toHaveText("75%")
  await page.keyboard.press("Control+0")
  await expect(level).toHaveText("100%")

  for (let step = 0; step < 10; step += 1) await page.keyboard.press("Control+=")
  await expect(level).toHaveText("400%")
  await expect(page.locator(svg)).toHaveAttribute("width", "16000")
  for (let step = 0; step < 12; step += 1) await page.keyboard.press("Control+-")
  await expect(level).toHaveText("10%")
  await expect(page.locator(svg)).toHaveAttribute("width", "400")
  await expect(page.locator(svg)).toHaveAttribute("viewBox", "0 0 4000 4000")
})

test("the browser's page zoom is prevented for the zoom keys", async ({ page }) => {
  await createBoard(page)
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { unprevented: seen })
    window.addEventListener("keydown", (event) => {
      if (["=", "-", "0", "!", "1"].includes(event.key) && !event.defaultPrevented) seen.push(event.key)
    })
  })
  for (const key of ["Control+=", "Control+-", "Control+0", "Shift+1"]) await page.keyboard.press(key)
  await expect(page.locator("#zoom-level")).toHaveText("100%")
  expect(await page.evaluate(() => Reflect.get(window, "unprevented") as string[])).toEqual([])
})

test("zoom is local: B's view does not change when A zooms, and nothing is stored", async ({ browser }) => {
  const session = await openSharedBoard(browser, "zoom-local")
  const { pageA, pageB } = session
  try {
    await setZoom(pageA, 2)
    await expect(pageA.locator(svg)).toHaveAttribute("width", "8000")
    expect(await zoomOf(pageB)).toBe(1)
    await expect(pageB.locator(svg)).toHaveAttribute("width", "4000")
    await pageA.reload()
    await expect(pageA.locator("[data-phx-main].phx-connected")).toBeVisible()
    expect(await zoomOf(pageA)).toBe(1)
  } finally {
    await closeSession(session)
  }
})

test("Shift+1 fits every element in view, and an empty board goes to 100%", async ({ page }) => {
  await createBoard(page)
  await page.keyboard.press("Control+=")
  await page.keyboard.press("Shift+1")
  await expectZoom(page, 1)

  await setZoom(page, 0.5)
  await drawRectangle(page, [100, 100], [260, 180])
  await drawRectangle(page, [1600, 700], [1760, 780])
  await page.keyboard.press("Control+0")
  await scrollHome(page)
  await page.keyboard.press("Shift+1")

  const size = await page.locator(viewport).evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }))
  const expected = Math.min(size.width / (1760 - 100 + 96), size.height / (780 - 100 + 96))
  await expect.poll(() => zoomOf(page)).toBeCloseTo(expected, 2)
  const view = await page.locator(viewport).boundingBox()
  if (view === null) throw new Error("viewport is not visible")
  for (const shape of await page.locator(rectangle).all()) {
    const box = await shape.boundingBox()
    if (box === null) throw new Error("rectangle is not visible")
    expect(box.x).toBeGreaterThanOrEqual(view.x)
    expect(box.y).toBeGreaterThanOrEqual(view.y)
    expect(box.x + box.width).toBeLessThanOrEqual(view.x + size.width)
    expect(box.y + box.height).toBeLessThanOrEqual(view.y + size.height)
  }
})

for (const zoom of [2, 0.5]) {
  test(`selection handles keep a constant 10px screen size at ${String(zoom * 100)}%`, async ({ page }) => {
    await createBoard(page)
    await setZoom(page, zoom)
    await drawRectangle(page, [100, 80], [300, 200])
    const shape = page.locator(rectangle)
    await dragScreen(page, await center(shape), 0, 0)
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const box = await page.locator(selectedHandle(corner)).boundingBox()
      expect(Math.abs((box?.width ?? NaN) - HANDLE_ON_SCREEN)).toBeLessThanOrEqual(1)
      expect(Math.abs((box?.height ?? NaN) - HANDLE_ON_SCREEN)).toBeLessThanOrEqual(1)
    }
  })
}

test("the text editor opens at the clicked spot, at the zoomed scale, at 200%", async ({ browser }) => {
  const session = await openSharedBoard(browser, "zoom-text")
  const { pageA, pageB } = session
  try {
    await setZoom(pageA, 2)
    await pageA.keyboard.press("t")
    const at = await screenAt(pageA, 150, 120)
    await pageA.mouse.click(at.x, at.y)
    const textarea = pageA.locator(editor)
    await expect(textarea).toBeVisible()
    const box = await textarea.boundingBox()
    expect(Math.abs((box?.x ?? NaN) - at.x)).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs((box?.y ?? NaN) - at.y)).toBeLessThanOrEqual(TOLERANCE)
    const scale = await textarea.evaluate((el) => el.getBoundingClientRect().height / (el as HTMLElement).offsetHeight)
    expect(scale).toBeCloseTo(2, 2)
    await pageA.keyboard.type("zoomed")
    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(textElement)).toHaveCount(1)
    await expect(pageB.locator(textElement)).toHaveCount(1)
    const placed = await boxOf(pageB.locator(textElement))
    expect(Math.abs(placed.x - 150)).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs(placed.y - 120)).toBeLessThanOrEqual(TOLERANCE)
  } finally {
    await closeSession(session)
  }
})

test("the note editor sits inside its note at 200%", async ({ page }) => {
  await createBoard(page)
  await setZoom(page, 2)
  await page.keyboard.press("n")
  await dragCanvas(page, [60, 40], [260, 160])
  const textarea = page.locator(editor)
  await expect(textarea).toBeVisible()
  const note = page.locator(`${svg} [data-draw][data-kind="note"]`)
  const noteBox = await note.boundingBox()
  const editorBox = await textarea.boundingBox()
  if (noteBox === null || editorBox === null) throw new Error("note or editor is not visible")
  expect(editorBox.x).toBeGreaterThanOrEqual(noteBox.x)
  expect(editorBox.y).toBeGreaterThanOrEqual(noteBox.y)
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width + 1)
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 1)
  await page.keyboard.type("note")
  await page.keyboard.press("Escape")
  await expect(page.locator(noteElement)).toHaveCount(1)
  await expectCommittedNear(page.locator(noteElement), { x: 60, y: 40, width: 200, height: 120 })
})

test("a remote cursor from A at 100% appears at the right canvas point in B at 200%, and the other way round", async ({ browser }) => {
  const session = await openSharedBoard(browser, "zoom-cursor")
  const { pageA, pageB } = session
  try {
    await setZoom(pageB, 2)
    const nameA = await viewerName(pageA)
    const nameB = await viewerName(pageB)
    const fromA = await screenAt(pageA, 600, 300)
    await pageA.mouse.move(fromA.x, fromA.y, { steps: 5 })
    await expect
      .poll(async () => {
        const spot = await cursorSpot(pageB, nameA).catch(() => ({ x: NaN, y: NaN }))
        return Math.max(Math.abs(spot.x - 600), Math.abs(spot.y - 300))
      })
      .toBeLessThanOrEqual(1)
    const arrow = await pageB.evaluate((name) => {
      const tip = document.querySelector(`#remote-cursors [data-name="${name}"] .remote-cursor-arrow`)
      const canvas = document.querySelector("#canvas")
      if (tip === null || canvas === null) throw new Error("cursor or canvas missing")
      return { x: tip.getBoundingClientRect().left - canvas.getBoundingClientRect().left, width: tip.getBoundingClientRect().width }
    }, nameA)
    expect(Math.abs(arrow.x - 1200)).toBeLessThanOrEqual(2)
    expect(arrow.width).toBeLessThan(20)

    const fromB = await screenAt(pageB, 400, 150)
    await pageB.mouse.move(fromB.x, fromB.y, { steps: 5 })
    await expect
      .poll(async () => {
        const spot = await cursorSpot(pageA, nameB).catch(() => ({ x: NaN, y: NaN }))
        return Math.max(Math.abs(spot.x - 400), Math.abs(spot.y - 150))
      })
      .toBeLessThanOrEqual(1)
  } finally {
    await closeSession(session)
  }
})

test("a remote draw preview from A at 50% is in the right canvas place for B at 200%", async ({ browser }) => {
  const session = await openSharedBoard(browser, "zoom-preview")
  const { pageA, pageB } = session
  try {
    await setZoom(pageA, 0.5)
    await setZoom(pageB, 2)
    await pageA.keyboard.press("r")
    const start = await screenAt(pageA, 100, 80)
    const end = await screenAt(pageA, 260, 170)
    await pageA.mouse.move(start.x, start.y)
    await pageA.mouse.down()
    await pageA.mouse.move(end.x, end.y, { steps: 10 })
    const preview = pageB.locator("#draw-previews [data-draw]")
    await expect(preview).toHaveCount(1)
    await expectBoxNear(preview, { x: 100, y: 80, width: 160, height: 90 })
    await pageA.mouse.up()
  } finally {
    await closeSession(session)
  }
})

test("export at 200% and at 50% is the same file as at 100%", async ({ page }) => {
  await createBoard(page)
  await drawRectangle(page, [120, 100], [320, 230])
  await page.keyboard.press("o")
  await dragCanvas(page, [400, 120], [560, 240])
  await page.keyboard.press("v")
  await expect(page.locator("#elements [data-element]")).toHaveCount(2)
  const atHundred = await downloadSvg(page)
  expect(atHundred).toContain("<svg")
  await setZoom(page, 2)
  expect(await downloadSvg(page)).toBe(atHundred)
  await setZoom(page, 0.5)
  expect(await downloadSvg(page)).toBe(atHundred)
})

test("the shortcuts help lists the zoom shortcuts from the registry", async ({ page }) => {
  await createBoard(page)
  await page.keyboard.press("?")
  await expect(page.locator("#shortcut-zoom_in kbd")).toHaveText(["Ctrl/⌘", "+"])
  await expect(page.locator("#shortcut-zoom_out kbd")).toHaveText(["Ctrl/⌘", "-"])
  await expect(page.locator("#shortcut-zoom_reset kbd")).toHaveText(["Ctrl/⌘", "0"])
  await expect(page.locator("#shortcut-zoom_fit kbd")).toHaveText(["Shift", "1"])
})
