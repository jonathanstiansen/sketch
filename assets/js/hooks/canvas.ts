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
import { LIVE_POINTS, SEED, isSeed, randomSeed, styleAttribute, styleOf } from "../elements/dom"
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
import { History, type Direction, type Entry, type Recorded, type Replay } from "./history_logic"
import {
  changePayload,
  createPayload,
  historyActionFor,
  isHistoryAction,
  recordedElement,
  recordedElements,
  type ElementChange,
  type ElementHistory,
  type ElementSnapshot,
} from "./element_history"
import { STYLE_PROPERTIES, TEXT_KINDS, type ClipboardActionId, type ElementKind, type TextKind, type ZoomActionId } from "../generated/manifest"
import {
  DEFAULT_ZOOM,
  anchoredScroll,
  clampScroll,
  clampZoom,
  fitView,
  isZoomAction,
  screenToCanvas,
  stepZoom,
  wheelZoom,
  zoomActionFor,
  zoomPercent,
  type View,
} from "./zoom_logic"
import { isShortcutKey } from "./shortcuts"
import { lineMeasurer, readClipboardText, writeClipboardText } from "./clipboard"
import { clipboardActionFor, decodeClipboard, duplicated, encodeElements, pastedText, placedAround } from "./clipboard_logic"
import {
  DEFAULT_TOOL,
  defaultSize,
  deletesSelection,
  drawGesture,
  drawnKind,
  escapes,
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
const HISTORY_EVENT = "sketch:history"
const ZOOM_EVENT = "sketch:zoom"
const ZOOM_ATTRIBUTE = "data-zoom"
const LINE_HEIGHT_PX = 16
const HISTORY_STATUS_MS = 3000
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
    committed: Shape
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

interface Copy extends Throttled {
  mode: "copy"
  source: ElementSnapshot
  grab: Point
  origin: Shape
  shape: Shape
}

type Gesture = Edit | Draw | Copy

function isEdit(gesture: Gesture): gesture is Edit {
  return gesture.mode !== "draw" && gesture.mode !== "copy"
}

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
  | {
      mode: "edit"
      kind: TextKind
      element: SVGElement
      elementId: string
      baseVersion: number
      text: string
      committed: Box
    }

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

function isOk(reply: unknown): boolean {
  return isRecord(reply) && reply.ok === true
}

function keyInput(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
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

function snapshotOf(element: SVGElement): ElementSnapshot | undefined {
  const { kind, text } = element.dataset
  const seed = Number(element.getAttribute(SEED))
  if (!isElementKind(kind) || !isSeed(seed)) return undefined
  const { box, points } = committedShape(element)
  return { kind, ...box, points, text: text ?? "", seed, style: styleOf(element) }
}

function setSize(svg: SVGSVGElement, name: "width" | "height", length: number): void {
  if (svg.getAttribute(name) !== String(length)) svg.setAttribute(name, String(length))
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
  private selectOnArrival: string | undefined
  private lastPointer: Point | undefined
  private nextStyle: ElementStyle = DEFAULT_STYLE
  private stylePanel!: StylePanel
  private selection!: SelectionOverlay
  private draws!: DrawLayer
  private observer: MutationObserver | undefined
  private history: ElementHistory = new History<ElementSnapshot, ElementChange>()
  private historyStatusTimer: number | undefined
  private queuedHistory: Direction[] = []
  private zoom = DEFAULT_ZOOM
  private svgObserver: MutationObserver | undefined

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
    this.svgObserver = new MutationObserver(() => {
      this.syncZoom()
    })
    this.svgObserver.observe(this.svg(), { attributeFilter: ["width", "height"] })
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("blur", this.releaseSpace)
    this.el.addEventListener("wheel", this.onWheel, { passive: false })
    this.el.addEventListener(ZOOM_EVENT, this.onZoomEvent)
    this.el.addEventListener(SELECT_TOOL_EVENT, this.onSelectTool)
    this.el.addEventListener(SET_STYLE_EVENT, this.onSetStyle)
    this.el.addEventListener(HISTORY_EVENT, this.onHistoryEvent)
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
    this.handleEvent("created", (payload: unknown) => {
      const created = isRecord(payload) ? recordedElement(payload.element) : undefined
      if (created !== undefined) this.record({ type: "create", elements: [created] })
    })
    this.handleEvent("erased", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.id === "string") this.onErased(payload.id)
    })
    this.handleEvent("revert", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.element_id === "string") {
        this.revert(payload.element_id)
      }
    })
    this.syncZoom()
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
    this.svgObserver?.disconnect()
    if (this.gesture !== undefined) window.clearTimeout(this.gesture.previewTimer)
    if (this.textSession !== undefined) this.endText(this.textSession)
    for (const timer of this.staleTimers.values()) window.clearTimeout(timer)
    window.clearTimeout(this.historyStatusTimer)
    window.clearTimeout(this.cursorTimer)
    window.clearTimeout(this.cursorSweep)
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
  }

  private onCursorMove = (event: PointerEvent): void => {
    const canvas = this.canvasSize()
    const point = this.canvasPoint(event)
    this.lastPointer = point
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
      altKey: event.altKey,
    })
    if (action === "pan") this.startPan(event)
    const kind = drawnKind(this.tool)
    if (action === "draw" && kind !== undefined) this.startDraw(event, kind)
    if (action === "text") this.openText(event, rect)
    if (action === "erase") this.startErase(event)
    if (action === "deselect") this.select(undefined)
    if (action === "move" && rect !== null) this.startEdit(event, rect, { mode: "move" })
    if (action === "copy" && rect !== null) this.startCopy(event, rect)
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
    const committed = committedShape(rect)
    this.gesture = {
      ...grip,
      rect,
      elementId,
      dragId: crypto.randomUUID(),
      pointerId: event.pointerId,
      baseVersion: integerAttribute(rect, "data-version"),
      grab: subtract(this.canvasPoint(event), gripPoint(shape, grip)),
      origin: shape,
      committed,
      shape,
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
  }

  private startCopy(event: PointerEvent, rect: SVGElement): void {
    const source = snapshotOf(rect)
    const elementId = rect.dataset.element
    if (!this.online || source === undefined || elementId === undefined) return
    event.preventDefault()
    this.select(elementId)
    this.el.setPointerCapture(event.pointerId)
    const origin = committedShape(rect)
    const dragId = crypto.randomUUID()
    this.gesture = {
      mode: "copy",
      source,
      dragId,
      pointerId: event.pointerId,
      grab: subtract(this.canvasPoint(event), origin.box),
      origin,
      shape: origin,
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
    this.showShape(this.draws.shape(dragId, source.kind, source.seed, source.style), origin, source.text)
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
    void this.eraseAndRecord(elementIds).finally(() => {
      this.unfade(elementIds)
    })
  }

  private async eraseAndRecord(elementIds: readonly string[]): Promise<void> {
    const erased = await this.pushErase(elementIds)
    if (erased.length > 0) this.record({ type: "erase", elements: erased })
  }

  private async pushErase(elementIds: readonly string[]): Promise<Recorded<ElementSnapshot>[]> {
    const reply: unknown = await this.pushEvent("erase", { element_ids: elementIds })
    return isRecord(reply) ? recordedElements(reply.erased) : []
  }

  private async pushCreate(snapshot: ElementSnapshot, dragId: string): Promise<Recorded<ElementSnapshot> | undefined> {
    const reply: unknown = await this.pushEvent("create_element", createPayload(snapshot, dragId))
    return isRecord(reply) ? recordedElement(reply.element) : undefined
  }

  private async pushChange(elementId: string, change: ElementChange, dragId: string): Promise<boolean> {
    const reply: unknown = await this.pushEvent(change.event, changePayload(elementId, change, dragId))
    return isOk(reply)
  }

  private async commitAndRecord(elementId: string, before: ElementChange, after: ElementChange, dragId: string, coalesce?: string): Promise<void> {
    if (!(await this.pushChange(elementId, after, dragId))) return
    const entry: Entry<ElementSnapshot, ElementChange> =
      coalesce === undefined ? { type: "commit", id: elementId, before, after } : { type: "commit", id: elementId, before, after, coalesce }
    this.record(entry)
  }

  private async createAndRecord(snapshot: ElementSnapshot, dragId: string): Promise<string | undefined> {
    const created = await this.pushCreate(snapshot, dragId)
    if (created !== undefined) this.record({ type: "create", elements: [created] })
    return created?.id
  }

  private async createGroup(snapshots: readonly ElementSnapshot[]): Promise<void> {
    const results = await Promise.all(snapshots.map((snapshot) => this.pushCreate(snapshot, crypto.randomUUID())))
    const created = results.flatMap((element) => element ?? [])
    if (created.length === 0) return
    this.record({ type: "create", elements: created })
    const [only] = created
    if (created.length === 1 && only !== undefined) this.selectWhenPresent(only.id)
  }

  private record(entry: Entry<ElementSnapshot, ElementChange>): void {
    this.history.record(entry, performance.now())
    this.syncHistoryButtons()
  }

  private onHistoryEvent = (event: Event): void => {
    if (event instanceof CustomEvent && isRecord(event.detail) && isHistoryAction(event.detail.action)) {
      this.runHistory(event.detail.action)
    }
  }

  private runHistory(direction: Direction): void {
    if (!this.online || this.gesture !== undefined || this.erase !== undefined || this.textEditor !== undefined) return
    if (this.history.busy) {
      this.queuedHistory.push(direction)
      return
    }
    const step = direction === "undo" ? this.history.undo() : this.history.redo()
    if (step.status === "dropped") this.flash(`Can't ${direction}: erased by someone else`)
    if (step.status === "replay") void this.replay(step.direction, step.replay)
    this.syncHistoryButtons()
  }

  private async replay(direction: Direction, replay: Replay<ElementSnapshot, ElementChange>): Promise<void> {
    const created = await this.runReplay(replay).catch(() => undefined)
    if (created === undefined) {
      this.history.failed()
      this.flash(`Couldn't ${direction}`)
    } else {
      this.history.replayed(created)
    }
    this.syncHistoryButtons()
    const next = this.queuedHistory.shift()
    if (next !== undefined) this.runHistory(next)
  }

  private async runReplay(replay: Replay<ElementSnapshot, ElementChange>): Promise<Map<string, string> | undefined> {
    if (replay.type === "commit") {
      return (await this.pushChange(replay.id, replay.change, crypto.randomUUID())) ? new Map() : undefined
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

  private syncHistoryButtons(): void {
    const enabled = { undo: this.history.canUndo, redo: this.history.canRedo }
    for (const button of document.querySelectorAll<HTMLElement>("[data-history-action]")) {
      const action = button.dataset.historyAction
      if (!isHistoryAction(action)) continue
      if (enabled[action] && !this.history.busy) {
        this.js().removeAttribute(button, "disabled")
      } else {
        this.js().setAttribute(button, "disabled", "")
      }
    }
  }

  private flash(message: string): void {
    const status = document.getElementById("history-status")
    if (status === null) return
    status.textContent = message
    status.hidden = false
    window.clearTimeout(this.historyStatusTimer)
    this.historyStatusTimer = window.setTimeout(() => {
      status.hidden = true
    }, HISTORY_STATUS_MS)
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
    this.history.noteErased(elementId)
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
    } else if (gesture.mode === "copy") {
      this.updateCopy(gesture, pointer)
    } else {
      this.updateEdit(gesture, pointer)
    }
  }

  private updateCopy(copy: Copy, pointer: Point): void {
    const { source, origin } = copy
    copy.shape = { box: movedBox(origin.box, pointer, copy.grab, this.canvasSize()), points: origin.points }
    this.showShape(this.draws.shape(copy.dragId, source.kind, source.seed, source.style), copy.shape, source.text)
    this.schedulePreview(copy, () => {
      this.sendPreview(copy)
    })
  }

  private updateEdit(edit: Edit, pointer: Point): void {
    edit.shape = editedShape(edit, pointer, this.canvasSize())
    this.showShape(edit.rect, edit.shape)
    this.schedulePreview(edit, () => {
      this.sendPreview(edit)
    })
  }

  private updateDraw(draw: Draw, pointer: Point): void {
    draw.dragged ||= isDrag(draw.start, pointer, this.zoom)
    if (!draw.dragged) return
    if (drawGesture(draw.kind) === "path") {
      draw.path = thinStroke([...draw.path, pointer], STROKE_MIN_DISTANCE / this.zoom, this.maxPoints())
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
    } else if (gesture.mode === "copy") {
      this.finishCopy(gesture)
    } else {
      this.finishEdit(gesture)
    }
  }

  private finishCopy(copy: Copy): void {
    if (sameShape(copy.shape, copy.origin)) {
      this.draws.remove(copy.dragId)
      if (copy.seq > 0) void this.pushEvent("draw_cancel", { drag_id: copy.dragId })
      return
    }
    const snapshot = { ...copy.source, ...copy.shape.box, points: copy.shape.points }
    void this.createAndRecord(snapshot, copy.dragId)
      .then((id) => {
        this.selectWhenPresent(id)
      })
      .finally(() => {
        this.draws.remove(copy.dragId)
      })
  }

  private finishEdit(edit: Edit): void {
    if (sameShape(edit.shape, edit.origin)) {
      this.revert(edit.elementId)
      return
    }
    const { committed, shape } = edit
    if (edit.mode === "move") {
      const before: ElementChange = { event: "commit", x: committed.box.x, y: committed.box.y }
      void this.commitAndRecord(edit.elementId, before, { event: "commit", x: shape.box.x, y: shape.box.y }, edit.dragId)
    } else {
      const before: ElementChange = { event: "commit_shape", box: committed.box, points: committed.points }
      void this.commitAndRecord(edit.elementId, before, { event: "commit_shape", box: shape.box, points: shape.points }, edit.dragId)
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
    void this.createAndRecord({ kind: draw.kind, ...box, points, text: "", seed: draw.seed, style: draw.style }, draw.dragId).finally(() => {
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
    if (isEdit(gesture)) {
      void this.pushEvent("drag_cancel", { element_id: gesture.elementId, drag_id: gesture.dragId })
    } else {
      void this.pushEvent("draw_cancel", { drag_id: gesture.dragId })
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const input = keyInput(event)
    const zoomAction = zoomActionFor(input)
    if (zoomAction !== undefined) {
      event.preventDefault()
      this.runZoom(zoomAction)
      return
    }
    const clipboardAction = clipboardActionFor(input)
    if (clipboardAction !== undefined) {
      this.runClipboard(event, clipboardAction)
      return
    }
    const historyAction = historyActionFor(input)
    if (historyAction !== undefined) {
      event.preventDefault()
      this.runHistory(historyAction)
      return
    }
    if (isPanKey(input)) {
      if (!(event.target instanceof HTMLButtonElement)) event.preventDefault()
      this.setSpaceHeld(true)
      return
    }
    if (togglesHelp(input)) this.toggleHelp()
    if (deletesSelection(input)) this.eraseSelected(event)
    if (escapes(input)) this.escape()
    this.useTool(nextTool(this.tool, input))
  }

  private runClipboard(event: KeyboardEvent, action: ClipboardActionId): void {
    if (action !== "copy" && action !== "cut") event.preventDefault()
    if (!this.online || this.gesture !== undefined || this.erase !== undefined || this.textEditor !== undefined) return
    if (action === "paste") {
      void this.paste()
      return
    }
    const source = this.selectedSnapshot()
    if (source === undefined) return
    if (action === "duplicate") {
      void this.createGroup(duplicated([source], this.canvasSize()))
      return
    }
    event.preventDefault()
    void this.copySelected(source, action === "cut")
  }

  private selectedSnapshot(): ElementSnapshot | undefined {
    const rect = this.selectedId === undefined ? null : this.elementFor(this.selectedId)
    return rect === null ? undefined : snapshotOf(rect)
  }

  private async copySelected(source: ElementSnapshot, cut: boolean): Promise<void> {
    const elementId = this.selectedId
    if (!(await writeClipboardText(encodeElements([source])))) {
      this.flash("Couldn't copy to the clipboard")
      return
    }
    if (!cut || elementId === undefined) return
    this.select(undefined)
    await this.eraseAndRecord([elementId])
  }

  private async paste(): Promise<void> {
    const text = await readClipboardText()
    if (text === undefined) {
      this.flash("Couldn't read the clipboard")
      return
    }
    const decoded = decodeClipboard(text)
    const target = this.pasteTarget()
    if (decoded.status === "rejected") {
      this.flash(decoded.reason)
    } else if (decoded.status === "elements") {
      await this.createGroup(placedAround(decoded.elements, target, this.canvasSize()))
    } else {
      await this.pasteText(decoded.text, target)
    }
  }

  private async pasteText(text: string, at: Point): Promise<void> {
    const layout = this.textLayout()
    const element = pastedText(text, {
      at,
      measure: lineMeasurer(layout.fontSize, getComputedStyle(this.el).getPropertyValue("--sketch-text-font")),
      lineHeight: layout.lineHeight,
      canvas: this.canvasSize(),
      seed: randomSeed(),
      style: this.nextStyle,
    })
    if (element === undefined) {
      this.flash("Can't paste that text")
      return
    }
    await this.createGroup([element])
  }

  private pasteTarget(): Point {
    if (this.lastPointer !== undefined) return this.lastPointer
    const bounds = this.el.getBoundingClientRect()
    const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    const canvas = this.svg().getBoundingClientRect()
    return screenToCanvas(center, { x: canvas.left, y: canvas.top }, this.zoom)
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
    void this.eraseAndRecord([elementId])
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!isShortcutKey("pan", event)) return
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
    const previous = styleOf(rect)[property]
    if (previous === value || this.selectedId === undefined) return
    const change = (token: string): ElementChange => ({ event: "commit_style", property, value: token })
    void this.commitAndRecord(this.selectedId, change(previous), change(value), crypto.randomUUID(), property)
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
    this.selectOnArrival = undefined
    this.syncSelection()
  }

  private selectWhenPresent(elementId: string | undefined): void {
    this.selectOnArrival = elementId
    this.syncSelection()
  }

  private syncSelection(): void {
    if (this.selectOnArrival !== undefined && this.elementFor(this.selectOnArrival) !== null) {
      this.selectedId = this.selectOnArrival
      this.selectOnArrival = undefined
    }
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
    if (isEdit(gesture)) {
      this.revert(gesture.elementId)
    } else {
      this.draws.remove(gesture.dragId)
    }
  }

  private endGesture(gesture: Gesture): void {
    this.gesture = undefined
    window.clearTimeout(gesture.previewTimer)
    if (isEdit(gesture)) releaseElement(gesture.rect)
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
    } else if (gesture.mode === "copy") {
      const { kind, seed, style, text } = gesture.source
      void this.pushEvent("draw_preview", {
        kind,
        drag_id: gesture.dragId,
        seq: gesture.seq,
        seed,
        ...style,
        ...gesture.shape.box,
        points: gesture.shape.points,
        text,
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
    return this.gesture !== undefined && isEdit(this.gesture) ? this.gesture.elementId : undefined
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
      committed: committedShape(element).box,
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
      const before: ElementChange = { event: "commit_shape", box: target.committed, points: [], text: target.text }
      void this.commitAndRecord(target.elementId, before, { event: "commit_shape", box, points: [], text }, ref.drag_id)
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
    void this.createAndRecord({ kind, ...box, points: [], text, seed, style }, dragId).finally(() => {
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
    const bounds = this.svg().getBoundingClientRect()
    return screenToCanvas(clientPoint(event), { x: bounds.left, y: bounds.top }, this.zoom)
  }

  private svg(): SVGSVGElement {
    const svg = this.el.querySelector("svg#canvas")
    if (!(svg instanceof SVGSVGElement)) throw new Error("#canvas must be an svg element")
    return svg
  }

  private viewportSize(): Size {
    return { width: this.el.clientWidth, height: this.el.clientHeight }
  }

  private onZoomEvent = (event: Event): void => {
    if (event instanceof CustomEvent && isRecord(event.detail) && isZoomAction(event.detail.action)) {
      this.runZoom(event.detail.action)
    }
  }

  private onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const bounds = this.el.getBoundingClientRect()
    const anchor = { x: event.clientX - bounds.left - this.el.clientLeft, y: event.clientY - bounds.top - this.el.clientTop }
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_HEIGHT_PX : event.deltaY
    this.zoomTo(wheelZoom(this.zoom, delta), anchor)
  }

  private runZoom(action: ZoomActionId): void {
    if (action === "zoom_fit") {
      this.fitToContent()
      return
    }
    const center = { x: this.el.clientWidth / 2, y: this.el.clientHeight / 2 }
    const next = action === "zoom_reset" ? DEFAULT_ZOOM : stepZoom(this.zoom, action === "zoom_in" ? "in" : "out")
    this.zoomTo(next, center)
  }

  private zoomTo(requested: number, anchor: Point): void {
    const zoom = clampZoom(requested)
    if (zoom === this.zoom) return
    const scroll = anchoredScroll({ x: this.el.scrollLeft, y: this.el.scrollTop }, anchor, this.zoom, zoom)
    this.showView({ zoom, scroll })
  }

  private fitToContent(): void {
    const boxes = [...this.el.querySelectorAll("#elements [data-element]")].map(renderedBox)
    this.showView(fitView(boxes, this.canvasSize(), this.viewportSize()))
  }

  private showView({ zoom, scroll }: View): void {
    this.zoom = zoom
    this.syncZoom()
    const clamped = clampScroll(scroll, this.canvasSize(), zoom, this.viewportSize())
    this.el.scrollTo(clamped.x, clamped.y)
  }

  private syncZoom(): void {
    const canvas = this.canvasSize()
    const svg = this.svg()
    setSize(svg, "width", canvas.width * this.zoom)
    setSize(svg, "height", canvas.height * this.zoom)
    this.selection.setZoom(this.zoom)
    this.cursorLayer.setZoom(this.zoom)
    const layer = this.textLayer()
    layer.style.transformOrigin = "0 0"
    layer.style.transform = `scale(${String(this.zoom)})`
    this.js().setAttribute(this.el, ZOOM_ATTRIBUTE, String(this.zoom))
    const level = document.getElementById("zoom-level")
    if (level !== null) level.textContent = `${String(zoomPercent(this.zoom))}%`
  }
}
