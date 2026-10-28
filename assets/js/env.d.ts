import type { LiveSocket } from "phoenix_live_view"

export interface LiveReloader {
  enableServerLogs(): void
  openEditorAtCaller(target: EventTarget | null): void
  openEditorAtDef(target: EventTarget | null): void
}

declare global {
  const process: { env: { NODE_ENV: string } }

  interface Window {
    liveSocket: LiveSocket
    liveReloader?: LiveReloader
  }

  interface WindowEventMap {
    "phx:live_reload:attached": CustomEvent<LiveReloader>
  }
}
