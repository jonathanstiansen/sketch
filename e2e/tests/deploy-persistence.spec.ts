import { readFileSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { createBoard, grabRectangle, openBoard } from "./support/board"
import { addRectangle } from "./support/canvas"

const phase = process.env.DEPLOY_PHASE
const stateFile = process.env.DEPLOY_STATE_FILE ?? "deploy-state.json"
const expected = { x: "350", y: "220", version: "1" }

interface DeployState {
  path: string
}

function readState(): DeployState {
  return JSON.parse(readFileSync(stateFile, "utf8")) as DeployState
}

test.skip(phase === undefined, "runs only with DEPLOY_PHASE=seed or DEPLOY_PHASE=verify")

test("seed: commit a drag on a new board and record its path", async ({ page }) => {
  test.skip(phase !== "seed", "seed phase only")
  const path = await createBoard(page)
  await addRectangle(page)
  const rectangle = page.locator("[data-element][data-kind='rectangle']")
  await expect(rectangle).toHaveAttribute("x", "100")

  const start = await grabRectangle(page, rectangle)
  await page.mouse.move(start.x + 250, start.y + 120, { steps: 20 })
  await page.mouse.up()
  await expect(rectangle).toHaveAttribute("data-version", expected.version)
  await expect(rectangle).toHaveAttribute("x", expected.x)
  writeFileSync(stateFile, JSON.stringify({ path }))
})

test("verify: the committed rectangle is still there", async ({ page }) => {
  test.skip(phase !== "verify", "verify phase only")
  await openBoard(page, readState().path)
  const rectangle = page.locator("[data-element][data-kind='rectangle']")
  await expect(rectangle).toHaveCount(1)
  await expect(rectangle).toHaveAttribute("x", expected.x)
  await expect(rectangle).toHaveAttribute("y", expected.y)
  await expect(rectangle).toHaveAttribute("data-version", expected.version)
})
