import { test } from "@playwright/test"

test("opens its own contexts", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await browser.newPage()
  const other = await browser
    .newContext()
  await context.newPage()
  void page
  void other
})
