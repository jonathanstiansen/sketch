import { ViewHook } from "phoenix_live_view"

const MAX_X = 3880
const MAX_Y = 3920
const PREVIEW_INTERVAL_MS = 50
const STALE_PREVIEW_MS = 2000
const DRAGGING = "data-dragging"

interface Point {
  x: number
  y: number
}

interface LocalDrag {
  rect: SVGRectElement
  rectangleId: string
  dragId: string
  pointerId: number
  baseVersion: number
  grab: Point
  origin: Point
  position: Point
  seq: number
  lastSentAt: number
  previewTimer: number | undefined
}

interface RemoteDrag {
  dragId: string
  seq: number
  staleTimer: number
}

interface Preview {
  rectangle_id: string
  drag_id: string
  seq: number
  base_version: number
  x: number
  y: number
}

interface DragRef {
  rectangle_id: string
  drag_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDragRef(value: unknown): value is DragRef {
  return (
    isRecord(value) && typeof value.rectangle_id === "string" && typeof value.drag_id === "string"
  )
}

function isPreview(value: unknown): value is Preview {
  return (
    isDragRef(value) &&
    isRecord(value) &&
    Number.isInteger(value.seq) &&
    Number.isInteger(value.base_version) &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y)
  )
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(Math.round(value), 0), max)
}

function numberAttribute(el: Element, name: string): number {
  return Number(el.getAttribute(name))
}

function committedPosition(rect: Element): Point {
  return { x: numberAttribute(rect, "data-x"), y: numberAttribute(rect, "data-y") }
}

function moveRect(rect: Element, { x, y }: Point): void {
  rect.setAttribute("x", String(x))
  rect.setAttribute("y", String(y))
}

export function keepDraggedPosition(fromEl: Element, toEl: Element): void {
  if (!fromEl.hasAttribute(DRAGGING)) return
  toEl.setAttribute(DRAGGING, "")
  for (const name of ["x", "y"]) {
    const value = fromEl.getAttribute(name)
    if (value !== null) toEl.setAttribute(name, value)
  }
}

export class Canvas extends ViewHook {
  private drag: LocalDrag | undefined
  private remoteDrags = new Map<string, RemoteDrag>()
  private finishedDragIds = new Set<string>()
  private online = true

