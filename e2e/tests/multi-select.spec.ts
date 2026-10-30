import { expect, test, type Page } from "@playwright/test"
import { createBoard, openBoard } from "./support/board"
import { canvasPoint, clickAt, closeSession, moveTo, openSharedBoard, pressAt, type Session } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const viewport = "#canvas-viewport"
const elements = "#elements [data-element]"
const rectangle = '#elements [data-element][data-kind="rectangle"]'
const ellipse = '#elements [data-element][data-kind="ellipse"]'
const line = '#elements [data-element][data-kind="line"]'
const members = "#selection [data-selection-member]"
const groupOutline = "#selection [data-selection-group]"
const handles = "#selection [data-handle]"
const strokeGroup = '#style-panel [data-style-property="stroke_color"]'
const fillGroup = '#style-panel [data-style-property="fill_color"]'
const strokeRed = `${strokeGroup} button[data-style-value="red"]`
const strokeBlue = `${strokeGroup} button[data-style-value="blue"]`
const strokeInk = `${strokeGroup} button[data-style-value="ink"]`

interface Placed {
  id: string
  x: number
  y: number
  version: number
}

async function draw(page: Page, key: string, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press(key)
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
  await page.keyboard.press("v")
}

async function drawThreeKinds(page: Page): Promise<void> {
  await page.keyboard.press("r")
  await page.locator(strokeRed).click()
  await draw(page, "r", [100, 100], [200, 170])
  await page.keyboard.press("o")
  await page.locator(strokeInk).click()
  await draw(page, "o", [250, 100], [330, 170])
  await draw(page, "l", [380, 100], [460, 170])
}

async function marquee(page: Page, from: [number, number], to: [number, number], modifiers?: "Shift"): Promise<void> {
  if (modifiers !== undefined) await page.keyboard.down(modifiers)
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
  if (modifiers !== undefined) await page.keyboard.up(modifiers)
}

async function placed(page: Page, selector: string = elements): Promise<Placed[]> {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-element") ?? "",
      x: Number(node.getAttribute("data-x")),
      y: Number(node.getAttribute("data-y")),
      version: Number(node.getAttribute("data-version")),
    })),
  )
}

async function expectCount(pages: readonly Page[], selector: string, count: number): Promise<void> {
  for (const page of pages) await expect(page.locator(selector)).toHaveCount(count)
}

async function expectAt(page: Page, element: Placed, x: number, y: number, attribute: "data-x" | "x" = "data-x"): Promise<void> {
  const node = page.locator(`[data-element="${element.id}"]`)
  await expect(node).toHaveAttribute(attribute, String(x))
  await expect(node).toHaveAttribute(attribute === "x" ? "y" : "data-y", String(y))
}

async function expectNoSelectionShown(page: Page): Promise<void> {
  await expect(page.locator("#selection > *")).toHaveCount(0)
  await expect(page.locator("#marquee > *")).toHaveCount(0)
  await expect(page.locator(viewport)).not.toHaveAttribute("data-selected-element", /.*/)
  await expect(page.locator(viewport)).not.toHaveAttribute("data-selected-count", /.*/)
}

interface EventLog {
  events: string[]
}

function logPushedEvents(log: EventLog): (page: Page) => Promise<void> {
  return (page) => {
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const text = typeof payload === "string" ? payload : payload.toString()
        for (const match of text.matchAll(/\["(group_preview|group_cancel|preview|drag_cancel)",/g)) {
          if (match[1] !== undefined) log.events.push(match[1])
        }
      })
    })
    return Promise.resolve()
  }
}

