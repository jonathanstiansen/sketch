import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, moveTo, openSharedBoard, pressAt, type Box } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const note = 'g[data-element][data-kind="note"]'
const drawnNote = 'g[data-draw][data-kind="note"]'
const editor = "textarea[data-text-editor]"
const sentence = "the quick brown fox jumps over the lazy dog"
const wrappedAt200 = ["the quick", "brown fox", "jumps over the", "lazy dog"]
const wrappedAt80 = ["the", "quic", "k", "brow", "n", "fox", "jump", "s", "over", "the", "lazy", "dog"]
const lineHeight = 25
const baseline = 19
const padding = 12

async function expectTool(page: Page, tool: string): Promise<void> {
  await expect(page.locator("#canvas-viewport")).toHaveAttribute("data-tool", tool)
}

async function expectAttributes(page: Page, selector: string, attributes: Record<string, string | number>): Promise<void> {
  const shape = page.locator(selector)
  await expect(shape).toHaveCount(1)
  for (const [name, value] of Object.entries(attributes)) await expect(shape).toHaveAttribute(name, String(value))
}

async function expectRendered(page: Page, group: string, { x, y, width, height }: Box, lines: string[]): Promise<void> {
  await expectAttributes(page, group, { x, y, width, height, transform: `translate(${String(x)} ${String(y)})` })
  const local = { x: 0, y: 0, width, height }
  await expectAttributes(page, `${group} > rect[data-note-body]`, { ...local, rx: 6 })
  await expectAttributes(page, `${group} > svg[data-note-clip]`, { ...local, overflow: "hidden" })
  const body = `${group} > svg[data-note-clip] > text[data-text-body]`
  await expectAttributes(page, body, { transform: `translate(${String(padding)} ${String(padding)})` })
  const spans = page.locator(`${body} > tspan`)
  await expect(spans).toHaveText(lines)
  for (let index = 0; index < lines.length; index += 1) {
    await expect(spans.nth(index)).toHaveAttribute("x", "0")
    await expect(spans.nth(index)).toHaveAttribute("y", String(baseline + index * lineHeight))
  }
}

async function expectNote(page: Page, text: string, box: Box, version: number, lines: string[]): Promise<void> {
  if (text === "") await expect(page.locator(note)).not.toHaveAttribute("data-text")
  await expectAttributes(page, note, {
    ...(text === "" ? {} : { "data-text": text }),
    "data-version": version,
    "data-x": box.x,
    "data-y": box.y,
    "data-width": box.width,
    "data-height": box.height,
  })
  await expectRendered(page, note, box, lines)
  await expect(page.locator(drawnNote)).toHaveCount(0)
}

test("N then a click opens an editor in a 200 by 160 note; B watches the wrapped text, a resize re-wraps it, and it persists", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "note")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("n")
    await expectTool(pageA, "note")
    await clickAt(pageA, 300, 200)
    await expect(pageA.locator(editor)).toBeFocused()
    const created = { x: 300, y: 200, width: 200, height: 160 }
    await expectRendered(pageA, drawnNote, created, [""])
    await expectRendered(pageB, drawnNote, created, [""])
    await expect(pageB.locator(note)).toHaveCount(0)

    await pageA.keyboard.type(sentence)
    await expectRendered(pageB, drawnNote, created, wrappedAt200)

    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) await expectNote(page, sentence, created, 0, wrappedAt200)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/note.png` })

    await pageA.keyboard.press("v")
    await clickAt(pageA, 320, 300)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    await pressAt(pageA, 500, 360)
    await moveTo(pageA, 380, 360)
    const narrower = { x: 300, y: 200, width: 80, height: 160 }
    for (const page of [pageA, pageB]) {
      await expectRendered(page, note, narrower, wrappedAt80)
      await expect(page.locator(note)).toHaveAttribute("data-width", "200")
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectNote(page, sentence, narrower, 1, wrappedAt80)

    await pageB.reload()
    await expectNote(pageB, sentence, narrower, 1, wrappedAt80)
  } finally {
    await closeSession(session)
  }
})

test("a dragged note opens its editor, an empty note is kept, and a double-click edits it", async ({ browser }) => {
  const session = await openSharedBoard(browser, "note-drag")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("9")
    await expectTool(pageA, "note")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 640, 440)
    const drawn = { x: 400, y: 300, width: 240, height: 140 }
    await expectRendered(pageB, drawnNote, drawn, [""])
    await pageA.mouse.up()
    await expect(pageA.locator(editor)).toBeFocused()
    await expectRendered(pageB, drawnNote, drawn, [""])

    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) await expectNote(page, "", drawn, 0, [""])

    await pageA.keyboard.press("v")
    await pageA.locator(note).dblclick()
    await expect(pageA.locator(editor)).toBeFocused()
    await expect(pageA.locator(editor)).toHaveCSS("left", `${String(drawn.x + padding)}px`)
    await expect(pageA.locator(editor)).toHaveCSS("top", `${String(drawn.y + padding)}px`)
    await pageA.keyboard.type("two words")
    await expectRendered(pageB, note, drawn, ["two words"])
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expectNote(page, "two words", drawn, 1, ["two words"])
  } finally {
    await closeSession(session)
  }
})
