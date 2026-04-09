import { contextBridge, ipcRenderer } from 'electron'

type UserTier = 'free' | 'pro' | 'power'

type AIRequest = { model: string; prompt: string; imageDataUrl?: string }
type MultiAIRequest = { prompt: string; imageDataUrl?: string }
type MultiAIResponse = { gpt: string; claude: string; gemini: string }
type ApiKeys = { openai?: string; anthropic?: string; gemini?: string }

type StripeConfig = {
  secretKey: string
  proPriceId: string
}

type SubscriptionStatus = {
  tier: UserTier
  customerId: string | null
  subscriptionId: string | null
  currentPeriodEnd: number | null
}

contextBridge.exposeInMainWorld('velora', {
  // Window
  togglePanel: () => ipcRenderer.invoke('velora:toggle-panel'),
  getWindowState: () => ipcRenderer.invoke('velora:get-window-state'),

  // Capture
  captureScreen: () => ipcRenderer.invoke('velora:capture-screen'),

  // AI
  runAI: (payload: AIRequest) => ipcRenderer.invoke('velora:run-ai', payload),
  runMultiAI: (payload: MultiAIRequest) => ipcRenderer.invoke('velora:run-multi-ai', payload) as Promise<MultiAIResponse>,
  checkOllama: () => ipcRenderer.invoke('velora:check-ollama') as Promise<{ running: boolean; models: string[] }>,

  // Settings
  getSettings: () => ipcRenderer.invoke('velora:get-settings'),
  setShareSafetyMode: (enabled: boolean) => ipcRenderer.invoke('velora:set-share-safety-mode', enabled),
  setWidgetShortcut: (shortcut: string) => ipcRenderer.invoke('velora:set-widget-shortcut', shortcut),
  setCaptureProtectionMode: (enabled: boolean) => ipcRenderer.invoke('velora:set-capture-protection-mode', enabled),
  setScreenContextFeature: (enabled: boolean) => ipcRenderer.invoke('velora:set-screen-context-feature', enabled),
  setLiveHelperShortcut: (shortcut: string) => ipcRenderer.invoke('velora:set-live-helper-shortcut', shortcut),
  setStealthOverlay: (enabled: boolean) => ipcRenderer.invoke('velora:set-stealth-overlay', enabled),

  // Microphone / audio
  requestMicPermission: () => ipcRenderer.invoke('velora:request-mic-permission') as Promise<boolean>,
  transcribeAudio: (base64Wav: string) => ipcRenderer.invoke('velora:transcribe-audio', base64Wav) as Promise<{ ok: boolean; error?: string; transcript: string }>,

  // API keys
  getApiKeyStatus: () => ipcRenderer.invoke('velora:get-api-key-status'),
  saveApiKeys: (keys: ApiKeys) => ipcRenderer.invoke('velora:save-api-keys', keys),

  // Subscription / Stripe
  getSubscription: () => ipcRenderer.invoke('velora:get-subscription') as Promise<SubscriptionStatus>,
  configureStripe: (config: StripeConfig) => ipcRenderer.invoke('velora:configure-stripe', config) as Promise<{ ok: boolean; error?: string }>,
  createCheckout: (_tier?: 'pro' | 'power') => ipcRenderer.invoke('velora:create-checkout') as Promise<{ ok: boolean; error?: string; url?: string }>,
  verifySubscription: () => ipcRenderer.invoke('velora:verify-subscription') as Promise<SubscriptionStatus>,
  openCustomerPortal: () => ipcRenderer.invoke('velora:open-customer-portal') as Promise<{ ok: boolean; error?: string }>,

  // Push listeners
  onWindowState: (handler: (payload: { isExpanded: boolean }) => void) => {
    const listener = (_: unknown, payload: { isExpanded: boolean }) => handler(payload)
    ipcRenderer.on('velora:window-state', listener)
    return () => ipcRenderer.removeListener('velora:window-state', listener)
  },
  onShortcut: (handler: (payload: { action: 'capture' | 'explain' | 'screen-context' | 'live-helper'; imageDataUrl?: string }) => void) => {
    const listener = (_: unknown, payload: { action: 'capture' | 'explain' | 'screen-context' | 'live-helper'; imageDataUrl?: string }) => handler(payload)
    ipcRenderer.on('velora:shortcut', listener)
    return () => ipcRenderer.removeListener('velora:shortcut', listener)
  },
  onSubscriptionUpdated: (handler: (payload: SubscriptionStatus) => void) => {
    const listener = (_: unknown, payload: SubscriptionStatus) => handler(payload)
    ipcRenderer.on('velora:subscription-updated', listener)
    return () => ipcRenderer.removeListener('velora:subscription-updated', listener)
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('velora:check-for-updates') as Promise<{ status: string }>,
  installUpdate: () => ipcRenderer.invoke('velora:install-update'),
  onUpdater: (handler: (payload: {
    event: 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'
    version?: string
    percent?: number
    transferred?: number
    total?: number
    message?: string
  }) => void) => {
    const listener = (_: unknown, payload: Parameters<typeof handler>[0]) => handler(payload)
    ipcRenderer.on('velora:updater', listener)
    return () => ipcRenderer.removeListener('velora:updater', listener)
  },
})
