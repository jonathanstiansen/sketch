import { expect, test, type Locator, type Page } from "@playwright/test"
import { createBoard, openBoard } from "./support/board"
import { canvasPoint, clickAt, closeSession, moveTo, openSharedBoard, pressAt, type Session } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const viewport = "#canvas-viewport"
const elements = "#elements [data-element]"
const arrow = '#elements [data-element][data-kind="arrow"]'
const rectangle = '#elements [data-element][data-kind="rectangle"]'
const textElement = '#elements [data-element][data-kind="text"]'
const editor = "textarea[data-text-editor]"
const status = "#history-status"
const strokeRed = '#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]'
const strokeBold = '#style-panel [data-style-property="stroke_width"] button[data-style-value="bold"]'
const strokeDashed = '#style-panel [data-style-property="stroke_style"] button[data-style-value="dashed"]'
const CONTENT = [
  "data-kind",
  "data-width",
  "data-height",
  "data-points",
  "data-text",
  "data-seed",
  "data-stroke-color",
  "data-fill-color",
  "data-stroke-width",
  "data-stroke-style",
] as const

async function attributes(locator: Locator, names: readonly string[]): Promise<Record<string, string | null>> {
  return locator.evaluate((node, wanted) => Object.fromEntries(wanted.map((name) => [name, node.getAttribute(name)])), [...names])
}

async function position(locator: Locator): Promise<{ x: number; y: number }> {
  const { "data-x": x, "data-y": y } = await attributes(locator, ["data-x", "data-y"])
  return { x: Number(x), y: Number(y) }
}

async function drawStyledArrow(page: Page): Promise<void> {
  await page.keyboard.press("a")
  await page.locator(strokeRed).click()
  await page.locator(strokeBold).click()
  await page.locator(strokeDashed).click()
  await pressAt(page, 200, 200)
  await moveTo(page, 320, 260)
  await page.mouse.up()
  await page.keyboard.press("v")
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press("r")
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
  await page.keyboard.press("v")
}

async function expectCount(pages: readonly Page[], selector: string, count: number): Promise<void> {
  for (const page of pages) await expect(page.locator(selector)).toHaveCount(count)
}

async function selectedId(page: Page): Promise<string> {
  await expect(page.locator(viewport)).toHaveAttribute("data-selected-element", /.+/)
  return (await page.locator(viewport).getAttribute("data-selected-element")) ?? ""
}

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function writeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
}

async function openSecondBoard(session: Session): Promise<{ path: string; first: Page; watcher: Page }> {
  const [contextA, contextB] = session.contexts
  if (contextA === undefined || contextB === undefined) throw new Error("contexts did not open")
  const first = await contextA.newPage()
  const path = await createBoard(first)
  const watcher = await contextB.newPage()
  await openBoard(watcher, path)
  return { path, first, watcher }
}

test("Ctrl/Cmd+D duplicates a styled arrow identically, offset by 10, selects the copy, and undo removes only the copy", async ({ browser }) => {
  const session = await openSharedBoard(browser, "duplicate")
  const { pageA, pageB } = session
  try {
    await drawStyledArrow(pageA)
    await expectCount([pageA, pageB], arrow, 1)
    await clickAt(pageA, 260, 230)
    const originalId = await selectedId(pageA)

    await pageA.keyboard.press("ControlOrMeta+d")
    await expectCount([pageA, pageB], arrow, 2)

    for (const page of [pageA, pageB]) {
      const original = page.locator(`[data-element="${originalId}"]`)
      const copy = page.locator(`${arrow}:not([data-element="${originalId}"])`)
      expect(await attributes(copy, CONTENT)).toEqual(await attributes(original, CONTENT))
      const [from, to] = [await position(original), await position(copy)]
      expect(to).toEqual({ x: from.x + 10, y: from.y + 10 })
      await expect(copy).toHaveAttribute("data-stroke-color", "red")
      await expect(copy).toHaveAttribute("data-stroke-style", "dashed")
    }
    const copyId = await pageA.locator(`${arrow}:not([data-element="${originalId}"])`).getAttribute("data-element")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-element", copyId ?? "")
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/duplicate-seen-by-b.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA, pageB], arrow, 1)
    await expect(pageB.locator(`[data-element="${originalId}"]`)).toHaveCount(1)
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expectCount([pageA, pageB], arrow, 2)
  } finally {
    await closeSession(session)
  }
})

