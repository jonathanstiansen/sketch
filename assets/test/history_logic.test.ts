import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { COALESCE_MS, History, type Recorded, type Step } from "../js/hooks/history_logic.ts"

const settings = { seed: 1, numRuns: 500 }

interface Content {
  kind: string
  x: number
  style: string
}

type Change = Partial<Content>

type Command =
  | { type: "create"; content: Content }
  | { type: "move"; pick: number; x: number }
  | { type: "restyle"; pick: number; style: string }
  | { type: "erase"; picks: number[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "otherErases"; pick: number }
  | { type: "otherMoves"; pick: number; x: number }

class Board {
  readonly elements = new Map<string, Content>()
  readonly erased = new Set<string>()
  readonly lineage = new Map<string, string>()
  readonly erasedByOthers = new Set<string>()
  private nextId = 0

  create(content: Content, lineage?: string): string {
    this.nextId += 1
    const id = `e${String(this.nextId)}`
    this.elements.set(id, content)
    this.lineage.set(id, lineage ?? id)
    return id
  }

  erase(id: string): Content {
    const content = this.live(id)
    this.elements.delete(id)
    this.erased.add(id)
    return content
  }

  commit(id: string, change: Change): void {
    this.elements.set(id, { ...this.live(id), ...change })
  }

  live(id: string): Content {
    assert.equal(this.erased.has(id), false, `${id} was erased`)
    const content = this.elements.get(id)
    if (content === undefined) throw new Error(`${id} is unknown`)
    return content
  }

  pick(index: number): string | undefined {
    const ids = [...this.elements.keys()]
    return ids.length === 0 ? undefined : ids[index % ids.length]
  }

  visible(): string[] {
    return [...this.elements.values()].map((content) => JSON.stringify(content)).sort()
  }
}

class Viewer {
  readonly history = new History<Content, Change>()
  readonly steps: Step<Content, Change>[] = []
  now = 0
  readonly board: Board

  constructor(board: Board) {
    this.board = board
  }

  run(command: Command): void {
    this.now += 1
    const { board, history } = this
    if (command.type === "create") {
      const id = board.create(command.content)
      history.record({ type: "create", elements: [{ id, snapshot: command.content }] }, this.now)
    } else if (command.type === "move" || command.type === "restyle") {
      const id = board.pick(command.pick)
      if (id === undefined) return
      const current = board.live(id)
      if (command.type === "move") {
        board.commit(id, { x: command.x })
        history.record({ type: "commit", id, before: { x: current.x }, after: { x: command.x } }, this.now)
      } else {
        board.commit(id, { style: command.style })
        history.record({ type: "commit", id, before: { style: current.style }, after: { style: command.style }, coalesce: "style" }, this.now)
      }
    } else if (command.type === "erase") {
      const ids = [...new Set(command.picks.flatMap((pick) => board.pick(pick) ?? []))]
      if (ids.length === 0) return
      const elements = ids.map((id): Recorded<Content> => ({ id, snapshot: board.erase(id) }))
      for (const id of ids) history.noteErased(id)
      history.record({ type: "erase", elements }, this.now)
    } else if (command.type === "undo" || command.type === "redo") {
      this.replay(command.type === "undo" ? history.undo() : history.redo())
    } else {
      this.other(command)
    }
  }

  replay(step: Step<Content, Change>): void {
    this.steps.push(step)
    if (step.status !== "replay") return
    const { board, history } = this
    const { replay } = step
    if (replay.type === "commit") {
      board.commit(replay.id, replay.change)
      history.replayed()
    } else if (replay.type === "erase") {
      for (const id of replay.ids) board.erase(id)
      for (const id of replay.ids) history.noteErased(id)
      history.replayed()
    } else {
      for (const { id } of replay.elements) assert.equal(board.erasedByOthers.has(id), false, `${id} was erased by someone else`)
      history.replayed(new Map(replay.elements.map(({ id, snapshot }) => [id, board.create(snapshot, id)])))
    }
  }

  private other(command: Extract<Command, { type: "otherErases" | "otherMoves" }>): void {
    const id = this.board.pick(command.pick)
    if (id === undefined) return
    if (command.type === "otherMoves") {
      this.board.commit(id, { x: command.x })
      return
    }
    this.board.erase(id)
    this.board.erasedByOthers.add(this.board.lineage.get(id) ?? id)
    this.history.noteErased(id)
  }

  undoAll(): void {
    while (this.history.canUndo) this.run({ type: "undo" })
  }

  redoAll(): void {
    while (this.history.canRedo) this.run({ type: "redo" })
  }
}

const content = fc.record({ kind: fc.constantFrom("rectangle", "line", "text"), x: fc.nat(4000), style: fc.constantFrom("ink", "red", "blue") })

const localAction: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ type: fc.constant("create" as const), content }),
  fc.record({ type: fc.constant("move" as const), pick: fc.nat(), x: fc.nat(4000) }),
  fc.record({ type: fc.constant("restyle" as const), pick: fc.nat(), style: fc.constantFrom("ink", "red", "blue", "green") }),
  fc.record({ type: fc.constant("erase" as const), picks: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }) }),
)

