import { expect, test, type Page } from "@playwright/test"
import { addRectangle, closeSession, openSharedBoard, pressAt, moveTo, type Box } from "./support/canvas"

const element = "[data-element][data-kind='rectangle']"
const body = `${element} > rect`

async function addSharedRectangle(pages: Page[]): Promise<void> {
  const [first] = pages
  if (first === undefined) throw new Error("no page")
  await addRectangle(first)
  for (const page of pages) await expect(page.locator(element)).toHaveAttribute("data-version", "0")
}

async function expectRendered(page: Page, { x, y, width, height }: Box): Promise<void> {
  const wrapper = page.locator(element)
  await expect(wrapper).toHaveAttribute("transform", `translate(${String(x)} ${String(y)})`)
  await expect(wrapper).toHaveAttribute("x", String(x))
  await expect(wrapper).toHaveAttribute("y", String(y))
  await expect(wrapper).toHaveAttribute("width", String(width))
  await expect(wrapper).toHaveAttribute("height", String(height))
  const rect = page.locator(body)
  await expect(rect).toHaveCount(1)
  await expect(rect).toHaveAttribute("x", "0")
  await expect(rect).toHaveAttribute("y", "0")
  await expect(rect).toHaveAttribute("width", String(width))
  await expect(rect).toHaveAttribute("height", String(height))
}

async function expectCommitted(page: Page, { x, y, width, height }: Box, version: number): Promise<void> {
  const wrapper = page.locator(element)
  await expect(wrapper).toHaveAttribute("data-version", String(version))
  await expect(wrapper).toHaveAttribute("data-x", String(x))
  await expect(wrapper).toHaveAttribute("data-y", String(y))
  await expect(wrapper).toHaveAttribute("data-width", String(width))
  await expect(wrapper).toHaveAttribute("data-height", String(height))
}

test("a rectangle is a translated wrapper: a move changes only the transform and a resize redraws the children, in both browsers", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "render-model-move")
  const { pageA, pageB } = session
  try {
    await addSharedRectangle([pageA, pageB])
    const origin = { x: 100, y: 100, width: 120, height: 80 }
    for (const page of [pageA, pageB]) await expectRendered(page, origin)

    await pressAt(pageA, 120, 120)
    await moveTo(pageA, 320, 170)
    const moved = { ...origin, x: 300, y: 150 }
    for (const page of [pageA, pageB]) {
      await expectRendered(page, moved)
      await expectCommitted(page, origin, 0)
    }

    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectRendered(page, moved)
      await expectCommitted(page, moved, 1)
    }

    await pressAt(pageA, 420, 230)
    await moveTo(pageA, 500, 300)
    const resized = { ...moved, width: 200, height: 150 }
    for (const page of [pageA, pageB]) {
      await expectRendered(page, resized)
      await expectCommitted(page, moved, 1)
    }

    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectRendered(page, resized)
      await expectCommitted(page, resized, 2)
    }
  } finally {
    await closeSession(session)
  }
})

test("a remote commit mid-drag or mid-resize updates the committed box but never snaps the dragged rectangle", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "render-model-remote-commit")
  const { pageA, pageB } = session
  try {
    await addSharedRectangle([pageA, pageB])

    await pressAt(pageA, 120, 120)
    await moveTo(pageA, 320, 170)
    const draggedByA = { x: 300, y: 150, width: 120, height: 80 }
    await expectRendered(pageB, draggedByA)

    await pressAt(pageB, 320, 170)
    await moveTo(pageB, 420, 370)
    await pageB.mouse.up()
    await expectCommitted(pageA, { ...draggedByA, x: 400, y: 350 }, 1)
    await expectRendered(pageA, draggedByA)

    await moveTo(pageA, 520, 220)
    await pageA.mouse.up()
    const movedByA = { ...draggedByA, x: 500, y: 200 }
    for (const page of [pageA, pageB]) {
      await expectRendered(page, movedByA)
      await expectCommitted(page, movedByA, 2)
    }

    await pressAt(pageA, 620, 280)
    await moveTo(pageA, 700, 330)
    const resizedByA = { ...movedByA, width: 200, height: 130 }
    await expectRendered(pageB, resizedByA)

    await pressAt(pageB, 550, 250)
    await moveTo(pageB, 150, 150)
    await pageB.mouse.up()
    await expectCommitted(pageA, { ...movedByA, x: 100, y: 100 }, 3)
    await expectRendered(pageA, resizedByA)

    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expectRendered(page, resizedByA)
      await expectCommitted(page, resizedByA, 4)
    }
  } finally {
    await closeSession(session)
  }
})
