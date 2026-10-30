import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, framesDir] = process.argv.slice(2)
const viewport = { width: 760, height: 520 }
const HOLD = 4
const arrow = '#elements [data-element][data-kind="arrow"]'
const rectangle = '#elements [data-element][data-kind="rectangle"]'
const strokeRed = '#style-panel [data-style-property="stroke_color"] button[data-style-value="red"]'
const strokeBold = '#style-panel [data-style-property="stroke_width"] button[data-style-value="bold"]'
const strokeDashed = '#style-panel [data-style-property="stroke_style"] button[data-style-value="dashed"]'
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

async function snap(pages, labelA, labelB) {
  await overlay(pages[0], "demo-caption", captionStyle, `A: ${labelA}`)
  await overlay(pages[1], "demo-caption", captionStyle, `B: ${labelB}`)
  for (let i = 0; i < HOLD; i++) {
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

  await pageA.keyboard.press("a")
  await pageA.locator(strokeRed).click()
  await pageA.locator(strokeBold).click()
  await pageA.locator(strokeDashed).click()
  await pointerTo(pageA, 80, 80)
  await pageA.mouse.down()
  await pointerTo(pageA, 200, 140, { steps: 20 })
  await pageA.mouse.up()
  await pageA.keyboard.press("v")
  await count(pageB, arrow, 1)
  await snap(pages, "draws a red, bold, dashed arrow", "sees it")

  await pointerTo(pageA, 140, 110)
  await pageA.mouse.click(...Object.values(await screenAt(pageA, 140, 110)))
  await snap(pages, "selects the arrow", "sees it")

  await pageA.keyboard.press("ControlOrMeta+d")
  await count(pageA, arrow, 2)
  await count(pageB, arrow, 2)
  await snap(pages, "Ctrl/Cmd+D duplicates it, offset by 10", "sees an identical copy")

  await pageA.keyboard.press("ControlOrMeta+c")
  await pointerTo(pageA, 500, 300)
  await snap(pages, "Ctrl/Cmd+C copies, the pointer moves", "sees nothing yet")
  await pageA.keyboard.press("ControlOrMeta+v")
  await count(pageA, arrow, 3)
  await count(pageB, arrow, 3)
  await snap(pages, "Ctrl/Cmd+V pastes centred on the pointer", "sees the pasted arrow")

  await pageA.keyboard.press("r")
  await pointerTo(pageA, 90, 220)
  await pageA.mouse.down()
  await pointerTo(pageA, 200, 290, { steps: 15 })
  await pageA.mouse.up()
  await pageA.keyboard.press("v")
  await count(pageB, rectangle, 1)
  await snap(pages, "draws a rectangle", "sees it")

  await pageA.keyboard.down("Alt")
  await pointerTo(pageA, 140, 250)
  await pageA.mouse.down()
  for (const [x, y] of [[220, 260], [320, 270], [420, 240]]) {
    await pointerTo(pageA, x, y, { steps: 8 })
    await snap(pages, "Alt+drag: the copy follows, the original stays", "sees the copy preview, the original stays")
  }
  await pageA.mouse.up()
  await pageA.keyboard.up("Alt")
  await count(pageA, rectangle, 2)
  await count(pageB, rectangle, 2)
  await snap(pages, "drops the copy", "sees the copy at the drop point")

  await pageA.evaluate(() => navigator.clipboard.writeText('{"type":"sketch/elements","version":1,"elements":[{"kind":"bogus"}]}'))
  await pageA.keyboard.press("ControlOrMeta+v")
  await pageA.locator("#history-status").waitFor({ state: "visible" })
  await snap(pages, "pastes a malformed envelope: a short flash, nothing created", "unchanged")

  await pageA.keyboard.press("ControlOrMeta+z")
  await pageA.keyboard.press("ControlOrMeta+z")
  await count(pageB, rectangle, 1)
  await snap(pages, "undo removes the alt-dragged copy, then the pasted arrow", "sees them go")
  await Promise.all(contexts.map((context) => context.close()))
} finally {
  await browser.close()
}