const anyCommand: fc.Arbitrary<Command> = fc.oneof(
  { weight: 4, arbitrary: localAction },
  { weight: 2, arbitrary: fc.constantFrom<Command>({ type: "undo" }, { type: "redo" }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("otherErases" as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("otherMoves" as const), pick: fc.nat(), x: fc.nat(4000) }) },
)

function boardWith(existing: readonly Content[]): Board {
  const board = new Board()
  for (const element of existing) board.create(element)
  return board
}

void test("undoing every local action restores the board, and redoing them all restores the result, ids aside", () => {
  fc.assert(
    fc.property(fc.array(content, { maxLength: 3 }), fc.array(localAction, { maxLength: 25 }), (existing, actions) => {
      const viewer = new Viewer(boardWith(existing))
      const initial = viewer.board.visible()
      for (const action of actions) viewer.run(action)
      const final = viewer.board.visible()

      viewer.undoAll()
      assert.deepEqual(viewer.board.visible(), initial)
      viewer.redoAll()
      assert.deepEqual(viewer.board.visible(), final)
      assert.ok(viewer.steps.every((step) => step.status === "replay"))
    }),
    settings,
  )
})

void test("with other viewers erasing and moving in between, no replay targets an erased id and nothing they erased comes back", () => {
  fc.assert(
    fc.property(fc.array(content, { maxLength: 3 }), fc.array(anyCommand, { maxLength: 40 }), (existing, commands) => {
      const viewer = new Viewer(boardWith(existing))
      for (const command of commands) viewer.run(command)
      viewer.undoAll()
      viewer.redoAll()
      viewer.undoAll()
    }),
    settings,
  )
})

void test("a new local action clears the redo stack", () => {
  fc.assert(
    fc.property(fc.array(localAction, { minLength: 1, maxLength: 15 }), fc.nat(), content, (actions, undos, created) => {
      const viewer = new Viewer(new Board())
      for (const action of actions) viewer.run(action)
      for (let i = 0; i <= undos % 5; i += 1) viewer.run({ type: "undo" })
      fc.pre(viewer.history.canRedo)

      viewer.run({ type: "create", content: created })
      assert.equal(viewer.history.canRedo, false)
      assert.deepEqual(viewer.history.redo(), { status: "empty" })
    }),
    settings,
  )
})

void test("an entry whose element someone else erased is dropped and changes nothing", () => {
  fc.assert(
    fc.property(content, fc.nat(4000), fc.boolean(), (created, x, redo) => {
      const viewer = new Viewer(new Board())
      viewer.run({ type: "create", content: created })
      viewer.run({ type: "move", pick: 0, x })
      if (redo) viewer.run({ type: "undo" })
      viewer.run({ type: "otherErases", pick: 0 })
      const before = viewer.board.visible()

      const step = redo ? viewer.history.redo() : viewer.history.undo()
      assert.deepEqual(step, { status: "dropped", direction: redo ? "redo" : "undo" })
      assert.deepEqual(viewer.board.visible(), before)
      viewer.undoAll()
      assert.deepEqual(viewer.board.visible(), [])
      assert.ok(viewer.steps.every((s) => s.status === "dropped" || s.status === "replay"))
      assert.equal(viewer.history.canUndo, false)
    }),
    settings,
  )
})

void test("undoing an erase creates the element again, and later entries follow it to its new id", () => {
  const viewer = new Viewer(new Board())
  viewer.run({ type: "create", content: { kind: "rectangle", x: 1, style: "ink" } })
  viewer.run({ type: "move", pick: 0, x: 2 })
  viewer.run({ type: "erase", picks: [0] })
  viewer.run({ type: "undo" })
  const [restored] = viewer.board.elements.keys()
  assert.equal(restored, "e2")
  viewer.run({ type: "undo" })
  assert.deepEqual(viewer.steps.at(-1), { status: "replay", direction: "undo", replay: { type: "commit", id: "e2", change: { x: 1 } } })
  viewer.run({ type: "move", pick: 0, x: 3 })
  viewer.run({ type: "erase", picks: [0] })
  viewer.run({ type: "undo" })
  viewer.run({ type: "undo" })
  assert.deepEqual(viewer.steps.at(-1), { status: "replay", direction: "undo", replay: { type: "commit", id: "e3", change: { x: 1 } } })
  viewer.run({ type: "undo" })
  assert.deepEqual(viewer.steps.at(-1), { status: "replay", direction: "undo", replay: { type: "erase", ids: ["e3"] } })
})

void test("an erase of several elements is one entry", () => {
  const viewer = new Viewer(boardWith([{ kind: "rectangle", x: 1, style: "ink" }, { kind: "line", x: 2, style: "red" }]))
  const initial = viewer.board.visible()
  viewer.run({ type: "erase", picks: [0, 1] })
  assert.deepEqual(viewer.board.visible(), [])
  viewer.run({ type: "undo" })
  assert.deepEqual(viewer.board.visible(), initial)
  assert.equal(viewer.history.canUndo, false)
})

