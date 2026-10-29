import { ViewHook } from "phoenix_live_view"
import {
  RemotePreviews,
  clickBox,
  cornerPoint,
  drawnBox,
  endpointPoint,
  isDrag,
  movedBox,
  movedEndpoint,
  previewDelay,
  resizedBox,
  sameShape,
  scalePoints,
  shapeAround,
  thinStroke,
  STROKE_MIN_DISTANCE,
  type Box,
  type Corner,
  type DragRef,
  type Endpoint,
  type Point,
  type Preview,
  type Shape,
  type Size,
} from "./canvas_logic"
import { DrawLayer, SelectionOverlay, isCorner, isEndpoint, setShape } from "./selection"
import {
  DEFAULT_TOOL,
  drawnKind,
  hasEndpointHandles,
  isDrawnKind,
  isPointKind,
  isPanKey,
  nextTool,
  panScroll,
  pointerAction,
  selectTool,
  togglesHelp,
  type DrawnKind,
  type KeyInput,
  type ToolId,
} from "./tools"

const STALE_PREVIEW_MS = 2000
const DRAGGING = "data-dragging"
const SELECT_TOOL_EVENT = "sketch:select-tool"
const SEGMENT_ATTRIBUTES = ["x1", "y1", "x2", "y2"]
const BOX_ATTRIBUTES = ["x", "y", "width", "height", "points", "cx", "cy", "rx", "ry", ...SEGMENT_ATTRIBUTES]
const BOX_SIZE_ATTRIBUTES = ["x", "y", "width", "height", ...SEGMENT_ATTRIBUTES]

interface Throttled {
  dragId: string
  pointerId: number
  seq: number
  lastSentAt: number
  previewTimer: number | undefined
}

type Grip = { mode: "move" } | { mode: "resize"; corner: Corner } | { mode: "endpoint"; endpoint: Endpoint }

type Edit = Throttled &
  Grip & {
    rect: SVGElement
    elementId: string
    baseVersion: number
    grab: Point
    origin: Shape
    shape: Shape
  }

interface Draw extends Throttled {
  mode: "draw"
  kind: DrawnKind
  start: Point
  dragged: boolean
  shape: Shape
  path: Point[]
}

type Gesture = Edit | Draw

interface DrawPreview extends Box {
  kind: DrawnKind
  drag_id: string
  seq: number
  points: readonly Point[]
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

function isBox(value: Record<string, unknown>): boolean {
  return ["x", "y", "width", "height"].every((key) => Number.isInteger(value[key]))
}

function isPoints(value: unknown): value is readonly Point[] {
  return Array.isArray(value) && value.every((point) => isRecord(point) && Number.isInteger(point.x) && Number.isInteger(point.y))
}

function isDragRef(value: unknown): value is DragRef {
  return isRecord(value) && typeof value.element_id === "string" && typeof value.drag_id === "string"
}

function isPreview(value: unknown): value is Preview {
  return (
    isDragRef(value) &&
    isRecord(value) &&
    Number.isInteger(value.seq) &&
    Number.isInteger(value.base_version) &&
    isBox(value) &&
    isPoints(value.points)
  )
}

function isDrawPreview(value: unknown): value is DrawPreview {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    isDrawnKind(value.kind) &&
    typeof value.drag_id === "string" &&
    Number.isInteger(value.seq) &&
    isBox(value) &&
    isPoints(value.points)
  )
}

