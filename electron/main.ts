import {
  app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain,
  Menu, nativeImage, Tray, safeStorage, shell,
} from 'electron'
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { config as loadEnv } from 'dotenv'
import Stripe from 'stripe'
import Store from 'electron-store'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
loadEnv({ path: path.join(__dirname, '../.env') })
loadEnv({ path: path.join(__dirname, '../.env.local') })

function readBuiltinKeysFromBundle(): { deepseek: string; gemini: string } {
  const p = path.join(__dirname, 'builtin-keys.json')
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { deepseek?: string; gemini?: string }
      return {
        deepseek: (raw.deepseek ?? '').trim(),
        gemini: (raw.gemini ?? '').trim(),
      }
    }
  } catch {
    /* ignore */
  }
  return { deepseek: '', gemini: '' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type UserTier = 'free' | 'pro' | 'power'

type AIRequest = { model: string; prompt: string; imageDataUrl?: string }
type MultiAIRequest = { prompt: string; imageDataUrl?: string }
type MultiAIResponse = { gpt: string; claude: string; gemini: string }

// Legacy short model IDs → full IDs (for backwards compat with stored data)
const LEGACY_MODEL_MAP: Record<string, string> = {
  gpt: 'gpt-4o-mini',
  claude: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-2.5-flash',
}

function resolveModelId(id: string): string {
  return LEGACY_MODEL_MAP[id] ?? id
}

type AppSettings = {
  shareSafetyMode: boolean
  captureProtectionMode: boolean
  widgetShortcut: string
  screenContextFeature: boolean
  liveHelperShortcut: string
  stealthOverlay: boolean
}

type ApiKeys = {
  openai?: string
  anthropic?: string
  gemini?: string
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

// ─── Optional built-in keys: bundle file (release) or VELORA_* from .env (dev) / OS env ─

const _builtinFile = readBuiltinKeysFromBundle()
const BUILTIN_DEEPSEEK_KEY =
  _builtinFile.deepseek || (process.env.VELORA_BUILTIN_DEEPSEEK_KEY ?? '').trim()
const BUILTIN_GEMINI_KEY =
  _builtinFile.gemini || (process.env.VELORA_BUILTIN_GEMINI_KEY ?? '').trim()

// ─── Constants ────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged
const DEEP_LINK_PROTOCOL = 'velora'

// ─── Electron Store ───────────────────────────────────────────────────────────

const store = new Store<{
  settings: AppSettings
  keys: ApiKeys
  stripeConfig: StripeConfig
  subscription: SubscriptionStatus
}>({
  name: 'velora-store',
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  if (isDev) return // never auto-update in dev

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('velora:updater', { event: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('velora:updater', { event: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('velora:updater', { event: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('velora:updater', {
      event: 'progress',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('velora:updater', { event: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('velora:updater', { event: 'error', message: err.message })
  })

  // Check 8 s after launch so the UI is fully ready, then every 4 hours
  setTimeout(() => { autoUpdater.checkForUpdatesAndNotify().catch(() => null) }, 8_000)
  setInterval(() => { autoUpdater.checkForUpdatesAndNotify().catch(() => null) }, 4 * 60 * 60 * 1_000)
}

// ─── Windows ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null

/** Re-assert z-order often so other apps cannot permanently strip TOPMOST / floating level. */
const WIDGET_TOPMOST_REASSERT_MS = 50
let widgetTopmostInterval: ReturnType<typeof setInterval> | null = null

// ─── In-memory caches ─────────────────────────────────────────────────────────

let cachedApiKeys: ApiKeys | null = null
let cachedSettings: AppSettings | null = null

// ─── Encryption helpers ───────────────────────────────────────────────────────

function encrypt(secret: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(secret).toString('base64')
  }
  return Buffer.from(secret, 'utf-8').toString('base64')
}

function decrypt(secret: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  }
  return Buffer.from(secret, 'base64').toString('utf-8')
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  if (cachedSettings) return cachedSettings
  cachedSettings = store.get('settings', {
    shareSafetyMode: false,
    captureProtectionMode: false,
    widgetShortcut: 'Alt+Space',
    screenContextFeature: false,
    liveHelperShortcut: 'CommandOrControl+Shift+H',
    stealthOverlay: false,
  })
  return cachedSettings
}

function saveSettings(next: AppSettings): void {
  store.set('settings', next)
  cachedSettings = next
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

function loadApiKeys(): ApiKeys {
  if (cachedApiKeys) return cachedApiKeys
  const encrypted = store.get('keys', {})
  cachedApiKeys = {
    openai: encrypted.openai ? decrypt(encrypted.openai) : '',
    anthropic: encrypted.anthropic ? decrypt(encrypted.anthropic) : '',
    gemini: encrypted.gemini ? decrypt(encrypted.gemini) : '',
  }
  return cachedApiKeys
}

function saveApiKeys(keys: ApiKeys): void {
  const encrypted: ApiKeys = {
    openai: keys.openai ? encrypt(keys.openai) : '',
    anthropic: keys.anthropic ? encrypt(keys.anthropic) : '',
    gemini: keys.gemini ? encrypt(keys.gemini) : '',
  }
  store.set('keys', encrypted)
  cachedApiKeys = { openai: keys.openai ?? '', anthropic: keys.anthropic ?? '', gemini: keys.gemini ?? '' }
}

// ─── Stripe config ────────────────────────────────────────────────────────────

function loadStripeConfig(): StripeConfig {
  return store.get('stripeConfig', { secretKey: '', proPriceId: '' })
}

function saveStripeConfig(config: StripeConfig): void {
  store.set('stripeConfig', config)
}

// ─── Subscription status ──────────────────────────────────────────────────────

function loadSubscription(): SubscriptionStatus {
  return store.get('subscription', {
    tier: 'free',
    customerId: null,
    subscriptionId: null,
    currentPeriodEnd: null,
  })
}

function saveSubscription(sub: SubscriptionStatus): void {
  store.set('subscription', sub)
  // Broadcast to all windows so the UI updates immediately
  broadcastSubscription(sub)
}

function broadcastSubscription(sub: SubscriptionStatus): void {
  for (const win of [mainWindow, widgetWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('velora:subscription-updated', sub)
    }
  }
}

// ─── Stripe helpers ───────────────────────────────────────────────────────────

function makeStripe(): Stripe | null {
  const { secretKey } = loadStripeConfig()
  if (!secretKey) return null
  return new Stripe(secretKey, { apiVersion: '2025-03-31.basil' })
}

async function verifyCheckoutSession(sessionId: string): Promise<void> {
  const stripe = makeStripe()
  if (!stripe) return

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    if (session.payment_status === 'paid' && session.status === 'complete') {
      const tier = (session.metadata?.tier as UserTier) ?? 'pro'
      const sub = session.subscription as Stripe.Subscription | null
      // In Stripe Basil API (2025+), current_period_end moved to items
      const periodEnd = sub?.items?.data?.[0]?.current_period_end
      saveSubscription({
        tier,
        customerId: typeof session.customer === 'string' ? session.customer : (session.customer as Stripe.Customer)?.id ?? null,
        subscriptionId: sub?.id ?? null,
        currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
      })
    }
  } catch (e) {
    console.error('[velora] Stripe verify error:', e)
  }
}

async function verifyActiveSubscription(): Promise<SubscriptionStatus> {
  const stripe = makeStripe()
  const current = loadSubscription()
  if (!stripe || !current.subscriptionId) return current

  try {
    const sub = await stripe.subscriptions.retrieve(current.subscriptionId)

    const periodEnd = sub.items?.data?.[0]?.current_period_end

    if (sub.status === 'active' || sub.status === 'trialing') {
      const tier = (sub.metadata?.tier as UserTier) ?? current.tier
      const updated: SubscriptionStatus = {
        ...current,
        tier,
        currentPeriodEnd: periodEnd ? periodEnd * 1000 : current.currentPeriodEnd,
      }
      saveSubscription(updated)
      return updated
    }

    // Subscription lapsed — downgrade to free
    if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'past_due') {
      const downgraded: SubscriptionStatus = {
        ...current,
        tier: 'free',
        currentPeriodEnd: periodEnd ? periodEnd * 1000 : current.currentPeriodEnd,
      }
      saveSubscription(downgraded)
      return downgraded
    }
  } catch (e) {
    console.error('[velora] Stripe subscription check error:', e)
  }

  return current
}

// ─── Deep link handler ────────────────────────────────────────────────────────

function handleDeepLink(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (url.hostname === 'payment-success') {
      const sessionId = url.searchParams.get('session_id')
      if (sessionId) void verifyCheckoutSession(sessionId)
    }
    if (url.hostname === 'payment-cancel') {
      broadcastSubscription(loadSubscription())
    }
  } catch {
    // ignore malformed deep links
  }
}

// ─── Capture protection ───────────────────────────────────────────────────────

function applyCaptureProtection(enabled: boolean): void {
  mainWindow?.setContentProtection(enabled)
}

// ─── Stealth overlay ──────────────────────────────────────────────────────────
// Hypothetical research: makes widget window invisible to screen recorders by
// combining content protection with the highest system z-order ('screen-saver').
// On macOS, 'screen-saver' level sits above even full-screen apps.
// On Windows, Electron uses HWND_TOPMOST under the hood for always-on-top.

/** Re-apply only the stacking layer (cheap); called on a timer so security tools cannot keep the widget buried. */
function applyWidgetTopmostLayer(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (loadSettings().stealthOverlay) {
    widgetWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  } else {
    widgetWindow.setAlwaysOnTop(true)
  }
}

function startWidgetTopmostPin(): void {
  stopWidgetTopmostPin()
  applyWidgetTopmostLayer()
  widgetTopmostInterval = setInterval(applyWidgetTopmostLayer, WIDGET_TOPMOST_REASSERT_MS)
}

function stopWidgetTopmostPin(): void {
  if (widgetTopmostInterval !== null) {
    clearInterval(widgetTopmostInterval)
    widgetTopmostInterval = null
  }
}

function applyStealthOverlay(enabled: boolean): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  widgetWindow.setContentProtection(enabled)
  if (enabled) {
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    widgetWindow.setVisibleOnAllWorkspaces(false)
  }
  applyWidgetTopmostLayer()
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function resolveAppIconPath(): string | null {
  const candidates = [
    path.join(__dirname, '../public/android-chrome-512x512.png'),
    path.join(__dirname, '../dist/android-chrome-512x512.png'),
    path.join(__dirname, '../public/favicon.png'),
    path.join(__dirname, '../dist/favicon.png'),
    path.join(app.getAppPath(), 'public/android-chrome-512x512.png'),
    path.join(app.getAppPath(), 'dist/android-chrome-512x512.png'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  const iconPath = resolveAppIconPath()
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Velora')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Velora', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: 'Toggle Widget', click: () => {
      if (!widgetWindow) return
      if (widgetWindow.isVisible()) { widgetWindow.hide() }
      else { widgetWindow.show(); widgetWindow.focus() }
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) { mainWindow.hide() } else { mainWindow.show(); mainWindow.focus() }
  })
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function createMainWindow(): void {
  const iconPath = resolveAppIconPath()

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 720,
    minHeight: 520,
    title: 'Velora',
    titleBarStyle: 'hiddenInset',
    transparent: true,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Allow microphone access for Live Audio Checker (Web Speech API + getUserMedia)
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'accessibility-events']
    callback(allowed.includes(permission))
  })
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission)
  })

  if (isDev) { mainWindow.loadURL('http://localhost:5173') }
  else { mainWindow.loadFile(path.join(__dirname, '../dist/index.html')) }

  mainWindow.on('closed', () => { mainWindow = null })
}

function createWidgetWindow(): void {
  widgetWindow = new BrowserWindow({
    width: 680,
    height: 560,
    minWidth: 360,
    minHeight: 300,
    maxWidth: 960,
    maxHeight: 720,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    resizable: true,
    show: false,
    skipTaskbar: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) { widgetWindow.loadURL('http://localhost:5173/#widget') }
  else { widgetWindow.loadURL(`file://${path.join(__dirname, '../dist/index.html')}#widget`) }

  widgetWindow.on('closed', () => {
    stopWidgetTopmostPin()
    widgetWindow = null
  })

  startWidgetTopmostPin()

  // Only hide on blur if not currently being resized
  let isResizing = false
  widgetWindow.on('will-resize', () => { isResizing = true })
  widgetWindow.on('resize', () => { setTimeout(() => { isResizing = false }, 200) })
  widgetWindow.on('blur', () => {
    if (!isResizing) widgetWindow?.hide()
  })
}

function createWindow(): void {
  createMainWindow()
  createWidgetWindow()
  const settings = loadSettings()
  applyCaptureProtection(settings.captureProtectionMode)
  if (settings.stealthOverlay) applyStealthOverlay(true)
  const iconPath = resolveAppIconPath()
  if (process.platform === 'darwin' && iconPath) app.dock?.setIcon(iconPath)
}

// ─── Shortcuts ────────────────────────────────────────────────────────────────

let currentWidgetShortcut = 'Alt+Space'
let currentLiveHelperShortcut = 'CommandOrControl+Shift+H'

function registerWidgetShortcut(shortcut: string): void {
  if (currentWidgetShortcut) globalShortcut.unregister(currentWidgetShortcut)
  const ok = globalShortcut.register(shortcut, () => {
    if (!widgetWindow) return
    if (widgetWindow.isVisible()) { widgetWindow.hide() }
    else { widgetWindow.show(); widgetWindow.focus() }
  })
  if (ok) currentWidgetShortcut = shortcut
}

function registerLiveHelperShortcut(shortcut: string): void {
  if (currentLiveHelperShortcut) globalShortcut.unregister(currentLiveHelperShortcut)
  const ok = globalShortcut.register(shortcut, async () => {
    // Show widget and send screen capture — renderer gates by tier
    if (widgetWindow && !widgetWindow.isVisible()) {
      widgetWindow.show()
      widgetWindow.focus()
    }
    const target = widgetWindow ?? mainWindow
    if (!target) return
    try {
      const dataUrl = await captureScreen()
      target.webContents.send('velora:shortcut', { action: 'live-helper', imageDataUrl: dataUrl })
    } catch (e) { console.error('[velora] Live Helper capture error:', e) }
  })
  if (ok) currentLiveHelperShortcut = shortcut
}

function registerShortcuts(): void {
  const settings = loadSettings()
  registerWidgetShortcut(settings.widgetShortcut || 'Alt+Space')
  registerLiveHelperShortcut(settings.liveHelperShortcut || 'CommandOrControl+Shift+H')

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) { mainWindow.hide() } else { mainWindow.show(); mainWindow.focus() }
  })

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    const target = widgetWindow?.isVisible() ? widgetWindow : mainWindow
    if (!target) return
    if (!target.isVisible()) { target.show(); target.focus() }
    target.webContents.send('velora:shortcut', { action: 'capture' })
  })

  globalShortcut.register('CommandOrControl+Shift+E', () => {
    const target = widgetWindow?.isVisible() ? widgetWindow : mainWindow
    if (!target) return
    if (!target.isVisible()) { target.show(); target.focus() }
    target.webContents.send('velora:shortcut', { action: 'explain' })
  })

  globalShortcut.register('CommandOrControl+Shift+A', async () => {
    const s = loadSettings()
    if (!s.screenContextFeature) return
    const target = widgetWindow?.isVisible() ? widgetWindow : mainWindow
    if (!target) return
    if (!target.isVisible()) { target.show(); target.focus() }
    try {
      const dataUrl = await captureScreen()
      target.webContents.send('velora:shortcut', { action: 'screen-context', imageDataUrl: dataUrl })
    } catch (e) { console.error(e) }
  })
}

