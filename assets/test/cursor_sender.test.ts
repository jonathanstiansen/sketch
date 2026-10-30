import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { PREVIEW_INTERVAL_MS, type Point } from "../js/hooks/canvas_logic.ts"
import { CursorSender, type CursorMessage } from "../js/hooks/cursor_logic.ts"

interface Move {
  at: number
  position: Point
}

interface Sent extends CursorMessage {
  at: number
}

const settings = { seed: 1, numRuns: 1000 }

const position = fc.record({ x: fc.integer({ min: 0, max: 4000 }), y: fc.integer({ min: 0, max: 4000 }) })
const nearbyPosition = fc.record({ x: fc.integer({ min: 0, max: 2 }), y: fc.integer({ min: 0, max: 2 }) })

function timeline(points: fc.Arbitrary<Point>): fc.Arbitrary<Move[]> {
  return fc.array(fc.record({ gap: fc.integer({ min: 1, max: 200 }), position: points }), { minLength: 1, maxLength: 60 }).map((steps) => {
    let at = 1000
    return steps.map(({ gap, position: point }): Move => {
      at += gap
      return { at, position: point }
    })
  })
}

function sentCursors(moves: Move[]): Sent[] {
  const sender = new CursorSender()
  const sent: Sent[] = []
  let dueAt: number | undefined

  const fire = (at: number): void => {
    dueAt = undefined
    const message = sender.flush(at)
    if (message !== undefined) sent.push({ ...message, at })
  }

  for (const move of moves) {
    if (dueAt !== undefined && dueAt <= move.at) fire(dueAt)
    const delay = sender.move(move.position, move.at)
    if (delay !== undefined) dueAt = move.at + delay
  }
  if (dueAt !== undefined) fire(dueAt)
  return sent
}

void test("cursor messages are at least 50 ms apart, so at most 20 per second", () => {
  fc.assert(
    fc.property(timeline(position), (moves) => {
      const sent = sentCursors(moves)
      for (let i = 1; i < sent.length; i++) {
        const gap = (sent[i]?.at ?? 0) - (sent[i - 1]?.at ?? 0)
        assert.ok(gap >= PREVIEW_INTERVAL_MS, `messages ${String(gap)} ms apart`)
      }
    }),
    settings,
  )
})

void test("a cursor message is only sent when the pointer moved since the last one", () => {
  fc.assert(
    fc.property(timeline(nearbyPosition), (moves) => {
      const sent = sentCursors(moves)
      for (let i = 1; i < sent.length; i++) {
        const [previous, current] = [sent[i - 1], sent[i]]
        assert.ok(previous?.x !== current?.x || previous?.y !== current?.y)
      }
    }),
    settings,
  )
})

void test("the last position is always sent, and the first without waiting", () => {
  fc.assert(
    fc.property(timeline(nearbyPosition), (moves) => {
      const sent = sentCursors(moves)
      assert.equal(sent.at(-1)?.x, moves.at(-1)?.position.x)
      assert.equal(sent.at(-1)?.y, moves.at(-1)?.position.y)
      assert.equal(sent[0]?.at, moves[0]?.at)
    }),
    settings,
  )
})

void test("sequence numbers count up from 1 without gaps", () => {
  fc.assert(
    fc.property(timeline(position), (moves) => {
      assert.deepEqual(
        sentCursors(moves).map(({ seq }) => seq),
        sentCursors(moves).map((_, index) => index + 1),
      )
    }),
    settings,
  )
})

void test("leaving a canvas the cursor was never shown on sends nothing", () => {
  assert.equal(new CursorSender().leave(), undefined)
})

void test("leaving takes the next sequence number and cancels a message still waiting", () => {
  const sender = new CursorSender()
  sender.move({ x: 5, y: 5 }, 1000)
  assert.deepEqual(sender.flush(1000), { x: 5, y: 5, seq: 1 })
  assert.equal(sender.move({ x: 9, y: 9 }, 1010), 40)
  assert.equal(sender.leave(), 2)
  assert.equal(sender.flush(1050), undefined)
  assert.equal(sender.leave(), undefined)
})

void test("coming back after leaving sends the same position again", () => {
  const sender = new CursorSender()
  sender.move({ x: 5, y: 5 }, 1000)
  sender.flush(1000)
  sender.leave()
  const delay = sender.move({ x: 5, y: 5 }, 1100)
  assert.equal(delay, 0)
  assert.deepEqual(sender.flush(1100), { x: 5, y: 5, seq: 3 })
})
