import { mkdirSync } from "node:fs"
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createBoard, openBoard } from "./support/board"

const recordingDir = process.env.E2E_RECORD_DIR
const recordingSize = { width: 960, height: 600 }
const rectangle = "rect[data-element]"
const viewport = "#canvas-viewport"

interface Session {
  pageA: Page
  pageB: Page
  contexts: BrowserContext[]
}

function recordingOptions(name: string) {
  if (recordingDir === undefined) return {}
  const dir = `${recordingDir}/${name}`
  mkdirSync(dir, { recursive: true })
  return { recordVideo: { dir, size: recordingSize }, viewport: recordingSize }
}

async function openSharedBoard(browser: Browser, name: string): Promise<Session> {
  const contexts = await Promise.all([
    browser.newContext(recordingOptions(`${name}-a`)),
    browser.newContext(recordingOptions(`${name}-b`)),
  ])
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
  if (pageA === undefined || pageB === undefined) throw new Error("pages did not open")
  await openBoard(pageB, await createBoard(pageA))
  return { pageA, pageB, contexts }
}

async function closeSession({ contexts }: Session): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()))
}

async function expectTool(page: Page, tool: string): Promise<void> {
  await expect(page.locator(`[data-tool-button][aria-pressed="true"]`)).toHaveAttribute(
    "data-tool-button",
    tool,
  )
  await expect(page.locator(viewport)).toHaveAttribute("data-tool", tool)
}

async function canvasPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator("#canvas").boundingBox()
  if (box === null) throw new Error("canvas is not visible")
  return { x: box.x + x, y: box.y + y }
}

async function addRectangle(session: Session): Promise<void> {
  await session.pageA.locator("#add-rectangle").click()
  await expect(session.pageA.locator(rectangle)).toHaveAttribute("x", "100")
  await expect(session.pageB.locator(rectangle)).toHaveAttribute("x", "100")
}

async function dragFromRectangle(page: Page, dx: number, dy: number): Promise<void> {
  const start = await canvasPoint(page, 160, 140)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 })
  await page.mouse.up()
}

async function expectScroll(page: Page, left: number, top: number): Promise<void> {
  await expect
    .poll(() => page.locator(viewport).evaluate((el) => [el.scrollLeft, el.scrollTop]))
    .toEqual([left, top])
}

async function expectUnmoved(session: Session): Promise<void> {
  for (const page of [session.pageA, session.pageB]) {
    await expect(page.locator(rectangle)).toHaveAttribute("x", "100")
    await expect(page.locator(rectangle)).toHaveAttribute("data-version", "0")
  }
}

async function resetScroll(page: Page): Promise<void> {
  await page.locator(viewport).evaluate((el) => {
    el.scrollTo(0, 0)
  })
  await expectScroll(page, 0, 0)
}

test("R and a click create a rectangle B sees; H and Space pan A without moving it", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "shortcuts")
  const { pageA, pageB } = session
  try {
    await expectTool(pageA, "selection")
    await pageA.keyboard.press("r")
    await expectTool(pageA, "rectangle")
    const target = await canvasPoint(pageA, 300, 200)
    await pageA.mouse.click(target.x, target.y)
    for (const page of [pageA, pageB]) {
      await expect(page.locator(rectangle)).toHaveAttribute("x", "300")
      await expect(page.locator(rectangle)).toHaveAttribute("y", "200")
    }

    await pageA.keyboard.press("h")
    await expectTool(pageA, "hand")
    const grab = await canvasPoint(pageA, 340, 240)
    await pageA.mouse.move(grab.x, grab.y)
    await pageA.mouse.down()
    await pageA.mouse.move(grab.x - 150, grab.y - 120, { steps: 15 })
    await pageA.mouse.up()
    await expectScroll(pageA, 150, 120)

    await pageA.keyboard.press("v")
    await expectTool(pageA, "selection")
    const rect = pageA.locator(rectangle)
    const box = await rect.boundingBox()
    if (box === null) throw new Error("rectangle is not visible")
    await pageA.keyboard.down("Space")
    await pageA.mouse.move(box.x + 40, box.y + 40)
    await pageA.mouse.down()
    await pageA.mouse.move(box.x - 60, box.y - 40, { steps: 15 })
    await pageA.mouse.up()
    await pageA.keyboard.up("Space")
    await expectScroll(pageA, 250, 200)

    for (const page of [pageA, pageB]) {
      await expect(page.locator(rectangle)).toHaveAttribute("x", "300")
      await expect(page.locator(rectangle)).toHaveAttribute("data-version", "0")
    }
  } finally {
    await closeSession(session)
  }
})

test("2 selects Rectangle; V and 1 return to Selection and dragging still moves", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "selection")
  const { pageA, pageB } = session
  try {
    await addRectangle(session)
    for (const back of ["v", "1"]) {
      await pageA.keyboard.press("2")
      await expectTool(pageA, "rectangle")
      await pageA.keyboard.press(back)
      await expectTool(pageA, "selection")
    }

    await dragFromRectangle(pageA, 200, 100)
    for (const page of [pageA, pageB]) {
      await expect(page.locator(rectangle)).toHaveAttribute("x", "300")
      await expect(page.locator(rectangle)).toHaveAttribute("y", "200")
      await expect(page.locator(rectangle)).toHaveAttribute("data-version", "1")
    }
    await expectScroll(pageA, 0, 0)
  } finally {
    await closeSession(session)
  }
})

