import { textBox, textLines, type Box, type Point, type Size } from "./canvas_logic"

export interface TextLayout {
  fontSize: number
  lineHeight: number
  notePadding: number
}

export interface TextEditorOptions {
  layer: HTMLElement
  layout: TextLayout
  maxLength: number
  canvas: Size
  note?: { frame: Box; padding: number } | undefined
  onInput: (text: string, box: Box) => void
  onCommit: (text: string, box: Box) => void
}

export function normalizedText(text: string): string {
  return textLines(text).join("\n")
}

export class TextEditor {
  private readonly textarea: HTMLTextAreaElement
  private readonly context: CanvasRenderingContext2D | null
  private committed = false

  constructor(
    private readonly origin: Point,
    initialText: string,
    private readonly options: TextEditorOptions,
  ) {
    this.textarea = document.createElement("textarea")
    this.textarea.className = options.note === undefined ? "text-editor" : "text-editor note-editor"
    this.textarea.setAttribute("data-text-editor", "")
    this.textarea.setAttribute("aria-label", "Text")
    this.textarea.spellcheck = false
    this.textarea.wrap = options.note === undefined ? "off" : "soft"
    this.textarea.maxLength = options.maxLength
    this.textarea.value = initialText
    this.textarea.style.fontSize = `${String(options.layout.fontSize)}px`
    this.textarea.style.lineHeight = `${String(options.layout.lineHeight)}px`
    this.context = document.createElement("canvas").getContext("2d")
    this.textarea.addEventListener("input", this.onInput)
    this.textarea.addEventListener("keydown", this.onKeyDown)
    this.textarea.addEventListener("blur", this.commit)
    options.layer.append(this.textarea)
    this.place()
    this.textarea.focus()
    this.textarea.setSelectionRange(initialText.length, initialText.length)
  }

  contains(target: EventTarget | null): boolean {
    return target === this.textarea
  }

  text(): string {
    return normalizedText(this.textarea.value)
  }

  box(): Box {
    if (this.options.note !== undefined) return this.options.note.frame
    return textBox(
      this.origin,
      this.text(),
      (line) => this.measure(line),
      this.options.layout.lineHeight,
      this.options.canvas,
    )
  }

  commit = (): void => {
    if (this.committed) return
    this.committed = true
    const text = this.text()
    const box = this.box()
    this.textarea.removeEventListener("blur", this.commit)
    this.textarea.remove()
    this.options.onCommit(text, box)
  }

  private onInput = (): void => {
    const box = this.place()
    this.options.onInput(this.text(), box)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    this.commit()
  }

  private place(): Box {
    const box = this.box()
    const { note } = this.options
    if (note !== undefined) return this.placeInNote(box, note.padding)
    const { fontSize } = this.options.layout
    this.textarea.style.left = `${String(box.x)}px`
    this.textarea.style.top = `${String(box.y)}px`
    this.textarea.style.width = `${String(box.width + fontSize)}px`
    this.textarea.style.height = `${String(box.height)}px`
    return box
  }

  private placeInNote(box: Box, padding: number): Box {
    this.textarea.style.left = `${String(box.x + padding)}px`
    this.textarea.style.top = `${String(box.y + padding)}px`
    this.textarea.style.width = `${String(Math.max(0, box.width - 2 * padding))}px`
    this.textarea.style.height = `${String(Math.max(0, box.height - 2 * padding))}px`
    return box
  }

  private measure(line: string): number {
    if (this.context === null) return line.length * this.options.layout.fontSize
    const style = getComputedStyle(this.textarea)
    this.context.font = `${String(this.options.layout.fontSize)}px ${style.fontFamily}`
    return this.context.measureText(line).width
  }
}