// ─── Screen capture ───────────────────────────────────────────────────────────

async function captureScreen(): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false,
  })
  if (!sources.length) throw new Error('No screen source found')
  return sources[0].thumbnail.toDataURL()
}

// ─── AI API calls ─────────────────────────────────────────────────────────────

async function callOpenAI(apiKey: string, modelId: string, prompt: string, imageDataUrl?: string): Promise<string> {
  // Reasoning models (o-series) use a different API shape
  const isReasoning = modelId.startsWith('o1') || modelId.startsWith('o3')
  const body = isReasoning
    ? {
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
      }
    : {
        model: modelId,
        messages: [{
          role: 'user',
          content: imageDataUrl
            ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }]
            : prompt,
        }],
        temperature: 0.2,
      }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`OpenAI ${modelId} failed (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? 'No response from OpenAI.'
}

async function callAnthropic(apiKey: string, modelId: string, prompt: string, imageDataUrl?: string): Promise<string> {
  const content = imageDataUrl
    ? [{ type: 'text', text: prompt }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageDataUrl.split(',')[1] } }]
    : [{ type: 'text', text: prompt }]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelId, max_tokens: 4096, messages: [{ role: 'user', content }] }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic ${modelId} failed (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { content?: { text?: string }[] }
  return data.content?.[0]?.text ?? 'No response from Claude.'
}

async function callGemini(apiKey: string, modelId: string, prompt: string, imageDataUrl?: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`
  const parts = imageDataUrl
    ? [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: imageDataUrl.split(',')[1] } }]
    : [{ text: prompt }]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Gemini ${modelId} failed (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from Gemini.'
}

