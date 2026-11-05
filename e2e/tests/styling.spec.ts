import { expect, test, type Page } from "@playwright/test"
import { clickAt, closeSession, moveTo, openSharedBoard, pressAt } from "./support/canvas"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const panel = "#style-panel"
const PROPERTIES = ["stroke_color", "fill_color", "stroke_width", "stroke_style", "sloppiness"] as const

type Property = (typeof PROPERTIES)[number]
type Style = Partial<Record<Property, string>>

function attribute(property: Property): string {
  return `data-${property.replaceAll("_", "-")}`
}

function swatch(property: Property, token: string): string {
  return `${panel} [data-style-property="${property}"] button[data-style-value="${token}"]`
}

async function expectStyle(page: Page, selector: string, style: Style): Promise<void> {
  for (const [property, token] of Object.entries(style) as [Property, string][]) {
    await expect(page.locator(selector)).toHaveAttribute(attribute(property), token)
  }
}

async function expectNothingOffered(page: Page): Promise<void> {
  await expect(page.locator(`${panel} [data-style-hint]`)).toBeVisible()
  await expect(page.locator(`${panel} [data-style-property]:visible`)).toHaveCount(0)
}

async function expectOffered(page: Page, offered: readonly Property[]): Promise<void> {
  await expect(page.locator(`${panel} [data-style-hint]`)).toBeHidden()
  for (const property of PROPERTIES) {
    const group = page.locator(`${panel} [data-style-property="${property}"]`)
    if (offered.includes(property)) {
      await expect(group).toBeVisible()
    } else {
      await expect(group).toBeHidden()
    }
  }
}

async function pick(page: Page, property: Property, token: string): Promise<void> {
  await page.locator(swatch(property, token)).click()
  await expect(page.locator(swatch(property, token))).toHaveAttribute("aria-pressed", "true")
}

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await pressAt(page, from.x, from.y)
  await moveTo(page, to.x, to.y)
}

test("A sets a stroke colour, a dashed stroke and a fill on a rectangle, B sees it, and a reload keeps it", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "styling-restyle")
  const { pageA, pageB } = session
  const rectangle = '[data-element][data-kind="rectangle"]'
  try {
    await expectNothingOffered(pageA)
    await pageA.keyboard.press("r")
    await draw(pageA, { x: 120, y: 100 }, { x: 320, y: 230 })
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) await expect(page.locator(rectangle)).toHaveAttribute("data-version", "0")

    await pageA.keyboard.press("v")
    await pageA.keyboard.press("Escape")
    await expectNothingOffered(pageA)
    await clickAt(pageA, 200, 160)
    await expectOffered(pageA, PROPERTIES)
    await expect(pageA.locator(swatch("stroke_color", "ink"))).toHaveAttribute("aria-pressed", "true")

    await pick(pageA, "stroke_color", "red")
    await expect(pageA.locator(rectangle)).toHaveAttribute("data-version", "1")
    await pick(pageA, "stroke_style", "dashed")
    await expect(pageA.locator(rectangle)).toHaveAttribute("data-version", "2")
    await pick(pageA, "fill_color", "blue")
    await expect(pageA.locator(rectangle)).toHaveAttribute("data-version", "3")
    if (evidenceDir !== undefined) {
      await pageA.locator(panel).screenshot({ path: `${evidenceDir}/panel.png` })
    }

    const styled = { stroke_color: "red", stroke_style: "dashed", fill_color: "blue", stroke_width: "thin" }
    await pageB.reload()
    for (const page of [pageA, pageB]) {
      await expectStyle(page, rectangle, styled)
      await expect(page.locator(rectangle)).toHaveAttribute("data-version", "3")
      await expect(page.locator(`${rectangle} > rect`)).toHaveClass("fill-palette-blue")
      const sketch = page.locator(`${rectangle} > path[data-sketch]`)
      await expect(sketch).toHaveClass("stroke-palette-red")
      await expect(sketch).toHaveAttribute("stroke-dasharray", "8 6")
      await expect(sketch).toHaveCSS("stroke-dasharray", "8px, 6px")
    }
    const red = await pageB.locator(`${rectangle} > path[data-sketch]`).evaluate((path) => getComputedStyle(path).stroke)
    const ink = await pageB
      .locator('#canvas defs marker#arrowhead-ink > path')
      .evaluate((path) => getComputedStyle(path).fill)
    expect(red).not.toEqual(ink)
  } finally {
    await closeSession(session)
  }
})

