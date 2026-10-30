import { mkdirSync } from "node:fs"
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createBoard, openBoard } from "./board"

const recordingDir = process.env.E2E_RECORD_DIR
const recordingSize = { width: 960, height: 600 }

export interface Session {
  pageA: Page
  pageB: Page
  contexts: BrowserContext[]
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

function recordingOptions(name: string) {
  if (recordingDir === undefined) return {}
  const dir = `${recordingDir}/${name}`
  mkdirSync(dir, { recursive: true })
  return { recordVideo: { dir, size: recordingSize }, viewport: recordingSize }
}

export async function openSharedBoard(
  browser: Browser,
  name: string,
  preparePageB: (page: Page) => Promise<void> = () => Promise.resolve(),
): Promise<Session> {
  const contexts = await Promise.all([
    browser.newContext(recordingOptions(`${name}-a`)),
    browser.newContext(recordingOptions(`${name}-b`)),
  ])
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
  if (pageA === undefined || pageB === undefined) throw new Error("pages did not open")
  const path = await createBoard(pageA)
  await preparePageB(pageB)
  await openBoard(pageB, path)
  return { pageA, pageB, contexts }
}

export async function closeSession({ contexts }: Session): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()))
}

export async function canvasPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator("#canvas").boundingBox()
  if (box === null) throw new Error("canvas is not visible")
  return { x: box.x + x, y: box.y + y }
}

export async function pressAt(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
}

export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}

export async function moveTo(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y)
  await page.mouse.move(point.x, point.y, { steps: 30 })
}

export async function expectBox(page: Page, selector: string, { x, y, width, height }: Box): Promise<void> {
  const shape = page.locator(selector)
  await expect(shape).toHaveAttribute("x", String(x))
  await expect(shape).toHaveAttribute("y", String(y))
  await expect(shape).toHaveAttribute("width", String(width))
  await expect(shape).toHaveAttribute("height", String(height))
}

export const SKETCH_END_JITTER = 2

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

function strokeEnds(path: string): { x1: number; y1: number; x2: number; y2: number }[] {
  return path
    .split("M")
    .map((stroke) => stroke.replace("C", " ").trim().split(/\s+/).map(Number))
    .filter((numbers) => numbers.length === 8)
    .map((numbers) => ({ x1: numbers[0] ?? NaN, y1: numbers[1] ?? NaN, x2: numbers[6] ?? NaN, y2: numbers[7] ?? NaN }))
}

export async function sketchedStrokeDeviation(page: Page, selector: string, segment: Segment): Promise<number> {
  const path = (await page.locator(selector).getAttribute("d")) ?? ""
  const ends = strokeEnds(path)
  if (ends.length !== 2) return Infinity
  return Math.max(
    ...ends.flatMap(({ x1, y1, x2, y2 }) => [x1 - segment.x1, y1 - segment.y1, x2 - segment.x2, y2 - segment.y2].map(Math.abs)),
  )
}