test("the Hand tool, Space and the middle button pan the viewport and never move a rectangle", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "panning")
  const { pageA } = session
  try {
    await addRectangle(session)

    await pageA.keyboard.press("h")
    await dragFromRectangle(pageA, -100, -60)
    await expectScroll(pageA, 100, 60)
    await expectUnmoved(session)

    await resetScroll(pageA)
    await pageA.keyboard.press("v")
    await pageA.keyboard.down("Space")
    await dragFromRectangle(pageA, -80, -50)
    await pageA.keyboard.up("Space")
    await expectScroll(pageA, 80, 50)
    await expectUnmoved(session)

    await resetScroll(pageA)
    const start = await canvasPoint(pageA, 160, 140)
    await pageA.mouse.move(start.x, start.y)
    await pageA.mouse.down({ button: "middle" })
    await pageA.mouse.move(start.x - 70, start.y - 40, { steps: 10 })
    await pageA.mouse.up({ button: "middle" })
    await expectScroll(pageA, 70, 40)
    await expectUnmoved(session)
    await expectTool(pageA, "selection")
  } finally {
    await closeSession(session)
  }
})

test("every toolbar shortcut and button selects its tool; disabled tools stay unselected", async ({
  page,
}) => {
  await createBoard(page)
  const buttons = await page.locator("[data-tool-button]").evaluateAll((elements) =>
    elements.map((el) => ({
      tool: el.getAttribute("data-tool-button") ?? "",
      keys: (el.getAttribute("aria-keyshortcuts") ?? "").split(" "),
      enabled: el.getAttribute("aria-disabled") === "false" && !el.hasAttribute("disabled"),
    })),
  )
  expect(buttons.map(({ tool }) => tool)).toEqual([
    "hand",
    "selection",
    "rectangle",
    "diamond",
    "ellipse",
    "arrow",
    "line",
    "draw",
    "text",
    "note",
    "eraser",
  ])

  expect(buttons.filter(({ enabled }) => enabled).map(({ tool }) => tool)).toEqual([
    "hand",
    "selection",
    "rectangle",
    "diamond",
    "ellipse",
  ])
  expect(buttons.find(({ tool }) => tool === "diamond")?.keys).toEqual(["D", "3"])
  expect(buttons.find(({ tool }) => tool === "ellipse")?.keys).toEqual(["O", "4"])

  for (const { tool, keys, enabled } of buttons) {
    for (const key of keys) {
      await page.keyboard.press("h")
      await expectTool(page, "hand")
      await page.keyboard.press(key.toLowerCase())
      await expectTool(page, enabled ? tool : "hand")
    }
    if (enabled) {
      await page.locator("#tool-selection").click()
      await page.locator(`#tool-${tool}`).click()
      await expectTool(page, tool)
    } else {
      await expect(page.locator(`#tool-${tool}`)).toBeDisabled()
      await expect(page.locator(`#tool-${tool}`)).toHaveAttribute("title", /Coming soon/)
    }
  }

  await page.locator("#tool-hand").focus()
  await page.keyboard.press("Space")
  await expectTool(page, "hand")
})

test("Esc returns to Selection and modified or typed keys never change the tool", async ({
  page,
}) => {
  await createBoard(page)
  for (const tool of ["h", "r"]) {
    await page.keyboard.press(tool)
    await page.keyboard.press("Escape")
    await expectTool(page, "selection")
  }

  await page.keyboard.press("Alt+r")
  await page.keyboard.press("Control+h")
  await expectTool(page, "selection")

  await page.evaluate(() => {
    const input = document.createElement("input")
    input.id = "probe-input"
    const editor = document.createElement("div")
    editor.id = "probe-editor"
    editor.contentEditable = "true"
    document.body.append(input, editor)
  })
  await page.locator("#probe-input").fill("")
  await page.locator("#probe-input").pressSequentially("hr2 ")
  await expect(page.locator("#probe-input")).toHaveValue("hr2 ")
  await page.locator("#probe-editor").pressSequentially("h2")
  await expect(page.locator("#probe-editor")).toHaveText("h2")
  await expectTool(page, "selection")
})

test("? toggles the shortcuts help and Esc closes it", async ({ page }) => {
  await createBoard(page)
  const help = page.locator("#shortcuts-help")
  const helpButton = page.locator("#shortcuts-help-button")
  await expect(help).toBeHidden()
  await expect(page.locator("#canvas-hint")).toHaveText(
    "To move canvas, hold Scroll wheel or Space while dragging, or use the hand tool",
  )

  await page.keyboard.press("?")
  await expect(help).toBeVisible()
  await expect(helpButton).toHaveAttribute("aria-expanded", "true")
  await page.keyboard.press("?")
  await expect(help).toBeHidden()
  await expect(helpButton).toHaveAttribute("aria-expanded", "false")

  await helpButton.click()
  await expect(help).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(help).toBeHidden()
  await expect(helpButton).toHaveAttribute("aria-expanded", "false")
})
