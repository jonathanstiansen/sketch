import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { CURSOR_STALE_MS, RemoteCursors, isRemoteCursor, type RemoteCursor } from "../js/hooks/cursor_logic.ts"

const settings = { seed: 1, numRuns: 500 }
const viewers = ["viewer-a", "viewer-b", "viewer-c"]

interface Event {
  viewer: string
  seq: number
  leave: boolean
  x: number
  y: number
}

function cursor({ viewer, seq, x, y }: Event): RemoteCursor {
  return { viewer_id: viewer, name: `Name ${viewer}`, color: "red", x, y, seq }
}

function apply(cursors: RemoteCursors, event: Event, now: number): void {
  if (event.leave) cursors.leave(event.viewer, event.seq)
  else cursors.accept(cursor(event), now)
}

const delivery = fc
  .array(fc.record({ viewer: fc.constantFrom(...viewers), leave: fc.boolean(), x: fc.nat(4000), y: fc.nat(4000) }), { minLength: 1, maxLength: 20 })
  .map((events) => {
    const nextSeq = new Map<string, number>()
    return events.map((event): Event => {
      const seq = (nextSeq.get(event.viewer) ?? 0) + 1
      nextSeq.set(event.viewer, seq)
      return { ...event, seq }
    })
  })
  .chain((events) => fc.shuffledSubarray(events, { minLength: events.length }).map((shuffled) => ({ events, shuffled })))

void test("whatever order messages arrive in, each viewer ends where their newest message says", () => {
  fc.assert(
    fc.property(delivery, ({ events, shuffled }) => {
      const cursors = new RemoteCursors()
      for (const event of shuffled) apply(cursors, event, 0)

      for (const viewer of viewers) {
        const newest = events.filter((event) => event.viewer === viewer).at(-1)
        const shown = cursors.visible().find((c) => c.viewer_id === viewer)
        if (newest === undefined || newest.leave) assert.equal(shown, undefined)
        else assert.deepEqual(shown, cursor(newest))
      }
    }),
    settings,
  )
})

void test("a late or repeated message never replaces a newer one", () => {
  const cursors = new RemoteCursors()
  const newer = { viewer: "viewer-a", seq: 5, leave: false, x: 50, y: 50 }
  assert.equal(cursors.accept(cursor(newer), 0), true)
  assert.equal(cursors.accept(cursor({ ...newer, seq: 4, x: 1 }), 1), false)
  assert.equal(cursors.accept(cursor({ ...newer, x: 1 }), 1), false)
  assert.deepEqual(cursors.visible(), [cursor(newer)])
})

void test("a leave stops an older cursor message from bringing the cursor back", () => {
  const cursors = new RemoteCursors()
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 1 }), 0), true)
  assert.equal(cursors.leave("viewer-a", 3), true)
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 2, leave: false, x: 2, y: 2 }), 1), false)
  assert.deepEqual(cursors.visible(), [])
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 4, leave: false, x: 3, y: 3 }), 2), true)
})

void test("viewers do not affect each other", () => {
  fc.assert(
    fc.property(delivery, ({ shuffled }) => {
      const together = new RemoteCursors()
      for (const event of shuffled) apply(together, event, 0)
      for (const viewer of viewers) {
        const alone = new RemoteCursors()
        for (const event of shuffled.filter((e) => e.viewer === viewer)) apply(alone, event, 0)
        assert.deepEqual(
          together.visible().filter((c) => c.viewer_id === viewer),
          alone.visible(),
        )
      }
    }),
    settings,
  )
})

const timelines = fc.array(
  fc.record({ viewer: fc.constantFrom(...viewers), gap: fc.integer({ min: 0, max: 1500 }) }),
  { minLength: 1, maxLength: 30 },
)

void test("a cursor disappears exactly 2000 ms after the last message from its viewer", () => {
  fc.assert(
    fc.property(timelines, fc.integer({ min: 0, max: 4000 }), (steps, wait) => {
      const cursors = new RemoteCursors()
      const lastSeen = new Map<string, number>()
      let now = 1000
      let seq = 0
      for (const { viewer, gap } of steps) {
        now += gap
        seq += 1
        cursors.accept(cursor({ viewer, seq, leave: false, x: seq, y: seq }), now)
        lastSeen.set(viewer, now)
      }
      const later = now + wait
      cursors.expire(later)

      const expected = viewers.filter((viewer) => later - (lastSeen.get(viewer) ?? -Infinity) < CURSOR_STALE_MS)
      assert.deepEqual(cursors.visible().map((c) => c.viewer_id).sort(), expected)
    }),
    settings,
  )
})

void test("1999 ms of silence keeps a cursor and 2000 ms removes it", () => {
  const cursors = new RemoteCursors()
  cursors.accept(cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 1 }), 5000)
  assert.deepEqual(cursors.expire(6999), [])
  assert.equal(cursors.visible().length, 1)
  assert.deepEqual(cursors.expire(7000), ["viewer-a"])
  assert.deepEqual(cursors.visible(), [])
})

void test("the next expiry is the soonest cursor's, and nothing when none is shown", () => {
  const cursors = new RemoteCursors()
  assert.equal(cursors.nextExpiry(), undefined)
  cursors.accept(cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 1 }), 100)
  cursors.accept(cursor({ viewer: "viewer-b", seq: 1, leave: false, x: 1, y: 1 }), 50)
  assert.equal(cursors.nextExpiry(), 50 + CURSOR_STALE_MS)
  cursors.expire(50 + CURSOR_STALE_MS)
  assert.equal(cursors.nextExpiry(), 100 + CURSOR_STALE_MS)
})

void test("payloads without a viewer, a position or a sequence number are not cursors", () => {
  const valid = cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 2 })
  assert.equal(isRemoteCursor(valid), true)
  for (const broken of [null, "x", {}, { ...valid, x: 1.5 }, { ...valid, seq: "1" }, { ...valid, name: 3 }, { ...valid, viewer_id: undefined }]) {
    assert.equal(isRemoteCursor(broken), false)
  }
})
