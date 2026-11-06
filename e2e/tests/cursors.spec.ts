import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { addRectangle, closeSession, moveTo, openSharedBoard, type Session } from "./support/canvas"
import { createBoard } from "./support/board"
import { newContext } from "./support/contexts"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const remoteCursor = "#remote-cursors [data-cursor]"
const ownName = "#viewer-name .font-semibold"
const TOLERANCE = 1

interface Spot {
  x: number
  y: number
}

function avatarOf(name: string): string {
  return `#viewer-roster button[aria-label*="${name}"]`
}

async function viewerName(page: Page): Promise<string> {
  return (await page.locator(ownName).innerText()).trim()
}

async function canvasSpot(page: Page, name: string): Promise<Spot> {
  const transform = (await page.locator(`${remoteCursor}[data-name="${name}"]`).getAttribute("transform")) ?? ""
  const [x = NaN, y = NaN] = (/translate\((-?\d+) (-?\d+)\)/.exec(transform) ?? []).slice(1).map(Number)
  return { x, y }
}

async function expectCursorNear(page: Page, name: string, expected: Spot): Promise<void> {
  await expect
    .poll(async () => {
      const { x, y } = await canvasSpot(page, name)
      return Math.max(Math.abs(x - expected.x), Math.abs(y - expected.y))
    })
    .toBeLessThanOrEqual(TOLERANCE)
}

async function arrowOffsetOnScreen(page: Page, name: string): Promise<Spot> {
  return page.evaluate((cursorName) => {
    const arrow = document.querySelector(`#remote-cursors [data-name="${cursorName}"] .remote-cursor-arrow`)
    const canvas = document.querySelector("#canvas")
    if (arrow === null || canvas === null) throw new Error("cursor or canvas missing")
    const a = arrow.getBoundingClientRect()
    const c = canvas.getBoundingClientRect()
    return { x: a.left - c.left, y: a.top - c.top }
  }, name)
}

async function scrollViewport(page: Page, left: number, top: number): Promise<void> {
  await page.locator("#canvas-viewport").evaluate((viewport, to) => {
    viewport.scrollTo(to.left, to.top)
  }, { left, top })
  await expect.poll(() => page.locator("#canvas-viewport").evaluate((viewport) => viewport.scrollLeft)).toBe(left)
}

async function leaveCanvas(page: Page): Promise<void> {
  await page.mouse.move(5, 5, { steps: 5 })
}

