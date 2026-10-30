import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { connected } from "./support/board"

const recordingDir = process.env.E2E_RECORD_DIR
const videoSize = { width: 800, height: 500 }
const boardPath = /\/b\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const rectangles = "[id^='element-'][data-kind='rectangle']"

async function createBoard(page: Page): Promise<string> {
  await page.goto("/")
  await expect(page.locator(connected)).toBeVisible()
  await page.locator("#new-board").click()
  await expect(page).toHaveURL(boardPath)
  await expect(page.locator("#add-rectangle")).toBeVisible()
  return new URL(page.url()).pathname
}

test("new boards are distinct, isolated, shareable and persistent", async ({ browser }) => {
  const recording =
    recordingDir === undefined
      ? {}
      : { recordVideo: { dir: recordingDir, size: videoSize }, viewport: videoSize }
  if (recordingDir !== undefined) mkdirSync(recordingDir, { recursive: true })

  const contextA = await browser.newContext(recording)
  const contextB = await browser.newContext(recording)
  const contextC = await browser.newContext()

  try {
    const [pageA, pageB, pageC] = await Promise.all([
      contextA.newPage(),
      contextB.newPage(),
      contextC.newPage(),
    ])

    const pathA = await createBoard(pageA)
    const pathB = await createBoard(pageB)
    expect(pathA).not.toBe(pathB)
    await expect(pageA.locator("#board-url")).toContainText(pathA)

    await pageC.goto(pathA)
    await expect(pageC.locator("#add-rectangle")).toBeVisible()

    await pageA.locator("#add-rectangle").click()
    await expect(pageA.locator(rectangles)).toHaveCount(1)
    await expect(pageC.locator(rectangles)).toHaveCount(1)

    await pageA.locator("#add-rectangle").click()
    await expect(pageA.locator(rectangles)).toHaveCount(2)
    await expect(pageC.locator(rectangles)).toHaveCount(2)
    await expect(pageB.locator(rectangles)).toHaveCount(0)

    await pageA.reload()
    await expect(pageA.locator(rectangles)).toHaveCount(2)
    await pageB.reload()
    await expect(pageB.locator(rectangles)).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextB.close()
    await contextC.close()
  }
})

test("malformed and unknown board urls redirect home with a flash", async ({ page }) => {
  const randomId = crypto.randomUUID()
  for (const path of ["/b/not-a-uuid", `/b/${randomId}`]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText("Board not found")).toBeVisible()
    await expect(page.locator("#new-board")).toBeVisible()
  }
  await page.screenshot({
    path: process.env.E2E_NOT_FOUND_SHOT ?? "test-results/board-not-found.png",
  })
})