function integerAttribute(el: Element, name: string): number {
  const value = Number(el.getAttribute(name))
  if (!el.hasAttribute(name) || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
  return value
}

function renderedBox(rect: Element): Box {
  return {
    x: integerAttribute(rect, "x"),
    y: integerAttribute(rect, "y"),
    width: integerAttribute(rect, "width"),
    height: integerAttribute(rect, "height"),
  }
}

function renderedPoints(shape: Element, box: Box): Point[] {
  const segment = shape.querySelector("line[data-line-stroke]")
  if (segment !== null) {
    return [
      { x: integerAttribute(segment, "x1") - box.x, y: integerAttribute(segment, "y1") - box.y },
      { x: integerAttribute(segment, "x2") - box.x, y: integerAttribute(segment, "y2") - box.y },
    ]
  }
  const stroke = shape.querySelector("polyline[data-freedraw-stroke]")
  if (stroke === null) return []
  return pairs(stroke.getAttribute("points") ?? "").map((at) => subtract(at, box))
}

function renderedShape(shape: Element): Shape {
  const box = renderedBox(shape)
  return { box, points: renderedPoints(shape, box) }
}

function integerPair(pair: string): Point {
  const [x, y] = pair.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("data-points must be integer pairs")
  }
  return { x, y }
}

function pairs(points: string): Point[] {
  return points === "" ? [] : points.split(" ").map(integerPair)
}

function committedPoints(shape: Element): Point[] {
  return pairs(shape.getAttribute("data-points") ?? "")
}

function committedShape(shape: Element): Shape {
  const points = committedPoints(shape)
  return {
    box: {
      x: integerAttribute(shape, "data-x"),
      y: integerAttribute(shape, "data-y"),
      width: integerAttribute(shape, "data-width"),
      height: integerAttribute(shape, "data-height"),
    },
    points,
  }
}

