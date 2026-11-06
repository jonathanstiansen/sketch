import { expect, test, type Page } from "@playwright/test"
import { canvasPoint, clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const rectangle = '#elements > [data-element][data-kind="rectangle"]'
const label = `${rectangle} [data-label]`
const editor = "[data-text-editor]"
const labelHandle = 'rect[data-handle="label"]'

async function drawRectangle(page: Page): Promise<void> {
  await page.keyboard.press("r")
  await pressAt(page, 200, 150)
  await moveTo(page, 440, 330)
  await page.mouse.up()
}

async function expectLabel(page: Page, x: string, y: string): Promise<void> {
  await expect(page.locator(rectangle)).toHaveAttribute("data-label-x", x)
  await expect(page.locator(rectangle)).toHaveAttribute("data-label-y", y)
}

test("Enter types a label into a shape that every browser sees, and the label drags only within the shape", async ({ browser }) => {
  const session = await openSharedBoard(browser, "shape-text")
  const { pageA, pageB } = session
  try {
    await drawRectangle(pageA)
    await expect(pageA.locator(rectangle)).toHaveCount(1)
    await expect(pageA.locator(editor)).toHaveCount(0)

    await pageA.keyboard.press("Escape")
    await clickAt(pageA, 320, 240)
    await pageA.keyboard.press("Enter")
    await expect(pageA.locator(editor)).toBeFocused()
    await pageA.keyboard.type("Hello shape")
    await pageA.keyboard.press("Escape")

    for (const page of [pageA, pageB]) {
      await expect(page.locator(label)).toHaveText("Hello shape")
      await expectLabel(page, "500", "500")
    }
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/label-centred-seen-by-b.png` })

    await clickAt(pageA, 220, 170)
    const handle = await pageA.locator(labelHandle).boundingBox()
    if (handle === null) throw new Error("the label handle is not shown")
    const corner = await canvasPoint(pageA, 100, 60)
    await pageA.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await pageA.mouse.down()
    await pageA.mouse.move(corner.x, corner.y, { steps: 20 })
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) await expectLabel(page, "0", "0")
    await expect(pageB.locator(rectangle)).toHaveAttribute("x", "200")
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/label-dragged-to-corner-seen-by-b.png` })

    await pageA.keyboard.press("ControlOrMeta+z")
    for (const page of [pageA, pageB]) await expectLabel(page, "500", "500")

    await pageB.reload()
    await expect(pageB.locator(label)).toHaveText("Hello shape")
    await expectLabel(pageB, "500", "500")
  } finally {
    await closeSession(session)
  }
})