  override mounted(): void {
    this.el.addEventListener("pointerdown", this.onPointerDown)
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerup", this.onPointerUp)
    this.el.addEventListener("pointercancel", this.onPointerCancel)
    this.el.addEventListener("lostpointercapture", this.onPointerCancel)
    this.handleEvent("preview", (payload: unknown) => {
      if (isPreview(payload)) this.applyRemotePreview(payload)
    })
    this.handleEvent("drag_cancel", (payload: unknown) => {
      if (isDragRef(payload)) this.cancelRemoteDrag(payload)
    })
    this.handleEvent("revert", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.rectangle_id === "string") {
        this.revert(payload.rectangle_id)
      }
    })
  }

  override disconnected(): void {
    this.online = false
    if (this.drag !== undefined) this.abandonDrag(this.drag)
  }

  override reconnected(): void {
    this.online = true
  }

  override destroyed(): void {
    if (this.drag !== undefined) window.clearTimeout(this.drag.previewTimer)
    for (const remote of this.remoteDrags.values()) window.clearTimeout(remote.staleTimer)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.online || this.drag !== undefined || event.button !== 0) return
    const rect = event.target instanceof SVGRectElement ? event.target : null
    const rectangleId = rect?.dataset.rect
    if (rect === null || rectangleId === undefined) return

    event.preventDefault()
    rect.setPointerCapture(event.pointerId)
    rect.setAttribute(DRAGGING, "")
    this.clearRemoteDrag(rectangleId)
    const position = { x: numberAttribute(rect, "x"), y: numberAttribute(rect, "y") }
    const pointer = this.canvasPoint(event)
    this.drag = {
      rect,
      rectangleId,
      dragId: crypto.randomUUID(),
      pointerId: event.pointerId,
      baseVersion: numberAttribute(rect, "data-version"),
      grab: { x: pointer.x - position.x, y: pointer.y - position.y },
      origin: position,
      position,
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (drag?.pointerId !== event.pointerId) return
    const pointer = this.canvasPoint(event)
    drag.position = {
      x: clamp(pointer.x - drag.grab.x, MAX_X),
      y: clamp(pointer.y - drag.grab.y, MAX_Y),
    }
    moveRect(drag.rect, drag.position)
    this.schedulePreview(drag)
  }

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag
    if (drag?.pointerId !== event.pointerId) return
    this.endDrag(drag)
    const { x, y } = drag.position
    if (x === drag.origin.x && y === drag.origin.y) return
    void this.pushEvent("commit", {
      rectangle_id: drag.rectangleId,
      drag_id: drag.dragId,
      x,
      y,
    })
  }

  private onPointerCancel = (): void => {
    const drag = this.drag
    if (drag === undefined) return
    this.abandonDrag(drag)
    void this.pushEvent("drag_cancel", { rectangle_id: drag.rectangleId, drag_id: drag.dragId })
  }

  private abandonDrag(drag: LocalDrag): void {
    this.endDrag(drag)
    moveRect(drag.rect, drag.origin)
  }

  private endDrag(drag: LocalDrag): void {
    this.drag = undefined
    window.clearTimeout(drag.previewTimer)
    drag.rect.removeAttribute(DRAGGING)
    if (drag.rect.hasPointerCapture(drag.pointerId)) drag.rect.releasePointerCapture(drag.pointerId)
  }

  private schedulePreview(drag: LocalDrag): void {
    if (drag.previewTimer !== undefined) return
    const wait = Math.max(0, drag.lastSentAt + PREVIEW_INTERVAL_MS - performance.now())
    drag.previewTimer = window.setTimeout(() => {
      drag.previewTimer = undefined
      this.sendPreview(drag)
    }, wait)
  }

  private sendPreview(drag: LocalDrag): void {
    if (this.drag !== drag) return
    drag.seq += 1
    drag.lastSentAt = performance.now()
    void this.pushEvent("preview", {
      rectangle_id: drag.rectangleId,
      drag_id: drag.dragId,
      seq: drag.seq,
      base_version: drag.baseVersion,
      ...drag.position,
    })
  }

  private applyRemotePreview(preview: Preview): void {
    const rect = this.rectFor(preview.rectangle_id)
    if (rect === null || this.drag?.rectangleId === preview.rectangle_id) return
    if (this.finishedDragIds.has(preview.drag_id)) return
    if (preview.base_version < numberAttribute(rect, "data-version")) return
    const current = this.remoteDrags.get(preview.rectangle_id)
    if (current?.dragId === preview.drag_id && preview.seq <= current.seq) return

    window.clearTimeout(current?.staleTimer)
    this.remoteDrags.set(preview.rectangle_id, {
      dragId: preview.drag_id,
      seq: preview.seq,
      staleTimer: window.setTimeout(() => {
        this.cancelRemoteDrag(preview)
      }, STALE_PREVIEW_MS),
    })
    moveRect(rect, preview)
  }

  private cancelRemoteDrag({ rectangle_id, drag_id }: DragRef): void {
    this.finishedDragIds.add(drag_id)
    if (this.remoteDrags.get(rectangle_id)?.dragId !== drag_id) return
    this.clearRemoteDrag(rectangle_id)
    this.revert(rectangle_id)
  }

  private clearRemoteDrag(rectangleId: string): void {
    window.clearTimeout(this.remoteDrags.get(rectangleId)?.staleTimer)
    this.remoteDrags.delete(rectangleId)
  }

  private revert(rectangleId: string): void {
    if (this.drag?.rectangleId === rectangleId) return
    const rect = this.rectFor(rectangleId)
    if (rect !== null) moveRect(rect, committedPosition(rect))
  }

  private rectFor(rectangleId: string): SVGRectElement | null {
    return this.el.querySelector<SVGRectElement>(`rect[data-rect="${CSS.escape(rectangleId)}"]`)
  }

  private canvasPoint(event: PointerEvent): Point {
    const svg = this.el.querySelector("svg")
    const bounds = svg?.getBoundingClientRect() ?? this.el.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
}
