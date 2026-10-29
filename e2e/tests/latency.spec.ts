import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { createBoard, grabRectangle, openBoard } from "./support/board"

const sampleCount = 200
const warmupCount = 5
const previewIntervalMs = 50
const dragSettleMs = previewIntervalMs + 10
const dragDistance = 40
const outputFile = process.env.LATENCY_OUT ?? "test-results/latency.json"
const rectangles = "rect[data-element]"

interface Summary {
  samples: number
  minMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

declare global {
  interface Window {
    observed: number[]
    emitted: number[]
    lastEmittedAt: number
  }
}

function percentile(sorted: number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(fraction * sorted.length))
  return sorted[rank - 1] ?? Number.NaN
}

function summarize(latencies: number[]): Summary {
  const sorted = [...latencies].sort((a, b) => a - b)
  const round = (value: number): number => Math.round(value * 100) / 100
  return {
    samples: sorted.length,
    minMs: round(percentile(sorted, 0)),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(percentile(sorted, 1)),
  }
}

async function observeAdditions(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.observed = []
    new MutationObserver((records) => {
      const at = performance.timeOrigin + performance.now()
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches("rect[data-element]")) window.observed.push(at)
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

async function observeMoves(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.observed = []
    new MutationObserver((records) => {
      const at = performance.timeOrigin + performance.now()
      for (const record of records) {
        if (record.target instanceof Element && record.target.getAttribute("x") !== record.oldValue) {
          window.observed.push(at)
        }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["x"], attributeOldValue: true, subtree: true })
  })
}

async function recordPointerMoves(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.emitted = []
    window.lastEmittedAt = performance.now()
    window.addEventListener(
      "pointermove",
      () => {
        window.emitted.push(performance.timeOrigin + performance.now())
        window.lastEmittedAt = performance.now()
      },
      { capture: true },
    )
  })
}

async function waitForObservations(page: Page, count: number): Promise<void> {
  await page.waitForFunction((expected) => window.observed.length >= expected, count)
}

async function observedTimes(page: Page): Promise<number[]> {
  return page.evaluate(() => window.observed)
}

async function measureCreate(pageA: Page, pageB: Page): Promise<number[]> {
  await observeAdditions(pageB)
  const sentAt: number[] = []
  for (let index = 0; index < sampleCount + warmupCount; index++) {
    sentAt.push(
      await pageA.evaluate(() => {
        const at = performance.timeOrigin + performance.now()
        document.querySelector<HTMLElement>("#add-rectangle")?.click()
        return at
      }),
    )
    await waitForObservations(pageB, index + 1)
  }
  const seenAt = await observedTimes(pageB)
  return sentAt.map((sent, index) => (seenAt[index] ?? Number.NaN) - sent).slice(warmupCount)
}

async function measureDragPreview(pageA: Page, pageB: Page): Promise<number[]> {
  const rectangle = pageA.locator(rectangles)
  await expect(rectangle).toHaveCount(1)
  await expect(pageB.locator(rectangles)).toHaveCount(1)
  await observeMoves(pageB)

  const start = await grabRectangle(pageA, rectangle)
  await recordPointerMoves(pageA)
  for (let index = 0; index < sampleCount + warmupCount; index++) {
    await pageA.waitForFunction(
      (settle) => performance.now() - window.lastEmittedAt > settle,
      dragSettleMs,
    )
    const offset = index % 2 === 0 ? dragDistance : 0
    await pageA.mouse.move(start.x + offset, start.y)
    await waitForObservations(pageB, index + 1)
  }
  await pageA.mouse.up()

  const sentAt = await pageA.evaluate(() => window.emitted)
  const seenAt = await observedTimes(pageB)
  return seenAt.map((seen, index) => seen - (sentAt[index] ?? Number.NaN)).slice(warmupCount)
}

test("@measure collaboration latency between two browsers", async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    const createPath = await createBoard(pageA)
    await openBoard(pageB, createPath)
    const create = await measureCreate(pageA, pageB)

    const dragPath = await createBoard(pageA)
    await openBoard(pageB, dragPath)
    await pageA.locator("#add-rectangle").click()
    const dragPreview = await measureDragPreview(pageA, pageB)

    const result = { create: summarize(create), dragPreview: summarize(dragPreview) }
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(outputFile, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    expect(result.create.samples).toBe(sampleCount)
    expect(result.dragPreview.samples).toBe(sampleCount)
    expect(Number.isNaN(result.create.p99Ms)).toBe(false)
    expect(Number.isNaN(result.dragPreview.p99Ms)).toBe(false)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
