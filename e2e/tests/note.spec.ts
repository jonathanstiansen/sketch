import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, expectBox, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const note = 'g[data-element][data-kind="note"]'
const noteLines = `${note} tspan`
const drawnNote = "g[data-draw]"
const drawnLines = `${drawnNote} tspan`
const editor = "textarea[data-text-editor]"
const sentence = "the quick brown fox jumps over the lazy dog"
const charsPerLine = 14

async function expectTool(page: Page, tool: string): Promise<void> {
  await expect(page.locator("#canvas-viewport")).toHaveAttribute("data-tool", tool)
}

async function lines(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).allTextContents()
}

async function expectWrapped(page: Page, selector: string, text: string, perLine: number): Promise<string[]> {
  await expect
    .poll(async () => {
      const shown = await lines(page, selector)
      const fits = shown.every((line) => Array.from(line).length <= perLine)
      return fits && shown.join("").replace(/\s/g, "") === text.replace(/\s/g, "")
    })
    .toBe(true)
  return lines(page, selector)
}

async function expectNote(page: Page, text: string, box: { x: number; y: number; width: number; height: number }, version: number): Promise<void> {
  await expect(page.locator(note)).toHaveCount(1)
  await expect(page.locator(note)).toHaveAttribute("data-text", text)
  await expect(page.locator(note)).toHaveAttribute("data-version", String(version))
  await expectBox(page, `${note} rect[data-note-body]`, box)
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
    await expectBox(pageA, `${drawnNote} rect[data-note-body]`, created)
    await expectBox(pageB, `${drawnNote} rect[data-note-body]`, created)
    await expect(pageB.locator(note)).toHaveCount(0)

    await pageA.keyboard.type(sentence)
    const live = await expectWrapped(pageB, drawnLines, sentence, charsPerLine)
    expect(live.length).toBeGreaterThan(1)
    await expect(pageB.locator(drawnLines)).toHaveText(live)

    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) {
      await expectNote(page, sentence, created, 0)
      await expect(page.locator(drawnNote)).toHaveCount(0)
      expect(await lines(page, noteLines)).toEqual(live)
    }
    await expect(pageA.locator(`${note} svg[data-note-clip]`)).toHaveAttribute("overflow", "hidden")
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/note.png` })

    await pageA.keyboard.press("v")
    await clickAt(pageA, 320, 300)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    await pressAt(pageA, 500, 360)
    await moveTo(pageA, 380, 360)
    const narrower = { x: 300, y: 200, width: 80, height: 160 }
    await expectBox(pageB, `${note} rect[data-note-body]`, narrower)
    const rewrapped = await expectWrapped(pageB, noteLines, sentence, 4)
    expect(rewrapped.length).toBeGreaterThan(live.length)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectNote(page, sentence, narrower, 1)
      expect(await expectWrapped(page, noteLines, sentence, 4)).toEqual(rewrapped)
    }

    await pageB.reload()
    await expectNote(pageB, sentence, narrower, 1)
    expect(await expectWrapped(pageB, noteLines, sentence, 4)).toEqual(rewrapped)
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
    await expectBox(pageB, `${drawnNote} rect[data-note-body]`, drawn)
    await pageA.mouse.up()
    await expect(pageA.locator(editor)).toBeFocused()
    await expectBox(pageB, `${drawnNote} rect[data-note-body]`, drawn)

    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(editor)).toHaveCount(0)
    for (const page of [pageA, pageB]) {
      await expectNote(page, "", drawn, 0)
      await expect(page.locator(noteLines)).toHaveCount(1)
      await expect(page.locator(drawnNote)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await pageA.locator(note).dblclick()
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.type("two words")
    await expect(pageB.locator(noteLines)).toHaveText(["two words"])
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expectNote(page, "two words", drawn, 1)
  } finally {
    await closeSession(session)
  }
})