async function pretendTabHidden(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

async function newViewer(browser: Parameters<typeof openSharedBoard>[0]): Promise<Session> {
  return openSharedBoard(browser, "cursors")
}

test("B sees A's labelled cursor at A's canvas spot, also after either side scrolls", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA, pageB } = session
  try {
    const nameA = await viewerName(pageA)
    const nameB = await viewerName(pageB)
    expect(nameA).not.toBe("")

    await moveTo(pageA, 300, 200)
    const label = pageB.locator(`${remoteCursor}[data-name="${nameA}"]`)
    await expect(label).toHaveCount(1)
    await expect(label.locator(".remote-cursor-name")).toHaveText(nameA)
    await expectCursorNear(pageB, nameA, { x: 300, y: 200 })
    await expect(pageA.locator(remoteCursor)).toHaveCount(0)

    const before = await arrowOffsetOnScreen(pageB, nameA)
    expect(Math.abs(before.x - 300)).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs(before.y - 200)).toBeLessThanOrEqual(TOLERANCE)

    await scrollViewport(pageB, 120, 80)
    const after = await arrowOffsetOnScreen(pageB, nameA)
    expect(Math.abs(after.x - 300)).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs(after.y - 200)).toBeLessThanOrEqual(TOLERANCE)
    const boxes = await pageB.locator("#canvas").boundingBox()
    expect(boxes?.x).toBeLessThan(0)

    await scrollViewport(pageA, 400, 250)
    await moveTo(pageA, 600, 450)
    await expectCursorNear(pageB, nameA, { x: 600, y: 450 })

    await moveTo(pageB, 400, 300)
    await expectCursorNear(pageA, nameB, { x: 400, y: 300 })
    await expect(pageA.locator(remoteCursor)).toHaveCount(1)

    const underCursor = await pageB.evaluate(({ x, y }) => {
      const canvas = document.querySelector("#canvas")?.getBoundingClientRect()
      const hit = document.elementFromPoint((canvas?.left ?? 0) + x + 2, (canvas?.top ?? 0) + y + 2)
      return hit?.closest("#remote-cursors") !== null
    }, { x: 600, y: 450 })
    expect(underCursor).toBe(false)

    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/cursor-seen-by-b.png` })
  } finally {
    await closeSession(session)
  }
})

test("A leaving the canvas removes A's cursor on B, and coming back shows it again", async ({ browser }) => {
  const session = await openSharedBoard(browser, "cursors-leave", (page) => page.clock.install())
  const { pageA, pageB } = session
  try {
    await pageB.clock.pauseAt(Date.now() + 1000)
    const nameA = await viewerName(pageA)
    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)

    await leaveCanvas(pageA)
    await expect(pageB.locator(remoteCursor)).toHaveCount(0)

    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(`${remoteCursor}[data-name="${nameA}"]`)).toHaveCount(1)
  } finally {
    await closeSession(session)
  }
})

test("A's tab becoming hidden removes A's cursor on B", async ({ browser }) => {
  const session = await openSharedBoard(browser, "cursors-leave", (page) => page.clock.install())
  const { pageA, pageB } = session
  try {
    await pageB.clock.pauseAt(Date.now() + 1000)
    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)

    await pretendTabHidden(pageA)
    await expect(pageB.locator(remoteCursor)).toHaveCount(0)
  } finally {
    await closeSession(session)
  }
})

test("a cursor that stops moving stays on the canvas", async ({ browser }) => {
  const session = await openSharedBoard(browser, "cursors-still", (page) => page.clock.install())
  const { pageA, pageB } = session
  try {
    await pageB.clock.pauseAt(Date.now() + 1000)
    await moveTo(pageA, 300, 200)
    await expectCursorNear(pageB, await viewerName(pageA), { x: 300, y: 200 })

    await pageB.clock.runFor(60_000)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)
    await expectCursorNear(pageB, await viewerName(pageA), { x: 300, y: 200 })
  } finally {
    await closeSession(session)
  }
})

test("closing A's tab removes A's cursor and avatar on B", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA, pageB } = session
  try {
    const nameA = await viewerName(pageA)
    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)
    await expect(pageB.locator(avatarOf(nameA))).toHaveCount(1)

    await pageA.close()
    await expect(pageB.locator(remoteCursor)).toHaveCount(0)
    await expect(pageB.locator(avatarOf(nameA))).toHaveCount(0)
    await expect(pageB.locator("#viewer-roster-empty")).toBeVisible()
  } finally {
    await closeSession(session)
  }
})

test("a viewer who opens the board later sees a cursor that is already resting", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA } = session
  const contextC = await newContext(browser)
  try {
    await moveTo(pageA, 640, 360)
    const pageC = await contextC.newPage()
    await pageC.goto(pageA.url())
    await expect(pageC.locator("[data-phx-main].phx-connected")).toBeVisible()
    await expectCursorNear(pageC, await viewerName(pageA), { x: 640, y: 360 })
  } finally {
    await contextC.close()
    await closeSession(session)
  }
})

test("B sees everyone in the header and jumps to A's cursor while A is on the canvas", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA, pageB } = session
  try {
    const nameA = await viewerName(pageA)
    const avatarA = pageB.locator(avatarOf(nameA))
    await expect(avatarA).toBeDisabled()

    await scrollViewport(pageA, 2000, 2200)
    await moveTo(pageA, 2400, 2500)
    await expect(avatarA).toBeEnabled()
    await expect(pageB.locator(`${remoteCursor}[data-name="${nameA}"]`)).not.toBeInViewport()

    await avatarA.click()
    await expect(pageB.locator(`${remoteCursor}[data-name="${nameA}"] .remote-cursor-arrow`)).toBeInViewport()
    await expect
      .poll(() =>
        pageB.locator("#canvas-viewport").evaluate((viewport) =>
          Math.max(
            Math.abs(viewport.scrollLeft + viewport.clientWidth / 2 - 2400),
            Math.abs(viewport.scrollTop + viewport.clientHeight / 2 - 2500),
          ),
        ),
      )
      .toBeLessThanOrEqual(TOLERANCE)
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/jump-to-viewer.png` })

    await leaveCanvas(pageA)
    await expect(avatarA).toBeDisabled()
  } finally {
    await closeSession(session)
  }
})

