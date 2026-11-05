import { previewDelay, type Point } from "./canvas_logic.ts"

export interface CursorMessage extends Point {
  seq: number
}

export interface RemoteCursor extends Point {
  viewer_id: string
  name: string
  color: string
  seq: number
}

export class CursorSender {
  private seq = 0
  private lastSentAt = -Infinity
  private sent: Point | undefined
  private pending: Point | undefined
  private scheduled = false

  move(point: Point, now: number): number | undefined {
    this.pending = point
    if (this.scheduled) return undefined
    this.scheduled = true
    return previewDelay(this.lastSentAt, now, false)
  }

  flush(now: number): CursorMessage | undefined {
    this.scheduled = false
    const point = this.pending
    this.pending = undefined
    if (point === undefined || (point.x === this.sent?.x && point.y === this.sent.y)) return undefined
    this.sent = point
    this.lastSentAt = now
    this.seq += 1
    return { ...point, seq: this.seq }
  }

  leave(): number | undefined {
    this.scheduled = false
    this.pending = undefined
    if (this.sent === undefined) return undefined
    this.sent = undefined
    this.seq += 1
    return this.seq
  }
}

export class RemoteCursors {
  private readonly shown = new Map<string, RemoteCursor>()
  private readonly latestSeq = new Map<string, number>()

  accept(cursor: RemoteCursor): boolean {
    if (!this.isNewer(cursor.viewer_id, cursor.seq)) return false
    this.latestSeq.set(cursor.viewer_id, cursor.seq)
    this.shown.set(cursor.viewer_id, cursor)
    return true
  }

  leave(viewerId: string, seq: number): boolean {
    if (!this.isNewer(viewerId, seq)) return false
    this.latestSeq.set(viewerId, seq)
    return this.shown.delete(viewerId)
  }

  forget(viewerId: string): boolean {
    this.latestSeq.set(viewerId, Infinity)
    return this.shown.delete(viewerId)
  }

  clear(): string[] {
    const ids = [...this.shown.keys()]
    this.shown.clear()
    this.latestSeq.clear()
    return ids
  }

  find(viewerId: string): RemoteCursor | undefined {
    return this.shown.get(viewerId)
  }

  visible(): RemoteCursor[] {
    return [...this.shown.values()]
  }

  private isNewer(viewerId: string, seq: number): boolean {
    return seq > (this.latestSeq.get(viewerId) ?? 0)
  }
}

export function isRemoteCursor(value: unknown): value is RemoteCursor {
  if (typeof value !== "object" || value === null) return false
  const cursor = value as Record<string, unknown>
  return (
    typeof cursor.viewer_id === "string" &&
    typeof cursor.name === "string" &&
    typeof cursor.color === "string" &&
    Number.isInteger(cursor.x) &&
    Number.isInteger(cursor.y) &&
    Number.isInteger(cursor.seq)
  )
}
