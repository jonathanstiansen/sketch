import { test } from "@playwright/test"

test("waits a fixed time", async ({ page }) => {
  await page.waitForTimeout(500)
  await new Promise((resolve) => setTimeout(resolve, 500))
})
