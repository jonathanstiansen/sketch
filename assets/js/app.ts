import "phoenix_html"
import { Socket } from "phoenix"
import { LiveSocket } from "phoenix_live_view"
import { hooks as colocatedHooks } from "phoenix-colocated/sketch"
import topbar from "../vendor/topbar"
import type { LiveReloader } from "./env"

function readCsrfToken(): string {
  const token = document.querySelector("meta[name='csrf-token']")?.getAttribute("content")
  if (token == null) {
    throw new Error("Missing csrf-token meta tag")
  }
  return token
}

const liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  params: { _csrf_token: readCsrfToken() },
  hooks: { ...colocatedHooks },
})

topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" })
window.addEventListener("phx:page-loading-start", () => {
  topbar.show(300)
})
window.addEventListener("phx:page-loading-stop", () => {
  topbar.hide()
})

liveSocket.connect()

window.liveSocket = liveSocket

function enableLiveReloadEditorShortcuts(reloader: LiveReloader): void {
  reloader.enableServerLogs()

  let keyDown: string | null = null
  window.addEventListener("keydown", (event) => {
    keyDown = event.key
  })
  window.addEventListener("keyup", () => {
    keyDown = null
  })
  window.addEventListener(
    "click",
    (event) => {
      if (keyDown === "c") {
        event.preventDefault()
        event.stopImmediatePropagation()
        reloader.openEditorAtCaller(event.target)
      } else if (keyDown === "d") {
        event.preventDefault()
        event.stopImmediatePropagation()
        reloader.openEditorAtDef(event.target)
      }
    },
    true,
  )

  window.liveReloader = reloader
}

if (process.env.NODE_ENV === "development") {
  window.addEventListener("phx:live_reload:attached", ({ detail: reloader }) => {
    enableLiveReloadEditorShortcuts(reloader)
  })
}
