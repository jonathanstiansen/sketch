import { test } from "@playwright/test"
import { http } from "msw"

test("mocks the transport", async ({ page }) => {
  await page.route("**/live/**", (route) => route.abort())
  const sinon = require("sinon")
  await import("@mswjs/interceptors")
  void http
  void sinon
})
