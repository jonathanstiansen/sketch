import { expect, test } from "@playwright/test"
import { closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const viewport = "#canvas-viewport"

const drawnTools = [
  { key: "2", kind: "rectangle" },
  { key: "4", kind: "ellipse" },
  { key: "5", kind: "arrow" },
  { key: "6", kind: "line" },
] as const

test("a shape, line or arrow is selected when the drag that draws it ends; a freehand stroke is not", async ({ browser }) => {
  const session = await openSharedBoard(browser, "select-after-draw")
  const { pageA, pageB } = session
  try {
    for (const [index, { key, kind }] of drawnTools.entries()) {
      const top = 120 + index * 150
      await pageA.keyboard.press(key)
      await pressAt(pageA, 200, top)
      await moveTo(pageA, 320, top + 100)
      await pageA.mouse.up()

      const created = pageA.locator(`g[data-element][data-kind="${kind}"]`)
      await expect(created).toHaveCount(1)
      const id = await created.getAttribute("data-element")
      await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-element", id ?? "")
      await expect(pageA.locator(viewport)).toHaveAttribute("data-selected-count", "1")
      await expect(pageB.locator(`g[data-element][data-kind="${kind}"]`)).toHaveCount(1)
      await expect(pageB.locator(viewport)).not.toHaveAttribute("data-selected-element")
    }
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/line-selected-after-draw.png` })

    await pageA.keyboard.press("Escape")
    await pageA.keyboard.press("7")
    await pressAt(pageA, 600, 200)
    await moveTo(pageA, 700, 260)
    await pageA.mouse.up()
    await expect(pageA.locator('g[data-element][data-kind="freedraw"]')).toHaveCount(1)
    await expect(pageA.locator(viewport)).not.toHaveAttribute("data-selected-element", /.+/)
  } finally {
    await closeSession(session)
  }
})
