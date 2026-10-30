import type { Browser, BrowserContext } from "@playwright/test"

export function darkContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ colorScheme: "dark" })
}
