type AIRequest = { model: string; prompt: string; imageDataUrl?: string }
type MultiAIRequest = { prompt: string; imageDataUrl?: string }
type MultiAIResponse = { gpt: string; claude: string; gemini: string }
type ApiKeys = { openai?: string; anthropic?: string; gemini?: string; deepseek?: string }
type ApiKeyStatus = { openai: boolean; anthropic: boolean; gemini: boolean; deepseek: boolean }

type AppSettings = {
  shareSafetyMode: boolean
  captureProtectionMode: boolean
  widgetShortcut: string
  screenContextFeature: boolean
  liveHelperShortcut: string
  stealthOverlay: boolean
}

declare global {
  interface Window {
    velora: {
      platform: NodeJS.Platform

      // Window
      togglePanel: () => Promise<{ isExpanded: boolean }>
      getWindowState: () => Promise<{ isExpanded: boolean }>
      quitApp: () => Promise<void>
      hideWidget: () => Promise<{ isExpanded: boolean }>
      getAppMeta: () => Promise<{
        version: string
        releasesUrl: string
        downloadPageUrl: string
        homepage: string
      }>
      openExternal: (url: string) => Promise<{ ok: boolean }>

      // Capture
      captureScreen: () => Promise<string>

      // AI
      runAI: (payload: AIRequest) => Promise<string>
      runMultiAI: (payload: MultiAIRequest) => Promise<MultiAIResponse>

      // Settings
      getSettings: () => Promise<AppSettings>
      setShareSafetyMode: (enabled: boolean) => Promise<AppSettings>
      setWidgetShortcut: (shortcut: string) => Promise<AppSettings>
      setCaptureProtectionMode: (enabled: boolean) => Promise<AppSettings>
      setScreenContextFeature: (enabled: boolean) => Promise<AppSettings>
      setLiveHelperShortcut: (shortcut: string) => Promise<AppSettings>
      setStealthOverlay: (enabled: boolean) => Promise<AppSettings>

      // Microphone / audio
      requestMicPermission: () => Promise<boolean>
      transcribeAudio: (base64Wav: string) => Promise<{ ok: boolean; error?: string; transcript: string }>

      // API keys
      getApiKeyStatus: () => Promise<ApiKeyStatus>
      saveApiKeys: (keys: ApiKeys) => Promise<ApiKeyStatus>

      // Push listeners
      onWindowState: (handler: (payload: { isExpanded: boolean }) => void) => () => void
      onShortcut: (handler: (payload: { action: 'capture' | 'explain' | 'screen-context' | 'live-helper'; imageDataUrl?: string }) => void) => () => void

      checkForUpdates: () => Promise<{ status: string }>
      installUpdate: () => Promise<void>
      onUpdater: (handler: (payload: {
        event: 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'
        version?: string
        percent?: number
        transferred?: number
        total?: number
        message?: string
      }) => void) => () => void
    }
  }
}

export {}
