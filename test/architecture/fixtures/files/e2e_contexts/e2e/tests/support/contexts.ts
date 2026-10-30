import type { Browser, BrowserContext } from "@playwright/test"

export function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
}
