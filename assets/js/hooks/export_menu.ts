import { ViewHook } from "phoenix_live_view"
import { EXPORT_ACTIONS, type ExportActionId } from "../generated/manifest"
import { buildSvg, copyPng, download, renderPng, svgBlob, type ExportOptions } from "../export/export_dom"
import { exportActionFor, exportFilename, type ExportFormat } from "../export/export_logic"
import { selectionFromAttribute } from "./selection_logic"
import { focusContext, shortcutFor } from "./shortcuts"

const STATUS_MS = 3000
const NOTHING_TO_EXPORT = "Nothing to export"
const SELECTED_ATTRIBUTE = "data-selected-element"

function isExportAction(value: string | undefined): value is ExportActionId {
  return EXPORT_ACTIONS.some(({ id }) => id === value)
}

function inTextEditor(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("textarea") !== null)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "the browser refused"
}

export class ExportMenu extends ViewHook {
  private statusTimer: number | undefined
  private observer: MutationObserver | undefined

  override mounted(): void {
    window.addEventListener("keydown", this.onKeyDown)
    document.addEventListener("click", this.onDocumentClick)
    this.button.addEventListener("click", this.toggle)
    this.menu.addEventListener("click", this.onMenuClick)
    this.observer = new MutationObserver(() => {
      this.syncSelection()
    })
    this.observer.observe(this.viewport, { attributes: true, attributeFilter: [SELECTED_ATTRIBUTE] })
    this.syncSelection()
  }

  override destroyed(): void {
    window.removeEventListener("keydown", this.onKeyDown)
    document.removeEventListener("click", this.onDocumentClick)
    window.clearTimeout(this.statusTimer)
    this.observer?.disconnect()
  }

  private get button(): HTMLElement {
    return this.required("export-button")
  }

  private get menu(): HTMLElement {
    return this.required("export-menu")
  }

  private get viewport(): HTMLElement {
    return this.required("canvas-viewport")
  }

  private required(id: string): HTMLElement {
    const element = document.getElementById(id)
    if (element === null) throw new Error(`#${id} is missing`)
    return element
  }

  private option(name: string): HTMLInputElement | null {
    return this.menu.querySelector<HTMLInputElement>(`input[data-export-option="${name}"]`)
  }

  private get selectedIds(): readonly string[] {
    return selectionFromAttribute(this.viewport.getAttribute(SELECTED_ATTRIBUTE))
  }

  private syncSelection(): void {
    const only = this.option("selection")
    if (only === null) return
    only.disabled = this.selectedIds.length === 0
    if (only.disabled) only.checked = false
  }

  private get isOpen(): boolean {
    return !this.menu.hidden
  }

  private open(): void {
    const help = document.getElementById("shortcuts-help")?.getAttribute("data-hide")
    if (help != null) this.js().exec(help)
    this.menu.hidden = false
    this.button.setAttribute("aria-expanded", "true")
    this.menu.querySelector<HTMLElement>("[data-export-action]")?.focus()
  }

  private close(restoreFocus: boolean): void {
    this.menu.hidden = true
    this.button.setAttribute("aria-expanded", "false")
    if (restoreFocus) this.button.focus()
  }

  private toggle = (): void => {
    if (this.isOpen) {
      this.close(true)
    } else {
      this.open()
    }
  }

  private onDocumentClick = (event: Event): void => {
    const target = event.target
    if (!this.isOpen || !(target instanceof Node)) return
    if (!this.menu.contains(target) && !this.button.contains(target)) this.close(false)
  }

  private onMenuClick = (event: Event): void => {
    const action = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-export-action]") : null
    const id = action?.dataset.exportAction
    if (isExportAction(id)) {
      this.close(true)
      void this.run(id)
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const context = focusContext(inTextEditor(event.target))
    if (this.isOpen && shortcutFor(event, context)?.action === "escape") {
      this.close(true)
      return
    }
    const action = exportActionFor(event, context)
    if (action === undefined) return
    event.preventDefault()
    void this.run(action)
  }

  private options(): ExportOptions {
    const selectedIds = this.selectedIds
    return {
      onlySelected: this.option("selection")?.checked === true && selectedIds.length > 0,
      selectedIds,
      background: this.option("background")?.checked === true,
    }
  }

  private async run(action: ExportActionId): Promise<void> {
    if (action === "open_menu") {
      this.open()
      return
    }
    try {
      await this.export(action)
    } catch (error) {
      this.say(`Export failed: ${errorMessage(error)}`)
    }
  }

  private async export(action: Exclude<ExportActionId, "open_menu">): Promise<void> {
    const canvas = document.getElementById("canvas")
    const built = canvas instanceof SVGSVGElement ? buildSvg(canvas, this.options()) : undefined
    if (built === undefined) {
      this.say(NOTHING_TO_EXPORT)
      return
    }
    const boardId = this.el.dataset.boardId ?? ""
    if (action === "copy_png") {
      await copyPng(renderPng(built, window.devicePixelRatio), built)
      this.say("Copied as PNG")
      return
    }
    const format: ExportFormat = action === "download_png" ? "png" : "svg"
    const blob = format === "png" ? await renderPng(built, window.devicePixelRatio) : svgBlob(built)
    const filename = exportFilename(boardId, new Date(), format)
    download(blob, filename)
    this.say(`Downloaded ${filename}`)
  }

  private say(message: string): void {
    const status = document.getElementById("export-status")
    if (status === null) return
    status.textContent = message
    status.hidden = false
    window.clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => {
      status.hidden = true
    }, STATUS_MS)
  }
}
