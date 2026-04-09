type UserTier = 'free' | 'pro' | 'power'

type AIRequest = { model: string; prompt: string; imageDataUrl?: string }
type MultiAIRequest = { prompt: string; imageDataUrl?: string }
type MultiAIResponse = { gpt: string; claude: string; gemini: string }
type ApiKeys = { openai?: string; anthropic?: string; gemini?: string }
type ApiKeyStatus = { openai: boolean; anthropic: boolean; gemini: boolean }

type AppSettings = {
  shareSafetyMode: boolean
  captureProtectionMode: boolean
  widgetShortcut: string
  screenContextFeature: boolean
  liveHelperShortcut: string
  stealthOverlay: boolean
}

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

declare global {
  interface Window {
    velora: {
      // Window
      togglePanel: () => Promise<{ isExpanded: boolean }>
      getWindowState: () => Promise<{ isExpanded: boolean }>

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

      // Subscription / Stripe
      getSubscription: () => Promise<SubscriptionStatus>
      configureStripe: (config: StripeConfig) => Promise<{ ok: boolean; error?: string }>
      createCheckout: (tier?: 'pro' | 'power') => Promise<{ ok: boolean; error?: string; url?: string }>
      verifySubscription: () => Promise<SubscriptionStatus>
      openCustomerPortal: () => Promise<{ ok: boolean; error?: string }>

      // Push listeners
      onWindowState: (handler: (payload: { isExpanded: boolean }) => void) => () => void
      onShortcut: (handler: (payload: { action: 'capture' | 'explain' | 'screen-context' | 'live-helper'; imageDataUrl?: string }) => void) => () => void
      onSubscriptionUpdated: (handler: (payload: SubscriptionStatus) => void) => () => void
    }
  }
}

export {}
