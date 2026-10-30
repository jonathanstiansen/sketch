import { writeFileSync } from "node:fs"
import { chromium } from "../../../e2e/node_modules/@playwright/test/index.mjs"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const [baseURL, htmlOutput, screenshot] = process.argv.slice(2)
const browser = await chromium.launch()
try {
  const context = await newContext(browser, { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(baseURL)
  await page.click("#new-board")
  await page.locator("#toolbar").waitFor()
  const html = [await page.locator("#toolbar").evaluate((e) => e.outerHTML)]
  await page.click("#shortcuts-help-button")
  await page.locator("#shortcuts-help").waitFor()
  html.push(await page.locator("#shortcuts-help").evaluate((e) => e.outerHTML))
  writeFileSync(htmlOutput, html.join("\n"))
  if (screenshot !== undefined) {
    await page.mouse.move(0, 700)
    await page.screenshot({ path: screenshot, clip: { x: 0, y: 0, width: 1280, height: 560 } })
  }
} finally {
  await browser.close()
}
