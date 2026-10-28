import { defineConfig, devices } from "@playwright/test"

const port = process.env.E2E_PORT ?? "4010"
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "mix phx.server",
    cwd: "..",
    env: { PORT: port },
    url: baseURL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
    stdout: "pipe",
  },
})
