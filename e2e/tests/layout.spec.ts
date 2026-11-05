import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { createBoard } from "./support/board"

const WIDTHS = [860, 1024, 1280, 1600] as const
const HEIGHT = 800
const screenshotDir = process.env.E2E_SCREENSHOT_DIR

const headerItems = [
  "button",
  "a[href]",
  "input",
  "select",
  "[role='toolbar']",
  "[role='group']",
  "#viewer-name",
  "#canvas-hint",
].join(", ")

const styleBarItems = "[data-style-hint], [data-style-property] button"
const canvasControls = ["#history-controls", "#zoom-controls", "#viewer-roster-card"] as const

interface Rect {
  label: string
  left: number
  top: number
  right: number
  bottom: number
}

interface Placed extends Rect {
  path: string
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function nested(a: Placed, b: Placed): boolean {
  return a.path.startsWith(b.path) || b.path.startsWith(a.path)
}

function overlappingPairs(rects: readonly Placed[]): string[] {
  return rects.flatMap((a, index) =>
    rects
      .slice(index + 1)
      .filter((b) => !nested(a, b) && overlaps(a, b))
      .map((b) => `${a.label} overlaps ${b.label}`),
  )
}

function outsideViewport(rects: readonly Rect[], width: number): string[] {
  return rects
    .filter((rect) => rect.left < 0 || rect.right > width)
    .map((rect) => `${rect.label} spans ${String(rect.left)}..${String(rect.right)} outside 0..${String(width)}`)
}

async function placedItems(page: Page, container: string, selector: string): Promise<Placed[]> {
  return page.locator(container).evaluate((root, itemSelector) => {
    function pathOf(element: Element): string {
      const indexes: number[] = []
      let node: Element | null = element
      while (node !== null && node !== root) {
        const parent: Element | null = node.parentElement
        indexes.unshift(parent === null ? 0 : Array.from(parent.children).indexOf(node))
        node = parent
      }
      return `${indexes.join("/")}/`
    }

    function labelOf(element: Element): string {
      const name = element.getAttribute("aria-label") ?? element.textContent.replace(/\s+/g, " ").trim().slice(0, 30)
      return `${element.tagName.toLowerCase()}${element.id === "" ? "" : `#${element.id}`} "${name}"`
    }

    return Array.from(root.querySelectorAll(itemSelector))
      .filter((element) => element.checkVisibility())
      .map((element) => {
        const box = element.getBoundingClientRect()
        return {
          label: labelOf(element),
          path: pathOf(element),
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        }
      })
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
  }, selector)
}

async function controlRects(page: Page): Promise<Placed[]> {
  return Promise.all(
    canvasControls.map(async (selector, index) => {
      const box = await page.locator(selector).boundingBox()
      if (box === null) throw new Error(`${selector} is not visible`)
      return { label: selector, path: `control-${String(index)}/`, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }
    }),
  )
}

async function canvasClientArea(page: Page): Promise<Rect> {
  return page.locator("#canvas-viewport").evaluate((viewport) => {
    const box = viewport.getBoundingClientRect()
    const left = box.left + viewport.clientLeft
    const top = box.top + viewport.clientTop
    return { label: "canvas client area", left, top, right: left + viewport.clientWidth, bottom: top + viewport.clientHeight }
  })
}

function outsideArea(rects: readonly Rect[], area: Rect): string[] {
  return rects
    .filter((rect) => rect.left < area.left || rect.top < area.top || rect.right > area.right || rect.bottom > area.bottom)
    .map((rect) => `${rect.label} leaves the ${area.label} (over a scrollbar or the edge)`)
}

async function layoutProblems(page: Page, width: number): Promise<string[]> {
  const header = await placedItems(page, "#board-header", headerItems)
  const styleBar = await placedItems(page, "#style-panel", styleBarItems)
  const styleBarBox = await page.locator("#style-panel").boundingBox()
  if (styleBarBox === null) throw new Error("the style bar is not visible")
  const styleBarRect: Placed = {
    label: "#style-panel",
    path: "style-panel/",
    left: styleBarBox.x,
    top: styleBarBox.y,
    right: styleBarBox.x + styleBarBox.width,
    bottom: styleBarBox.y + styleBarBox.height,
  }
  const chrome = [...header.map((rect) => ({ ...rect, path: `header/${rect.path}` })), styleBarRect]
  const controls = await controlRects(page)

  return [
    ...overlappingPairs(chrome),
    ...overlappingPairs(styleBar),
    ...outsideViewport([...chrome, ...styleBar], width),
    ...overlappingPairs(controls),
    ...outsideArea(controls, await canvasClientArea(page)),
  ]
}

async function openFreshBoard(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: HEIGHT })
  await createBoard(page)
  await expect(page.locator("#board-url")).toBeVisible()
}

for (const width of WIDTHS) {
  test(`at ${String(width)}x${String(HEIGHT)} the header, style bar and canvas controls do not overlap or leave the viewport`, async ({
    page,
  }) => {
    await openFreshBoard(page, width)
    expect(await layoutProblems(page, width)).toEqual([])

    if (screenshotDir !== undefined) {
      mkdirSync(screenshotDir, { recursive: true })
      await page.screenshot({ path: `${screenshotDir}/header-${String(width)}.png`, clip: { x: 0, y: 0, width, height: 160 } })
    }
  })

  test(`at ${String(width)}x${String(HEIGHT)} the style bar with a drawing tool selected stays in place`, async ({ page }) => {
    await openFreshBoard(page, width)
    await page.locator("#tool-rectangle").click()
    await expect(page.locator("#style-stroke_color")).toBeVisible()
    expect(await layoutProblems(page, width)).toEqual([])
  })
}