test("a viewer on another board sees nothing and is seen by nobody", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA, pageB } = session
  const contextC = await newContext(browser)
  try {
    const pageC = await contextC.newPage()
    await createBoard(pageC)

    const [nameA, nameB, nameC] = await Promise.all([viewerName(pageA), viewerName(pageB), viewerName(pageC)])

    await moveTo(pageC, 400, 400)
    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(`${remoteCursor}[data-name="${nameA}"]`)).toHaveCount(1)
    await moveTo(pageB, 100, 100)
    await expect(pageA.locator(`${remoteCursor}[data-name="${nameB}"]`)).toHaveCount(1)

    expect(await pageA.locator(remoteCursor).count()).toBe(1)
    expect(await pageB.locator(remoteCursor).count()).toBe(1)
    expect(await pageC.locator(remoteCursor).count()).toBe(0)
    expect(await pageA.locator(`${remoteCursor}[data-name="${nameC}"]`).count()).toBe(0)
    expect(await pageB.locator(`${remoteCursor}[data-name="${nameC}"]`).count()).toBe(0)
  } finally {
    await contextC.close()
    await closeSession(session)
  }
})

test("an export made while cursors are shown contains no cursors", async ({ browser }) => {
  const session = await newViewer(browser)
  const { pageA, pageB } = session
  try {
    await addRectangle(pageA)
    await expect(pageB.locator("#elements > [data-element]")).toHaveCount(1)
    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)
    const nameA = await viewerName(pageA)

    await pageB.keyboard.press("Control+Shift+E")
    const download = pageB.waitForEvent("download")
    await pageB.locator('#export-menu [data-export-action="download_svg"]').click()
    const svg = readFileSync(await (await download).path(), "utf8")

    expect(svg).toContain("data-element")
    expect(svg).not.toContain("remote-cursor")
    expect(svg).not.toContain("data-cursor")
    expect(svg).not.toContain(nameA)
  } finally {
    await closeSession(session)
  }
})

test("a dark theme shows cursors with readable labels", async ({ browser }) => {
  const contexts = await Promise.all([newContext(browser, { colorScheme: "dark" }), newContext(browser, { colorScheme: "dark" })])
  try {
    const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
    if (pageA === undefined || pageB === undefined) throw new Error("pages did not open")
    const path = await createBoard(pageA)
    await pageB.goto(path)
    await expect(pageB.locator("[data-phx-main].phx-connected")).toBeVisible()

    await moveTo(pageA, 300, 200)
    await expect(pageB.locator(remoteCursor)).toHaveCount(1)
    const colors = await pageB.locator(".remote-cursor-name").evaluate((label) => {
      const tag = label.parentElement?.querySelector(".remote-cursor-tag")
      return { text: getComputedStyle(label).fill, tag: tag === null || tag === undefined ? "" : getComputedStyle(tag).fill }
    })
    expect(colors.text).not.toBe(colors.tag)
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/cursor-dark.png` })
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
