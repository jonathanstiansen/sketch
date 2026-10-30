import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test"

export const SHARED_CONTEXT_OPTIONS = {
  permissions: ["clipboard-read", "clipboard-write"],
} as const satisfies BrowserContextOptions

export function contextOptions(options: BrowserContextOptions = {}): BrowserContextOptions {
  const permissions = [...new Set([...SHARED_CONTEXT_OPTIONS.permissions, ...(options.permissions ?? [])])]
  return { ...SHARED_CONTEXT_OPTIONS, ...options, permissions }
}

export function newContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  return browser.newContext(contextOptions(options))
}
