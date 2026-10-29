import { ViewHook } from "phoenix_live_view"
import {
  RemotePreviews,
  dragPosition,
  previewDelay,
  type DragRef,
  type Point,
  type Preview,
} from "./canvas_logic"
import {
  DEFAULT_TOOL,
  isPanKey,
  nextTool,
  panScroll,
  pointerAction,
  selectTool,
  togglesHelp,
  type KeyInput,
  type ToolId,
} from "./tools"

const STALE_PREVIEW_MS = 2000
const DRAGGING = "data-dragging"
const SELECT_TOOL_EVENT = "sketch:select-tool"

interface LocalDrag {
  rect: SVGRectElement
  rectangleId: string
  dragId: string
  pointerId: number
  baseVersion: number
  grab: Point
  origin: Point
  position: Point
  max: Point
  seq: number
  lastSentAt: number
  previewTimer: number | undefined
}

interface Pan {
  pointerId: number
  startPointer: Point
  startScroll: Point
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  )
}

function keyInput(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    editable: event.isComposing || isEditable(event.target),
  }
}

function clientPoint(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY }
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

function numberAttribute(el: Element, name: string): number {
  return Number(el.getAttribute(name))
}

function integerAttribute(el: Element, name: string): number {
  const value = Number(el.getAttribute(name))
  if (!el.hasAttribute(name) || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
  return value
}

function maxPosition(el: Element): Point {
  return { x: integerAttribute(el, "data-max-x"), y: integerAttribute(el, "data-max-y") }
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
  private remotePreviews = new RemotePreviews()
  private staleTimers = new Map<string, number>()
  private online = true
  private tool: ToolId = DEFAULT_TOOL
  private spaceHeld = false
  private pannedWithSpace = false
  private pan: Pan | undefined

  override mounted(): void {
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("blur", this.releaseSpace)
    this.el.addEventListener(SELECT_TOOL_EVENT, this.onSelectTool)
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
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("blur", this.releaseSpace)
    if (this.drag !== undefined) window.clearTimeout(this.drag.previewTimer)
    for (const timer of this.staleTimers.values()) window.clearTimeout(timer)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.drag !== undefined || this.pan !== undefined) return
    const rect = event.target instanceof SVGRectElement ? event.target : null
    const action = pointerAction({
      button: event.button,
      tool: this.tool,
      spaceHeld: this.spaceHeld,
      onRectangle: rect?.dataset.rect !== undefined,
    })
    if (action === "pan") this.startPan(event)
    if (action === "create") this.createAt(event)
    if (action === "drag" && rect !== null) this.startDrag(event, rect)
  }

  private startDrag(event: PointerEvent, rect: SVGRectElement): void {
    const rectangleId = rect.dataset.rect
    if (!this.online || rectangleId === undefined) return

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
      max: maxPosition(this.el),
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) {
      const scroll = panScroll(this.pan.startScroll, this.pan.startPointer, clientPoint(event))
      this.el.scrollTo(scroll.x, scroll.y)
      return
    }
    const drag = this.drag
    if (drag?.pointerId !== event.pointerId) return
    drag.position = dragPosition(this.canvasPoint(event), drag.grab, drag.max)
    moveRect(drag.rect, drag.position)
    this.schedulePreview(drag)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
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

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    const drag = this.drag
    if (drag === undefined) return
    this.abandonDrag(drag)
    void this.pushEvent("drag_cancel", { rectangle_id: drag.rectangleId, drag_id: drag.dragId })
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const input = keyInput(event)
    if (isPanKey(input)) {
      if (!(event.target instanceof HTMLButtonElement)) event.preventDefault()
      this.setSpaceHeld(true)
      return
    }
    if (togglesHelp(input)) this.toggleHelp()
    if (input.key === "Escape") this.hideHelp()
    this.useTool(nextTool(this.tool, input))
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== " ") return
    if (this.pannedWithSpace) event.preventDefault()
    this.releaseSpace()
  }

  private releaseSpace = (): void => {
    this.pannedWithSpace = false
    this.setSpaceHeld(false)
  }

  private onSelectTool = (event: Event): void => {
    if (event instanceof CustomEvent && isRecord(event.detail) && typeof event.detail.tool === "string") {
      this.useTool(selectTool(this.tool, event.detail.tool))
    }
  }

  private useTool(tool: ToolId): void {
    if (tool === this.tool) return
    this.tool = tool
    this.js().setAttribute(this.el, "data-tool", tool)
    for (const button of document.querySelectorAll<HTMLElement>("[data-tool-button]")) {
      this.js().setAttribute(button, "aria-pressed", String(button.dataset.toolButton === tool))
    }
  }

  private setSpaceHeld(held: boolean): void {
    if (held === this.spaceHeld) return
    this.spaceHeld = held
    this.js().setAttribute(this.el, "data-space-held", String(held))
  }

  private toggleHelp(): void {
    const command = document.getElementById("shortcuts-help-button")?.getAttribute("phx-click")
    if (command != null) this.js().exec(command)
  }

  private hideHelp(): void {
    const command = document.getElementById("shortcuts-help")?.getAttribute("data-hide")
    if (command != null) this.js().exec(command)
  }

  private startPan(event: PointerEvent): void {
    event.preventDefault()
    this.pannedWithSpace = this.spaceHeld
    this.el.setPointerCapture(event.pointerId)
    this.pan = {
      pointerId: event.pointerId,
      startPointer: clientPoint(event),
      startScroll: { x: this.el.scrollLeft, y: this.el.scrollTop },
    }
    this.js().setAttribute(this.el, "data-panning", "true")
  }

  private endPan(): void {
    const pan = this.pan
    if (pan === undefined) return
    this.pan = undefined
    this.js().setAttribute(this.el, "data-panning", "false")
    if (this.el.hasPointerCapture(pan.pointerId)) this.el.releasePointerCapture(pan.pointerId)
  }

  private createAt(event: PointerEvent): void {
    if (!this.online) return
    event.preventDefault()
    const { x, y } = this.canvasPoint(event)
    void this.pushEvent("create_at", { x: Math.round(x), y: Math.round(y) })
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
    const wait = previewDelay(drag.lastSentAt, performance.now(), drag.previewTimer !== undefined)
    if (wait === undefined) return
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
    if (!this.remotePreviews.accept(preview, numberAttribute(rect, "data-version"))) return

    window.clearTimeout(this.staleTimers.get(preview.rectangle_id))
    this.staleTimers.set(
      preview.rectangle_id,
      window.setTimeout(() => {
        this.cancelRemoteDrag(preview)
      }, STALE_PREVIEW_MS),
    )
    moveRect(rect, preview)
  }

  private cancelRemoteDrag(ref: DragRef): void {
    if (!this.remotePreviews.finish(ref)) return
    this.clearStaleTimer(ref.rectangle_id)
    this.revert(ref.rectangle_id)
  }

  private clearRemoteDrag(rectangleId: string): void {
    this.remotePreviews.forget(rectangleId)
    this.clearStaleTimer(rectangleId)
  }

  private clearStaleTimer(rectangleId: string): void {
    window.clearTimeout(this.staleTimers.get(rectangleId))
    this.staleTimers.delete(rectangleId)
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
