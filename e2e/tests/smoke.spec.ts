import { expect, test } from "@playwright/test"
import { newContext } from "./support/contexts"

test("two browser contexts open the home page", async ({ browser }) => {
  const first = await newContext(browser)
  const second = await newContext(browser)

  try {
    const [firstPage, secondPage] = await Promise.all([first.newPage(), second.newPage()])

    for (const page of [firstPage, secondPage]) {
      await page.goto("/")
      await expect(page.locator("#new-board")).toBeVisible()
    }

    await firstPage.screenshot({ path: "test-results/home.png" })
  } finally {
    await first.close()
    await second.close()
  }
})
