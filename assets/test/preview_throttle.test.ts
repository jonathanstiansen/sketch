import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { PREVIEW_INTERVAL_MS, previewDelay, type Point } from "../js/hooks/canvas_logic.ts"

interface Move {
  at: number
  position: Point
}

interface SentPreview {
  at: number
  position: Point
}

const settings = { seed: 1, numRuns: 1000 }

const point = fc.record({ x: fc.nat(3880), y: fc.nat(3920) })
const moves = fc
  .array(fc.record({ gap: fc.integer({ min: 1, max: 200 }), position: point }), {
    minLength: 1,
    maxLength: 60,
  })
  .map((steps) => {
    let at = 1000
    return steps.map(({ gap, position }): Move => {
      at += gap
      return { at, position }
    })
  })

function sentPreviews(drag: Move[]): SentPreview[] {
  const sent: SentPreview[] = []
  let lastSentAt = -Infinity
  let dueAt: number | undefined
  let latest: Point | undefined

  const fireTimer = (at: number): void => {
    if (latest !== undefined) sent.push({ at, position: latest })
    lastSentAt = at
    dueAt = undefined
  }

  for (const move of drag) {
    if (dueAt !== undefined && dueAt <= move.at) fireTimer(dueAt)
    latest = move.position
    const delay = previewDelay(lastSentAt, move.at, dueAt !== undefined)
    if (delay !== undefined) dueAt = move.at + delay
  }
  if (dueAt !== undefined) fireTimer(dueAt)
  return sent
}

void test("previews of one drag are at least 50 ms apart, so at most 20 per second", () => {
  fc.assert(
    fc.property(moves, (drag) => {
      const sent = sentPreviews(drag)
      for (let i = 1; i < sent.length; i++) {
        const gap = (sent[i]?.at ?? 0) - (sent[i - 1]?.at ?? 0)
        assert.ok(gap >= PREVIEW_INTERVAL_MS, `previews ${String(gap)} ms apart`)
      }
    }),
    settings,
  )
})

void test("the last position of a drag is always previewed (trailing edge)", () => {
  fc.assert(
    fc.property(moves, (drag) => {
      assert.deepEqual(sentPreviews(drag).at(-1)?.position, drag.at(-1)?.position)
    }),
    settings,
  )
})

void test("the first move of a drag is previewed without waiting", () => {
  fc.assert(
    fc.property(moves, (drag) => {
      assert.equal(sentPreviews(drag)[0]?.at, drag[0]?.at)
    }),
    settings,
  )
})
