import { readFileSync } from "node:fs"
import { expect, test, type Browser, type BrowserContext, type Download, type Page } from "@playwright/test"
import { clickAt, moveTo, pressAt } from "./support/canvas"
import { createBoard } from "./support/board"

const evidenceDir = process.env.E2E_EVIDENCE_DIR
const PADDING = 16
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const element = "#elements > [data-element]"
const openButton = "#export-button"
const menu = "#export-menu"

interface Point {
  x: number
  y: number
}

interface ElementBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface SvgSummary {
  parsed: boolean
  viewBox: string | null
  width: string | null
  height: string | null
  elementIds: string[]
  classAttributes: number
  paints: string[]
  handleNodes: number
  rootRectFill: string | null
  markers: string[]
  markerReferences: string[]
  textFontFamilies: string[]
}

async function newExportContext(browser: Browser, options: { colorScheme?: "light" | "dark"; deviceScaleFactor?: number } = {}): Promise<BrowserContext> {
  return browser.newContext({
    colorScheme: options.colorScheme ?? "light",
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    permissions: ["clipboard-read", "clipboard-write"],
  })
}

async function drawShape(page: Page, key: string, from: Point, to: Point): Promise<void> {
  const before = await page.locator(element).count()
  await page.keyboard.press(key)
  await pressAt(page, from.x, from.y)
  await moveTo(page, to.x, to.y)
  await page.mouse.up()
  await expect(page.locator(element)).toHaveCount(before + 1)
  await page.keyboard.press("v")
}

async function sampleBoard(page: Page): Promise<void> {
  await createBoard(page)
  await drawShape(page, "r", { x: 120, y: 100 }, { x: 320, y: 230 })
  await clickAt(page, 220, 165)
  await page.locator('#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]').click()
  await page.locator('#style-panel [data-style-property="fill_color"] button[data-style-value="yellow"]').click()
  await drawShape(page, "o", { x: 400, y: 120 }, { x: 560, y: 240 })
  await drawShape(page, "a", { x: 130, y: 330 }, { x: 540, y: 400 })
  await expect(page.locator(element)).toHaveCount(3)
  await expect(page.locator("#elements > [data-kind='rectangle'][data-stroke-color='red'][data-fill-color='yellow']")).toHaveCount(1)
}

async function elementBoxes(page: Page): Promise<ElementBox[]> {
  return page.locator(element).evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-element") ?? "",
      x: Number(node.getAttribute("x")),
      y: Number(node.getAttribute("y")),
      width: Number(node.getAttribute("width")),
      height: Number(node.getAttribute("height")),
    })),
  )
}

function croppedTo(boxes: readonly ElementBox[]): string {
  const left = Math.min(...boxes.map(({ x }) => x)) - PADDING
  const top = Math.min(...boxes.map(({ y }) => y)) - PADDING
  const right = Math.max(...boxes.map(({ x, width }) => x + width)) + PADDING
  const bottom = Math.max(...boxes.map(({ y, height }) => y + height)) + PADDING
  return `${String(left)} ${String(top)} ${String(right - left)} ${String(bottom - top)}`
}

async function openExportMenu(page: Page): Promise<void> {
  await page.locator(openButton).click()
  await expect(page.locator(menu)).toBeVisible()
}

async function downloadVia(page: Page, action: "download_png" | "download_svg"): Promise<Download> {
  if (!(await page.locator(menu).isVisible())) await openExportMenu(page)
  const download = page.waitForEvent("download")
  await page.locator(`${menu} [data-export-action="${action}"]`).click()
  return download
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path()
  return readFileSync(path)
}

async function summarise(page: Page, markup: string): Promise<SvgSummary> {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml")
    const root = doc.documentElement
    const parsed = doc.querySelector("parsererror") === null && root.localName === "svg"
    const all = [...doc.querySelectorAll("*")]
    const paints = all.flatMap((node) => ["fill", "stroke"].map((name) => node.getAttribute(name)).filter((value) => value !== null))
    const children = [...root.children]
    const rootRect = children.find((child) => child.localName === "rect")
    return {
      parsed,
      viewBox: root.getAttribute("viewBox"),
      width: root.getAttribute("width"),
      height: root.getAttribute("height"),
      elementIds: [...doc.querySelectorAll("g[data-element]")].map((node) => node.getAttribute("data-element") ?? ""),
      classAttributes: all.filter((node) => node.hasAttribute("class")).length,
      paints,
      handleNodes: doc.querySelectorAll("[data-handle], [data-selection-outline], .selection-outline, .selection-handle, [data-draw]").length,
      rootRectFill: rootRect?.getAttribute("fill") ?? null,
      markers: [...doc.querySelectorAll("defs > marker")].map((node) => node.getAttribute("id") ?? ""),
      markerReferences: all.map((node) => node.getAttribute("marker-end")).filter((value) => value !== null),
      textFontFamilies: [...doc.querySelectorAll("text")].map((node) => node.getAttribute("font-family") ?? ""),
    }
  }, markup)
}

