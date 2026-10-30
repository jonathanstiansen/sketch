import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, framesDir] = process.argv.slice(2)
const viewport = { width: 760, height: 520 }
const HOLD = 4
const rectangle = '#elements [data-element][data-kind="rectangle"]'
let frame = 0

async function overlay(page, id, css, text) {
  await page.evaluate(
    ([tagId, style, label]) => {
      let tag = document.getElementById(tagId)
      if (tag === null) {
        tag = document.createElement("div")
        tag.id = tagId
        document.body.append(tag)
      }
      tag.style.cssText = style
      tag.textContent = label
    },
    [id, css, text],
  )
}

const captionStyle =
  "position:fixed;left:12px;bottom:70px;z-index:99;padding:6px 10px;border-radius:8px;background:#111;color:#fff;font:600 14px system-ui;pointer-events:none"

async function crosshair(page, at) {
  await overlay(
    page,
    "demo-crosshair",
    `position:fixed;left:${at.x - 9}px;top:${at.y - 9}px;width:18px;height:18px;border:2px solid #e11d48;border-radius:50%;z-index:99;pointer-events:none`,
    "",
  )
}

async function level(page) {
  return page.locator("#zoom-level").innerText()
}

async function snap(pages, labelA, labelB) {
  await overlay(pages[0], "demo-caption", captionStyle, `A: ${labelA} (${await level(pages[0])})`)
  await overlay(pages[1], "demo-caption", captionStyle, `B: ${labelB} (${await level(pages[1])})`)
  for (let i = 0; i < HOLD; i++) {
    const name = String(frame).padStart(3, "0")
    await pages[0].screenshot({ path: `${framesDir}/a-${name}.png` })
    await pages[1].screenshot({ path: `${framesDir}/b-${name}.png` })
    frame += 1
  }
}

async function screenAt(page, x, y) {
  const box = await page.locator("#canvas").boundingBox()
  const zoom = Number(await page.locator("#canvas-viewport").getAttribute("data-zoom"))
  return { x: box.x + x * zoom, y: box.y + y * zoom }
}

async function drag(page, from, to) {
  const start = await screenAt(page, ...from)
  const end = await screenAt(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 20 })
  await page.mouse.up()
}

async function zoomIs(page, zoom) {
  await page.waitForFunction(
    (want) => Math.abs(Number(document.querySelector("#canvas-viewport").dataset.zoom) - want) < 1e-6,
    zoom,
  )
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

  await pageA.keyboard.press("r")
  await drag(pageA, [120, 90], [320, 200])
  await pageA.keyboard.press("v")
  await pageB.locator(rectangle).waitFor()
  await snap(pages, "draws a rectangle at 100%", "watching at 100%")

  const corner = await screenAt(pageA, 320, 200)
  await pageA.mouse.move(corner.x, corner.y)
  await crosshair(pageA, corner)
  await snap(pages, "the pointer is on the rectangle's corner", "watching at 100%")

  await pageA.keyboard.down("Control")
  for (const [delta, zoom] of [[-200, 1.284], [-200, 1.649], [-200, 2.117], [200, 1.649], [200, 1.284]]) {
    await pageA.mouse.wheel(0, delta)
    await pageA.waitForFunction(
      (want) => Math.abs(Number(document.querySelector("#canvas-viewport").dataset.zoom) - want) < 0.01,
      zoom,
    )
    await snap(pages, "Ctrl+wheel, the corner stays under the pointer", "watching at 100%")
  }
  await pageA.keyboard.up("Control")

  await pageA.keyboard.press("Control+0")
  await zoomIs(pageA, 1)
  await pageA.keyboard.press("Control+-")
  await pageA.keyboard.press("Control+-")
  await zoomIs(pageA, 0.5)
  await pageA.locator("#canvas-viewport").evaluate((el) => el.scrollTo(0, 0))
  await pageA.evaluate(() => document.getElementById("demo-crosshair")?.remove())
  await snap(pages, "zoomed out to 50%", "watching at 100%")

  await pageA.keyboard.press("r")
  const start = await screenAt(pageA, 360, 160)
  const end = await screenAt(pageA, 560, 290)
  await pageA.mouse.move(start.x, start.y)
  await pageA.mouse.down()
  for (const t of [0.25, 0.5, 0.75, 1]) {
    await pageA.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, { steps: 6 })
    await snap(pages, "drags a rectangle at 50%", "sees the preview in the same canvas place")
  }
  await pageA.mouse.up()
  await pageA.keyboard.press("v")
  await pageB.waitForFunction(() => document.querySelectorAll('#elements [data-kind="rectangle"]').length === 2)
  await snap(pages, "the rectangle is created", "sees it at the same canvas place")
  await Promise.all(contexts.map((context) => context.close()))
} finally {
  await browser.close()
}