test("A marquee-selects three kinds and drags them; B sees one batched preview stream, the commits and never the selection; one undo restores all", async ({
  browser,
}) => {
  const log: EventLog = { events: [] }
  const session = await openSharedBoard(browser, "multi-select-drag", logPushedEvents(log))
  const { pageA, pageB } = session
  try {
    await drawThreeKinds(pageA)
    await expectCount([pageA, pageB], elements, 3)
    const before = await placed(pageA)

    await marquee(pageA, [60, 60], [500, 220])
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "3")
    await expect(pageA.locator(members)).toHaveCount(3)
    await expect(pageA.locator(groupOutline)).toHaveCount(1)
    await expect(pageA.locator(handles)).toHaveCount(0)
    await expectNoSelectionShown(pageB)

    await pressAt(pageA, 150, 135)
    await moveTo(pageA, 250, 335)
    for (const element of before) await expectAt(pageB, element, element.x + 100, element.y + 200, "x")
    await expectNoSelectionShown(pageB)
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/group-preview-seen-by-b.png` })
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      for (const element of before) {
        await expectAt(page, element, element.x + 100, element.y + 200)
        await expect(page.locator(`[data-element="${element.id}"]`)).toHaveAttribute("data-version", String(element.version + 1))
      }
    }
    expect(log.events).toContain("group_preview")
    expect(log.events.filter((event) => event === "preview")).toEqual([])
    await expectNoSelectionShown(pageB)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/group-selected-by-a.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    for (const element of before) await expectAt(pageB, element, element.x, element.y)
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    for (const element of before) await expectAt(pageB, element, element.x + 100, element.y + 200)
  } finally {
    await closeSession(session)
  }
})

test("Shift+click toggles elements, Shift+marquee adds, Ctrl/Cmd+A selects all and Esc clears", async ({ browser }) => {
  const session = await openSharedBoard(browser, "multi-select-toggle")
  const { pageA, pageB } = session
  try {
    await drawThreeKinds(pageA)
    await expectCount([pageA], elements, 3)
    await clickAt(pageA, 150, 135)
    await expect(pageA.locator(handles)).toHaveCount(4)
    await pageA.keyboard.down("Shift")
    await clickAt(pageA, 290, 135)
    await pageA.keyboard.up("Shift")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "2")
    await expect(pageA.locator(handles)).toHaveCount(0)
    await pageA.keyboard.down("Shift")
    await clickAt(pageA, 150, 135)
    await pageA.keyboard.up("Shift")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "1")

    await marquee(pageA, [360, 60], [480, 120], "Shift")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "2")
    await pageA.keyboard.press("Escape")
    await expectNoSelectionShown(pageA)
    await pageA.keyboard.press("ControlOrMeta+a")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "3")
    await clickAt(pageA, 700, 500)
    await expectNoSelectionShown(pageA)
    await expectNoSelectionShown(pageB)
  } finally {
    await closeSession(session)
  }
})

test("B erases one element mid-drag: A's release commits the other two and reverts nothing else", async ({ browser }) => {
  const session = await openSharedBoard(browser, "multi-select-erase")
  const { pageA, pageB } = session
  try {
    await drawThreeKinds(pageA)
    await expectCount([pageA, pageB], elements, 3)
    const [rect, oval, stroke] = await placed(pageA)
    if (rect === undefined || oval === undefined || stroke === undefined) throw new Error("three elements expected")

    await pageA.keyboard.press("ControlOrMeta+a")
    await pressAt(pageA, 150, 135)
    await moveTo(pageA, 200, 235)
    await expectAt(pageB, oval, oval.x + 50, oval.y + 100, "x")

    await clickAt(pageB, 290 + 50, 135 + 100)
    await pageB.keyboard.press("Delete")
    await expectCount([pageA, pageB], ellipse, 0)

    await moveTo(pageA, 230, 255)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectAt(page, rect, rect.x + 80, rect.y + 120)
      await expectAt(page, stroke, stroke.x + 80, stroke.y + 120)
      await expect(page.locator(`[data-element="${rect.id}"]`)).toHaveAttribute("data-version", "1")
      await expect(page.locator(`[data-element="${stroke.id}"]`)).toHaveAttribute("data-version", "1")
    }
    await expect(pageA.locator("#flash-group")).not.toContainText("Could not move")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "2")
  } finally {
    await closeSession(session)
  }
})

test("Delete erases the whole selection as one entry and one undo brings every element back", async ({ browser }) => {
  const session = await openSharedBoard(browser, "multi-select-delete")
  const { pageA, pageB } = session
  try {
    await drawThreeKinds(pageA)
    await draw(pageA, "r", [100, 400], [200, 470])
    await expectCount([pageA, pageB], elements, 4)
    await marquee(pageA, [60, 60], [500, 220])
    await pageA.keyboard.press("Delete")
    await expectCount([pageA, pageB], elements, 1)
    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA, pageB], elements, 4)
    for (const selector of [rectangle, ellipse, line]) await expect(pageB.locator(selector)).not.toHaveCount(0)
    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA, pageB], elements, 3)
  } finally {
    await closeSession(session)
  }
})

test("restyling a group shows mixed values, applies to every element it fits as one undo entry", async ({ browser }) => {
  const session = await openSharedBoard(browser, "multi-select-style")
  const { pageA, pageB } = session
  try {
    await drawThreeKinds(pageA)
    await expectCount([pageA, pageB], elements, 3)
    await marquee(pageA, [60, 60], [500, 220])

    await expect(pageA.locator(strokeGroup)).toHaveAttribute("data-mixed", "")
    await expect(pageA.locator(`${strokeGroup} button[aria-pressed="true"]`)).toHaveCount(0)
    await expect(pageA.locator(fillGroup)).toBeVisible()
    await expect(pageA.locator(fillGroup)).not.toHaveAttribute("data-mixed", /.*/)
    if (evidenceDir !== undefined) await pageA.locator("#style-panel").screenshot({ path: `${evidenceDir}/mixed-stroke-colour.png` })

    await pageA.locator(strokeBlue).click()
    for (const selector of [rectangle, ellipse, line]) await expect(pageB.locator(selector)).toHaveAttribute("data-stroke-color", "blue")
    await expect(pageA.locator(strokeGroup)).not.toHaveAttribute("data-mixed", /.*/)
    await expect(pageA.locator(strokeBlue)).toHaveAttribute("aria-pressed", "true")
    await expect(pageB.locator(line)).toHaveAttribute("data-fill-color", "auto")

    await pageA.keyboard.press("ControlOrMeta+z")
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-stroke-color", "red")
    await expect(pageB.locator(ellipse)).toHaveAttribute("data-stroke-color", "ink")
    await expect(pageB.locator(line)).toHaveAttribute("data-stroke-color", "ink")
  } finally {
    await closeSession(session)
  }
})

async function offsets(page: Page): Promise<{ dx: number; dy: number }[]> {
  const [first, ...rest] = await placed(page)
  if (first === undefined) return []
  return rest.map(({ x, y }) => ({ dx: x - first.x, dy: y - first.y }))
}

test("a group copied on board 1 pastes on board 2 with its layout, selected, and B sees it", async ({ browser }) => {
  const session: Session = await openSharedBoard(browser, "multi-select-paste")
  const { pageA, contexts } = session
  try {
    await drawThreeKinds(pageA)
    await expectCount([pageA], elements, 3)
    const layout = await offsets(pageA)
    await pageA.keyboard.press("ControlOrMeta+a")
    await pageA.keyboard.press("ControlOrMeta+c")
    await expect.poll(() => pageA.evaluate(() => navigator.clipboard.readText())).toContain('"type":"sketch/elements"')

    const [contextA, contextB] = contexts
    if (contextA === undefined || contextB === undefined) throw new Error("contexts did not open")
    const second = await contextA.newPage()
    const path = await createBoard(second)
    const watcher = await contextB.newPage()
    await openBoard(watcher, path)
    const target = await canvasPoint(second, 900, 600)
    await second.mouse.move(target.x, target.y)
    await second.keyboard.press("ControlOrMeta+v")

    await expectCount([second, watcher], elements, 3)
    await expect(second.locator(viewport)).toHaveAttribute("data-selected-count", "3")
    expect(await offsets(watcher)).toEqual(layout)
    await expectNoSelectionShown(watcher)
    if (evidenceDir !== undefined) await watcher.screenshot({ path: `${evidenceDir}/pasted-group-seen-by-b.png` })
  } finally {
    await closeSession(session)
  }
})

test("a group dragged past the canvas edge stops as a whole and keeps its layout (the delta is clamped)", async ({ browser }) => {
  const session = await openSharedBoard(browser, "multi-select-edge")
  const { pageA, pageB } = session
  try {
    await draw(pageA, "r", [100, 100], [200, 170])
    await draw(pageA, "r", [300, 250], [380, 330])
    await expectCount([pageA, pageB], elements, 2)
    const [left, right] = await placed(pageA)
    if (left === undefined || right === undefined) throw new Error("two rectangles expected")

    await pageA.keyboard.press("ControlOrMeta+a")
    await pressAt(pageA, 340, 290)
    await moveTo(pageA, 1, 280)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      await expectAt(page, left, 0, left.y - 10)
      await expectAt(page, right, right.x - left.x, right.y - 10)
    }
  } finally {
    await closeSession(session)
  }
})
