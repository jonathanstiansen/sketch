import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, framesDir] = process.argv.slice(2)
const viewport = { width: 760, height: 520 }
const HOLD = 4
const elements = "#elements [data-element]"
const ellipse = '#elements [data-element][data-kind="ellipse"]'
const strokeRed = '#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]'
const strokeInk = '#style-panel [data-style-property="stroke_color"] button[data-style-value="ink"]'
const strokeBlue = '#style-panel [data-style-property="stroke_color"] button[data-style-value="blue"]'
let frame = 0

const captionStyle =
  "position:fixed;left:12px;bottom:70px;z-index:99;padding:6px 10px;border-radius:8px;background:#111;color:#fff;font:600 14px system-ui;pointer-events:none"

async function caption(page, text) {
  await page.evaluate(
    ([style, label]) => {
      let tag = document.getElementById("demo-caption")
      if (tag === null) {
        tag = document.createElement("div")
        tag.id = "demo-caption"
        document.body.append(tag)
      }
      tag.style.cssText = style
      tag.textContent = label
    },
    [captionStyle, text],
  )
}

async function snap(pages, labelA, labelB, hold = HOLD) {
  await caption(pages[0], `A: ${labelA}`)
  await caption(pages[1], `B: ${labelB}`)
  for (let i = 0; i < hold; i++) {
    const name = String(frame).padStart(3, "0")
    await pages[0].screenshot({ path: `${framesDir}/a-${name}.png` })
    await pages[1].screenshot({ path: `${framesDir}/b-${name}.png` })
    frame += 1
  }
}

async function screenAt(page, x, y) {
  const box = await page.locator("#canvas").boundingBox()
  return { x: box.x + x, y: box.y + y }
}

async function pointerTo(page, x, y, options = {}) {
  const at = await screenAt(page, x, y)
  await page.mouse.move(at.x, at.y, options)
}

async function count(page, selector, n) {
  await page.waitForFunction(([css, want]) => document.querySelectorAll(css).length === want, [selector, n])
}

async function drag(page, from, to, steps = 15) {
  await pointerTo(page, ...from)
  await page.mouse.down()
  await pointerTo(page, ...to, { steps })
  await page.mouse.up()
}

async function draw(page, key, from, to) {
  await page.keyboard.press(key)
  await drag(page, from, to)
  await page.keyboard.press("v")
}

mkdirSync(framesDir, { recursive: true })
const browser = await chromium.launch()
try {
  const contexts = await Promise.all(
    [0, 1].map(() => newContext(browser, { viewport, deviceScaleFactor: 1 })),
  )
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
  await pageA.locator(strokeRed).click()
  await draw(pageA, "r", [60, 60], [160, 130])
  await pageA.keyboard.press("o")
  await pageA.locator(strokeInk).click()
  await draw(pageA, "o", [200, 60], [280, 130])
  await draw(pageA, "l", [320, 60], [400, 130])
  await count(pageB, elements, 3)
  await snap(pages, "draws a red rectangle, an ellipse and a line", "sees them")

  await pointerTo(pageA, 30, 30)
  await pageA.mouse.down()
  for (const [x, y] of [[200, 100], [430, 160]]) {
    await pointerTo(pageA, x, y, { steps: 8 })
    await snap(pages, "drags a marquee on empty canvas", "sees no marquee", 2)
  }
  await pageA.mouse.up()
  await snap(pages, "three selected: group outline, one per element, no handles", "sees no selection")

  await pointerTo(pageA, 110, 95)
  await pageA.mouse.down()
  for (const [x, y] of [[150, 150], [200, 210], [250, 260]]) {
    await pointerTo(pageA, x, y, { steps: 8 })
    await snap(pages, "drags the group", "sees all three move live (one group_preview per tick)", 2)
  }
  await pageA.mouse.up()
  await snap(pages, "releases: one commit per element", "sees the committed positions")

  await pageA.locator(strokeBlue).click()
  await pageB.waitForFunction(() => document.querySelectorAll('#elements [data-stroke-color="blue"]').length === 3)
  await snap(pages, "the stroke colour was mixed; blue applies to all three", "sees three blue strokes")

  await pageA.keyboard.press("Delete")
  await count(pageB, elements, 0)
  await snap(pages, "Delete erases the selection", "sees all three go")
  await pageA.keyboard.press("ControlOrMeta+z")
  await count(pageB, elements, 3)
  await snap(pages, "one undo brings all three back", "sees them back")

  await pageA.keyboard.press("ControlOrMeta+a")
  await pointerTo(pageA, 300, 400)
  await pageA.mouse.down()
  for (const [x, y] of [[150, 410], [0, 420]]) {
    await pointerTo(pageA, x, y, { steps: 8 })
    await snap(pages, "Ctrl/Cmd+A, drags left past the edge", "sees the group stop at x = 0, layout kept", 2)
  }
  await pageA.mouse.up()
  await count(pageB, ellipse, 1)
  await snap(pages, "the delta was clamped for the whole group", "sees the same layout at the edge")
  await Promise.all(contexts.map((context) => context.close()))
} finally {
  await browser.close()
}