test("the next element is drawn in the panel's current style, previewed in it in both browsers, and keeps only what its kind takes", async ({
  browser,
}) => {
  const session = await openSharedBoard(browser, "styling-next")
  const { pageA, pageB } = session
  const ellipsePreview = '[data-draw][data-kind="ellipse"]'
  const ellipse = '[data-element][data-kind="ellipse"]'
  const line = '[data-element][data-kind="line"]'
  try {
    await pageA.keyboard.press("o")
    await expectOffered(pageA, PROPERTIES)
    await pick(pageA, "stroke_color", "green")
    await pick(pageA, "fill_color", "yellow")
    await pick(pageA, "stroke_style", "dotted")
    await pageA.locator(swatch("stroke_width", "bold")).focus()
    await pageA.keyboard.press("Enter")
    await expect(pageA.locator(swatch("stroke_width", "bold"))).toHaveAttribute("aria-pressed", "true")
    await expect(pageA.locator("[data-element]")).toHaveCount(0)

    const next = { stroke_color: "green", fill_color: "yellow", stroke_width: "bold", stroke_style: "dotted" }
    await draw(pageA, { x: 100, y: 100 }, { x: 300, y: 220 })
    for (const page of [pageA, pageB]) {
      await expectStyle(page, ellipsePreview, next)
      await expect(page.locator(`${ellipsePreview} > path[data-sketch]`)).toHaveAttribute("stroke-dasharray", "0 8")
    }
    await pageA.mouse.up()
    for (const page of [pageA, pageB]) {
      await expect(page.locator(ellipse)).toHaveCount(1)
      await expectStyle(page, ellipse, next)
      await expect(page.locator(`${ellipse} > ellipse`)).toHaveClass("fill-palette-yellow")
    }

    await pageA.keyboard.press("l")
    await expectOffered(pageA, ["stroke_color", "stroke_width", "stroke_style", "sloppiness"])
    await expect(pageA.locator(swatch("stroke_color", "green"))).toHaveAttribute("aria-pressed", "true")
    await draw(pageA, { x: 100, y: 300 }, { x: 300, y: 380 })
    await pageA.mouse.up()
    await pageB.reload()
    for (const page of [pageA, pageB]) {
      await expect(page.locator(line)).toHaveCount(1)
      await expectStyle(page, line, { ...next, fill_color: "auto" })
      await expect(page.locator(`${line} > path[data-line-stroke]`)).toHaveAttribute("stroke-width", "3")
    }
  } finally {
    await closeSession(session)
  }
})

test("text only offers a stroke colour, which colours its glyphs", async ({ browser }) => {
  const session = await openSharedBoard(browser, "styling-text")
  const { pageA, pageB } = session
  const text = '[data-element][data-kind="text"]'
  try {
    await pageA.keyboard.press("t")
    await expectOffered(pageA, ["stroke_color"])
    await pick(pageA, "stroke_color", "blue")
    await clickAt(pageA, 200, 200)
    await pageA.keyboard.type("blue words")
    await pageA.keyboard.press("Escape")
    for (const page of [pageA, pageB]) {
      await expectStyle(page, text, { stroke_color: "blue", fill_color: "auto", stroke_width: "thin", stroke_style: "solid" })
      await expect(page.locator(`${text} > text[data-text-body]`)).toHaveClass("text-element ink-palette-blue")
    }

    await pageA.keyboard.press("v")
    await clickAt(pageA, 210, 210)
    await expectOffered(pageA, ["stroke_color"])
    await pick(pageA, "stroke_color", "orange")
    for (const page of [pageA, pageB]) await expectStyle(page, text, { stroke_color: "orange" })
  } finally {
    await closeSession(session)
  }
})

test("sloppiness makes strokes cleaner or rougher for both viewers, and a reload keeps it (addendum D16)", async ({ browser }) => {
  const session = await openSharedBoard(browser, "styling-sloppiness")
  const { pageA, pageB } = session
  const rectangles = '[data-element][data-kind="rectangle"]'
  const levels = ["architect", "artist", "cartoonist"] as const
  try {
    await pageA.keyboard.press("r")
    await expectOffered(pageA, PROPERTIES)
    await expect(pageA.locator(swatch("sloppiness", "artist"))).toHaveAttribute("aria-pressed", "true")

    for (const [index, level] of levels.entries()) {
      await pageA.keyboard.press("r")
      await pick(pageA, "sloppiness", level)
      await draw(pageA, { x: 80 + index * 220, y: 120 }, { x: 260 + index * 220, y: 260 })
      await pageA.mouse.up()
    }
    for (const page of [pageA, pageB]) await expect(page.locator(rectangles)).toHaveCount(3)

    const outlines = async (page: Page): Promise<Record<string, string>> =>
      Object.fromEntries(
        await page.locator(rectangles).evaluateAll((nodes) =>
          nodes.map((node) => [node.getAttribute("data-sloppiness") ?? "", node.querySelector("path[data-sketch]")?.getAttribute("d") ?? ""]),
        ),
      )
    const seenByA = await outlines(pageA)
    expect(Object.keys(seenByA).sort()).toEqual([...levels].sort())
    expect(new Set(Object.values(seenByA)).size).toBe(3)
    await expect.poll(() => outlines(pageB)).toEqual(seenByA)
    if (evidenceDir !== undefined) await pageB.screenshot({ path: `${evidenceDir}/sloppiness-levels.png` })

    await pageA.keyboard.press("v")
    await clickAt(pageA, 170, 125)
    await expect(pageA.locator(swatch("sloppiness", "architect"))).toHaveAttribute("aria-pressed", "true")
    await pick(pageA, "sloppiness", "cartoonist")
    for (const page of [pageA, pageB]) await expect(page.locator(rectangles).first()).toHaveAttribute("data-sloppiness", "cartoonist")

    await pageB.reload()
    await expect(pageB.locator(rectangles).first()).toHaveAttribute("data-sloppiness", "cartoonist")
  } finally {
    await closeSession(session)
  }
})