void test("style changes of one element and property within the coalescing window are one entry", () => {
  fc.assert(
    fc.property(fc.array(fc.nat(2 * COALESCE_MS), { minLength: 1, maxLength: 6 }), (gaps) => {
      const history = new History<Content, Change>()
      let now = 0
      let style = "ink"
      for (const [index, gap] of gaps.entries()) {
        now += gap
        const next = `s${String(index)}`
        history.record({ type: "commit", id: "e1", before: { style }, after: { style: next }, coalesce: "style" }, now)
        style = next
      }
      const expected = 1 + gaps.slice(1).filter((gap) => gap > COALESCE_MS).length
      let undone = 0
      let restored: Change | undefined
      for (let step = history.undo(); step.status === "replay"; step = history.undo()) {
        undone += 1
        if (step.replay.type === "commit") restored = step.replay.change
        history.replayed()
      }
      assert.equal(undone, expected)
      assert.deepEqual(restored, { style: "ink" })
    }),
    settings,
  )
})

void test("different properties, different elements and moves never coalesce", () => {
  const history = new History<Content, Change>()
  history.record({ type: "commit", id: "e1", before: { style: "ink" }, after: { style: "red" }, coalesce: "stroke" }, 0)
  history.record({ type: "commit", id: "e1", before: { style: "ink" }, after: { style: "red" }, coalesce: "fill" }, 1)
  history.record({ type: "commit", id: "e2", before: { style: "ink" }, after: { style: "red" }, coalesce: "fill" }, 2)
  history.record({ type: "commit", id: "e2", before: { x: 1 }, after: { x: 2 } }, 3)
  history.record({ type: "commit", id: "e2", before: { x: 2 }, after: { x: 3 } }, 4)
  let count = 0
  for (let step = history.undo(); step.status === "replay"; step = history.undo()) {
    count += 1
    history.replayed()
  }
  assert.equal(count, 5)
})

void test("a style change after an undo does not coalesce into the entry below", () => {
  const history = new History<Content, Change>()
  history.record({ type: "commit", id: "e1", before: { style: "ink" }, after: { style: "red" }, coalesce: "stroke" }, 0)
  history.record({ type: "commit", id: "e1", before: { style: "red" }, after: { style: "blue" }, coalesce: "stroke" }, 600)
  assert.equal(history.undo().status, "replay")
  history.replayed()
  history.record({ type: "commit", id: "e1", before: { style: "red" }, after: { style: "green" }, coalesce: "stroke" }, 700)
  const first = history.undo()
  history.replayed()
  assert.deepEqual(first, { status: "replay", direction: "undo", replay: { type: "commit", id: "e1", change: { style: "red" } } })
})

void test("only one replay runs at a time, and a failed replay is dropped", () => {
  const history = new History<Content, Change>()
  history.record({ type: "commit", id: "e1", before: { x: 1 }, after: { x: 2 } }, 0)
  history.record({ type: "commit", id: "e1", before: { x: 2 }, after: { x: 3 } }, 1)
  assert.equal(history.undo().status, "replay")
  assert.deepEqual(history.undo(), { status: "busy" })
  assert.deepEqual(history.redo(), { status: "busy" })
  history.failed()
  assert.equal(history.canRedo, false)
  assert.deepEqual(history.undo(), { status: "replay", direction: "undo", replay: { type: "commit", id: "e1", change: { x: 1 } } })
})

void test("an undo that finishes after a new action does not refill the redo stack, and a redo stays below it", () => {
  const history = new History<Content, Change>()
  history.record({ type: "commit", id: "e1", before: { x: 1 }, after: { x: 2 } }, 0)
  history.undo()
  history.record({ type: "commit", id: "e1", before: { x: 2 }, after: { x: 5 } }, 1)
  history.replayed()
  assert.equal(history.canRedo, false)

  const other = new History<Content, Change>()
  other.record({ type: "commit", id: "e1", before: { x: 1 }, after: { x: 2 } }, 0)
  other.undo()
  other.replayed()
  other.redo()
  other.record({ type: "commit", id: "e2", before: { x: 7 }, after: { x: 8 } }, 1)
  other.replayed()
  const undone = other.undo()
  assert.deepEqual(undone, { status: "replay", direction: "undo", replay: { type: "commit", id: "e2", change: { x: 7 } } })
})

void test("a re-creation where some creates failed keeps only the elements that came back", () => {
  const history = new History<Content, Change>()
  const a = { kind: "rectangle", x: 1, style: "ink" }
  const b = { kind: "line", x: 2, style: "ink" }
  history.record({ type: "erase", elements: [{ id: "a", snapshot: a }, { id: "b", snapshot: b }] }, 0)
  history.noteErased("a")
  history.noteErased("b")
  history.undo()
  history.replayed(new Map([["a", "a2"]]))
  assert.deepEqual(history.redo(), { status: "replay", direction: "redo", replay: { type: "erase", ids: ["a2"] } })

  const none = new History<Content, Change>()
  none.record({ type: "erase", elements: [{ id: "a", snapshot: a }] }, 0)
  none.undo()
  none.replayed(new Map())
  assert.equal(none.canRedo, false)
})
