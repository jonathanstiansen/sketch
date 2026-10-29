import { expect, test, type Locator, type Page } from "@playwright/test"
import { canvasPoint, clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const textElement = 'g[data-element][data-kind="text"]'
const lines = `${textElement} tspan`
const editor = "textarea[data-text-editor]"
const drawPreview = "text[data-draw]"

async function expectTool(page: Page, tool: string): Promise<void> {
  await expect(page.locator("#canvas-viewport")).toHaveAttribute("data-tool", tool)
}

async function expectText(page: Page, text: string, version: number): Promise<void> {
  await expect(page.locator(textElement)).toHaveCount(1)
  await expect(page.locator(textElement)).toHaveAttribute("data-text", text)
  await expect(page.locator(textElement)).toHaveAttribute("data-version", String(version))
  await expect(page.locator(lines)).toHaveText(text.split("\n"))
  await expect(page.locator(`${textElement} b`)).toHaveCount(0)
}

async function typeWatched(typist: Page, watched: Locator, typed: string, before = ""): Promise<void> {
  let shown = before
  for (const character of typed) {
    await typist.keyboard.type(character)
    shown += character
    await expect(watched).toHaveText(shown)
  }
}

async function textBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const group = page.locator(textElement)
  const number = async (name: string): Promise<number> => Number(await group.getAttribute(name))
  return { x: await number("x"), y: await number("y"), width: await number("width"), height: await number("height") }
}

test("A types multi-line text B watches appear, edits it with a double-click, moves it, and it persists", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "text")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("t")
    await expectTool(pageA, "text")
    await clickAt(pageA, 300, 200)
    await expect(pageA.locator(editor)).toBeFocused()

    await typeWatched(pageA, pageB.locator(drawPreview), "rv over <b>x</b>")
    await expect(pageB.locator(textElement)).toHaveCount(0)
    await expectTool(pageA, "text")

    await pageA.keyboard.press("Enter")
    await pageA.keyboard.type("second line")
    await expect(pageB.locator(`${drawPreview} tspan`)).toHaveText(["rv over <b>x</b>", "second line"])
    await expect(pageA.locator(editor)).toHaveValue("rv over <b>x</b>\nsecond line")

    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) await expectText(page, "rv over <b>x</b>\nsecond line", 0)
    await expect(pageB.locator(drawPreview)).toHaveCount(0)
    const created = await textBox(pageA)
    expect(created).toMatchObject({ x: 300, y: 200, height: 50 })
    expect(created.width).toBeGreaterThan(50)
    expect(await textBox(pageB)).toEqual(created)

    await pageA.keyboard.press("v")
    await expectTool(pageA, "selection")
    await pageA.locator(textElement).dblclick()
    await expect(pageA.locator(editor)).toBeFocused()
    await expect(pageA.locator(editor)).toHaveValue("rv over <b>x</b>\nsecond line")
    await typeWatched(pageA, pageB.locator(lines).nth(1), " vr", "second line")
    await expect(pageB.locator(lines)).toHaveText(["rv over <b>x</b>", "second line vr"])
    await expect(pageB.locator(textElement)).toHaveAttribute("data-version", "0")
    await expectTool(pageA, "selection")

    await clickAt(pageA, 700, 450)
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) await expectText(page, "rv over <b>x</b>\nsecond line vr", 1)
    await expect(pageA.locator("rect[data-selection-outline]")).toHaveCount(1)
    await expect(pageA.locator("rect[data-handle]")).toHaveCount(0)

    const edited = await textBox(pageA)
    await pressAt(pageA, edited.x + 10, edited.y + 10)
    await moveTo(pageA, edited.x + 110, edited.y + 70)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectText(page, "rv over <b>x</b>\nsecond line vr", 2)
      expect(await textBox(page)).toEqual({ ...edited, x: edited.x + 100, y: edited.y + 60 })
    }
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/text.png` })

    await pageB.reload()
    await expectText(pageB, "rv over <b>x</b>\nsecond line vr", 2)
  } finally {
    await closeSession(session)
  }
})

test("the 8 shortcut opens the editor; an empty or blank editor creates nothing", async ({ browser }) => {
  const session = await openSharedBoard(browser, "text-empty")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("8")
    await expectTool(pageA, "text")
    await clickAt(pageA, 200, 200)
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)

    await clickAt(pageA, 400, 300)
    await pageA.keyboard.type("  ")
    await pageA.keyboard.press("Enter")
    await expect(pageB.locator(drawPreview)).toHaveCount(1)
    const outside = await canvasPoint(pageA, 800, 500)
    await pageA.mouse.click(outside.x, outside.y)
    await expect(pageA.locator(editor)).toHaveCount(0)
    await expect(pageB.locator(drawPreview)).toHaveCount(0)

    await clickAt(pageA, 200, 400)
    await pageA.keyboard.type("kept")
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expectText(page, "kept", 0)
  } finally {
    await closeSession(session)
  }
})