test("Ctrl/Cmd+C on board 1 pastes on board 2 at the pointer; B sees it; undo removes it; cut erases and undo restores", async ({ browser }) => {
  const session = await openSharedBoard(browser, "paste")
  const { pageA } = session
  try {
    await drawStyledArrow(pageA)
    await expectCount([pageA], arrow, 1)
    await clickAt(pageA, 260, 230)
    await pageA.keyboard.press("ControlOrMeta+c")
    await expect.poll(() => clipboardText(pageA)).toContain('"type":"sketch/elements"')
    const envelope: unknown = JSON.parse(await clipboardText(pageA))
    expect(envelope).toMatchObject({
      type: "sketch/elements",
      version: 1,
      elements: [{ kind: "arrow", width: 120, height: 60, stroke_color: "red", stroke_width: "bold", stroke_style: "dashed" }],
    })
    await expectCount([pageA], arrow, 1)

    const board2 = await openSecondBoard(session)
    const { first: pageA2, watcher: pageB2 } = board2
    await pageA2.bringToFront()
    const target = await canvasPoint(pageA2, 600, 400)
    await pageA2.mouse.move(target.x, target.y)
    await pageA2.keyboard.press("ControlOrMeta+v")
    await expectCount([pageA2, pageB2], arrow, 1)
    for (const page of [pageA2, pageB2]) {
      const pasted = page.locator(arrow)
      expect(await position(pasted)).toEqual({ x: 540, y: 370 })
      await expect(pasted).toHaveAttribute("data-stroke-color", "red")
      await expect(pasted).toHaveAttribute("data-stroke-style", "dashed")
    }
    await expect(pageA2.locator(viewport)).toHaveAttribute("data-selected-element", /.+/)
    if (evidenceDir !== undefined) await pageB2.screenshot({ path: `${evidenceDir}/pasted-on-board-2-seen-by-b.png` })

    await pageA2.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA2, pageB2], arrow, 0)
    await expectCount([pageA], arrow, 1)

    await pageA.bringToFront()
    await clickAt(pageA, 260, 230)
    await pageA.keyboard.press("ControlOrMeta+x")
    await expectCount([pageA], arrow, 0)
    await expect.poll(() => clipboardText(pageA)).toContain('"kind":"arrow"')
    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA], arrow, 1)
    await expect(pageA.locator(arrow)).toHaveAttribute("data-stroke-color", "red")
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expectCount([pageA], arrow, 0)

    await pageA2.bringToFront()
    await pageA2.keyboard.press("ControlOrMeta+v")
    await expectCount([pageA2, pageB2], arrow, 1)
  } finally {
    await closeSession(session)
  }
})

test("pasting arbitrary text makes a text element at the pointer; text that does not fit and malformed envelopes do nothing", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "paste-text")
  const { pageA, pageB } = session
  try {
    const target = await canvasPoint(pageA, 300, 300)
    await pageA.mouse.move(target.x, target.y)
    await writeClipboard(pageA, "hello from the clipboard\nsecond line")
    await pageA.keyboard.press("ControlOrMeta+v")
    await expectCount([pageA, pageB], textElement, 1)
    for (const page of [pageA, pageB]) {
      await expect(page.locator(textElement)).toHaveAttribute("data-text", "hello from the clipboard\nsecond line")
      expect(await position(page.locator(textElement))).toEqual({ x: 300, y: 300 })
    }

    const malformed = [
      '{"type":"sketch/elements","version":1,"elements":[{"kind":"bogus","x":1,"y":1,"width":1,"height":1}]}',
      '{"type":"sketch/elements","version":2,"elements":[]}',
      '{"type":"sketch/elements","version":1,"elements":[{"kind":"rectangle","x":-5,"y":0,"width":10,"height":10,"points":[],"text":"","stroke_color":"ink","fill_color":"auto","stroke_width":"thin","stroke_style":"solid","seed":1}]}',
      '{"type":"sketch/elements","vers',
      "x".repeat(2001),
      "   \n  ",
    ]
    for (const text of malformed) {
      await writeClipboard(pageA, text)
      await pageA.keyboard.press("ControlOrMeta+v")
      await expect(pageA.locator(status)).toBeVisible()
      await expect(pageA.locator(status)).toContainText(/paste/i)
      await pageA.evaluate(() => {
        document.getElementById("history-status")?.setAttribute("hidden", "")
      })
    }
    await expectCount([pageA, pageB], elements, 1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/malformed-paste-flash.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA, pageB], textElement, 0)
  } finally {
    await closeSession(session)
  }
})

