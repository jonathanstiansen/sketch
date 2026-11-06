import { pushClientEvent, type EventPusher } from "./client_events.ts"
import {
  createPayload,
  positionPayload,
  recordedElement,
  recordedElements,
  shapePayload,
  stylePayload,
  type ElementChange,
  type ElementSnapshot,
} from "./element_history.ts"
import { History, type Change, type Direction, type Entry, type Recorded, type Replay } from "./history_logic.ts"

export interface MutationHost {
  canReplay(): boolean
  historyChanged(): void
  failed(message: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isOk(reply: unknown): boolean {
  return isRecord(reply) && reply.ok === true
}

export class BoardMutations {
  private readonly history = new History<ElementSnapshot, ElementChange>()
  private queued: Direction[] = []
  private readonly server: EventPusher
  private readonly host: MutationHost
  private readonly now: () => number

  constructor(server: EventPusher, host: MutationHost, now: () => number = () => performance.now()) {
    this.server = server
    this.host = host
    this.now = now
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  get busy(): boolean {
    return this.history.busy
  }

  noteErased(elementId: string): void {
    this.history.noteErased(elementId)
  }

  async create(snapshot: ElementSnapshot, dragId: string): Promise<string | undefined> {
    const created = await this.pushCreate(snapshot, dragId)
    if (created !== undefined) this.record({ type: "create", elements: [created] })
    return created?.id
  }

  async createMany(snapshots: readonly ElementSnapshot[]): Promise<string[]> {
    const results = await Promise.all(snapshots.map((snapshot) => this.pushCreate(snapshot, crypto.randomUUID())))
    const created = results.flatMap((element) => element ?? [])
    if (created.length > 0) this.record({ type: "create", elements: created })
    return created.map(({ id }) => id)
  }

  async erase(elementIds: readonly string[]): Promise<void> {
    const erased = await this.pushErase(elementIds)
    if (erased.length > 0) this.record({ type: "erase", elements: erased })
  }

  async commit(changes: readonly Change<ElementChange>[], dragId: string, coalesce?: string): Promise<Change<ElementChange>[]> {
    const results = await Promise.all(changes.map(async (change) => ({ change, ok: await this.pushChange(change.id, change.after, dragId) })))
    const committed = results.flatMap(({ change, ok }) => (ok ? [change] : []))
    if (committed.length > 0) this.record(coalesce === undefined ? { type: "commit", changes: committed } : { type: "commit", changes: committed, coalesce })
    return results.flatMap(({ change, ok }) => (ok ? [] : [change]))
  }

  run(direction: Direction): void {
    if (this.history.busy) {
      this.queued.push(direction)
      return
    }
    const step = direction === "undo" ? this.history.undo() : this.history.redo()
    if (step.status === "dropped") this.host.failed(`Can't ${direction}: erased by someone else`)
    if (step.status === "replay") void this.replay(step.direction, step.replay)
    this.host.historyChanged()
  }

  private record(entry: Entry<ElementSnapshot, ElementChange>): void {
    this.history.record(entry, this.now())
    this.host.historyChanged()
  }

  private async replay(direction: Direction, replay: Replay<ElementSnapshot, ElementChange>): Promise<void> {
    const created = await this.runReplay(replay).catch(() => undefined)
    if (created === undefined) {
      this.history.failed()
      this.host.failed(`Couldn't ${direction}`)
    } else {
      this.history.replayed(created)
    }
    this.host.historyChanged()
    const next = this.queued.shift()
    if (next !== undefined && this.host.canReplay()) this.run(next)
  }

  private async runReplay(replay: Replay<ElementSnapshot, ElementChange>): Promise<Map<string, string> | undefined> {
    if (replay.type === "commit") {
      const dragId = crypto.randomUUID()
      const results = await Promise.all(replay.changes.map(({ id, change }) => this.pushChange(id, change, dragId)))
      return results.some(Boolean) ? new Map() : undefined
    }
    if (replay.type === "erase") {
      return (await this.pushErase(replay.ids)).length > 0 ? new Map() : undefined
    }
    const created = await Promise.all(
      replay.elements.map(async ({ id, snapshot }) => [id, await this.pushCreate(snapshot, crypto.randomUUID())] as const),
    )
    const ids = new Map(created.flatMap(([id, element]) => (element === undefined ? [] : [[id, element.id] as const])))
    return ids.size === 0 ? undefined : ids
  }

  private async pushErase(elementIds: readonly string[]): Promise<Recorded<ElementSnapshot>[]> {
    const reply: unknown = await pushClientEvent(this.server, "erase", { element_ids: elementIds })
    return isRecord(reply) ? recordedElements(reply.erased) : []
  }

  private async pushCreate(snapshot: ElementSnapshot, dragId: string): Promise<Recorded<ElementSnapshot> | undefined> {
    const reply: unknown = await pushClientEvent(this.server, "create_element", createPayload(snapshot, dragId))
    return isRecord(reply) ? recordedElement(reply.element) : undefined
  }

  private async pushChange(elementId: string, change: ElementChange, dragId: string): Promise<boolean> {
    return isOk(await this.pushElementChange(elementId, change, dragId))
  }

  private pushElementChange(elementId: string, change: ElementChange, dragId: string): Promise<unknown> {
    if (change.event === "commit") return pushClientEvent(this.server, "commit", positionPayload(elementId, change, dragId))
    if (change.event === "commit_shape") return pushClientEvent(this.server, "commit_shape", shapePayload(elementId, change, dragId))
    return pushClientEvent(this.server, "commit_style", stylePayload(elementId, change))
  }
}
