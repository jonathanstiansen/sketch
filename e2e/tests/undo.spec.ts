import { expect, test, type Locator, type Page } from "@playwright/test"
import { createBoard } from "./support/board"
import { clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const rectangle = '#elements [data-element][data-kind="rectangle"]'
const textElement = '#elements [data-element][data-kind="text"]'
const elements = "#elements [data-element]"
const editor = "textarea[data-text-editor]"
const status = "#history-status"
const undoButton = "#history-undo"
const redoButton = "#history-redo"
const strokeRed = '#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]'

async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press("r")
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
  await page.keyboard.press("v")
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
}

async function expectRectangle(page: Page, expected: { x: number; y: number; stroke: string } | undefined): Promise<void> {
  if (expected === undefined) {
    await expect(page.locator(rectangle)).toHaveCount(0)
    return
  }
  const shape = page.locator(rectangle)
  await expect(shape).toHaveCount(1)
  await expect(shape).toHaveAttribute("data-x", String(expected.x))
  await expect(shape).toHaveAttribute("data-y", String(expected.y))
  await expect(shape).toHaveAttribute("data-stroke-color", expected.stroke)
}

async function elementId(locator: Locator): Promise<string> {
  const id = await locator.getAttribute("data-element")
  if (id === null) throw new Error("element has no id")
  return id
}

async function expectBoth(pages: Page[], expected: { x: number; y: number; stroke: string } | undefined): Promise<void> {
  for (const page of pages) await expectRectangle(page, expected)
}

const drawn = { x: 100, y: 100, stroke: "ink" }
const moved = { x: 300, y: 200, stroke: "ink" }
const restyled = { x: 300, y: 200, stroke: "red" }

test("A draws, moves, restyles and erases; B sees every undo revert it and every redo replay it", async ({ browser }) => {
  const session = await openSharedBoard(browser, "undo")
  const { pageA, pageB } = session
  const both = [pageA, pageB]
  try {
    await expect(pageA.locator(undoButton)).toBeDisabled()
    await expect(pageA.locator(redoButton)).toBeDisabled()

    await drawRectangle(pageA, [100, 100], [220, 180])
    await expectBoth(both, drawn)
    const original = await elementId(pageB.locator(rectangle))
    await expect(pageA.locator(undoButton)).toBeEnabled()

    await drag(pageA, [160, 140], [360, 240])
    await expectBoth(both, moved)

    await pageA.locator(strokeRed).click()
    await expectBoth(both, restyled)
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "2")

    await clickAt(pageA, 360, 240)
    await pageA.keyboard.press("Delete")
    await expectBoth(both, undefined)

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectBoth(both, restyled)
    const restored = await elementId(pageB.locator(rectangle))
    expect(restored).not.toBe(original)
    await expect(pageB.locator(`[data-element="${original}"]`)).toHaveCount(0)
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/erase-undone-seen-by-b.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectBoth(both, moved)
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "1")

    await pageA.locator(undoButton).click()
    await expectBoth(both, drawn)
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "2")

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectBoth(both, undefined)
    await expect(pageA.locator(undoButton)).toBeDisabled()
    await expect(pageA.locator(redoButton)).toBeEnabled()

    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expectBoth(both, drawn)
    await pageA.keyboard.press("Control+y")
    await expectBoth(both, moved)
    await pageA.locator(redoButton).click()
    await expectBoth(both, restyled)
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expectBoth(both, undefined)
    await expect(pageA.locator(redoButton)).toBeDisabled()

    await pageB.reload()
    await expectRectangle(pageB, undefined)
    await pageA.keyboard.press("ControlOrMeta+z")
    await expectBoth(both, restyled)
    await pageB.reload()
    await expectRectangle(pageB, restyled)
  } finally {
    await closeSession(session)
  }
})

test("a new action clears redo, and one eraser stroke over two elements is one undo", async ({ browser }) => {
  const session = await openSharedBoard(browser, "undo-redo-cleared")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await drawRectangle(pageA, [300, 100], [420, 180])
    await expect(pageB.locator(rectangle)).toHaveCount(2)

    await pageA.keyboard.press("e")
    await pressAt(pageA, 60, 140)
    await moveTo(pageA, 460, 150)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expect(page.locator(rectangle)).toHaveCount(0)

    await pageA.keyboard.press("ControlOrMeta+z")
    for (const page of [pageA, pageB]) await expect(page.locator(rectangle)).toHaveCount(2)
    await expect(pageA.locator(redoButton)).toBeEnabled()

    await pageA.keyboard.press("v")
    await drawRectangle(pageA, [100, 300], [220, 380])
    await expect(pageB.locator(rectangle)).toHaveCount(3)
    await expect(pageA.locator(redoButton)).toBeDisabled()
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await expect(pageB.locator(rectangle)).toHaveCount(3)
  } finally {
    await closeSession(session)
  }
})

