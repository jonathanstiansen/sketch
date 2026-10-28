import { expect, test } from "@playwright/test"

test("two browser contexts open the home page", async ({ browser }) => {
  const first = await browser.newContext()
  const second = await browser.newContext()

  try {
    const [firstPage, secondPage] = await Promise.all([first.newPage(), second.newPage()])

    for (const page of [firstPage, secondPage]) {
      await page.goto("/")
      await expect(page.getByText("Peace of mind from prototype to production.")).toBeVisible()
    }

    await firstPage.screenshot({ path: "test-results/home.png" })
  } finally {
    await first.close()
    await second.close()
  }
})
