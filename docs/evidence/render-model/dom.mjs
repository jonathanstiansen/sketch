import { chromium } from "../../../e2e/node_modules/@playwright/test/index.mjs"
import { newContext } from "../../../e2e/tests/support/contexts.ts"

const [baseURL, screenshot] = process.argv.slice(2)
const element = "[data-element][data-kind='rectangle']"
const viewport = { width: 960, height: 600 }

function clean(html) {
  return html
    .replace(/ (data-phx-loc|data-phx-id|phx-r|data-phx-stream)="[^"]*"/g, "")
    .replace(/<!--.*?-->/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")
    .replace(/>\s+</g, "><")
}

async function show(label, page, selector) {
  await page.locator(selector).waitFor()
  console.log(`${label}:\n  ${clean(await page.locator(selector).evaluate((node) => node.outerHTML))}`)
}

async function canvasPoint(page, x, y) {
  const box = await page.locator("#canvas").boundingBox()
  return { x: box.x + x, y: box.y + y }
}

async function press(page, x, y) {
  const at = await canvasPoint(page, x, y)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
}

async function move(page, x, y) {
  const at = await canvasPoint(page, x, y)
  await page.mouse.move(at.x, at.y, { steps: 20 })
}

const browser = await chromium.launch()
try {
  const [pageA, pageB] = await Promise.all([1, 2].map(async () => (await newContext(browser, { viewport })).newPage()))
  await pageA.goto(baseURL)
  await pageA.click("#new-board")
  await pageA.waitForURL(/\/b\//)
  await pageB.goto(pageA.url())
  await Promise.all([pageA, pageB].map((page) => page.locator("[data-phx-main].phx-connected").waitFor()))

  await pageA.click("#add-rectangle")
  await pageB.locator(element).waitFor()
  await show("B after A adds a rectangle", pageB, element)

  await press(pageA, 120, 120)
  await move(pageA, 320, 170)
  await show("A mid-move (live box and transform changed; committed data-* and children unchanged)", pageA, `${element}[x='300']`)
  await show("B mid-move, from A's preview", pageB, `${element}[x='300']`)
  await pageA.mouse.up()
  await pageA.locator(`${element}[data-version='1']`).waitFor()

  await press(pageA, 420, 230)
  await move(pageA, 500, 300)
  await show("B mid-resize (the client renderer redrew the child)", pageB, `${element}[width='200']`)
  await pageA.mouse.up()
  await show("B after A's resize is committed (server render)", pageB, `${element}[data-version='2']`)

  await pageA.keyboard.press("r")
  await press(pageA, 600, 380)
  await move(pageA, 760, 480)
  await show("B's preview of A's rectangle in progress", pageB, "[data-draw][width='160']")
  if (screenshot !== undefined) await pageB.screenshot({ path: screenshot })
  await pageA.mouse.up()
} finally {
  await browser.close()
}