function expectConcrete(paints: readonly string[]): void {
  expect(paints.length).toBeGreaterThan(0)
  for (const paint of paints) expect(paint).toMatch(/^(#[0-9a-f]{6}|none)$/)
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test("Download SVG is a standalone file cropped to the content with every colour inlined and no selection handles", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await clickAt(page, 220, 165)
    await expect(page.locator("#canvas-viewport")).toHaveAttribute("data-selected-element", /.+/)
    await expect(page.locator("#selection [data-handle]")).toHaveCount(4)
    const boxes = await elementBoxes(page)

    const download = await downloadVia(page, "download_svg")
    expect(download.suggestedFilename()).toMatch(/^sketch-[0-9a-f]{8}-\d{8}-\d{4}\.svg$/)
    const svg = await summarise(page, (await downloadedBytes(download)).toString("utf8"))

    expect(svg.parsed).toBe(true)
    expect(svg.viewBox).toBe(croppedTo(boxes))
    expect(`${svg.width ?? ""} ${svg.height ?? ""}`).toBe((svg.viewBox ?? "").split(" ").slice(2).join(" "))
    expect(svg.elementIds.sort()).toEqual(boxes.map(({ id }) => id).sort())
    expect(svg.handleNodes).toBe(0)
    expect(svg.classAttributes).toBe(0)
    expectConcrete(svg.paints)
    expect(new Set(svg.paints).size).toBeGreaterThan(3)
    expect(svg.rootRectFill).toMatch(/^#[0-9a-f]{6}$/)
    expect(svg.markers).toHaveLength(1)
    expect(svg.markerReferences).toEqual([`url(#${svg.markers[0] ?? ""})`])
  } finally {
    await context.close()
  }
})

test("Background off leaves the SVG transparent", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await openExportMenu(page)
    await page.locator(menu).getByLabel("Background").uncheck()
    const svg = await summarise(page, (await downloadedBytes(await downloadVia(page, "download_svg"))).toString("utf8"))
    expect(svg.rootRectFill).toBeNull()
    expect(svg.elementIds).toHaveLength(3)
  } finally {
    await context.close()
  }
})

test("Download PNG is a PNG at the device pixel ratio of the cropped area", async ({ browser }) => {
  const context = await newExportContext(browser, { deviceScaleFactor: 2 })
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    const [, , width = 0, height = 0] = croppedTo(await elementBoxes(page)).split(" ").map(Number)

    const download = await downloadVia(page, "download_png")
    expect(download.suggestedFilename()).toMatch(/^sketch-[0-9a-f]{8}-\d{8}-\d{4}\.png$/)
    const bytes = await downloadedBytes(download)

    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
    expect(pngSize(bytes)).toEqual({ width: width * 2, height: height * 2 })
    if (evidenceDir !== undefined) await page.screenshot({ path: `${evidenceDir}/menu.png`, clip: await menuClip(page) })
  } finally {
    await context.close()
  }
})

async function menuClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  await openExportMenu(page)
  const menuBox = await page.locator(menu).boundingBox()
  const buttonBox = await page.locator(openButton).boundingBox()
  if (menuBox === null || buttonBox === null) throw new Error("the export menu is not visible")
  const left = Math.min(menuBox.x, buttonBox.x) - 12
  const top = Math.min(menuBox.y, buttonBox.y) - 12
  const right = Math.max(menuBox.x + menuBox.width, buttonBox.x + buttonBox.width) + 12
  const bottom = Math.max(menuBox.y + menuBox.height, buttonBox.y + buttonBox.height) + 12
  return { x: left, y: top, width: right - left, height: bottom - top }
}

test("Shift+Alt+C copies the board to the clipboard as a PNG with the SVG as text", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await page.keyboard.press("Shift+Alt+C")
    await expect(page.locator("#export-status")).toHaveText("Copied as PNG")

    const clipboard = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      if (item === undefined) return null
      const png = new Uint8Array(await (await item.getType("image/png")).arrayBuffer())
      const text = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : ""
      return { types: item.types, signature: [...png.subarray(0, 8)], text }
    })
    expect(clipboard?.types).toContain("image/png")
    expect(clipboard?.signature).toEqual(PNG_SIGNATURE)
    expect(clipboard?.text).toContain("<svg")
  } finally {
    await context.close()
  }
})

