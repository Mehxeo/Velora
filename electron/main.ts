import {
  app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain,
  Menu, nativeImage, shell, Tray, safeStorage,
} from 'electron'
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { config as loadEnv } from 'dotenv'
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
  deepseek?: string
}

// ─── Optional built-in keys: bundle file (release) or VELORA_* from .env (dev) / OS env ─

const _builtinFile = readBuiltinKeysFromBundle()
const BUILTIN_DEEPSEEK_KEY =
  _builtinFile.deepseek || (process.env.VELORA_BUILTIN_DEEPSEEK_KEY ?? '').trim()
const BUILTIN_GEMINI_KEY =
  _builtinFile.gemini || (process.env.VELORA_BUILTIN_GEMINI_KEY ?? '').trim()

// ─── Constants ────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/** Windows reserves Alt+Space for the system window menu — avoid as default / migrate stored value. */
function defaultWidgetShortcut(): string {
  return isWin ? 'Control+Shift+Space' : 'Alt+Space'
}

function normalizeWidgetShortcutForOs(shortcut: string): string {
  const s = shortcut.trim()
  if (isWin && /^alt\s*\+\s*space$/i.test(s)) return defaultWidgetShortcut()
  return shortcut
}

// ─── Electron Store ───────────────────────────────────────────────────────────

const store = new Store<{
  settings: AppSettings
  keys: ApiKeys
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
  const defaults: AppSettings = {
    shareSafetyMode: false,
    captureProtectionMode: false,
    widgetShortcut: defaultWidgetShortcut(),
    screenContextFeature: false,
    liveHelperShortcut: 'CommandOrControl+Shift+H',
    stealthOverlay: false,
  }
  const raw = store.get('settings') as Partial<AppSettings> | undefined
  const merged: AppSettings = { ...defaults, ...(raw ?? {}) }
  if (isWin && /^alt\s*\+\s*space$/i.test((merged.widgetShortcut ?? '').trim())) {
    merged.widgetShortcut = 'Control+Shift+Space'
    store.set('settings', merged)
  }
  cachedSettings = merged
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
    deepseek: encrypted.deepseek ? decrypt(encrypted.deepseek) : '',
  }
  return cachedApiKeys
}

