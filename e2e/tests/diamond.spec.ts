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
const element = "[data-element][data-kind='diamond']"
const drawPreview = "[data-draw][data-kind='diamond']"
const body = "polygon"

function pair(x: number, y: number): string {
  return [x, y].map(String).join(",")
}

function diamondPoints({ width, height }: Box): string {
  const [midX, midY] = [width / 2, height / 2]
  return [pair(midX, 0), pair(width, midY), pair(midX, height), pair(0, midY)].join(" ")
}

async function expectDiamond(page: Page, box: Box, version: number): Promise<void> {
  await expect(page.locator(element)).toHaveCount(1)
  await expectBox(page, element, box)
  await expect(page.locator(element).locator(body)).toHaveAttribute("points", diamondPoints(box))
  await expect(page.locator(element)).toHaveAttribute("data-version", String(version))
  await expect(page.locator(element)).toHaveAttribute("data-kind", "diamond")
}

test("A draws and resizes a diamond; B sees each step live and kind and box persist", async ({ browser }) => {
  const session = await openSharedBoard(browser, "diamond")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("d")
    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 200, 220)
    const drawn = { x: 200, y: 220, width: 200, height: 80 }
    await expectBox(pageB, drawPreview, drawn)
    await expect(pageB.locator(drawPreview).locator(body)).toHaveAttribute("points", diamondPoints(drawn))
    await expect(pageB.locator(element)).toHaveCount(0)
    await pageA.mouse.up()

    for (const page of [pageA, pageB]) {
      await expectDiamond(page, drawn, 0)
      await expect(page.locator(drawPreview)).toHaveCount(0)
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 300, 260)
    await expect(pageA.locator('rect[data-handle="se"]')).toHaveCount(1)
    if (evidenceDir !== undefined) await pageA.screenshot({ path: `${evidenceDir}/diamond.png` })

    await pressAt(pageA, 400, 300)
    await moveTo(pageA, 520, 380)
    const resized = { x: 200, y: 220, width: 320, height: 160 }
    await expectBox(pageB, element, resized)
    await expect(pageB.locator(element).locator(body)).toHaveAttribute("points", diamondPoints(resized))
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectDiamond(page, resized, 1)

    await pageB.reload()
    await expectDiamond(pageB, resized, 1)
  } finally {
    await closeSession(session)
  }
})

test("Esc while drawing a diamond creates nothing and clears B's preview", async ({ browser }) => {
  const session = await openSharedBoard(browser, "diamond-cancelled")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("3")
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

test("a click with the Diamond tool creates a default-sized diamond", async ({ browser }) => {
  const session = await openSharedBoard(browser, "diamond-click")
  const { pageA, pageB } = session
  try {
    await pageA.keyboard.press("d")
    await clickAt(pageA, 600, 350)
    const clicked = { x: 600, y: 350, width: 120, height: 80 }
    for (const page of [pageA, pageB]) await expectDiamond(page, clicked, 0)
  } finally {
    await closeSession(session)
  }
})

test("a diamond is a translated wrapper: a move changes only the transform and a resize redraws the polygon, in both browsers", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "diamond-move")
  const { pageA, pageB } = session
  const wrapperAt = ({ x, y }: Box) => `translate(${String(x)} ${String(y)})`
  try {
    await pageA.keyboard.press("d")
    await pressAt(pageA, 100, 100)
    await moveTo(pageA, 221, 181)
    await pageA.mouse.up()
    const drawn = { x: 100, y: 100, width: 121, height: 81 }
    for (const page of [pageA, pageB]) await expectDiamond(page, drawn, 0)

    await pageA.keyboard.press("v")
    await pressAt(pageA, 160, 140)
    await moveTo(pageA, 360, 190)
    const moved = { ...drawn, x: 300, y: 150 }
    for (const page of [pageA, pageB]) {
      await expect(page.locator(element)).toHaveAttribute("transform", wrapperAt(moved))
      await expect(page.locator(element).locator(body)).toHaveAttribute("points", diamondPoints(drawn))
      await expect(page.locator(element)).toHaveAttribute("data-x", "100")
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectDiamond(page, moved, 1)

    await pressAt(pageA, 421, 231)
    await moveTo(pageA, 502, 301)
    const resized = { ...moved, width: 202, height: 151 }
    for (const page of [pageA, pageB]) {
      await expect(page.locator(element)).toHaveAttribute("transform", wrapperAt(moved))
      await expect(page.locator(element).locator(body)).toHaveAttribute("points", diamondPoints(resized))
      await expect(page.locator(element)).toHaveAttribute("data-width", "121")
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expectDiamond(page, resized, 2)
  } finally {
    await closeSession(session)
  }
})