test("Copy as PNG in the menu puts an image on the clipboard", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await openExportMenu(page)
    await page.locator(`${menu} [data-export-action="copy_png"]`).click()
    await expect(page.locator("#export-status")).toHaveText("Copied as PNG")
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => [...item.types]))
    expect(types).toContain("image/png")
  } finally {
    await context.close()
  }
})

test("Only selected exports just the selected element, and is disabled without a selection", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await openExportMenu(page)
    const only = page.locator(menu).getByLabel("Only selected")
    await expect(only).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(page.locator(menu)).toBeHidden()

    await clickAt(page, 480, 180)
    await openExportMenu(page)
    await expect(only).toBeEnabled()
    await only.check()
    const selectedId = await page.locator("#canvas-viewport").getAttribute("data-selected-element")
    const selected = (await elementBoxes(page)).filter(({ id }) => id === selectedId)
    expect(selected).toHaveLength(1)

    const svg = await summarise(page, (await downloadedBytes(await downloadVia(page, "download_svg"))).toString("utf8"))
    expect(svg.elementIds).toEqual([selectedId])
    expect(svg.viewBox).toBe(croppedTo(selected))
    expect(svg.markers).toHaveLength(0)
    expect(svg.handleNodes).toBe(0)

    await clickAt(page, 700, 500)
    await expect(only).toBeDisabled()
    await expect(only).not.toBeChecked()
  } finally {
    await context.close()
  }
})

test("a dark theme export uses the dark palette and background", async ({ browser }) => {
  const light = await newExportContext(browser, { colorScheme: "light" })
  const dark = await newExportContext(browser, { colorScheme: "dark" })
  try {
    const lightPage = await light.newPage()
    await sampleBoard(lightPage)
    const lightSvg = await summarise(lightPage, (await downloadedBytes(await downloadVia(lightPage, "download_svg"))).toString("utf8"))

    const darkPage = await dark.newPage()
    await sampleBoard(darkPage)
    const darkSvg = await summarise(darkPage, (await downloadedBytes(await downloadVia(darkPage, "download_svg"))).toString("utf8"))

    expectConcrete(darkSvg.paints)
    expect(luminance(lightSvg.rootRectFill ?? "#000000")).toBeGreaterThan(0.8)
    expect(luminance(darkSvg.rootRectFill ?? "#ffffff")).toBeLessThan(0.3)
    expect(darkSvg.paints).not.toEqual(lightSvg.paints)
  } finally {
    await Promise.all([light.close(), dark.close()])
  }
})

test("Ctrl+Shift+E opens a keyboard-operable menu and Escape closes it", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await sampleBoard(page)
    await page.keyboard.press("Control+Shift+E")
    await expect(page.locator(menu)).toBeVisible()
    await expect(page.locator(openButton)).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator(`${menu} [data-export-action="download_png"]`)).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.locator(`${menu} [data-export-action="download_svg"]`)).toBeFocused()
    const download = page.waitForEvent("download")
    await page.keyboard.press("Enter")
    expect((await download).suggestedFilename()).toMatch(/\.svg$/)
    await expect(page.locator(menu)).toBeHidden()
    await expect(page.locator(openButton)).toBeFocused()

    await page.keyboard.press("Control+Shift+E")
    await page.keyboard.press("Escape")
    await expect(page.locator(menu)).toBeHidden()
  } finally {
    await context.close()
  }
})

test("an empty board says there is nothing to export", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  try {
    await createBoard(page)
    await page.keyboard.press("Shift+Alt+C")
    await expect(page.locator("#export-status")).toHaveText("Nothing to export")
    await openExportMenu(page)
    await page.locator(`${menu} [data-export-action="download_svg"]`).click()
    await expect(page.locator("#export-status")).toHaveText("Nothing to export")
  } finally {
    await context.close()
  }
})

test("a clipboard failure shows a message instead of throwing", async ({ browser }) => {
  const context = await newExportContext(browser)
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await sampleBoard(page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    })
    await page.keyboard.press("Shift+Alt+C")
    await expect(page.locator("#export-status")).toContainText("Export failed")
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("the shortcuts help lists the export shortcuts", async ({ page }) => {
  await createBoard(page)
  await page.keyboard.press("?")
  const help = page.locator("#shortcuts-help")
  await expect(help).toBeVisible()
  await expect(help).toContainText("Copy as PNG")
  await expect(help).toContainText("Export")
})
