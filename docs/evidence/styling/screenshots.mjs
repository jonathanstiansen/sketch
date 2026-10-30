import { createRequire } from "node:module"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, boardId, outPrefix] = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const colorScheme of ["light", "dark"]) {
    const context = await newContext(browser, { colorScheme, viewport: { width: 1100, height: 640 } })
    const page = await context.newPage()
    await page.goto(`${baseURL}/b/${boardId}`)
    await page.locator("[data-element]").nth(20).waitFor()
    await page.locator(".phx-connected").first().waitFor()
    const canvas = await page.locator("#canvas").boundingBox()
    if (canvas === null) throw new Error("canvas is not visible")
    await page.screenshot({
      path: `${outPrefix}-${colorScheme}.png`,
      clip: { x: canvas.x + 20, y: canvas.y + 20, width: 1040, height: 460 },
    })
    await page.close()
  }
} finally {
  await browser.close()
}
