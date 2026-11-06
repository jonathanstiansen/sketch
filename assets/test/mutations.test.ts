import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { anyStyle } from "./style_arbitrary.ts"
import { BoardMutations } from "../js/hooks/mutations.ts"
import type { ElementSnapshot } from "../js/hooks/element_history.ts"
import {
  ELEMENT_KINDS,
  GEOMETRY,
  STYLE_DEFAULTS,
  STYLE_PROPERTIES,
  STYLE_TOKENS,
  type StyleProperty,
} from "../js/generated/manifest.ts"

type Row = Record<string, unknown>

function without(row: Row, keys: readonly string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
}

class FakeBoardLive {
  readonly rows = new Map<string, Row>()
  private nextId = 0

  pushEvent(event: string, payload: object): Promise<unknown> {
    return Promise.resolve(this.reply(event, payload as Row))
  }

  private reply(event: string, payload: Row): unknown {
    if (event === "create_element") return { element: this.create(payload) }
    if (event === "erase")
      return { erased: this.erase(payload.element_ids as string[]) }
    const row = this.rows.get(payload.element_id as string)
    if (row === undefined) return { ok: false }
    const change = without(payload, ["element_id", "drag_id"])
    Object.assign(row, change)
    return { ok: true }
  }

  private create(payload: Row): Row {
    this.nextId += 1
    const fields = without(payload, ["drag_id"])
    const row = {
      ...fields,
      id: `element-${String(this.nextId)}`,
      text: fields.text ?? "",
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  private erase(ids: readonly string[]): Row[] {
    return ids.flatMap((id) => {
      const row = this.rows.get(id)
      this.rows.delete(id)
      return row === undefined ? [] : [{ ...row }]
    })
  }

  contents(): string[] {
    return [...this.rows.values()]
      .map((row) => without(row, ["id"]))
      .map((content) => JSON.stringify(content, Object.keys(content).sort()))
      .sort()
  }
}

const coordinate = fc.integer({ min: 0, max: GEOMETRY.canvasWidth - 200 })

const snapshot: fc.Arbitrary<ElementSnapshot> = fc.record({
  kind: fc.constantFrom(...ELEMENT_KINDS),
  x: coordinate,
  y: coordinate,
  width: fc.integer({ min: 0, max: 200 }),
  height: fc.integer({ min: 0, max: 200 }),
  points: fc.array(fc.record({ x: fc.nat(200), y: fc.nat(200) }), {
    maxLength: 4,
  }),
  text: fc.string({ maxLength: 8 }),
  seed: fc.integer({ min: 0, max: GEOMETRY.maxSeed }),
  style: anyStyle,
})

const restyle = fc
  .constantFrom(...STYLE_PROPERTIES)
  .chain((property: StyleProperty) =>
    fc.record({
      property: fc.constant(property),
      value: fc.constantFrom(...STYLE_TOKENS[property]),
    }),
  )

type Operation =
  | { type: "create"; snapshot: ElementSnapshot }
  | { type: "move"; pick: number; x: number; y: number }
  | { type: "reshape"; pick: number; width: number; height: number }
  | { type: "restyle"; pick: number; property: StyleProperty; value: string }
  | { type: "erase"; pick: number }

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ type: fc.constant("create" as const), snapshot }),
  fc.record({
    type: fc.constant("move" as const),
    pick: fc.nat(),
    x: coordinate,
    y: coordinate,
  }),
  fc.record({
    type: fc.constant("reshape" as const),
    pick: fc.nat(),
    width: fc.nat(200),
    height: fc.nat(200),
  }),
  restyle.chain((change) =>
    fc.record({
      type: fc.constant("restyle" as const),
      pick: fc.nat(),
      property: fc.constant(change.property),
      value: fc.constant(change.value),
    }),
  ),
  fc.record({ type: fc.constant("erase" as const), pick: fc.nat() }),
)

function harness() {
  const server = new FakeBoardLive()
  let clock = 0
  const failures: string[] = []
  const mutations = new BoardMutations(
    server,
    {
      canReplay: () => true,
      historyChanged: () => undefined,
      failed: (message) => failures.push(message),
    },
    () => (clock += 1000),
  )
  return { server, mutations, failures }
}

