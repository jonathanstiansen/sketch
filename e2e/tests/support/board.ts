import { expect, type Locator, type Page } from "@playwright/test"

export const boardPath = /\/b\/[0-9a-f-]{36}$/
export const connected = "[data-phx-main].phx-connected"

export interface RectangleState {
  id: string | null
  x: string | null
  y: string | null
  version: string | null
}

export async function createBoard(page: Page): Promise<string> {
  await page.goto("/")
  await expect(page.locator(connected)).toBeVisible()
  await page.locator("#new-board").click()
  await expect(page).toHaveURL(boardPath)
  await expect(page.locator(connected)).toBeVisible()
  return new URL(page.url()).pathname
}

export async function openBoard(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator(connected)).toBeVisible()
}

export async function grabRectangle(page: Page, rectangle: Locator): Promise<{ x: number; y: number }> {
  const box = await rectangle.boundingBox()
  if (box === null) throw new Error("rectangle is not visible")
  const start = { x: Math.round(box.x + 20), y: Math.round(box.y + 20) }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  return start
}

export async function rectangleStates(page: Page): Promise<RectangleState[]> {
  return page.locator("[data-element][data-kind='rectangle']").evaluateAll((rects) =>
    rects
      .map((rect) => ({
        id: rect.getAttribute("data-element"),
        x: rect.getAttribute("x"),
        y: rect.getAttribute("y"),
        version: rect.getAttribute("data-version"),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  )
}
