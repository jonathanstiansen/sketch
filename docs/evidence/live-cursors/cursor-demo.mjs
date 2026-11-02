import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, framesDir] = process.argv.slice(2)
const FRAMES = 36
const viewport = { width: 860, height: 440 }
const names = ["a", "b", "c"]

function pathFor(index, step) {
  const t = (step / FRAMES) * 2 * Math.PI
  const centres = [{ x: 420, y: 120 }, { x: 580, y: 170 }, { x: 500, y: 90 }]
  const radii = [{ x: 150, y: 70 }, { x: 120, y: 80 }, { x: 170, y: 50 }]
  const centre = centres[index]
  const radius = radii[index]
  const phase = index * 2.1
  return { x: Math.round(centre.x + radius.x * Math.cos(t + phase)), y: Math.round(centre.y + radius.y * Math.sin(t * (index + 1) + phase)) }
}

async function canvasOrigin(page) {
  const box = await page.locator("#canvas").boundingBox()
  return { x: box.x, y: box.y }
}

async function seesOthersAt(page, expected) {
  await page.waitForFunction(
    (spots) => {
      const found = [...document.querySelectorAll("#remote-cursors [data-cursor]")].map((g) => /translate\((-?\d+) (-?\d+)\)/.exec(g.getAttribute("transform") ?? "").slice(1).map(Number))
      return spots.every(([x, y]) => found.some(([fx, fy]) => Math.abs(fx - x) <= 1 && Math.abs(fy - y) <= 1))
    },
    expected.map(({ x, y }) => [x, y]),
  )
}

mkdirSync(framesDir, { recursive: true })
const browser = await chromium.launch()
try {
  const contexts = await Promise.all(names.map(() => newContext(browser, { viewport, deviceScaleFactor: 1 })))
  const pages = await Promise.all(contexts.map((context) => context.newPage()))
  await pages[0].goto(baseURL)
  await pages[0].locator(".phx-connected").first().waitFor()
  await pages[0].locator("#new-board").click()
  await pages[0].waitForURL(/\/b\//)
  await pages[0].locator(".phx-connected").first().waitFor()
  for (const page of pages.slice(1)) {
    await page.goto(pages[0].url())
    await page.locator(".phx-connected").first().waitFor()
  }
  const origins = await Promise.all(pages.map(canvasOrigin))

  for (let step = 0; step < FRAMES; step++) {
    const spots = names.map((_, index) => pathFor(index, step))
    for (const [index, page] of pages.entries()) {
      await page.mouse.move(origins[index].x + spots[index].x, origins[index].y + spots[index].y)
    }
    for (const [index, page] of pages.entries()) {
      await seesOthersAt(page, spots.filter((_, other) => other !== index))
    }
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: `${framesDir}/${names[index]}-${String(step).padStart(3, "0")}.png`, clip: { x: 220, y: 0, width: 640, height: 440 } })
    }
  }
  await Promise.all(contexts.map((context) => context.close()))
} finally {
  await browser.close()
}