function showShape(element: Element, { box, points }: Shape): void {
  setShape(element, box, points)
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function keepDraggedPosition(fromEl: Element, toEl: Element): void {
  if (fromEl.hasAttribute(DRAGGING)) {
    toEl.setAttribute(DRAGGING, "")
  } else if (fromEl.parentElement?.hasAttribute(DRAGGING) !== true) {
    return
  }
  for (const name of BOX_ATTRIBUTES) {
    const value = fromEl.getAttribute(name)
    if (value !== null) toEl.setAttribute(name, value)
  }
}

function gripPoint({ box, points }: Shape, grip: Grip): Point {
  if (grip.mode === "resize") return cornerPoint(box, grip.corner)
  if (grip.mode === "endpoint") return endpointPoint({ box, points }, grip.endpoint) ?? box
  return box
}

function editedShape(edit: Edit, pointer: Point, canvas: Size): Shape {
  const { box, points } = edit.origin
  if (edit.mode === "resize") {
    const resized = resizedBox(box, edit.corner, subtract(pointer, edit.grab), canvas)
    return { box: resized, points: scalePoints(points, box, resized) }
  }
  if (edit.mode === "endpoint") return movedEndpoint(edit.origin, edit.endpoint, subtract(pointer, edit.grab), canvas)
  return { box: movedBox(box, pointer, edit.grab, canvas), points }
}

export class Canvas extends ViewHook {
  private gesture: Gesture | undefined
  private remotePreviews = new RemotePreviews()
  private remoteDraws = new RemotePreviews()
  private staleTimers = new Map<string, number>()
  private online = true
  private tool: ToolId = DEFAULT_TOOL
  private spaceHeld = false
  private pannedWithSpace = false
  private pan: Pan | undefined
  private selectedId: string | undefined
  private selection!: SelectionOverlay
  private draws!: DrawLayer
  private observer: MutationObserver | undefined

  override mounted(): void {
    this.selection = new SelectionOverlay(this.layer("#selection"))
    this.draws = new DrawLayer(this.layer("#draw-previews"))
    this.observer = new MutationObserver(() => {
      this.syncSelection()
    })
    this.observer.observe(this.layer("#elements"), {
      subtree: true,
      childList: true,
      attributeFilter: BOX_SIZE_ATTRIBUTES,
    })
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
    this.handleEvent("draw_preview", (payload: unknown) => {
      if (isDrawPreview(payload)) this.applyRemoteDraw(payload)
    })
    this.handleEvent("draw_end", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.drag_id === "string") this.endRemoteDraw(payload.drag_id)
    })
    this.handleEvent("revert", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.element_id === "string") {
        this.revert(payload.element_id)
      }
    })
  }

  override disconnected(): void {
    this.online = false
    if (this.gesture !== undefined) this.abandonGesture(this.gesture)
  }

  override reconnected(): void {
    this.online = true
  }

  override destroyed(): void {
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("blur", this.releaseSpace)
    this.observer?.disconnect()
    if (this.gesture !== undefined) window.clearTimeout(this.gesture.previewTimer)
    for (const timer of this.staleTimers.values()) window.clearTimeout(timer)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.gesture !== undefined || this.pan !== undefined) return
    const target = event.target instanceof Element ? event.target : null
    const rect = target?.closest<SVGElement>("[data-element]") ?? null
    const handle = target?.closest<SVGRectElement>("rect[data-handle]")?.dataset.handle
    const action = pointerAction({
      button: event.button,
      tool: this.tool,
      spaceHeld: this.spaceHeld,
      onElement: rect !== null,
      onHandle: isCorner(handle) || isEndpoint(handle),
    })
    if (action === "pan") this.startPan(event)
    const kind = drawnKind(this.tool)
    if (action === "draw" && kind !== undefined) this.startDraw(event, kind)
    if (action === "deselect") this.select(undefined)
    if (action === "move" && rect !== null) this.startEdit(event, rect, { mode: "move" })
    if (action === "resize" && isCorner(handle)) this.editSelected(event, { mode: "resize", corner: handle })
    if (action === "resize" && isEndpoint(handle)) this.editSelected(event, { mode: "endpoint", endpoint: handle })
  }

  private editSelected(event: PointerEvent, grip: Grip): void {
    const rect = this.selectedId === undefined ? null : this.elementFor(this.selectedId)
    if (rect !== null) this.startEdit(event, rect, grip)
  }

  private startEdit(event: PointerEvent, rect: SVGElement, grip: Grip): void {
    const elementId = rect.dataset.element
    if (!this.online || elementId === undefined) return

    event.preventDefault()
    this.select(elementId)
    this.el.setPointerCapture(event.pointerId)
    rect.setAttribute(DRAGGING, "")
    this.clearRemoteDrag(elementId)
    const shape = renderedShape(rect)
    this.gesture = {
      ...grip,
      rect,
      elementId,
      dragId: crypto.randomUUID(),
      pointerId: event.pointerId,
      baseVersion: integerAttribute(rect, "data-version"),
      grab: subtract(this.canvasPoint(event), gripPoint(shape, grip)),
      origin: shape,
      shape,
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
  }

  private startDraw(event: PointerEvent, kind: DrawnKind): void {
    if (!this.online) return
    event.preventDefault()
    this.select(undefined)
    this.el.setPointerCapture(event.pointerId)
    const start = this.canvasPoint(event)
    this.gesture = {
      mode: "draw",
      kind,
      start,
      dragged: false,
      shape: this.drawnShape(kind, start, start),
      path: [start],
      dragId: crypto.randomUUID(),
      pointerId: event.pointerId,
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
    const gesture = this.gesture
    if (gesture?.pointerId !== event.pointerId) return
    const pointer = this.canvasPoint(event)
    if (gesture.mode === "draw") {
      this.updateDraw(gesture, pointer)
    } else {
      this.updateEdit(gesture, pointer)
    }
  }

  private updateEdit(edit: Edit, pointer: Point): void {
    edit.shape = editedShape(edit, pointer, this.canvasSize())
    showShape(edit.rect, edit.shape)
    this.schedulePreview(edit)
  }

  private updateDraw(draw: Draw, pointer: Point): void {
    draw.dragged ||= isDrag(draw.start, pointer)
    if (!draw.dragged) return
    if (draw.kind === "freedraw") {
      draw.path = thinStroke([...draw.path, pointer], STROKE_MIN_DISTANCE, this.maxPoints())
      draw.shape = shapeAround(draw.path, this.canvasSize())
    } else {
      draw.shape = this.drawnShape(draw.kind, draw.start, pointer)
    }
    showShape(this.draws.shape(draw.dragId, draw.kind), draw.shape)
    this.schedulePreview(draw)
  }

  private drawnShape(kind: DrawnKind, start: Point, end: Point): Shape {
    const canvas = this.canvasSize()
    return isPointKind(kind) ? shapeAround([start, end], canvas) : { box: drawnBox(start, end, canvas), points: [] }
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    const gesture = this.gesture
    if (gesture?.pointerId !== event.pointerId) return
    this.endGesture(gesture)
    if (gesture.mode === "draw") {
      this.finishDraw(gesture)
    } else {
      this.finishEdit(gesture)
    }
  }

  private finishEdit(edit: Edit): void {
    if (sameShape(edit.shape, edit.origin)) return
    const ref = { element_id: edit.elementId, drag_id: edit.dragId }
    if (edit.mode === "move") {
      void this.pushEvent("commit", { ...ref, x: edit.shape.box.x, y: edit.shape.box.y })
    } else {
      void this.pushEvent("commit_shape", { ...ref, ...edit.shape.box, points: edit.shape.points })
    }
  }

  private finishDraw(draw: Draw): void {
    if (!draw.dragged && isPointKind(draw.kind)) return
    const { box, points } = draw.dragged
      ? draw.shape
      : { box: clickBox(draw.start, this.defaultSize(), this.canvasSize()), points: [] }
    void this.pushEvent("create_element", { kind: draw.kind, drag_id: draw.dragId, ...box, points }).finally(
      () => {
        this.draws.remove(draw.dragId)
      },
    )
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    if (this.gesture !== undefined) this.cancelGesture(this.gesture)
  }

  private cancelGesture(gesture: Gesture): void {
    this.abandonGesture(gesture)
    if (gesture.mode === "draw") {
      void this.pushEvent("draw_cancel", { drag_id: gesture.dragId })
    } else {
      void this.pushEvent("drag_cancel", { element_id: gesture.elementId, drag_id: gesture.dragId })
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const input = keyInput(event)
    if (isPanKey(input)) {
      if (!(event.target instanceof HTMLButtonElement)) event.preventDefault()
      this.setSpaceHeld(true)
      return
    }
    if (togglesHelp(input)) this.toggleHelp()
    if (input.key === "Escape") this.escape()
    this.useTool(nextTool(this.tool, input))
  }

  private escape(): void {
    this.hideHelp()
    if (this.gesture !== undefined) this.cancelGesture(this.gesture)
    this.select(undefined)
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
    if (tool !== "selection") this.select(undefined)
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

  private select(elementId: string | undefined): void {
    this.selectedId = elementId
    this.syncSelection()
  }

  private syncSelection(): void {
    const rect = this.selectedId === undefined ? null : this.elementFor(this.selectedId)
    if (rect === null) {
      this.selectedId = undefined
      this.selection.hide()
    } else {
      const { box, points } = renderedShape(rect)
      this.selection.show(box, points, hasEndpointHandles(rect.dataset.kind))
    }
  }

  private abandonGesture(gesture: Gesture): void {
    this.endGesture(gesture)
    if (gesture.mode === "draw") {
      this.draws.remove(gesture.dragId)
    } else {
      showShape(gesture.rect, gesture.origin)
    }
  }

  private endGesture(gesture: Gesture): void {
    this.gesture = undefined
    window.clearTimeout(gesture.previewTimer)
    if (gesture.mode !== "draw") gesture.rect.removeAttribute(DRAGGING)
    if (this.el.hasPointerCapture(gesture.pointerId)) this.el.releasePointerCapture(gesture.pointerId)
  }

  private schedulePreview(gesture: Gesture): void {
    const wait = previewDelay(gesture.lastSentAt, performance.now(), gesture.previewTimer !== undefined)
    if (wait === undefined) return
    gesture.previewTimer = window.setTimeout(() => {
      gesture.previewTimer = undefined
      this.sendPreview(gesture)
    }, wait)
  }

  private sendPreview(gesture: Gesture): void {
    if (this.gesture !== gesture) return
    gesture.seq += 1
    gesture.lastSentAt = performance.now()
    if (gesture.mode === "draw") {
      void this.pushEvent("draw_preview", {
        kind: gesture.kind,
        drag_id: gesture.dragId,
        seq: gesture.seq,
        ...gesture.shape.box,
        points: gesture.shape.points,
      })
    } else {
      void this.pushEvent("preview", {
        element_id: gesture.elementId,
        drag_id: gesture.dragId,
        seq: gesture.seq,
        base_version: gesture.baseVersion,
        ...gesture.shape.box,
        points: gesture.shape.points,
      })
    }
  }

  private applyRemotePreview(preview: Preview): void {
    const rect = this.elementFor(preview.element_id)
    if (rect === null || this.editedElementId() === preview.element_id) return
    if (!this.remotePreviews.accept(preview, integerAttribute(rect, "data-version"))) return

    this.restartStaleTimer(preview.element_id, () => {
      this.cancelRemoteDrag(preview)
    })
    setShape(rect, preview, preview.points)
  }

  private applyRemoteDraw(preview: DrawPreview): void {
    const ref = { element_id: preview.drag_id, drag_id: preview.drag_id }
    if (!this.remoteDraws.accept({ ...ref, seq: preview.seq, base_version: 0 }, 0)) return

    this.restartStaleTimer(preview.drag_id, () => {
      this.endRemoteDraw(preview.drag_id)
    })
    setShape(this.draws.shape(preview.drag_id, preview.kind), preview, preview.points)
  }

  private endRemoteDraw(dragId: string): void {
    this.remoteDraws.finish({ element_id: dragId, drag_id: dragId })
    this.clearStaleTimer(dragId)
    this.draws.remove(dragId)
  }

  private restartStaleTimer(id: string, onStale: () => void): void {
    window.clearTimeout(this.staleTimers.get(id))
    this.staleTimers.set(id, window.setTimeout(onStale, STALE_PREVIEW_MS))
  }

  private cancelRemoteDrag(ref: DragRef): void {
    if (!this.remotePreviews.finish(ref)) return
    this.clearStaleTimer(ref.element_id)
    this.revert(ref.element_id)
  }

  private clearRemoteDrag(elementId: string): void {
    this.remotePreviews.forget(elementId)
    this.clearStaleTimer(elementId)
  }

  private clearStaleTimer(id: string): void {
    window.clearTimeout(this.staleTimers.get(id))
    this.staleTimers.delete(id)
  }

  private revert(elementId: string): void {
    if (this.editedElementId() === elementId) return
    const rect = this.elementFor(elementId)
    if (rect !== null) showShape(rect, committedShape(rect))
  }

  private editedElementId(): string | undefined {
    return this.gesture?.mode === "draw" ? undefined : this.gesture?.elementId
  }

  private elementFor(elementId: string): SVGElement | null {
    return this.el.querySelector<SVGElement>(`[data-element="${CSS.escape(elementId)}"]`)
  }

  private layer(selector: string): Element {
    const layer = this.el.querySelector(selector)
    if (layer === null) throw new Error(`${selector} is missing`)
    return layer
  }

  private canvasSize(): Size {
    return {
      width: integerAttribute(this.el, "data-canvas-width"),
      height: integerAttribute(this.el, "data-canvas-height"),
    }
  }

  private maxPoints(): number {
    return integerAttribute(this.el, "data-max-points")
  }

  private defaultSize(): Size {
    return {
      width: integerAttribute(this.el, "data-default-width"),
      height: integerAttribute(this.el, "data-default-height"),
    }
  }

  private canvasPoint(event: PointerEvent): Point {
    const svg = this.el.querySelector("svg")
    const bounds = svg?.getBoundingClientRect() ?? this.el.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
}
