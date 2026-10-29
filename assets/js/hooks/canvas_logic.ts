export const PREVIEW_INTERVAL_MS = 50

export interface Point {
  x: number
  y: number
}

export interface DragRef {
  rectangle_id: string
  drag_id: string
}

export interface Preview extends DragRef {
  seq: number
  base_version: number
  x: number
  y: number
}

export function clamp(value: number, max: number): number {
  return Math.min(Math.max(Math.round(value), 0), max)
}

export function dragPosition(cursor: Point, grab: Point, max: Point): Point {
  return { x: clamp(cursor.x - grab.x, max.x), y: clamp(cursor.y - grab.y, max.y) }
}

export function previewDelay(
  lastSentAt: number,
  now: number,
  alreadyScheduled: boolean,
): number | undefined {
  if (alreadyScheduled) return undefined
  return Math.max(0, lastSentAt + PREVIEW_INTERVAL_MS - now)
}

export class RemotePreviews {
  private latestSeq = new Map<string, number>()
  private finishedDragIds = new Set<string>()
  private activeDrags = new Map<string, string>()

  accept(preview: Preview, knownVersion: number): boolean {
    if (this.finishedDragIds.has(preview.drag_id)) return false
    if (preview.base_version < knownVersion) return false
    const latest = this.latestSeq.get(preview.drag_id)
    if (latest !== undefined && preview.seq <= latest) return false

    this.latestSeq.set(preview.drag_id, preview.seq)
    this.activeDrags.set(preview.rectangle_id, preview.drag_id)
    return true
  }

  finish({ rectangle_id, drag_id }: DragRef): boolean {
    this.finishedDragIds.add(drag_id)
    this.latestSeq.delete(drag_id)
    if (this.activeDrags.get(rectangle_id) !== drag_id) return false
    this.activeDrags.delete(rectangle_id)
    return true
  }

  forget(rectangleId: string): void {
    this.activeDrags.delete(rectangleId)
  }
}
