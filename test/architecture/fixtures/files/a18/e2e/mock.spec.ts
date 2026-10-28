import { test } from "@playwright/test"
import { http } from "msw"

test("mocks the transport", async ({ page }) => {
  await page.route("**/live/**", (route) => route.abort())
  void http
})
