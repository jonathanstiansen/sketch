import { expect, test, type Page } from "@playwright/test"
import {
  clickAt,
  closeSession,
  expectBox,
  moveTo,
  openSharedBoard,
  pressAt,
  type Box,
} from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const element = "ellipse[data-element]"
const drawPreview = "ellipse[data-draw]"

interface Ellipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

function ellipseOf({ x, y, width, height }: Box): Ellipse {
  return { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2 }
}

async function expectEllipseGeometry(page: Page, selector: string, box: Box): Promise<void> {
  for (const [name, value] of Object.entries(ellipseOf(box))) {
    await expect(page.locator(selector)).toHaveAttribute(name, String(value))
  }
}

async function expectEllipse(page: Page, box: Box, version: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(1)
  await expectBox(page, element, box)
  await expectEllipseGeometry(page, element, box)
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
  await expect(page.locator(element)).toHaveAttribute("data-kind", "ellipse")
}

test("A draws and resizes an ellipse; B sees each step live and kind and box persist", async ({ browser }) => {
  const session = await openSharedBoard(browser, "ellipse")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("o")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 200, 220)
    const drawn = { x: 200, y: 220, width: 200, height: 80 }
    await expectBox(pageB, drawPreview, drawn)
    await expectEllipseGeometry(pageB, drawPreview, drawn)
    await expect(pageB.locator(element)).toHaveCount(0)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      await expectEllipse(page, drawn, 0)
      await expect(page.locator(drawPreview)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/ellipse.png` })

    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 520, 380)
    const resized = { x: 200, y: 220, width: 320, height: 160 }
    await expectBox(pageB, element, resized)
    await expectEllipseGeometry(pageB, element, resized)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectEllipse(page, resized, 1)

    await pageB.reload()
    await expectEllipse(pageB, resized, 1)
  } finally {
    await closeSession(session)
  }
})

test("a click in the corner of the box outside the ellipse does not select it", async ({ browser }) => {
  const session = await openSharedBoard(browser, "ellipse-corner")
  const { pageA } = session
  try {
    await pageA.keyboard.press("o")
    await pressAt(pageA, 200, 220)
    await moveTo(pageA, 400, 300)
    await pageA.mouse.up()
    await expectEllipse(pageA, { x: 200, y: 220, width: 200, height: 80 }, 0)

    await pageA.keyboard.press("v")
    await clickAt(pageA, 206, 226)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(0)
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
  } finally {
    await closeSession(session)
  }
})

test("Esc while drawing an ellipse creates nothing and clears B's preview", async ({ browser }) => {
  const session = await openSharedBoard(browser, "ellipse-cancelled")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("4")
    await pressAt(pageA, 300, 300)
    await moveTo(pageA, 420, 380)
    await expect(pageB.locator(drawPreview)).toHaveCount(1)
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) await expect(page.locator(drawPreview)).toHaveCount(0)
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expect(page.locator(element)).toHaveCount(0)
  } finally {
    await closeSession(session)
  }
})

test("a click with the Ellipse tool creates a default-sized ellipse", async ({ browser }) => {
  const session = await openSharedBoard(browser, "ellipse-click")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("o")
    await clickAt(pageA, 600, 350)
    const clicked = { x: 600, y: 350, width: 120, height: 80 }
    for (const page of [pageA, pageB]) await expectEllipse(page, clicked, 0)
  } finally {
    await closeSession(session)
  }
})