async function callOllama(modelId: string, prompt: string): Promise<string> {
  const ollamaModel = modelId.replace('ollama/', '')
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`Ollama ${ollamaModel} failed (${res.status}): ${err.slice(0, 200)}`)
    }
    const data = await res.json() as { message?: { content?: string } }
    return data.message?.content ?? 'No response from Ollama.'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Failed to fetch')) {
      return [
        `Ollama is not running or the model "${ollamaModel}" is not installed.`,
        '',
        'To get started:',
        '  1. Install Ollama at https://ollama.com',
        `  2. Run: ollama pull ${ollamaModel}`,
        '  3. Ollama starts automatically on macOS/Windows after install.',
      ].join('\n')
    }
    throw e
  }
}

async function checkOllama(): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, models: [] }
    const data = await res.json() as { models?: { name: string }[] }
    return { running: true, models: (data.models ?? []).map((m) => m.name) }
  } catch {
    return { running: false, models: [] }
  }
}

async function callDeepSeek(modelId: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BUILTIN_DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`DeepSeek ${modelId} failed (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? 'No response from DeepSeek.'
}

function makeFallbackResponse(label: string, prompt: string): string {
  return [
    `Velora is running in demo mode — no API key set for ${label}.`,
    'Add your key in Settings → API Keys to connect a real model.',
    '',
    'Prompt received:',
    prompt.slice(0, 400),
  ].join('\n')
}

async function runAIRequest(payload: AIRequest): Promise<string> {
  const keys = loadApiKeys()
  const modelId = resolveModelId(payload.model)
  const { prompt, imageDataUrl } = payload

  if (modelId.startsWith('ollama/')) {
    return callOllama(modelId, prompt)
  }
  if (modelId.startsWith('deepseek')) {
    if (!BUILTIN_DEEPSEEK_KEY) return makeFallbackResponse('DeepSeek', prompt)
    return callDeepSeek(modelId, prompt)
  }
  if (modelId.startsWith('gemini')) {
    const geminiKey = keys.gemini || BUILTIN_GEMINI_KEY
    if (!geminiKey) return makeFallbackResponse('Google Gemini', prompt)
    return callGemini(geminiKey, modelId, prompt, imageDataUrl)
  }
  if (modelId.startsWith('gpt') || modelId.startsWith('o3') || modelId.startsWith('o1') || modelId.startsWith('o4')) {
    if (!keys.openai) return makeFallbackResponse('OpenAI', prompt)
    return callOpenAI(keys.openai, modelId, prompt, imageDataUrl)
  }
  if (modelId.startsWith('claude')) {
    if (!keys.anthropic) return makeFallbackResponse('Anthropic', prompt)
    return callAnthropic(keys.anthropic, modelId, prompt, imageDataUrl)
  }
  return `Unknown model: ${modelId}. Please select a valid model in Velora.`
}

function settledToText(result: PromiseSettledResult<string>, label: string): string {
  if (result.status === 'fulfilled') return result.value
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
  return `${label} error: ${reason}`
}

async function runMultiAIRequest(payload: MultiAIRequest): Promise<MultiAIResponse> {
  const [gpt, claude, gemini] = await Promise.allSettled([
    runAIRequest({ model: 'gpt-4o-mini',             prompt: payload.prompt, imageDataUrl: payload.imageDataUrl }),
    runAIRequest({ model: 'claude-3-5-sonnet-latest', prompt: payload.prompt, imageDataUrl: payload.imageDataUrl }),
    runAIRequest({ model: 'gemini-2.5-flash',         prompt: payload.prompt, imageDataUrl: payload.imageDataUrl }),
  ])
  return {
    gpt:    settledToText(gpt,    'OpenAI'),
    claude: settledToText(claude, 'Anthropic'),
    gemini: settledToText(gemini, 'Google'),
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Register deep link protocol handler (must be before app.whenReady)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
}

// macOS deep link via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows/Linux deep link via second-instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLinkUrl = commandLine.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`))
    if (deepLinkUrl) handleDeepLink(deepLinkUrl)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerShortcuts()
  setupAutoUpdater()

  // On startup, verify subscription status in the background
  setTimeout(() => { void verifyActiveSubscription() }, 3000)

  // ─── IPC: Window state ────────────────────────────────────────────────────

  ipcMain.handle('velora:toggle-panel', () => {
    if (widgetWindow) {
      if (widgetWindow.isVisible()) { widgetWindow.hide(); return { isExpanded: false } }
      else { widgetWindow.show(); widgetWindow.focus(); return { isExpanded: true } }
    }
    return { isExpanded: true }
  })

  ipcMain.handle('velora:get-window-state', () => ({
    isExpanded: widgetWindow ? widgetWindow.isVisible() : true,
  }))

  // ─── IPC: Screen capture ──────────────────────────────────────────────────

  ipcMain.handle('velora:capture-screen', async () => captureScreen())

  // ─── IPC: AI ──────────────────────────────────────────────────────────────

  ipcMain.handle('velora:run-ai', async (_, payload: AIRequest) => runAIRequest(payload))
  ipcMain.handle('velora:run-multi-ai', async (_, payload: MultiAIRequest) => runMultiAIRequest(payload))
  ipcMain.handle('velora:check-ollama', () => checkOllama())

  // ─── IPC: App settings ────────────────────────────────────────────────────

  ipcMain.handle('velora:get-settings', () => loadSettings())

  ipcMain.handle('velora:set-share-safety-mode', (_, enabled: boolean) => {
    const next = { ...loadSettings(), shareSafetyMode: enabled }
    saveSettings(next)
    if (enabled && mainWindow) mainWindow.hide()
    return next
  })

  ipcMain.handle('velora:set-widget-shortcut', (_, shortcut: string) => {
    const next = { ...loadSettings(), widgetShortcut: shortcut }
    saveSettings(next)
    registerWidgetShortcut(shortcut)
    return next
  })

  ipcMain.handle('velora:set-capture-protection-mode', (_, enabled: boolean) => {
    const next = { ...loadSettings(), captureProtectionMode: enabled }
    saveSettings(next)
    applyCaptureProtection(enabled)
    return next
  })

  ipcMain.handle('velora:set-screen-context-feature', (_, enabled: boolean) => {
    const next = { ...loadSettings(), screenContextFeature: enabled }
    saveSettings(next)
    return next
  })

  ipcMain.handle('velora:set-live-helper-shortcut', (_, shortcut: string) => {
    const next = { ...loadSettings(), liveHelperShortcut: shortcut }
    saveSettings(next)
    registerLiveHelperShortcut(shortcut)
    return next
  })

  // ─── IPC: API keys ────────────────────────────────────────────────────────

  ipcMain.handle('velora:get-api-key-status', () => {
    const keys = loadApiKeys()
    return { openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic), gemini: Boolean(keys.gemini) }
  })

  ipcMain.handle('velora:save-api-keys', (_, keys: ApiKeys) => {
    saveApiKeys(keys)
    return { openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic), gemini: Boolean(keys.gemini) }
  })

  // ─── IPC: Stripe / Subscription ───────────────────────────────────────────

  ipcMain.handle('velora:get-subscription', () => loadSubscription())

  ipcMain.handle('velora:configure-stripe', (_, config: StripeConfig) => {
    saveStripeConfig(config)
    return { ok: true }
  })

  ipcMain.handle('velora:create-checkout', async () => {
    const stripe = makeStripe()
    if (!stripe) return { ok: false, error: 'Stripe not configured. Add your secret key in Settings.' }

    const { proPriceId } = loadStripeConfig()
    if (!proPriceId) return { ok: false, error: 'No Pro price ID configured.' }

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: proPriceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${DEEP_LINK_PROTOCOL}://payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${DEEP_LINK_PROTOCOL}://payment-cancel`,
        metadata: { tier: 'pro' },
      })
      if (session.url) {
        void shell.openExternal(session.url)
        return { ok: true, url: session.url }
      }
      return { ok: false, error: 'Checkout session URL not available.' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Stripe error'
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('velora:verify-subscription', async () => {
    const status = await verifyActiveSubscription()
    return status
  })

  ipcMain.handle('velora:open-customer-portal', async () => {
    const stripe = makeStripe()
    if (!stripe) return { ok: false, error: 'Stripe not configured.' }

    const { customerId } = loadSubscription()
    if (!customerId) return { ok: false, error: 'No customer found. Please purchase a plan first.' }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${DEEP_LINK_PROTOCOL}://portal-return`,
      })
      void shell.openExternal(session.url)
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('velora:set-stealth-overlay', (_, enabled: boolean) => {
    const next = { ...loadSettings(), stealthOverlay: enabled }
    saveSettings(next)
    applyStealthOverlay(enabled)
    return next
  })

  // ─── Auto-updater controls ────────────────────────────────────────────────
  ipcMain.handle('velora:check-for-updates', () => {
    if (isDev) return { status: 'dev-mode' }
    autoUpdater.checkForUpdatesAndNotify().catch(() => null)
    return { status: 'checking' }
  })

  ipcMain.handle('velora:install-update', () => {
    autoUpdater.quitAndInstall()
  })

  // ─── Microphone permission (macOS system-level) ───────────────────────────
  ipcMain.handle('velora:request-mic-permission', async () => {
    if (process.platform === 'darwin') {
      const { systemPreferences } = await import('electron')
      try {
        const status = await systemPreferences.askForMediaAccess('microphone')
        return status
      } catch {
        return false
      }
    }
    return true
  })

  // ─── Whisper audio transcription (uses openai key if available) ───────────
  ipcMain.handle('velora:transcribe-audio', async (_, base64Audio: string) => {
    const keys = loadApiKeys()
    if (!keys.openai) return { ok: false, error: 'No OpenAI API key set — add one in Settings.', transcript: '' }
    try {
      const audioBuffer = Buffer.from(base64Audio, 'base64')
      // Native FormData + Blob available in Node 18+ (used by Electron)
      const blob = new Blob([audioBuffer], { type: 'audio/webm' })
      const form = new FormData()
      form.append('file', blob as unknown as File, 'audio.webm')
      form.append('model', 'whisper-1')
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${keys.openai}` },
        body: form as unknown as BodyInit,
      })
      const data = await res.json() as { text?: string; error?: { message: string } }
      if (!res.ok) return { ok: false, error: data.error?.message ?? 'Whisper error', transcript: '' }
      return { ok: true, transcript: data.text ?? '' }
    } catch (err) {
      return { ok: false, error: String(err), transcript: '' }
    }
  })

  // ─── App activate ─────────────────────────────────────────────────────────

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopWidgetTopmostPin()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