function saveApiKeys(keys: ApiKeys): void {
  // Merge with existing keys — only overwrite a field if a new non-empty value is provided
  const existing = loadApiKeys()
  const merged: ApiKeys = {
    openai: keys.openai?.trim() ? keys.openai.trim() : existing.openai,
    anthropic: keys.anthropic?.trim() ? keys.anthropic.trim() : existing.anthropic,
    gemini: keys.gemini?.trim() ? keys.gemini.trim() : existing.gemini,
    deepseek: keys.deepseek?.trim() ? keys.deepseek.trim() : existing.deepseek,
  }
  const encrypted: ApiKeys = {
    openai: merged.openai ? encrypt(merged.openai) : '',
    anthropic: merged.anthropic ? encrypt(merged.anthropic) : '',
    gemini: merged.gemini ? encrypt(merged.gemini) : '',
    deepseek: merged.deepseek ? encrypt(merged.deepseek) : '',
  }
  store.set('keys', encrypted)
  cachedApiKeys = merged
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
  // 'screen-saver' always-on-top level is macOS-only; Windows uses default topmost.
  if (loadSettings().stealthOverlay && isMac) {
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
  const trayIconSize = isWin ? 16 : 18
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: trayIconSize, height: trayIconSize })
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

  const macChrome: Electron.BrowserWindowConstructorOptions = {
    titleBarStyle: 'hiddenInset',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
  }
  const winChrome: Electron.BrowserWindowConstructorOptions = {
    frame: true,
    transparent: false,
    backgroundColor: '#09090b',
  }

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 720,
    minHeight: 520,
    title: 'Velora',
    ...(isMac ? macChrome : winChrome),
    hasShadow: true,
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
  const macWidgetChrome: Electron.BrowserWindowConstructorOptions = {
    vibrancy: 'under-window',
    visualEffectState: 'active',
    roundedCorners: true,
  }

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
    backgroundColor: '#00000000',
    ...(isMac ? macWidgetChrome : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) { widgetWindow.loadURL('http://localhost:5173/#widget') }
  else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'widget' })
  }

  widgetWindow.on('closed', () => {
    stopWidgetTopmostPin()
    widgetWindow = null
  })

  startWidgetTopmostPin()

  // Only hide on blur if not currently being resized
  let isResizing = false
  let blurHideTimer: ReturnType<typeof setTimeout> | null = null
  const clearBlurHideTimer = (): void => {
    if (blurHideTimer !== null) {
      clearTimeout(blurHideTimer)
      blurHideTimer = null
    }
  }
  widgetWindow.on('will-resize', () => { isResizing = true })
  widgetWindow.on('resize', () => { setTimeout(() => { isResizing = false }, 200) })
  widgetWindow.on('focus', () => { clearBlurHideTimer() })
  widgetWindow.on('blur', () => {
    if (isResizing) return
    clearBlurHideTimer()
    // Windows often fires blur/focus races when showing the widget; debounce hide.
    const delay = isWin ? 280 : 120
    blurHideTimer = setTimeout(() => {
      blurHideTimer = null
      if (!widgetWindow || widgetWindow.isDestroyed()) return
      if (widgetWindow.isFocused()) return
      widgetWindow.hide()
    }, delay)
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

let registeredWidgetShortcut = ''
let registeredLiveHelperShortcut = ''

function onWidgetShortcut(): void {
  if (!widgetWindow) return
  if (widgetWindow.isVisible()) { widgetWindow.hide() }
  else { widgetWindow.show(); widgetWindow.focus() }
}

async function onLiveHelperShortcut(): Promise<void> {
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
}

function registerWidgetShortcut(shortcut: string): void {
  const previous = registeredWidgetShortcut
  if (previous) globalShortcut.unregister(previous)
  const ok = globalShortcut.register(shortcut, onWidgetShortcut)
  if (ok) {
    registeredWidgetShortcut = shortcut
    return
  }
  console.error('[velora] Failed to register widget shortcut:', shortcut)
  if (previous && globalShortcut.register(previous, onWidgetShortcut)) {
    registeredWidgetShortcut = previous
    return
  }
  const fb = defaultWidgetShortcut()
  if (globalShortcut.register(fb, onWidgetShortcut)) {
    registeredWidgetShortcut = fb
    saveSettings({ ...loadSettings(), widgetShortcut: fb })
    console.warn('[velora] Fell back to widget shortcut:', fb)
    return
  }
  registeredWidgetShortcut = ''
}

function registerLiveHelperShortcut(shortcut: string): void {
  const previous = registeredLiveHelperShortcut
  const fallback = 'CommandOrControl+Shift+H'
  if (previous) globalShortcut.unregister(previous)
  const ok = globalShortcut.register(shortcut, () => { void onLiveHelperShortcut() })
  if (ok) {
    registeredLiveHelperShortcut = shortcut
    return
  }
  console.error('[velora] Failed to register live helper shortcut:', shortcut)
  if (previous && globalShortcut.register(previous, () => { void onLiveHelperShortcut() })) {
    registeredLiveHelperShortcut = previous
    return
  }
  if (shortcut !== fallback && globalShortcut.register(fallback, () => { void onLiveHelperShortcut() })) {
    registeredLiveHelperShortcut = fallback
    saveSettings({ ...loadSettings(), liveHelperShortcut: fallback })
    console.warn('[velora] Fell back to live helper shortcut:', fallback)
    return
  }
  registeredLiveHelperShortcut = ''
}

function registerShortcuts(): void {
  const settings = loadSettings()
  registerWidgetShortcut(settings.widgetShortcut || defaultWidgetShortcut())
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
  if (!sources.length) {
    const hint = isWin
      ? ' Allow Velora in Settings → Privacy → Screen recording (or restart the app after enabling).'
      : ''
    throw new Error(`No screen source found.${hint}`)
  }
  const entire = sources.find((s) => /entire|whole\s*screen|full\s*desktop/i.test(s.name))
    ?? sources.find((s) => /^screen\s*1$/i.test(s.name.trim()))
    ?? sources.find((s) => /^display\s*1$/i.test(s.name.trim()))
    ?? sources[0]
  return entire.thumbnail.toDataURL()
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

async function callDeepSeek(apiKey: string, modelId: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    const deepseekKey = keys.deepseek || BUILTIN_DEEPSEEK_KEY
    if (!deepseekKey) return makeFallbackResponse('DeepSeek', prompt)
    return callDeepSeek(deepseekKey, modelId, prompt)
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

// Single instance lock — focus existing window if launched again
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
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

  // ─── IPC: Window state ────────────────────────────────────────────────────

  ipcMain.handle('velora:toggle-panel', () => {
    if (widgetWindow) {
      if (widgetWindow.isVisible()) { widgetWindow.hide(); return { isExpanded: false } }
      else { widgetWindow.show(); widgetWindow.focus(); return { isExpanded: true } }
    }
    return { isExpanded: true }
  })

  ipcMain.handle('velora:quit-app', () => {
    app.quit()
  })

  /** Hide the floating widget only (main window / app keep running). */
  ipcMain.handle('velora:hide-widget', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.hide()
    }
    return { isExpanded: false }
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
    const normalized = normalizeWidgetShortcutForOs(shortcut)
    const next = { ...loadSettings(), widgetShortcut: normalized }
    saveSettings(next)
    registerWidgetShortcut(normalized)
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
    return {
      openai: Boolean(keys.openai),
      anthropic: Boolean(keys.anthropic),
      gemini: Boolean(keys.gemini),
      deepseek: Boolean(keys.deepseek) || Boolean(BUILTIN_DEEPSEEK_KEY),
    }
  })

  ipcMain.handle('velora:save-api-keys', (_, keys: ApiKeys) => {
    saveApiKeys(keys)
    const saved = loadApiKeys()
    return {
      openai: Boolean(saved.openai),
      anthropic: Boolean(saved.anthropic),
      gemini: Boolean(saved.gemini),
      deepseek: Boolean(saved.deepseek) || Boolean(BUILTIN_DEEPSEEK_KEY),
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

  ipcMain.handle('velora:get-app-meta', () => ({
    version: app.getVersion(),
    releasesUrl: 'https://github.com/Mehxeo/velora/releases/latest',
    downloadPageUrl: 'https://mehxeo.github.io/velora/',
    homepage: 'https://veloraapp.xyz',
  }))

  ipcMain.handle('velora:open-external', async (_, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false as const }
      await shell.openExternal(url)
      return { ok: true as const }
    } catch {
      return { ok: false as const }
    }
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