async function settled(mutations: BoardMutations): Promise<void> {
  while (mutations.busy) await new Promise((resolve) => setImmediate(resolve))
}

async function apply(
  server: FakeBoardLive,
  mutations: BoardMutations,
  op: Operation,
): Promise<boolean> {
  if (op.type === "create") {
    const id = await mutations.create(op.snapshot, crypto.randomUUID())
    const { style, ...shape } = op.snapshot
    assert.deepEqual(server.rows.get(id ?? ""), { ...shape, ...style, id })
    return true
  }
  const ids = [...server.rows.keys()]
  const id = ids[op.pick % Math.max(1, ids.length)]
  const row = id === undefined ? undefined : server.rows.get(id)
  if (id === undefined || row === undefined) return false
  if (op.type === "erase") {
    await mutations.erase([id])
    assert.equal(server.rows.has(id), false)
    return true
  }
  const dragId = crypto.randomUUID()
  if (op.type === "move") {
    await mutations.commit(
      [
        {
          id,
          before: { event: "commit", x: row.x as number, y: row.y as number },
          after: { event: "commit", x: op.x, y: op.y },
        },
      ],
      dragId,
    )
    assert.deepEqual([row.x, row.y], [op.x, op.y])
  } else if (op.type === "reshape") {
    const before = {
      event: "commit_shape" as const,
      box: {
        x: row.x as number,
        y: row.y as number,
        width: row.width as number,
        height: row.height as number,
      },
      points: row.points as { x: number; y: number }[],
    }
    await mutations.commit(
      [
        {
          id,
          before,
          after: {
            ...before,
            box: { ...before.box, width: op.width, height: op.height },
          },
        },
      ],
      dragId,
    )
    assert.deepEqual([row.width, row.height], [op.width, op.height])
  } else {
    const before = {
      event: "commit_style" as const,
      property: op.property,
      value: row[op.property] as string,
    }
    await mutations.commit(
      [{ id, before, after: { ...before, value: op.value } }],
      dragId,
    )
    assert.equal(row[op.property], op.value)
  }
  return true
}

async function stepAll(
  mutations: BoardMutations,
  direction: "undo" | "redo",
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index++) {
    mutations.run(direction)
    await settled(mutations)
  }
}

void test("every write through the mutation layer does what it asks, undoes back to the empty board and redoes to the same board (ADR 0015)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(operation, { minLength: 1, maxLength: 12 }),
      async (operations) => {
        const { server, mutations, failures } = harness()
        let recorded = 0
        for (const op of operations)
          if (await apply(server, mutations, op)) recorded += 1
        const final = server.contents()

        await stepAll(mutations, "undo", recorded)
        assert.deepEqual(server.contents(), [])
        assert.equal(mutations.canUndo, false)

        await stepAll(mutations, "redo", recorded)
        assert.deepEqual(server.contents(), final)
        assert.equal(mutations.canRedo, false)
        assert.deepEqual(failures, [])
      },
    ),
    { seed: 1, numRuns: 300 },
  )
})

void test("a write the server refuses records nothing to undo", async () => {
  const { mutations } = harness()
  const failed = await mutations.commit(
    [
      {
        id: "missing",
        before: { event: "commit", x: 0, y: 0 },
        after: { event: "commit", x: 5, y: 5 },
      },
    ],
    crypto.randomUUID(),
  )
  assert.equal(failed.length, 1)
  await mutations.erase(["missing"])
  assert.equal(mutations.canUndo, false)
})

void test("an undo asked for while a replay runs waits its turn", async () => {
  const { server, mutations } = harness()
  for (const x of [10, 20]) {
    await mutations.create(
      {
        kind: "rectangle",
        x,
        y: 0,
        width: 10,
        height: 10,
        points: [],
        text: "",
        seed: 1,
        style: STYLE_DEFAULTS,
      },
      crypto.randomUUID(),
    )
  }
  mutations.run("undo")
  mutations.run("undo")
  await settled(mutations)
  assert.equal(server.rows.size, 0)
})
