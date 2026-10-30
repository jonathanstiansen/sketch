export const COALESCE_MS = 500

export type Direction = "undo" | "redo"

export interface Recorded<S> {
  readonly id: string
  readonly snapshot: S
}

export interface Change<C> {
  readonly id: string
  readonly before: C
  readonly after: C
}

export interface Replayed<C> {
  readonly id: string
  readonly change: C
}

export type Entry<S, C> =
  | { readonly type: "create" | "erase"; readonly elements: readonly Recorded<S>[] }
  | { readonly type: "commit"; readonly changes: readonly Change<C>[]; readonly coalesce?: string }

export type Replay<S, C> =
  | { readonly type: "erase"; readonly ids: readonly string[] }
  | { readonly type: "create"; readonly elements: readonly Recorded<S>[] }
  | { readonly type: "commit"; readonly changes: readonly Replayed<C>[] }

export type Step<S, C> =
  | { readonly status: "replay"; readonly direction: Direction; readonly replay: Replay<S, C> }
  | { readonly status: "dropped"; readonly direction: Direction }
  | { readonly status: "empty" | "busy" }

type Commit<S, C> = Extract<Entry<S, C>, { type: "commit" }>

interface Pending<S, C> {
  readonly direction: Direction
  readonly entry: Entry<S, C>
  readonly recreates: boolean
  readonly generation: number
  readonly depth: number
}

function needsLiveElements(entry: Entry<unknown, unknown>, direction: Direction): boolean {
  if (entry.type === "commit") return true
  return (entry.type === "create") === (direction === "undo")
}

function sameIds(a: readonly Change<unknown>[], b: readonly Change<unknown>[]): boolean {
  return a.length === b.length && a.every(({ id }, index) => id === b[index]?.id)
}

function coalesced<S, C>(top: Commit<S, C>, next: Commit<S, C>): Commit<S, C> {
  return { ...top, changes: top.changes.map((change, index) => ({ ...change, after: next.changes[index]?.after ?? change.after })) }
}

export class History<S, C> {
  private undoStack: Entry<S, C>[] = []
  private redoStack: Entry<S, C>[] = []
  private readonly current = new Map<string, string>()
  private readonly original = new Map<string, string>()
  private readonly erased = new Set<string>()
  private pending: Pending<S, C> | undefined
  private generation = 0
  private coalesceTarget: { entry: Entry<S, C>; at: number } | undefined

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get busy(): boolean {
    return this.pending !== undefined
  }

  record(entry: Entry<S, C>, now: number): void {
    const recorded = this.toOriginalIds(entry)
    const top = this.coalescingTop(recorded, now)
    this.generation += 1
    this.redoStack = []
    const pushed = top === undefined || recorded.type !== "commit" ? recorded : coalesced(top, recorded)
    if (top !== undefined) this.undoStack.pop()
    this.undoStack.push(pushed)
    this.coalesceTarget = { entry: pushed, at: now }
  }

  noteErased(id: string): void {
    this.erased.add(id)
  }

  undo(): Step<S, C> {
    return this.step("undo")
  }

  redo(): Step<S, C> {
    return this.step("redo")
  }

  replayed(created: ReadonlyMap<string, string> = new Map()): void {
    const pending = this.pending
    if (pending === undefined) return
    this.pending = undefined
    const entry = pending.recreates ? this.withCreatedIds(pending.entry, created) : pending.entry
    if (entry === undefined) return
    if (pending.direction === "redo") {
      this.undoStack.splice(Math.min(pending.depth, this.undoStack.length), 0, entry)
    } else if (pending.generation === this.generation) {
      this.redoStack.push(entry)
    }
  }

  failed(): void {
    this.pending = undefined
  }

  private step(direction: Direction): Step<S, C> {
    if (this.pending !== undefined) return { status: "busy" }
    const stack = direction === "undo" ? this.undoStack : this.redoStack
    const popped = stack.pop()
    if (popped === undefined) return { status: "empty" }
    this.coalesceTarget = undefined
    const entry = needsLiveElements(popped, direction) ? this.withoutErased(popped) : popped
    if (entry === undefined) return { status: "dropped", direction }
    const replay = this.replayOf(entry, direction)
    this.pending = {
      direction,
      entry,
      recreates: replay.type === "create",
      generation: this.generation,
      depth: this.undoStack.length,
    }
    return { status: "replay", direction, replay }
  }

  private replayOf(entry: Entry<S, C>, direction: Direction): Replay<S, C> {
    if (entry.type === "commit") {
      const changes = entry.changes.map(({ id, before, after }) => ({ id: this.currentId(id), change: direction === "undo" ? before : after }))
      return { type: "commit", changes }
    }
    const erases = (entry.type === "create") === (direction === "undo")
    if (erases) return { type: "erase", ids: entry.elements.map(({ id }) => this.currentId(id)) }
    return { type: "create", elements: entry.elements }
  }

  private coalescingTop(entry: Entry<S, C>, now: number): Commit<S, C> | undefined {
    const target = this.coalesceTarget
    const top = this.undoStack.at(-1)
    if (target === undefined || top === undefined || target.entry !== top || now - target.at > COALESCE_MS) return undefined
    if (top.type !== "commit" || entry.type !== "commit" || top.coalesce === undefined) return undefined
    return top.coalesce === entry.coalesce && sameIds(top.changes, entry.changes) ? top : undefined
  }

  private withoutErased(entry: Entry<S, C>): Entry<S, C> | undefined {
    if (entry.type === "commit") {
      const live = entry.changes.filter(({ id }) => !this.isErased(id))
      return live.length === 0 ? undefined : { ...entry, changes: live }
    }
    const live = entry.elements.filter(({ id }) => !this.isErased(id))
    return live.length === 0 ? undefined : { ...entry, elements: live }
  }

  private withCreatedIds(entry: Entry<S, C>, created: ReadonlyMap<string, string>): Entry<S, C> | undefined {
    if (entry.type === "commit") return entry
    const recreated = entry.elements.filter(({ id }) => created.has(id))
    for (const { id } of recreated) {
      const newId = created.get(id)
      if (newId === undefined) continue
      this.current.set(id, newId)
      this.original.set(newId, id)
    }
    return recreated.length === 0 ? undefined : { ...entry, elements: recreated }
  }

  private isErased(originalId: string): boolean {
    return this.erased.has(this.currentId(originalId))
  }

  private currentId(originalId: string): string {
    return this.current.get(originalId) ?? originalId
  }

  private originalId(id: string): string {
    return this.original.get(id) ?? id
  }

  private toOriginalIds(entry: Entry<S, C>): Entry<S, C> {
    if (entry.type === "commit") return { ...entry, changes: entry.changes.map((change) => ({ ...change, id: this.originalId(change.id) })) }
    return { ...entry, elements: entry.elements.map((element) => ({ ...element, id: this.originalId(element.id) })) }
  }
}
