export {}

declare global {
  interface Window {
    orionDesktop?: {
      isElectron: boolean
      bridgeBaseUrl: string
      restartBridge?: () => Promise<{
        ok: boolean
        bridgeBaseUrl: string
        error?: string | null
      }>
      platform: string
      versions: {
        chrome: string
        electron: string
        node: string
      }
    }
  }
}
