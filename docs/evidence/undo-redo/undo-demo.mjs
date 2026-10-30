import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, framesDir] = process.argv.slice(2)
const viewport = { width: 1280, height: 520 }
const HOLD = 4
const rectangle = '#elements [data-element][data-kind="rectangle"]'
let frame = 0

async function caption(page, text) {
  await page.evaluate((label) => {
    let tag = document.getElementById("demo-caption")
    if (tag === null) {
      tag = document.createElement("div")
      tag.id = "demo-caption"
      tag.style.cssText =
        "position:fixed;left:120px;bottom:20px;z-index:99;padding:6px 10px;border-radius:8px;background:#111;color:#fff;font:600 14px system-ui"
      document.body.append(tag)
    }
    tag.textContent = label
  }, text)
}

async function shows(page, expected) {
  await page.waitForFunction(
    ([selector, want]) => {
      const shapes = [...document.querySelectorAll(selector)]
      if (want === null) return shapes.length === 0
      const [shape] = shapes
      return (
        shapes.length === 1 &&
        shape.getAttribute("data-x") === String(want.x) &&
        shape.getAttribute("data-y") === String(want.y) &&
        shape.getAttribute("data-stroke-color") === want.stroke
      )
    },
    [rectangle, expected],
  )
}

async function canvasPoint(page, x, y) {
  const box = await page.locator("#canvas").boundingBox()
  return { x: box.x + x, y: box.y + y }
}

async function drag(page, from, to) {
  const start = await canvasPoint(page, ...from)
  const end = await canvasPoint(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 20 })
  await page.mouse.up()
}

async function snap(pages, labelA, expected) {
  for (const page of pages) await shows(page, expected)
  await caption(pages[0], `A: ${labelA}`)
  await caption(pages[1], "B: watching")
  for (let i = 0; i < HOLD; i++) {
    const name = String(frame).padStart(3, "0")
    await pages[0].screenshot({ path: `${framesDir}/a-${name}.png` })
    await pages[1].screenshot({ path: `${framesDir}/b-${name}.png` })
    frame += 1
  }
}

mkdirSync(framesDir, { recursive: true })
const browser = await chromium.launch()
try {
  const contexts = await Promise.all([0, 1].map(() => newContext(browser, { viewport, deviceScaleFactor: 1 })))
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
  const pages = [pageA, pageB]
  await pageA.goto(baseURL)
  await pageA.locator(".phx-connected").first().waitFor()
  await pageA.locator("#new-board").click()
  await pageA.waitForURL(/\/b\//)
  await pageA.locator(".phx-connected").first().waitFor()
  await pageB.goto(pageA.url())
  await pageB.locator(".phx-connected").first().waitFor()

  const drawn = { x: 80, y: 60, stroke: "ink" }
  const moved = { x: 280, y: 140, stroke: "ink" }
  const red = { x: 280, y: 140, stroke: "red" }

  await snap(pages, "empty board", null)
  await pageA.keyboard.press("r")
  await drag(pageA, [80, 60], [240, 160])
  await pageA.keyboard.press("v")
  await snap(pages, "draws a rectangle", drawn)
  await drag(pageA, [160, 110], [360, 190])
  await snap(pages, "moves it", moved)
  await pageA.locator('#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]').click()
  await snap(pages, "makes it red", red)
  await pageA.keyboard.press("Delete")
  await snap(pages, "erases it", null)

  for (const [label, expected] of [
    ["Ctrl+Z: erase undone (new id)", red],
    ["Ctrl+Z: colour undone", moved],
    ["Ctrl+Z: move undone", drawn],
    ["Ctrl+Z: create undone", null],
  ]) {
    await pageA.keyboard.press("ControlOrMeta+z")
    await snap(pages, label, expected)
  }
  for (const [label, expected] of [
    ["Ctrl+Shift+Z: create redone", drawn],
    ["Ctrl+Shift+Z: move redone", moved],
    ["Ctrl+Shift+Z: colour redone", red],
    ["Ctrl+Shift+Z: erase redone", null],
  ]) {
    await pageA.keyboard.press("ControlOrMeta+Shift+z")
    await snap(pages, label, expected)
  }
  await Promise.all(contexts.map((context) => context.close()))
} finally {
  await browser.close()
}
