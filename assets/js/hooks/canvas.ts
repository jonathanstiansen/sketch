import { ViewHook } from "phoenix_live_view"
import {
  RemotePreviews,
  clamp,
  clickBox,
  cornerPoint,
  drawnBox,
  endpointPoint,
  eraserHits,
  isBlankText,
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
import { CursorSender, RemoteCursors, isRemoteCursor, type RemoteCursor } from "./cursor_logic"
import { CursorLayer } from "./cursor_layer"
import { DrawLayer, SelectionOverlay, isCorner, isEndpoint, setShape } from "./selection"
import { TextEditor, type TextLayout } from "./text_editor"
import { LIVE_POINTS, isSeed, randomSeed, styleAttribute, styleOf } from "../elements/dom"
import {
  DEFAULT_STYLE,
  appliesTo,
  isStyleProperty,
  isStyleToken,
  styleForKind,
  styleFrom,
  withToken,
  type ElementStyle,
} from "../elements/style"
import { StylePanel } from "./style_panel"
import { STYLE_PROPERTIES, TEXT_KINDS, type ElementKind, type TextKind } from "../generated/manifest"
import {
  DEFAULT_TOOL,
  defaultSize,
  deletesSelection,
  drawGesture,
  drawnKind,
  isElementKind,
  isPreviewKind,
  isTextKind,
  isTypedKind,
  isPanKey,
  nextTool,
  panScroll,
  pointerAction,
  requiresText,
  selectTool,
  selectionHandles,
  togglesHelp,
  typedKind,
  type DrawnKind,
  type PreviewKind,
  type KeyInput,
  type ToolId,
} from "./tools"

const STALE_PREVIEW_MS = 2000
const TEXT_KEEPALIVE_MS = 1000
const DRAGGING = "data-dragging"
const ERASING = "data-erasing"
const TEXT_EDITING = "data-text-editing"
const SELECT_TOOL_EVENT = "sketch:select-tool"
const SET_STYLE_EVENT = "sketch:set-style"
const SELECTED_ATTRIBUTE = "data-selected-element"
const PHX_UPDATE = "phx-update"
const OBSERVED_ATTRIBUTES = ["x", "y", "width", "height", LIVE_POINTS, ...STYLE_PROPERTIES.map(styleAttribute)]
const TEXT_KIND_SELECTOR = TEXT_KINDS.map((kind) => `[data-element][data-kind="${kind}"]`).join(", ")

interface PreviewClock {
  seq: number
  lastSentAt: number
  previewTimer: number | undefined
}

interface Throttled extends PreviewClock {
  dragId: string
  pointerId: number
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
  seed: number
  style: ElementStyle
  start: Point
  dragged: boolean
  shape: Shape
  path: Point[]
}

type Gesture = Edit | Draw

interface Erase {
  pointerId: number
  last: Point
  pending: Set<string>
}

interface DrawPreview extends Box {
  kind: PreviewKind
  drag_id: string
  seq: number
  seed?: number
  points: readonly Point[]
  text?: string
  style: ElementStyle
}

type TextTarget =
  | { mode: "create"; kind: TextKind }
  | { mode: "edit"; kind: TextKind; element: SVGElement; elementId: string; baseVersion: number; text: string }

interface TextSession extends PreviewClock {
  target: TextTarget
  dragId: string
  seed: number
  style: ElementStyle
  keepAlive: number
  text: string
  box: Box
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

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function isPreview(value: unknown): value is Preview {
  return (
    isDragRef(value) &&
    isRecord(value) &&
    Number.isInteger(value.seq) &&
    Number.isInteger(value.base_version) &&
    isBox(value) &&
    isPoints(value.points) &&
    isOptionalText(value.text)
  )
}

function hasValidStyle(value: Record<string, unknown>): boolean {
  return STYLE_PROPERTIES.every((property) => value[property] === undefined || isStyleToken(property, value[property]))
}

function isDrawPreview(value: unknown): value is Omit<DrawPreview, "style"> & Record<string, unknown> {
  return (
    isRecord(value) &&
    hasValidStyle(value) &&
    typeof value.kind === "string" &&
    isPreviewKind(value.kind) &&
    typeof value.drag_id === "string" &&
    Number.isInteger(value.seq) &&
    (value.seed === undefined || isSeed(value.seed)) &&
    isBox(value) &&
    isPoints(value.points) &&
    isOptionalText(value.text)
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

function renderedShape(shape: Element): Shape {
  const points = shape.getAttribute(LIVE_POINTS) ?? shape.getAttribute("data-points") ?? ""
  return { box: renderedBox(shape), points: pairs(points) }
}

function integerPair(pair: string): Point {
  const [x, y] = pair.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("points must be integer pairs")
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

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function keepGestureMarkers(fromEl: Element, toEl: Element): void {
  for (const marker of [ERASING, DRAGGING]) {
    if (fromEl.hasAttribute(marker)) toEl.setAttribute(marker, "")
  }
}

// While ignored, LiveView patches only the element's data-* attributes (the committed box and
// version) and leaves its other attributes and children to the gesture, whatever the kind.
function claimElement(element: Element): void {
  element.setAttribute(DRAGGING, "")
  element.setAttribute(PHX_UPDATE, "ignore")
}

function releaseElement(element: Element): void {
  element.removeAttribute(DRAGGING)
  element.removeAttribute(PHX_UPDATE)
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
  private erase: Erase | undefined
  private textSession: TextSession | undefined
  private textEditor: TextEditor | undefined
  private remotePreviews = new RemotePreviews()
  private remoteDraws = new RemotePreviews()
  private staleTimers = new Map<string, number>()
  private cursorSender = new CursorSender()
  private cursorTimer: number | undefined
  private remoteCursors = new RemoteCursors()
  private cursorSweep: number | undefined
  private cursorLayer!: CursorLayer
  private online = true
  private tool: ToolId = DEFAULT_TOOL
  private spaceHeld = false
  private pannedWithSpace = false
  private pan: Pan | undefined
  private selectedId: string | undefined
  private nextStyle: ElementStyle = DEFAULT_STYLE
  private stylePanel!: StylePanel
  private selection!: SelectionOverlay
  private draws!: DrawLayer
  private observer: MutationObserver | undefined

  override mounted(): void {
    this.selection = new SelectionOverlay(this.layer("#selection"))
    this.draws = new DrawLayer(this.layer("#draw-previews"))
    this.cursorLayer = new CursorLayer(this.layer("#remote-cursors"))
    this.stylePanel = new StylePanel(document.getElementById("style-panel"))
    this.observer = new MutationObserver(() => {
      this.syncSelection()
    })
    this.observer.observe(this.layer("#elements"), {
      subtree: true,
      childList: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    })
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("blur", this.releaseSpace)
    this.el.addEventListener(SELECT_TOOL_EVENT, this.onSelectTool)
    this.el.addEventListener(SET_STYLE_EVENT, this.onSetStyle)
    this.el.addEventListener("pointerdown", this.onPointerDown)
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointermove", this.onCursorMove)
    this.el.addEventListener("pointerleave", this.onCursorLeave)
    document.addEventListener("visibilitychange", this.onVisibilityChange)
    this.el.addEventListener("pointerup", this.onPointerUp)
    this.el.addEventListener("pointercancel", this.onPointerCancel)
    this.el.addEventListener("lostpointercapture", this.onPointerCancel)
    this.el.addEventListener("dblclick", this.onDoubleClick)
    this.handleEvent("preview", (payload: unknown) => {
      if (isPreview(payload)) this.applyRemotePreview(payload)
    })
    this.handleEvent("drag_cancel", (payload: unknown) => {
      if (isDragRef(payload)) this.cancelRemoteDrag(payload)
    })
    this.handleEvent("draw_preview", (payload: unknown) => {
      if (isDrawPreview(payload)) this.applyRemoteDraw({ ...payload, style: styleFrom((property) => payload[property]) })
    })
    this.handleEvent("draw_end", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.drag_id === "string") this.endRemoteDraw(payload.drag_id)
    })
    this.handleEvent("cursor", (payload: unknown) => {
      if (isRemoteCursor(payload)) this.applyRemoteCursor(payload)
    })
    this.handleEvent("cursor_leave", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.viewer_id === "string" && typeof payload.seq === "number") {
        this.removeRemoteCursor(payload.viewer_id, payload.seq)
      }
    })
    this.handleEvent("erased", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.id === "string") this.onErased(payload.id)
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
    this.cancelErase()
    this.textEditor?.commit()
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
    if (this.textSession !== undefined) this.endText(this.textSession)
    for (const timer of this.staleTimers.values()) window.clearTimeout(timer)
    window.clearTimeout(this.cursorTimer)
    window.clearTimeout(this.cursorSweep)
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
  }

  private onCursorMove = (event: PointerEvent): void => {
    const canvas = this.canvasSize()
    const point = this.canvasPoint(event)
    const delay = this.cursorSender.move({ x: clamp(point.x, canvas.width), y: clamp(point.y, canvas.height) }, performance.now())
    if (delay === undefined) return
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = undefined
      const message = this.cursorSender.flush(performance.now())
      if (message !== undefined && this.online) void this.pushEvent("cursor", message)
    }, delay)
  }

  private onCursorLeave = (): void => {
    this.sendCursorLeave()
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) this.sendCursorLeave()
  }

  private sendCursorLeave(): void {
    window.clearTimeout(this.cursorTimer)
    this.cursorTimer = undefined
    const seq = this.cursorSender.leave()
    if (seq !== undefined && this.online) void this.pushEvent("cursor_leave", { seq })
  }

  private applyRemoteCursor(cursor: RemoteCursor): void {
    if (!this.remoteCursors.accept(cursor, performance.now())) return
    this.cursorLayer.show(cursor)
    this.scheduleCursorSweep()
  }

  private removeRemoteCursor(viewerId: string, seq: number): void {
    if (this.remoteCursors.leave(viewerId, seq)) this.cursorLayer.remove(viewerId)
  }

  private scheduleCursorSweep(): void {
    window.clearTimeout(this.cursorSweep)
    const due = this.remoteCursors.nextExpiry()
    if (due === undefined) return
    this.cursorSweep = window.setTimeout(() => {
      for (const viewerId of this.remoteCursors.expire(performance.now())) this.cursorLayer.remove(viewerId)
      this.scheduleCursorSweep()
    }, Math.max(0, due - performance.now()))
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.textEditor !== undefined) {
      if (!this.textEditor.contains(event.target)) {
        event.preventDefault()
        this.textEditor.commit()
      }
      return
    }
    if (this.gesture !== undefined || this.erase !== undefined || this.pan !== undefined) return
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
    if (action === "text") this.openText(event, rect)
    if (action === "erase") this.startErase(event)
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
    claimElement(rect)
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
      seed: randomSeed(),
      style: styleForKind(kind, this.nextStyle),
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

  private startErase(event: PointerEvent): void {
    if (!this.online) return
    event.preventDefault()
    this.el.setPointerCapture(event.pointerId)
    const start = this.canvasPoint(event)
    this.erase = { pointerId: event.pointerId, last: start, pending: new Set() }
    this.eraseAlong(this.erase, [start])
  }

  private eraseAlong(erase: Erase, path: Point[]): void {
    const elements = [...this.el.querySelectorAll<SVGElement>("#elements [data-element]")].flatMap((shape) => {
      const id = shape.dataset.element
      return id === undefined || erase.pending.has(id) ? [] : [{ id, box: renderedBox(shape) }]
    })
    for (const id of eraserHits(elements, path)) {
      erase.pending.add(id)
      this.elementFor(id)?.setAttribute(ERASING, "")
    }
    erase.last = path[path.length - 1] ?? erase.last
  }

  private finishErase(erase: Erase): void {
    this.endErase(erase)
    if (erase.pending.size === 0) return
    const elementIds = [...erase.pending]
    void this.pushEvent("erase", { element_ids: elementIds }).finally(() => {
      this.unfade(elementIds)
    })
  }

  private cancelErase(): void {
    const erase = this.erase
    if (erase === undefined) return
    this.endErase(erase)
    this.unfade(erase.pending)
  }

  private endErase(erase: Erase): void {
    this.erase = undefined
    if (this.el.hasPointerCapture(erase.pointerId)) this.el.releasePointerCapture(erase.pointerId)
  }

  private unfade(elementIds: Iterable<string>): void {
    for (const id of elementIds) this.elementFor(id)?.removeAttribute(ERASING)
  }

  private onErased(elementId: string): void {
    this.remotePreviews.erase(elementId)
    this.clearStaleTimer(elementId)
    this.erase?.pending.delete(elementId)
    if (this.gesture !== undefined && this.editedElementId() === elementId) this.endGesture(this.gesture)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) {
      const scroll = panScroll(this.pan.startScroll, this.pan.startPointer, clientPoint(event))
      this.el.scrollTo(scroll.x, scroll.y)
      return
    }
    if (this.erase?.pointerId === event.pointerId) {
      this.eraseAlong(this.erase, [this.erase.last, this.canvasPoint(event)])
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
    this.showShape(edit.rect, edit.shape)
    this.schedulePreview(edit, () => {
      this.sendPreview(edit)
    })
  }

  private updateDraw(draw: Draw, pointer: Point): void {
    draw.dragged ||= isDrag(draw.start, pointer)
    if (!draw.dragged) return
    if (drawGesture(draw.kind) === "path") {
      draw.path = thinStroke([...draw.path, pointer], STROKE_MIN_DISTANCE, this.maxPoints())
      draw.shape = shapeAround(draw.path, this.canvasSize())
    } else {
      draw.shape = this.drawnShape(draw.kind, draw.start, pointer)
    }
    this.showShape(this.draws.shape(draw.dragId, draw.kind, draw.seed, draw.style), draw.shape)
    this.schedulePreview(draw, () => {
      this.sendPreview(draw)
    })
  }

  private drawnShape(kind: DrawnKind, start: Point, end: Point): Shape {
    const canvas = this.canvasSize()
    return drawGesture(kind) === "box" ? { box: drawnBox(start, end, canvas), points: [] } : shapeAround([start, end], canvas)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    if (this.erase?.pointerId === event.pointerId) this.finishErase(this.erase)
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
    if (sameShape(edit.shape, edit.origin)) {
      this.revert(edit.elementId)
      return
    }
    const ref = { element_id: edit.elementId, drag_id: edit.dragId }
    if (edit.mode === "move") {
      void this.pushEvent("commit", { ...ref, x: edit.shape.box.x, y: edit.shape.box.y })
    } else {
      void this.pushEvent("commit_shape", { ...ref, ...edit.shape.box, points: edit.shape.points })
    }
  }

  private finishDraw(draw: Draw): void {
    if (!draw.dragged && drawGesture(draw.kind) !== "box") return
    const { box, points } = draw.dragged
      ? draw.shape
      : { box: clickBox(draw.start, defaultSize(draw.kind), this.canvasSize()), points: [] }
    if (isTextKind(draw.kind)) {
      this.openDrawnText(draw, draw.kind, box)
      return
    }
    void this.pushEvent("create_element", {
      kind: draw.kind,
      drag_id: draw.dragId,
      seed: draw.seed,
      ...draw.style,
      ...box,
      points,
    }).finally(() => {
      this.draws.remove(draw.dragId)
    })
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    if (this.gesture !== undefined) this.cancelGesture(this.gesture)
    this.cancelErase()
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
    if (deletesSelection(input)) this.eraseSelected(event)
    if (input.key === "Escape") this.escape()
    this.useTool(nextTool(this.tool, input))
  }

  private escape(): void {
    this.hideHelp()
    if (this.gesture !== undefined) this.cancelGesture(this.gesture)
    this.cancelErase()
    this.select(undefined)
  }

  private eraseSelected(event: KeyboardEvent): void {
    const elementId = this.selectedId
    if (elementId === undefined || this.gesture !== undefined || this.textEditor !== undefined || !this.online) return
    event.preventDefault()
    this.select(undefined)
    void this.pushEvent("erase", { element_ids: [elementId] })
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

  private onSetStyle = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return
    const { property, value } = event.detail
    if (!isStyleProperty(property) || !isStyleToken(property, value)) return
    this.nextStyle = withToken(this.nextStyle, property, value)
    this.restyleSelected(property, value)
    this.syncStylePanel()
  }

  private restyleSelected(property: keyof ElementStyle, value: string): void {
    const rect = this.selectedId === undefined ? null : this.elementFor(this.selectedId)
    const kind = rect?.dataset.kind
    if (rect === null || !isElementKind(kind) || !appliesTo(kind, property) || !this.online) return
    if (styleOf(rect)[property] === value) return
    void this.pushEvent("commit_style", { element_id: this.selectedId, [property]: value })
  }

  private syncStylePanel(): void {
    const rect = this.selectedId === undefined ? null : this.elementFor(this.selectedId)
    const kind = rect?.dataset.kind
    if (rect !== null && isElementKind(kind)) {
      this.stylePanel.show(kind, styleOf(rect))
    } else {
      this.stylePanel.show(this.toolKind(), this.nextStyle)
    }
  }

  private toolKind(): ElementKind | undefined {
    return drawnKind(this.tool) ?? typedKind(this.tool)
  }

  private useTool(tool: ToolId): void {
    if (tool === this.tool) return
    this.tool = tool
    if (tool !== "selection") this.select(undefined)
    this.syncStylePanel()
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
      this.js().removeAttribute(this.el, SELECTED_ATTRIBUTE)
    } else {
      this.js().setAttribute(this.el, SELECTED_ATTRIBUTE, rect.dataset.element ?? "")
      const { box, points } = renderedShape(rect)
      this.selection.show(box, points, selectionHandles(rect.dataset.kind))
    }
    this.syncStylePanel()
  }

  private abandonGesture(gesture: Gesture): void {
    this.endGesture(gesture)
    if (gesture.mode === "draw") {
      this.draws.remove(gesture.dragId)
    } else {
      this.revert(gesture.elementId)
    }
  }

  private endGesture(gesture: Gesture): void {
    this.gesture = undefined
    window.clearTimeout(gesture.previewTimer)
    if (gesture.mode !== "draw") releaseElement(gesture.rect)
    if (this.el.hasPointerCapture(gesture.pointerId)) this.el.releasePointerCapture(gesture.pointerId)
  }

  private schedulePreview(clock: PreviewClock, send: () => void): void {
    const wait = previewDelay(clock.lastSentAt, performance.now(), clock.previewTimer !== undefined)
    if (wait === undefined) return
    clock.previewTimer = window.setTimeout(() => {
      clock.previewTimer = undefined
      send()
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
        seed: gesture.seed,
        ...gesture.style,
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
    this.showShape(rect, { box: preview, points: preview.points }, preview.text)
  }

  private applyRemoteDraw(preview: DrawPreview): void {
    const ref = { element_id: preview.drag_id, drag_id: preview.drag_id }
    if (!this.remoteDraws.accept({ ...ref, seq: preview.seq, base_version: 0 }, 0)) return

    this.restartStaleTimer(preview.drag_id, () => {
      this.endRemoteDraw(preview.drag_id)
    })
    const shape = this.draws.shape(preview.drag_id, preview.kind, preview.seed ?? 0, preview.style)
    this.showShape(shape, { box: preview, points: preview.points }, preview.text)
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
    if (rect === null) return
    this.showShape(rect, committedShape(rect), rect.dataset.text ?? "")
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

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.tool !== "selection" || this.textEditor !== undefined) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const element = hit?.closest<SVGElement>(TEXT_KIND_SELECTOR)
    if (element != null) this.editText(element)
  }

  private openText(event: PointerEvent, rect: SVGElement | null): void {
    const kind = typedKind(this.tool)
    if (kind === undefined) return
    event.preventDefault()
    if (rect?.matches(`[data-kind="${kind}"]`) === true) {
      this.editText(rect)
    } else {
      this.startText(this.canvasPoint(event), "", { mode: "create", kind })
    }
  }

  private editText(element: SVGElement): void {
    const elementId = element.dataset.element
    if (elementId === undefined) return
    const kind = element.dataset.kind
    if (!isTextKind(kind)) return
    const text = element.dataset.text ?? ""
    const target: TextTarget = {
      mode: "edit",
      kind,
      element,
      elementId,
      baseVersion: integerAttribute(element, "data-version"),
      text,
    }
    const box = renderedBox(element)
    if (this.startText(box, text, target, isTypedKind(kind) ? undefined : box)) {
      element.setAttribute(TEXT_EDITING, "")
      this.clearRemoteDrag(elementId)
    }
  }

  private openDrawnText(draw: Draw, kind: DrawnKind & TextKind, box: Box): void {
    const target: TextTarget = { mode: "create", kind }
    const shape = this.draws.shape(draw.dragId, kind, draw.seed, draw.style)
    this.showShape(shape, { box, points: [] }, "")
    this.draws.hideText(draw.dragId)
    this.startText(box, "", target, box, draw)
  }

  private startText(at: Point, text: string, target: TextTarget, frame?: Box, drawn?: Draw): boolean {
    if (!this.online || this.textSession !== undefined) return false
    this.select(undefined)
    const session: TextSession = {
      target,
      text,
      box: { ...at, width: 0, height: 0 },
      dragId: drawn?.dragId ?? crypto.randomUUID(),
      seed: drawn?.seed ?? randomSeed(),
      style: drawn?.style ?? styleForKind(target.kind, this.nextStyle),
      seq: drawn?.seq ?? 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
      keepAlive: window.setInterval(() => {
        if (session.seq > 0) this.sendTextPreview(session)
      }, TEXT_KEEPALIVE_MS),
    }
    this.textSession = session
    this.textEditor = new TextEditor(at, text, {
      layer: this.textLayer(),
      layout: this.textLayout(),
      maxLength: integerAttribute(this.el, "data-max-text-length"),
      canvas: this.canvasSize(),
      note: frame === undefined ? undefined : { frame, padding: this.textLayout().notePadding },
      onInput: (typed, box) => {
        session.text = typed
        session.box = box
        this.schedulePreview(session, () => {
          this.sendTextPreview(session)
        })
      },
      onCommit: (typed, box) => {
        this.finishText(session, typed, box)
      },
    })
    session.box = this.textEditor.box()
    if (frame !== undefined && target.mode === "create") this.sendTextPreview(session)
    return true
  }

  private sendTextPreview(session: TextSession): void {
    if (this.textSession !== session || !this.online) return
    session.seq += 1
    session.lastSentAt = performance.now()
    const preview = { drag_id: session.dragId, seq: session.seq, ...session.box, points: [], text: session.text }
    if (session.target.mode === "create") {
      void this.pushEvent("draw_preview", { kind: session.target.kind, seed: session.seed, ...session.style, ...preview })
    } else {
      void this.pushEvent("preview", {
        element_id: session.target.elementId,
        base_version: session.target.baseVersion,
        ...preview,
      })
    }
  }

  private finishText(session: TextSession, text: string, box: Box): void {
    this.endText(session)
    const sent = session.seq > 0 && this.online
    const { target } = session
    if (target.mode === "create") {
      this.finishCreatedText(session, target.kind, text, box, sent)
      return
    }
    target.element.removeAttribute(TEXT_EDITING)
    const ref = { element_id: target.elementId, drag_id: session.dragId }
    if ((requiresText(target.kind) && isBlankText(text)) || text === target.text || !this.online) {
      this.revert(target.elementId)
      if (sent) void this.pushEvent("drag_cancel", ref)
    } else {
      this.showShape(target.element, { box, points: [] }, text)
      void this.pushEvent("commit_shape", { ...ref, ...box, points: [], text })
    }
    this.select(target.elementId)
  }

  private finishCreatedText(session: TextSession, kind: TextKind, text: string, box: Box, sent: boolean): void {
    const { dragId, seed, style } = session
    if ((requiresText(kind) && isBlankText(text)) || !this.online) {
      this.draws.remove(dragId)
      if (sent) void this.pushEvent("draw_cancel", { drag_id: dragId })
      return
    }
    void this.pushEvent("create_element", { kind, drag_id: dragId, seed, ...style, ...box, points: [], text }).finally(() => {
      this.draws.remove(dragId)
    })
  }

  private endText(session: TextSession): void {
    window.clearTimeout(session.previewTimer)
    window.clearInterval(session.keepAlive)
    if (this.textSession !== session) return
    this.textSession = undefined
    this.textEditor = undefined
  }

  private textLayer(): HTMLElement {
    const layer = this.layer("#text-editor-layer")
    if (!(layer instanceof HTMLElement)) throw new Error("#text-editor-layer must be an HTML element")
    return layer
  }

  private textLayout(): TextLayout {
    return {
      fontSize: integerAttribute(this.el, "data-font-size"),
      lineHeight: integerAttribute(this.el, "data-line-height"),
      notePadding: integerAttribute(this.el, "data-note-padding"),
    }
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

  private showShape(element: Element, { box, points }: Shape, text?: string): void {
    setShape(element, box, points, text)
  }

  private canvasPoint(event: PointerEvent): Point {
    const svg = this.el.querySelector("svg")
    const bounds = svg?.getBoundingClientRect() ?? this.el.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
}
