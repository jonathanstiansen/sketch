export {}

declare global {
  interface Window {
    liveSocket: {
      connect(): void
      disconnect(): void
    }
  }
}
