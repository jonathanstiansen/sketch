import { createRequire } from "node:module"

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const [baseURL, boardId, outDir] = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme, viewport: { width: 1100, height: 640 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.goto(`${baseURL}/b/${boardId}`)
    await page.locator("[data-element]").nth(20).waitFor()
    await page.locator(".phx-connected").first().waitFor()
    for (const [action, extension] of [
      ["download_svg", "svg"],
      ["download_png", "png"],
    ]) {
      await page.keyboard.press("Control+Shift+E")
      const download = page.waitForEvent("download")
      await page.locator(`#export-menu [data-export-action="${action}"]`).click()
      await (await download).saveAs(`${outDir}/sample-${colorScheme}.${extension}`)
    }
    if (colorScheme === "light") {
      await page.keyboard.press("Control+Shift+E")
      const menu = await page.locator("#export-menu").boundingBox()
      const button = await page.locator("#export-button").boundingBox()
      if (menu === null || button === null) throw new Error("the export menu is not visible")
      const left = Math.min(menu.x, button.x) - 12
      const top = Math.min(menu.y, button.y) - 12
      await page.screenshot({
        path: `${outDir}/menu.png`,
        clip: {
          x: left,
          y: top,
          width: Math.max(menu.x + menu.width, button.x + button.width) + 12 - left,
          height: Math.max(menu.y + menu.height, button.y + button.height) + 12 - top,
        },
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
}
