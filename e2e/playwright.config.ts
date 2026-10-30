import { defineConfig, devices } from "@playwright/test"
import { contextOptions } from "./tests/support/contexts"

const externalBaseURL = process.env.E2E_BASE_URL
const port = process.env.E2E_PORT ?? "4010"
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`
const measure = process.env.MEASURE === "1"

export default defineConfig({
  testDir: "./tests",
  timeout: measure ? 600_000 : 120_000,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    ...contextOptions({ baseURL }),
    trace: "retain-on-failure",
  },
  ...(measure ? {} : { grepInvert: /@measure/ }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(externalBaseURL === undefined
    ? {
        webServer: {
          command: "mix phx.server",
          cwd: "..",
          env: { PORT: port },
          url: baseURL,
          reuseExistingServer: process.env.CI === undefined,
          timeout: 180_000,
          stdout: "pipe" as const,
        },
      }
    : {}),
})