test("an undo whose element B erased is dropped with a message and nothing comes back", async ({ browser }) => {
  const session = await openSharedBoard(browser, "undo-conflict")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await drag(pageA, [160, 140], [360, 240])
    await expectBoth([pageA, pageB], moved)

    await clickAt(pageB, 360, 240)
    await pageB.keyboard.press("Delete")
    await expectBoth([pageA, pageB], undefined)

    await pageA.keyboard.press("ControlOrMeta+z")
    await expect(pageA.locator(status)).toBeVisible()
    await expect(pageA.locator(status)).toHaveText("Can't undo: erased by someone else")
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/undo-dropped.png` })
    await pageA.keyboard.press("ControlOrMeta+z")
    await expect(pageA.locator(undoButton)).toBeDisabled()
    await expectBoth([pageA, pageB], undefined)

    await pageB.reload()
    await expect(pageB.locator(elements)).toHaveCount(0)
  } finally {
    await closeSession(session)
  }
})

test("if B moved the element after A, A's undo still applies A's previous position (last writer wins)", async ({ browser }) => {
  const session = await openSharedBoard(browser, "undo-lww")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 100], [220, 180])
    await drag(pageA, [160, 140], [360, 240])
    await expectBoth([pageA, pageB], moved)

    await drag(pageB, [360, 240], [460, 440])
    await expectBoth([pageA, pageB], { x: 400, y: 400, stroke: "ink" })

    await pageA.keyboard.press("ControlOrMeta+z")
    await expectBoth([pageA, pageB], drawn)
    await expect(pageB.locator(rectangle)).toHaveAttribute("data-version", "3")
  } finally {
    await closeSession(session)
  }
})

test("Ctrl+Z inside the text editor is the editor's own undo; text edits undo on the canvas", async ({ browser }) => {
  const session = await openSharedBoard(browser, "undo-text")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA, [100, 300], [220, 380])
    await expect(pageB.locator(rectangle)).toHaveCount(1)

    await pageA.keyboard.press("t")
    await clickAt(pageA, 300, 100)
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.type("hello")
    await pageA.keyboard.press("ControlOrMeta+z")
    await expect(pageA.locator(editor)).toBeFocused()
    await expect(pageA.locator(editor)).not.toHaveValue("hello")
    await expect(pageB.locator(rectangle)).toHaveCount(1)
    await expect(pageA.locator(rectangle)).toHaveCount(1)

    await pageA.locator(editor).fill("hello")
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expect(page.locator(textElement)).toHaveAttribute("data-text", "hello")

    await pageA.keyboard.press("v")
    await pageA.locator(textElement).dblclick()
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.press("End")
    await pageA.keyboard.type(" world")
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expect(page.locator(textElement)).toHaveAttribute("data-text", "hello world")

    await pageA.keyboard.press("ControlOrMeta+z")
    for (const page of [pageA, pageB]) await expect(page.locator(textElement)).toHaveAttribute("data-text", "hello")
    await pageA.keyboard.press("ControlOrMeta+z")
    for (const page of [pageA, pageB]) await expect(page.locator(textElement)).toHaveCount(0)
    await expect(pageB.locator(rectangle)).toHaveCount(1)
  } finally {
    await closeSession(session)
  }
})

test("a reload clears the stacks and keeps the board", async ({ page }) => {
  await createBoard(page)
  await drawRectangle(page, [100, 100], [220, 180])
  await drag(page, [160, 140], [360, 240])
  await expectRectangle(page, moved)
  await expect(page.locator(undoButton)).toBeEnabled()

  await page.reload()
  await expectRectangle(page, moved)
  await expect(page.locator(undoButton)).toBeDisabled()
  await expect(page.locator(redoButton)).toBeDisabled()
  await page.keyboard.press("ControlOrMeta+z")
  await page.locator("#shortcuts-help-button").click()
  await expect(page.locator("#shortcut-undo kbd")).toHaveText(["Ctrl/⌘", "Z"])
  await expect(page.locator("#shortcut-redo kbd")).toHaveText(["Ctrl/⌘", "Shift", "Z", "Ctrl", "Y"])
  await expectRectangle(page, moved)
})
