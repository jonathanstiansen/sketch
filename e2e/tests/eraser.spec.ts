import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const elements = "#elements [data-element]"
const fading = "#elements [data-element][data-erasing]"
const rectangle = '[data-element][data-kind="rectangle"]'
const ellipse = '[data-element][data-kind="ellipse"]'
const diamond = '[data-element][data-kind="diamond"]'
const editor = "textarea[data-text-editor]"

async function draw(page: Page, key: string, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press(key)
  await pressAt(page, ...from)
  await moveTo(page, ...to)
  await page.mouse.up()
}

async function expectKinds(page: Page, kinds: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator(elements).evaluateAll((all) => all.map((el) => el.getAttribute("data-kind")))).sort())
    .toEqual([...kinds].sort())
}

test("dragging the eraser across two of three elements erases both for B, Esc cancels, Delete erases the selection, and reload keeps it all", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "eraser")
  const { pageA, pageB } = session
  try {
    await draw(pageA, "r", [100, 100], [220, 180])
    await draw(pageA, "o", [300, 100], [420, 180])
    await draw(pageA, "d", [500, 100], [620, 180])
    for (const page of [pageA, pageB]) await expectKinds(page, ["rectangle", "ellipse", "diamond"])

    await pageA.keyboard.press("e")
    await expect(pageA.locator("#canvas-viewport")).toHaveAttribute("data-tool", "eraser")
    await pressAt(pageA, 60, 140)
    await moveTo(pageA, 460, 150)
    await expect(pageA.locator(fading)).toHaveCount(2)
    await expect(pageA.locator(`${rectangle}[data-erasing]`)).toHaveCount(1)
    await expect(pageA.locator(`${ellipse}[data-erasing]`)).toHaveCount(1)
    await expectKinds(pageB, ["rectangle", "ellipse", "diamond"])
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/eraser.png` })
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectKinds(page, ["diamond"])
    await expect(pageA.locator(fading)).toHaveCount(0)

    await pageA.keyboard.press("0")
    await pressAt(pageA, 480, 140)
    await moveTo(pageA, 640, 140)
    await expect(pageA.locator(`${diamond}[data-erasing]`)).toHaveCount(1)
    await pageA.keyboard.press("Escape")
    await expect(pageA.locator(fading)).toHaveCount(0)
    await pageA.mouse.up()
    await expect(pageA.locator("#canvas-viewport")).toHaveAttribute("data-tool", "selection")
    await pageB.reload()
    for (const page of [pageA, pageB]) await expectKinds(page, ["diamond"])

    await clickAt(pageA, 560, 140)
    await expect(pageA.locator("rect[data-handle]")).toHaveCount(4)
    await pageA.keyboard.press("Delete")
    for (const page of [pageA, pageB]) await expectKinds(page, [])
    await expect(pageA.locator("rect[data-handle]")).toHaveCount(0)

    await pageA.reload()
    await pageB.reload()
    for (const page of [pageA, pageB]) await expectKinds(page, [])
  } finally {
    await closeSession(session)
  }
})

test("Backspace in a note editor edits the text and erases nothing, then Backspace on the selected note erases it", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "eraser-editor")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("n")
    await clickAt(pageA, 300, 200)
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.type("hello")
    await pageA.keyboard.press("Backspace")
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) {
      await expect(page.locator('[data-element][data-kind="note"]')).toHaveAttribute("data-text", "hell")
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 320, 300)
    await expect(pageA.locator("rect[data-handle]")).toHaveCount(4)
    await pageA.keyboard.press("Backspace")
    for (const page of [pageA, pageB]) await expectKinds(page, [])
  } finally {
    await closeSession(session)
  }
})

test("B erases the element A is dragging: A's drag ends without resurrecting it and both converge to empty", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "eraser-race")
  const { pageA, pageB } = session
  try {
    await draw(pageA, "r", [100, 100], [220, 180])
    for (const page of [pageA, pageB]) await expectKinds(page, ["rectangle"])

    await pageA.keyboard.press("v")
    await pressAt(pageA, 150, 140)
    await moveTo(pageA, 350, 240)
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "300")

    await pageB.keyboard.press("e")
    await clickAt(pageB, 360, 240)
    for (const page of [pageA, pageB]) await expectKinds(page, [])

    await moveTo(pageA, 450, 300)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectKinds(page, [])
    await expect(pageA.locator("#flash-error")).toHaveCount(0)
    await expect(pageA.locator("#draw-previews > *")).toHaveCount(0)

    await pageA.reload()
    await pageB.reload()
    for (const page of [pageA, pageB]) await expectKinds(page, [])
  } finally {
    await closeSession(session)
  }
})
