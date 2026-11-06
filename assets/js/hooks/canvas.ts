import { ViewHook } from "phoenix_live_view"
import { pushClientEvent } from "./client_events.ts"
import {
  RemotePreviews,
  clamp,
  clickBox,
  cornerPoint,
  drawnBox,
  absolutePoints,
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
import { DrawLayer, MarqueeLayer, SelectionOverlay, isCorner, isEndpoint, setShape } from "./selection"
import {
  EMPTY_SELECTION,
  acceptedGroupEntries,
  movedGroup,
  erasedWithSelection,
  groupPreview,
  marqueeBox,
  marqueeHits,
  marqueeSelection,
  restyleTargets,
  selectionAttribute,
  sameSelection,
  selectsAll,
  toggled,
  type GroupPreview,
  type GroupPreviewEntry,
  type Selection,
  type Styled,
} from "./selection_logic"
import { TextEditor, type TextLayout } from "./text_editor"
import { LIVE_POINTS, SEED, isSeed, randomSeed, styleAttribute, styleOf } from "../elements/dom"
import {
  DEFAULT_STYLE,
  isStyleProperty,
  isStyleToken,
  styleForKind,
  styleFrom,
  withToken,
  type ElementStyle,
} from "../elements/style"
import { StylePanel } from "./style_panel"
import type { Change, Direction } from "./history_logic"
import { historyActionFor, isHistoryAction, type ElementChange, type ElementSnapshot } from "./element_history"
import { BoardMutations } from "./mutations"
import { BINDING_ENDS, anchorFor, bindingsFrom, bindsEnds, bindsTo, boxContains, resolvedShape, type Binding, type BindingEnd, type Bindings } from "./binding_logic"
import { STYLE_PROPERTIES, TEXT_KINDS, type ClipboardActionId, type ElementKind, type TextKind, type ZoomActionId } from "../generated/manifest"
import {
  DEFAULT_ZOOM,
  anchoredScroll,
  centeredOn,
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
  selectsWhenDrawn,
  keepsSelection,
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
  wheelAction,
  type PointerAction,
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
const JUMP_TO_VIEWER_EVENT = "sketch:jump-to-viewer"
const FOUND_CURSOR_CLASS = "remote-cursor-found"
const ZOOM_ATTRIBUTE = "data-zoom"
const LINE_HEIGHT_PX = 16
const HISTORY_STATUS_MS = 3000
const SELECTED_ATTRIBUTE = "data-selected-element"
const SELECTED_COUNT_ATTRIBUTE = "data-selected-count"
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

type Grip = { mode: "resize"; corner: Corner } | { mode: "endpoint"; endpoint: Endpoint }

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

interface Member {
  rect: SVGElement
  elementId: string
  baseVersion: number
  origin: Shape
  committed: Shape
}

interface Move extends Throttled {
  mode: "move"
  pressedId: string
  members: Member[]
  grab: Point
  shapes: readonly Shape[]
}

type Gesture = Edit | Draw | Copy | Move

function isEdit(gesture: Gesture): gesture is Edit {
  return gesture.mode === "resize" || gesture.mode === "endpoint"
}

function claimedRects(gesture: Gesture): SVGElement[] {
  if (isEdit(gesture)) return [gesture.rect]
  return gesture.mode === "move" ? gesture.members.map(({ rect }) => rect) : []
}

function editedIds(gesture: Gesture | undefined): string[] {
  if (gesture === undefined) return []
  if (isEdit(gesture)) return [gesture.elementId]
  return gesture.mode === "move" ? gesture.members.map(({ elementId }) => elementId) : []
}

interface Marquee {
  pointerId: number
  start: Point
  additive: boolean
  base: Selection
  dragged: boolean
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

function isGroupEntry(value: unknown): value is GroupPreviewEntry {
  return (
    isRecord(value) &&
    typeof value.element_id === "string" &&
    Number.isInteger(value.base_version) &&
    isBox(value) &&
    isPoints(value.points)
  )
}

function isGroupPreview(value: unknown): value is GroupPreview {
  return (
    isRecord(value) &&
    typeof value.drag_id === "string" &&
    Number.isInteger(value.seq) &&
    Array.isArray(value.elements) &&
    value.elements.every(isGroupEntry)
  )
}

function isGroupCancel(value: unknown): value is { drag_id: string; element_ids: string[] } {
  return (
    isRecord(value) &&
    typeof value.drag_id === "string" &&
    Array.isArray(value.element_ids) &&
    value.element_ids.every((id) => typeof id === "string")
  )
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

function domBindings(element: Element): Bindings {
  return bindingsFrom(
    BINDING_ENDS.flatMap((end) => {
      const target = element.getAttribute(`data-${end}-target`)
      const anchorText = element.getAttribute(`data-${end}-anchor`)
      if (target === null || anchorText === null) return []
      const binding: Binding = { target, anchor: integerPair(anchorText) }
      return [[end, binding] as const]
    }),
  )
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
  return endpointPoint({ box, points }, grip.endpoint) ?? box
}

function editedShape(edit: Edit, pointer: Point, canvas: Size): Shape {
  const { box, points } = edit.origin
  if (edit.mode === "resize") {
    const resized = resizedBox(box, edit.corner, subtract(pointer, edit.grab), canvas)
    return { box: resized, points: scalePoints(points, box, resized) }
  }
  return movedEndpoint(edit.origin, edit.endpoint, subtract(pointer, edit.grab), canvas)
}

type ShapeChange = Extract<ElementChange, { event: "commit_shape" }>

function looseEnds(rect: Element, movedIds: ReadonlySet<string>): [BindingEnd, Binding][] {
  const bindings = domBindings(rect)
  return BINDING_ENDS.flatMap((end) => {
    const binding = bindings[end]
    return binding === undefined || movedIds.has(binding.target) ? [] : [[end, binding] as [BindingEnd, Binding]]
  })
}

function movedChange({ rect, elementId, committed }: Member, shape: Shape, movedIds: ReadonlySet<string>): Change<ElementChange> {
  const loose = looseEnds(rect, movedIds)
  if (loose.length === 0) {
    return { id: elementId, before: { event: "commit", x: committed.box.x, y: committed.box.y }, after: { event: "commit", x: shape.box.x, y: shape.box.y } }
  }
  return {
    id: elementId,
    before: { event: "commit_shape", box: committed.box, points: committed.points, bindings: Object.fromEntries(loose) },
    after: { event: "commit_shape", box: shape.box, points: shape.points, bindings: Object.fromEntries(loose.map(([end]) => [end, null])) },
  }
}

const NOTHING = (): void => undefined

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
  private cursorLayer!: CursorLayer
  private online = true
  private tool: ToolId = DEFAULT_TOOL
  private spaceHeld = false
  private pannedWithSpace = false
  private pan: Pan | undefined
  private selected: Selection = EMPTY_SELECTION
  private selectOnArrival: Selection | undefined
  private selectionChanges = 0
  private marquee: Marquee | undefined
  private marqueeLayer!: MarqueeLayer
  private lastPointer: Point | undefined
  private nextStyle: ElementStyle = DEFAULT_STYLE
  private stylePanel!: StylePanel
  private selection!: SelectionOverlay
  private draws!: DrawLayer
  private observer: MutationObserver | undefined
  private readonly mutations = new BoardMutations(this, {
    canReplay: () => this.canReplay(),
    historyChanged: () => {
      this.syncHistoryButtons()
    },
    failed: (message) => {
      this.flash(message)
    },
  })
  private historyStatusTimer: number | undefined
  private zoom = DEFAULT_ZOOM
  private svgObserver: MutationObserver | undefined

  override mounted(): void {
    this.selection = new SelectionOverlay(this.layer("#selection"))
    this.draws = new DrawLayer(this.layer("#draw-previews"))
    this.marqueeLayer = new MarqueeLayer(this.layer("#marquee"))
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
    this.el.addEventListener(JUMP_TO_VIEWER_EVENT, this.onJumpToViewer)
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
    this.handleEvent("group_preview", (payload: unknown) => {
      if (isGroupPreview(payload)) this.applyRemoteGroup(payload)
    })
    this.handleEvent("group_cancel", (payload: unknown) => {
      if (!isGroupCancel(payload)) return
      for (const elementId of payload.element_ids) this.cancelRemoteDrag({ element_id: elementId, drag_id: payload.drag_id })
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
    this.handleEvent("viewer_left", (payload: unknown) => {
      if (isRecord(payload) && typeof payload.viewer_id === "string") this.forgetViewer(payload.viewer_id)
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
    this.cancelMarquee()
    this.textEditor?.commit()
  }

  override reconnected(): void {
    this.online = true
    for (const viewerId of this.remoteCursors.clear()) this.cursorLayer.remove(viewerId)
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
      if (message !== undefined && this.online) void pushClientEvent(this, "cursor", message)
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
    if (seq !== undefined && this.online) void pushClientEvent(this, "cursor_leave", { seq })
  }

  private applyRemoteCursor(cursor: RemoteCursor): void {
    if (this.remoteCursors.accept(cursor)) this.cursorLayer.show(cursor)
  }

  private removeRemoteCursor(viewerId: string, seq: number): void {
    if (this.remoteCursors.leave(viewerId, seq)) this.cursorLayer.remove(viewerId)
  }

  private forgetViewer(viewerId: string): void {
    if (this.remoteCursors.forget(viewerId)) this.cursorLayer.remove(viewerId)
  }

  private onJumpToViewer = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail) || typeof event.detail.viewer_id !== "string") return
    const cursor = this.remoteCursors.find(event.detail.viewer_id)
    if (cursor === undefined) return
    const scroll = centeredOn(cursor, this.canvasSize(), this.zoom, this.viewportSize())
    this.el.scrollTo({ left: scroll.x, top: scroll.y, behavior: "smooth" })
    this.cursorLayer.highlight(cursor.viewer_id, FOUND_CURSOR_CLASS)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.textEditor !== undefined) {
      if (!this.textEditor.contains(event.target)) {
        event.preventDefault()
        this.textEditor.commit()
      }
      return
    }
    if (this.gesture !== undefined || this.erase !== undefined || this.pan !== undefined || this.marquee !== undefined) return
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
      shiftKey: event.shiftKey,
    })
    const kind = drawnKind(this.tool)
    const handlers: Record<PointerAction, () => void> = {
      pan: () => {
        this.startPan(event)
      },
      draw: () => {
        if (kind !== undefined) this.startDraw(event, kind)
      },
      text: () => {
        this.openText(event, rect)
      },
      erase: () => {
        this.startErase(event)
      },
      marquee: () => {
        this.startMarquee(event)
      },
      toggle: () => {
        if (rect !== null) this.toggleSelected(event, rect)
      },
      move: () => {
        if (rect !== null) this.startMove(event, rect)
      },
      copy: () => {
        if (rect !== null) this.startCopy(event, rect)
      },
      resize: () => {
        if (isCorner(handle)) this.editSelected(event, { mode: "resize", corner: handle })
        if (isEndpoint(handle)) this.editSelected(event, { mode: "endpoint", endpoint: handle })
      },
      zoom: NOTHING,
      none: NOTHING,
    }
    handlers[action]()
  }

  private editSelected(event: PointerEvent, grip: Grip): void {
    const [only] = this.selected
    const rect = only === undefined || this.selected.length !== 1 ? null : this.elementFor(only)
    if (rect !== null) this.startEdit(event, rect, grip)
  }

  private toggleSelected(event: PointerEvent, rect: SVGElement): void {
    const elementId = rect.dataset.element
    if (elementId === undefined) return
    event.preventDefault()
    this.select(toggled(this.selected, elementId))
  }

  private startMove(event: PointerEvent, rect: SVGElement): void {
    const pressedId = rect.dataset.element
    if (!this.online || pressedId === undefined) return
    if (!this.selected.includes(pressedId)) this.select([pressedId])
    event.preventDefault()
    this.el.setPointerCapture(event.pointerId)
    const members = this.selected.flatMap((elementId): Member[] => {
      const rect = this.elementFor(elementId)
      if (rect === null) return []
      claimElement(rect)
      this.clearRemoteDrag(elementId)
      const origin = renderedShape(rect)
      return [{ rect, elementId, baseVersion: integerAttribute(rect, "data-version"), origin, committed: committedShape(rect) }]
    })
    this.gesture = {
      mode: "move",
      pressedId,
      members,
      grab: this.canvasPoint(event),
      shapes: members.map(({ origin }) => origin),
      dragId: crypto.randomUUID(),
      pointerId: event.pointerId,
      seq: 0,
      lastSentAt: -Infinity,
      previewTimer: undefined,
    }
  }

  private startMarquee(event: PointerEvent): void {
    event.preventDefault()
    this.el.setPointerCapture(event.pointerId)
    const additive = event.shiftKey
    this.marquee = { pointerId: event.pointerId, start: this.canvasPoint(event), additive, base: this.selected, dragged: false }
  }

  private updateMarquee(marquee: Marquee, pointer: Point): void {
    marquee.dragged ||= isDrag(marquee.start, pointer, this.zoom)
    if (!marquee.dragged) return
    const box = marqueeBox(marquee.start, pointer)
    this.marqueeLayer.show(box)
    const elements = [...this.el.querySelectorAll<SVGElement>("#elements [data-element]")].flatMap((shape) => {
      const id = shape.dataset.element
      return id === undefined ? [] : [{ id, box: renderedBox(shape) }]
    })
    const next = marqueeSelection(marquee.base, marqueeHits(elements, box), marquee.additive)
    if (!sameSelection(next, this.selected)) this.select(next)
  }

  private finishMarquee(marquee: Marquee): void {
    this.endMarquee(marquee)
    if (!marquee.dragged && !marquee.additive) this.select(EMPTY_SELECTION)
  }

  private cancelMarquee(): void {
    const marquee = this.marquee
    if (marquee === undefined) return
    this.endMarquee(marquee)
    this.select(marquee.base)
  }

  private endMarquee(marquee: Marquee): void {
    this.marquee = undefined
    this.marqueeLayer.hide()
    if (this.el.hasPointerCapture(marquee.pointerId)) this.el.releasePointerCapture(marquee.pointerId)
  }

  private selectAll(): void {
    if (this.gesture !== undefined || this.textEditor !== undefined) return
    this.useTool(DEFAULT_TOOL)
    const ids = [...this.el.querySelectorAll<SVGElement>("#elements [data-element]")].flatMap((shape) => shape.dataset.element ?? [])
    this.select(ids)
  }

  private startEdit(event: PointerEvent, rect: SVGElement, grip: Grip): void {
    const elementId = rect.dataset.element
    if (!this.online || elementId === undefined) return

    event.preventDefault()
    this.select([elementId])
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
    this.select([elementId])
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
    this.select(EMPTY_SELECTION)
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
    for (const id of erasedWithSelection(eraserHits(elements, path), this.selected)) {
      if (erase.pending.has(id)) continue
      erase.pending.add(id)
      this.elementFor(id)?.setAttribute(ERASING, "")
    }
    erase.last = path[path.length - 1] ?? erase.last
  }

  private finishErase(erase: Erase): void {
    this.endErase(erase)
    if (erase.pending.size === 0) return
    const elementIds = [...erase.pending]
    void this.mutations.erase(elementIds).finally(() => {
      this.unfade(elementIds)
    })
  }

  private onHistoryEvent = (event: Event): void => {
    if (event instanceof CustomEvent && isRecord(event.detail) && isHistoryAction(event.detail.action)) {
      this.runHistory(event.detail.action)
    }
  }

  private canReplay(): boolean {
    return this.online && this.gesture === undefined && this.erase === undefined && this.textEditor === undefined
  }

  private runHistory(direction: Direction): void {
    if (this.canReplay()) this.mutations.run(direction)
  }

  private async commitOne(elementId: string, before: ElementChange, after: ElementChange, dragId: string): Promise<void> {
    await this.mutations.commit([{ id: elementId, before, after }], dragId)
  }

  private async createGroup(snapshots: readonly ElementSnapshot[]): Promise<void> {
    const created = await this.mutations.createMany(snapshots)
    if (created.length > 0) this.selectWhenPresent(created)
  }

  private syncHistoryButtons(): void {
    const enabled = { undo: this.mutations.canUndo, redo: this.mutations.canRedo }
    for (const button of document.querySelectorAll<HTMLElement>("[data-history-action]")) {
      const action = button.dataset.historyAction
      if (!isHistoryAction(action)) continue
      if (enabled[action] && !this.mutations.busy) {
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
    this.mutations.noteErased(elementId)
    this.remotePreviews.erase(elementId)
    this.clearStaleTimer(elementId)
    this.erase?.pending.delete(elementId)
    if (this.gesture !== undefined && isEdit(this.gesture) && this.gesture.elementId === elementId) this.endGesture(this.gesture)
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
    if (this.marquee?.pointerId === event.pointerId) {
      this.updateMarquee(this.marquee, this.canvasPoint(event))
      return
    }
    const gesture = this.gesture
    if (gesture?.pointerId !== event.pointerId) return
    const pointer = this.canvasPoint(event)
    if (gesture.mode === "draw") {
      this.updateDraw(gesture, pointer)
    } else if (gesture.mode === "copy") {
      this.updateCopy(gesture, pointer)
    } else if (gesture.mode === "move") {
      this.updateMove(gesture, pointer)
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

  private updateMove(move: Move, pointer: Point): void {
    const moved = movedGroup(
      move.members.map(({ origin }) => origin),
      subtract(pointer, move.grab),
      this.canvasSize(),
    )
    move.shapes = moved.shapes
    move.members.forEach(({ rect }, index) => {
      const shape = moved.shapes[index]
      if (shape !== undefined) this.showElement(rect, shape)
    })
    this.schedulePreview(move, () => {
      this.sendPreview(move)
    })
  }

  private updateEdit(edit: Edit, pointer: Point): void {
    edit.shape = editedShape(edit, pointer, this.canvasSize())
    this.showElement(edit.rect, edit.shape)
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
    if (this.marquee?.pointerId === event.pointerId) this.finishMarquee(this.marquee)
    const gesture = this.gesture
    if (gesture?.pointerId !== event.pointerId) return
    this.endGesture(gesture)
    if (gesture.mode === "draw") {
      this.finishDraw(gesture)
    } else if (gesture.mode === "copy") {
      this.finishCopy(gesture)
    } else if (gesture.mode === "move") {
      void this.finishMove(gesture)
    } else {
      this.finishEdit(gesture)
    }
  }

  private finishCopy(copy: Copy): void {
    if (sameShape(copy.shape, copy.origin)) {
      this.draws.remove(copy.dragId)
      if (copy.seq > 0) void pushClientEvent(this, "draw_cancel", { drag_id: copy.dragId })
      return
    }
    const snapshot = { ...copy.source, ...copy.shape.box, points: copy.shape.points }
    void this.mutations.create(snapshot, copy.dragId)
      .then((id) => {
        if (id !== undefined) this.selectWhenPresent([id])
      })
      .finally(() => {
        this.draws.remove(copy.dragId)
      })
  }

  private async finishMove(move: Move): Promise<void> {
    const moved = move.members.flatMap((member, index) => {
      const shape = move.shapes[index]
      return shape === undefined || sameShape(shape, member.origin) ? [] : [{ member, shape }]
    })
    if (moved.length === 0) {
      for (const { elementId } of move.members) this.revert(elementId)
      if (move.seq > 0) this.pushMoveCancel(move)
      this.select([move.pressedId])
      return
    }
    const movedIds = new Set(move.members.map(({ elementId }) => elementId))
    const changes = moved.map(({ member, shape }) => movedChange(member, shape, movedIds))
    const failed = await this.mutations.commit(changes, move.dragId)
    for (const { id } of failed) this.revert(id)
  }

  private pushMoveCancel(move: Move): void {
    void pushClientEvent(this, "group_cancel", { drag_id: move.dragId, element_ids: move.members.map(({ elementId }) => elementId) })
  }

  private finishEdit(edit: Edit): void {
    if (sameShape(edit.shape, edit.origin)) {
      this.revert(edit.elementId)
      if (edit.seq > 0) void pushClientEvent(this, "drag_cancel", { element_id: edit.elementId, drag_id: edit.dragId })
      return
    }
    const { committed, shape } = edit
    const [before, after] = this.rebound(edit, { event: "commit_shape", box: committed.box, points: committed.points }, { event: "commit_shape", box: shape.box, points: shape.points })
    void this.commitOne(edit.elementId, before, after, edit.dragId)
  }

  private rebound(edit: Edit, before: ShapeChange, after: ShapeChange): [ShapeChange, ShapeChange] {
    const kind = edit.rect.dataset.kind
    if (edit.mode !== "endpoint" || !isElementKind(kind) || !bindsEnds(kind)) return [before, after]
    const end: BindingEnd = edit.endpoint
    const point = endpointPoint(edit.shape, end)
    const next = point === undefined ? undefined : this.bindingAt(point, edit.elementId)
    return [
      { ...before, bindings: { [end]: domBindings(edit.rect)[end] ?? null } },
      { ...after, bindings: { [end]: next ?? null } },
    ]
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
    const selectionAtRelease = this.selectionChanges
    const bindings = bindsEnds(draw.kind) ? this.bindingsAt({ box, points }, draw.dragId) : {}
    void this.mutations.create({ kind: draw.kind, ...box, points, text: "", seed: draw.seed, style: draw.style, bindings }, draw.dragId)
      .then((id) => {
        const untouched = this.selectionChanges === selectionAtRelease
        if (id !== undefined && untouched && selectsWhenDrawn(draw.kind)) this.selectWhenPresent([id])
      })
      .finally(() => {
        this.draws.remove(draw.dragId)
      })
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.pan?.pointerId === event.pointerId) this.endPan()
    if (this.gesture !== undefined) this.cancelGesture(this.gesture)
    this.cancelErase()
    this.cancelMarquee()
  }

  private cancelGesture(gesture: Gesture): void {
    this.abandonGesture(gesture)
    if (gesture.mode === "move") {
      this.pushMoveCancel(gesture)
    } else if (isEdit(gesture)) {
      void pushClientEvent(this, "drag_cancel", { element_id: gesture.elementId, drag_id: gesture.dragId })
    } else {
      void pushClientEvent(this, "draw_cancel", { drag_id: gesture.dragId })
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
    if (selectsAll(input)) {
      event.preventDefault()
      this.selectAll()
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
    const selected = this.selectedElements()
    const sources = selected.flatMap((rect) => snapshotOf(rect) ?? [])
    if (sources.length === 0) return
    if (action === "duplicate") {
      void this.createGroup(duplicated(sources, this.canvasSize()))
      return
    }
    event.preventDefault()
    const ids = selected.flatMap((rect) => rect.dataset.element ?? [])
    void this.copySelected(sources, action === "cut" ? ids : [])
  }

  private selectedElements(): SVGElement[] {
    return [...this.el.querySelectorAll<SVGElement>("#elements [data-element]")].filter(
      (rect) => rect.dataset.element !== undefined && this.selected.includes(rect.dataset.element),
    )
  }

  private async copySelected(sources: readonly ElementSnapshot[], cutIds: readonly string[]): Promise<void> {
    if (!(await writeClipboardText(encodeElements(sources)))) {
      this.flash("Couldn't copy to the clipboard")
      return
    }
    if (cutIds.length === 0) return
    this.select(EMPTY_SELECTION)
    await this.mutations.erase(cutIds)
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
    this.cancelMarquee()
    this.select(EMPTY_SELECTION)
  }

  private eraseSelected(event: KeyboardEvent): void {
    const elementIds = this.selected
    if (elementIds.length === 0 || this.gesture !== undefined || this.textEditor !== undefined || !this.online) return
    event.preventDefault()
    this.select(EMPTY_SELECTION)
    void this.mutations.erase(elementIds)
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
    if (!this.online) return
    const targets = restyleTargets(this.selectedStyles(), property, value)
    if (targets.length === 0) return
    const change = (token: string): ElementChange => ({ event: "commit_style", property, value: token })
    const changes = targets.map(({ id, before }) => ({ id, before: change(before), after: change(value) }))
    void this.mutations.commit(changes, crypto.randomUUID(), property)
  }

  private selectedStyles(): (Styled & { id: string })[] {
    return this.selectedElements().flatMap((rect) => {
      const { kind, element } = rect.dataset
      return isElementKind(kind) && element !== undefined ? [{ id: element, kind, style: styleOf(rect) }] : []
    })
  }

  private syncStylePanel(): void {
    const selected = this.selectedStyles()
    if (selected.length > 0) {
      this.stylePanel.show(selected)
    } else {
      const kind = this.toolKind()
      this.stylePanel.show(kind === undefined ? [] : [{ kind, style: this.nextStyle }])
    }
  }

  private toolKind(): ElementKind | undefined {
    return drawnKind(this.tool) ?? typedKind(this.tool)
  }

  private useTool(tool: ToolId): void {
    if (!keepsSelection(tool)) this.select(EMPTY_SELECTION)
    if (tool === this.tool) {
      this.syncStylePanel()
      return
    }
    this.tool = tool
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

  private select(elementIds: Selection): void {
    this.selectionChanges += 1
    this.selected = elementIds
    this.selectOnArrival = undefined
    this.syncSelection()
  }

  private selectWhenPresent(elementIds: Selection): void {
    this.selectOnArrival = elementIds
    this.syncSelection()
  }

  private syncSelection(): void {
    const arriving = this.selectOnArrival
    if (arriving?.every((id) => this.elementFor(id) !== null) === true) {
      this.selected = arriving
      this.selectOnArrival = undefined
    }
    const rects = this.selected.flatMap((id) => this.elementFor(id) ?? [])
    this.selected = rects.flatMap((rect) => rect.dataset.element ?? [])
    const [only] = rects
    const published = selectionAttribute(this.selected)
    if (only === undefined || published === undefined) {
      this.selection.hide()
      this.js().removeAttribute(this.el, SELECTED_ATTRIBUTE)
      this.js().removeAttribute(this.el, SELECTED_COUNT_ATTRIBUTE)
    } else {
      this.js().setAttribute(this.el, SELECTED_ATTRIBUTE, published)
      this.js().setAttribute(this.el, SELECTED_COUNT_ATTRIBUTE, String(rects.length))
      this.showSelection(only, rects)
    }
    this.syncStylePanel()
  }

  private showSelection(only: SVGElement, rects: readonly SVGElement[]): void {
    if (rects.length > 1) {
      this.selection.showGroup(rects.map(renderedBox))
    } else {
      const { box, points } = renderedShape(only)
      this.selection.show(box, points, selectionHandles(only.dataset.kind))
    }
  }

  private abandonGesture(gesture: Gesture): void {
    this.endGesture(gesture)
    const edited = editedIds(gesture)
    for (const elementId of edited) this.revert(elementId)
    if (edited.length === 0) this.draws.remove(gesture.dragId)
  }

  private endGesture(gesture: Gesture): void {
    this.gesture = undefined
    window.clearTimeout(gesture.previewTimer)
    for (const rect of claimedRects(gesture)) releaseElement(rect)
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
      void pushClientEvent(this, "draw_preview", {
        kind: gesture.kind,
        drag_id: gesture.dragId,
        seq: gesture.seq,
        seed: gesture.seed,
        ...gesture.style,
        ...gesture.shape.box,
        points: gesture.shape.points,
      })
    } else if (gesture.mode === "move") {
      const members = gesture.members.flatMap(({ rect, elementId, baseVersion }, index) => {
        const shape = gesture.shapes[index]
        return shape === undefined || !rect.isConnected ? [] : [{ elementId, baseVersion, shape }]
      })
      if (members.length > 0) void pushClientEvent(this, "group_preview", groupPreview(gesture.dragId, gesture.seq, members))
    } else if (gesture.mode === "copy") {
      const { kind, seed, style, text } = gesture.source
      void pushClientEvent(this, "draw_preview", {
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
      void pushClientEvent(this, "preview", {
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
    if (rect === null || this.isEditing(preview.element_id)) return
    if (!this.remotePreviews.accept(preview, integerAttribute(rect, "data-version"))) return

    this.restartStaleTimer(preview.element_id, () => {
      this.cancelRemoteDrag(preview)
    })
    this.showElement(rect, { box: preview, points: preview.points }, preview.text)
  }

  private applyRemoteGroup(group: GroupPreview): void {
    const accepted = acceptedGroupEntries(this.remotePreviews, group, (elementId) => {
      const rect = this.elementFor(elementId)
      return rect === null || this.isEditing(elementId) ? undefined : integerAttribute(rect, "data-version")
    })
    for (const entry of accepted) {
      const rect = this.elementFor(entry.element_id)
      if (rect === null) continue
      const ref = { element_id: entry.element_id, drag_id: group.drag_id }
      this.restartStaleTimer(entry.element_id, () => {
        this.cancelRemoteDrag(ref)
      })
      this.showElement(rect, { box: entry, points: entry.points })
    }
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
    if (this.isEditing(elementId)) return
    const rect = this.elementFor(elementId)
    if (rect === null) return
    this.showElement(rect, committedShape(rect), rect.dataset.text ?? "")
  }

  private isEditing(elementId: string): boolean {
    return editedIds(this.gesture).includes(elementId)
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
    this.select(EMPTY_SELECTION)
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
      void pushClientEvent(this, "draw_preview", { kind: session.target.kind, seed: session.seed, ...session.style, ...preview })
    } else {
      void pushClientEvent(this, "preview", {
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
      if (sent) void pushClientEvent(this, "drag_cancel", ref)
    } else {
      this.showElement(target.element, { box, points: [] }, text)
      const before: ElementChange = { event: "commit_shape", box: target.committed, points: [], text: target.text }
      void this.commitOne(target.elementId, before, { event: "commit_shape", box, points: [], text }, ref.drag_id)
    }
    this.select([target.elementId])
  }

  private finishCreatedText(session: TextSession, kind: TextKind, text: string, box: Box, sent: boolean): void {
    const { dragId, seed, style } = session
    if ((requiresText(kind) && isBlankText(text)) || !this.online) {
      this.draws.remove(dragId)
      if (sent) void pushClientEvent(this, "draw_cancel", { drag_id: dragId })
      return
    }
    void this.mutations.create({ kind, ...box, points: [], text, seed, style }, dragId).finally(() => {
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

  private showElement(element: Element, shape: Shape, text?: string): void {
    this.showShape(element, shape, text)
    const id = element.getAttribute("data-element")
    if (id !== null) this.followBindings(id)
  }

  private followBindings(targetId: string): void {
    const selector = BINDING_ENDS.map((end) => `#elements > [data-${end}-target="${CSS.escape(targetId)}"]`).join(", ")
    for (const arrow of this.el.querySelectorAll<SVGElement>(selector)) {
      const arrowId = arrow.dataset.element
      if (arrowId === undefined || this.isEditing(arrowId)) continue
      this.showShape(arrow, resolvedShape(renderedShape(arrow), domBindings(arrow), (id) => this.liveBox(id), this.canvasSize()))
    }
  }

  private liveBox(elementId: string): Box | undefined {
    const rect = this.elementFor(elementId)
    return rect === null ? undefined : renderedBox(rect)
  }

  private bindingAt(point: Point, except: string): Binding | undefined {
    const targets = [...this.el.querySelectorAll<SVGElement>("#elements > [data-element]")].filter((rect) => {
      const { kind, element: id } = rect.dataset
      return id !== undefined && id !== except && isElementKind(kind) && bindsTo(kind) && boxContains(renderedBox(rect), point)
    })
    const top = targets.at(-1)
    const target = top?.dataset.element
    return top === undefined || target === undefined ? undefined : { target, anchor: anchorFor(point, renderedBox(top)) }
  }

  private bindingsAt(shape: Shape, except: string): Bindings {
    const ends = absolutePoints(shape)
    return bindingsFrom(
      BINDING_ENDS.flatMap((end, index) => {
        const point = ends[index]
        const binding = point === undefined ? undefined : this.bindingAt(point, except)
        return binding === undefined ? [] : [[end, binding] as const]
      }),
    )
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
    if (wheelAction({ tool: this.tool, ctrlKey: event.ctrlKey, metaKey: event.metaKey }) !== "zoom") return
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
