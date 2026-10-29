import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { createBoard } from "./support/board"

const repoRoot = new URL("../..", import.meta.url).pathname
const recordingDir = process.env.E2E_RECORD_DIR
const videoSize = { width: 640, height: 400 }

const deployed = process.env.E2E_BASE_URL !== undefined

function createBoardWithMix(): string {
  const output = execFileSync(
    "mix",
    ["run", "-e", "IO.puts(Sketch.Canvas.create_board!().id)"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, MIX_ENV: "dev" } },
  )
  const id = output.trim().split("\n").at(-1)
  if (id === undefined || id === "") throw new Error("board id was not printed")
  return id
}

async function openBoard(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("#add-rectangle")).toBeVisible()
}

test("a rectangle added in one browser appears live in another and survives reload", async ({
  browser,
}) => {
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
    const [boardPath, otherBoardPath] = deployed
      ? [await createBoard(pageA), await createBoard(pageC)]
      : [`/b/${createBoardWithMix()}`, `/b/${createBoardWithMix()}`]
    await openBoard(pageA, boardPath)
    await openBoard(pageB, boardPath)
    await openBoard(pageC, otherBoardPath)

    await pageA.locator("#add-rectangle").click()
    await expect(pageA.locator("rect[id^='element-']")).toHaveCount(1)
    await pageA.locator("#add-rectangle").click()

    await expect(pageA.locator("rect[id^='element-']")).toHaveCount(2)
    await expect(pageB.locator("rect[id^='element-']")).toHaveCount(2)
    await expect(pageB.locator("rect[id^='element-'][data-version='0']")).toHaveCount(2)

    await pageB.reload()
    await expect(pageB.locator("rect[id^='element-']")).toHaveCount(2)
    await pageB.screenshot({ path: process.env.E2E_RELOAD_SHOT ?? "test-results/after-reload.png" })

    await expect(pageC.locator("rect[id^='element-']")).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextB.close()
    await contextC.close()
  }
})