test("Alt+drag duplicates: the original stays for everyone, B sees the copy at the drop point, undo removes the copy", async ({ browser }) => {
  const session = await openSharedBoard(browser, "alt-drag")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await expectCount([pageA, pageB], rectangle, 1)
    const originalId = (await pageB.locator(rectangle).getAttribute("data-element")) ?? ""
    const original = (page: Page) => page.locator(`[data-element="${originalId}"]`)
    const before = await attributes(original(pageB), ["data-x", "data-y", "data-version"])

    await pageA.keyboard.down("Alt")
    await pressAt(pageA, 160, 140)
    await moveTo(pageA, 460, 340)
    await expect(pageB.locator('[data-draw][data-kind="rectangle"]')).toHaveCount(1)
    for (const page of [pageA, pageB]) {
      await expectCount([page], rectangle, 1)
      expect(await attributes(original(page), ["data-x", "data-y", "data-version"])).toEqual(before)
      await expect(original(page)).toHaveAttribute("x", "100")
      await expect(original(page)).toHaveAttribute("y", "100")
    }
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/alt-drag-preview-seen-by-b.png` })

    await pageA.mouse.up()
    await pageA.keyboard.up("Alt")
    await expectCount([pageA, pageB], rectangle, 2)
    for (const page of [pageA, pageB]) {
      expect(await attributes(original(page), ["data-x", "data-y", "data-version"])).toEqual(before)
      const copy = page.locator(`${rectangle}:not([data-element="${originalId}"])`)
      expect(await position(copy)).toEqual({ x: 400, y: 300 })
      await expect(copy).toHaveAttribute("data-version", "0")
    }
    await expect(pageB.locator("[data-draw]")).toHaveCount(0)
    const copyId = await pageA.locator(`${rectangle}:not([data-element="${originalId}"])`).getAttribute("data-element")
    await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-element", copyId ?? "")
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/alt-drag-copy-seen-by-b.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectCount([pageA, pageB], rectangle, 1)
    await expect(original(pageB)).toHaveCount(1)
    expect(await attributes(original(pageB), ["data-x", "data-y", "data-version"])).toEqual(before)
  } finally {
    await closeSession(session)
  }
})

test("Alt+click without moving makes no copy, and Esc cancels an Alt+drag", async ({ browser }) => {
  const session = await openSharedBoard(browser, "alt-cancel")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await expectCount([pageA, pageB], rectangle, 1)

    await pageA.keyboard.down("Alt")
    await clickAt(pageA, 160, 140)
    await pageA.keyboard.up("Alt")

    await pageA.keyboard.down("Alt")
    await pressAt(pageA, 160, 140)
    await moveTo(pageA, 400, 300)
    await expect(pageB.locator('[data-draw][data-kind="rectangle"]')).toHaveCount(1)
    await pageA.keyboard.up("Alt")
    await pageA.keyboard.press("Escape")
    await pageA.mouse.up()
    await expect(pageB.locator("[data-draw]")).toHaveCount(0)
    await expectCount([pageA, pageB], rectangle, 1)
  } finally {
    await closeSession(session)
  }
})

test("inside the text editor Ctrl/Cmd+C copies the selected text and Ctrl/Cmd+V pastes text, not elements", async ({ browser }) => {
  const session = await openSharedBoard(browser, "editor-clipboard")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await expectCount([pageA, pageB], rectangle, 1)
    await clickAt(pageA, 160, 140)
    await pageA.keyboard.press("ControlOrMeta+c")
    await expect.poll(() => clipboardText(pageA)).toContain('"type":"sketch/elements"')

    await pageA.keyboard.press("t")
    await clickAt(pageA, 400, 300)
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.type("only text")
    await pageA.keyboard.press("ControlOrMeta+a")
    await pageA.keyboard.press("ControlOrMeta+c")
    await expect.poll(() => clipboardText(pageA)).toBe("only text")

    await writeClipboard(pageA, " more")
    await pageA.keyboard.press("ArrowRight")
    await pageA.keyboard.press("ControlOrMeta+v")
    await expect(pageA.locator(editor)).toHaveValue("only text more")
    await expectCount([pageA, pageB], elements, 1)

    await pageA.keyboard.press("Escape")
    await expectCount([pageA, pageB], textElement, 1)
    await expect(pageB.locator(textElement)).toHaveAttribute("data-text", "only text more")
    await expectCount([pageA, pageB], rectangle, 1)
  } finally {
    await closeSession(session)
  }
})
