import { useCallback, useEffect, useMemo, useState, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { buildPrompt, quickActions, type QuickActionId } from './lib/prompts'
import {
  getModelById, getModelsByProvider, PROVIDERS,
  PROVIDER_LABELS, PROVIDER_COLORS, BADGE_COLORS, PROVIDER_FREE_NOTE,
  PROVIDER_KEY_LINKS, type ModelProvider,
} from './lib/models'
import { hasSupabaseEnv, supabase, shareConversation, fetchSharedConversation } from './lib/supabase'
import { LiveAudioPanel } from './components/LiveAudioPanel'
import { useVeloraStore } from './store/useVeloraStore'
import {
  formatGlobalShortcutDisplay,
  normalizeShortcutForDisplay,
  normalizeShortcutForStorage,
  widgetShortcutPlaceholder,
} from './lib/keyboardLabels'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

// ─── Constants kept outside component to avoid re-creation on every render ────

const PROFANITY_WORDS = ['badword1', 'badword2']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mdComponents: Record<string, (props: any) => React.ReactElement> = {
  code({ children, className, node: _n, ref: _r, ...rest }: {
    children?: React.ReactNode
    className?: string
    node?: unknown
    ref?: unknown
    [key: string]: unknown
  }) {
    const match = /language-(\w+)/.exec(className ?? '')
    if (match) {
      return (
        <SyntaxHighlighter PreTag="div" language={match[1]} style={vscDarkPlus}>
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      )
    }
    return <code className={className} {...rest}>{children}</code>
  },
}

const appRegionDrag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const appRegionNoDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** Public download URLs (mirrored by getAppMeta in Electron). */
const PUBLIC_DOWNLOAD = {
  releases: 'https://github.com/Mehxeo/velora/releases/latest',
  downloadPage: 'https://mehxeo.github.io/velora/',
  homepage: 'https://veloraapp.xyz',
} as const

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthMode = 'signin' | 'signup'
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  return (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition ?? null
}

function containsProfanity(text: string) {
  const lower = text.toLowerCase()
  return PROFANITY_WORDS.some((w) => lower.includes(w))
}

// ─── Memoized message bubble ──────────────────────────────────────────────────

type MsgType = {
  id: string; role: 'user' | 'assistant'; content: string; model?: string
  createdAt: number; latencyMs?: number
  attachments?: { name: string; type: string; url: string }[]
}

const MessageBubble = memo(function MessageBubble({
  message,
  index,
  conversationId,
  onBookmark,
}: {
  message: MsgType
  index: number
  conversationId: string
  onBookmark: (conversationId: string, messageId: string, excerpt: string) => void
}) {
  const isUser = message.role === 'user'
  return (
    <article
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
      className={`velora-message rounded-2xl p-4 leading-relaxed ${
        isUser ? 'ml-auto w-fit max-w-[82%] velora-message-user' : 'w-full max-w-3xl mx-auto velora-message-assistant'
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full ${
          isUser
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25'
            : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25'
        }`}>
          {isUser ? 'You' : (message.model ?? 'Assistant')}
        </span>
        <div className="flex items-center gap-2">
          {message.latencyMs ? (
            <span className="text-[11px] rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5" style={{ color: 'var(--text-muted)' }}>{message.latencyMs}ms</span>
          ) : null}
          {!isUser && (
            <button
              className="text-[11px] rounded-full px-2.5 py-0.5 bg-black/5 dark:bg-white/5 hover:bg-blue-500/15 hover:text-blue-400 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => onBookmark(conversationId, message.id, message.content.slice(0, 120))}
            >
              Bookmark
            </button>
          )}
        </div>
      </div>
      <div className="prose prose-invert max-w-none text-[15px] prose-p:leading-relaxed prose-pre:p-0 prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.attachments.map((att) => (
            <span key={att.name} className="velora-chip rounded-full px-2.5 py-0.5 text-[11px]">{att.name}</span>
          ))}
        </div>
      )}
    </article>
  )
})

// ─── SVG icons as constants ───────────────────────────────────────────────────

const IconAttach = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

const IconCapture = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

const IconMic = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
)

const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12H19M19 12L12 5M19 12L12 19" />
  </svg>
)

const IconShare = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

const IconDownload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 1L13 13M13 1L1 13" />
  </svg>
)

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

const IconGhost = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
  </svg>
)

const IconChevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5L5 6.5L8 3.5" />
  </svg>
)

const IconExternalLink = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

// ─── Animated modal wrapper ───────────────────────────────────────────────────
// Handles: enter/exit animations, WebkitAppRegion: 'no-drag' override,
// and backdrop click-to-close. This prevents Electron's drag region from
// intercepting pointer events inside open modals.

function AnimatedModal({
  isOpen,
  onClose,
  zIndex = 100,
  children,
}: {
  isOpen: boolean
  onClose: () => void
  zIndex?: number
  children: React.ReactNode
}) {
  const hasOpenedRef = useRef(false)
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true
      setMounted(true)
      setClosing(false)
    } else if (hasOpenedRef.current && mounted) {
      setClosing(true)
      const t = window.setTimeout(() => {
        setMounted(false)
        setClosing(false)
      }, 215)
      return () => window.clearTimeout(t)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null

  return (
    <div
      className={`velora-modal-overlay ${closing ? 'velora-modal-overlay--out' : 'velora-modal-overlay--in'}`}
      style={{ zIndex, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>
  )
}

// ─── Model picker ─────────────────────────────────────────────────────────────

type ApiKeyStatus = { openai: boolean; anthropic: boolean; gemini: boolean; deepseek: boolean; ollama: boolean }

function ModelBadgePill({ badge }: { badge: string }) {
  const colors = BADGE_COLORS[badge as keyof typeof BADGE_COLORS]
  if (!colors) return null
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black border leading-none"
      style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}>
      {badge}
    </span>
  )
}

function ModelPicker({
  value,
  onChange,
  apiKeyStatus,
  compact = false,
}: {
  value: string
  onChange: (model: string) => void
  apiKeyStatus: ApiKeyStatus
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const current = getModelById(value)
  const lastProvider = PROVIDERS[PROVIDERS.length - 1]
  const isDark = document.documentElement.classList.contains('dark')

  // Position dropdown using fixed coords from trigger rect
  function openDropdown() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function syncPosition() {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
    function handleClose(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    document.addEventListener('mousedown', handleClose)
    return () => {
      window.removeEventListener('resize', syncPosition)
      document.removeEventListener('mousedown', handleClose)
    }
  }, [open])

  function hasKey(provider: ModelProvider): boolean {
    if (provider === 'deepseek') return true
    if (provider === 'google') return true
    if (provider === 'ollama') return true
    if (provider === 'openai') return Boolean(apiKeyStatus.openai)
    if (provider === 'anthropic') return Boolean(apiKeyStatus.anthropic)
    return false
  }

  const displayName = current?.name ?? value

  return (
    <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDropdown()}
        className={`velora-pill flex items-center gap-1.5 rounded-full font-medium outline-none cursor-pointer transition-all hover:opacity-80 ${
          compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
        }`}
      >
        {current && (
          <span className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: PROVIDER_COLORS[current.provider].from }} />
        )}
        <span className="font-semibold truncate max-w-[100px]">{displayName}</span>
        {current?.badge && !compact && <ModelBadgePill badge={current.badge} />}
        <IconChevron />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className={`velora-model-dropdown${isDark ? ' dark' : ''}`}
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="velora-model-dropdown-scroll custom-scrollbar">
            {PROVIDERS.map((provider) => {
              const models = getModelsByProvider(provider)
              const providerHasKey = hasKey(provider)
              const freeNote = PROVIDER_FREE_NOTE[provider]
              const keyLink = PROVIDER_KEY_LINKS[provider]
              const colors = PROVIDER_COLORS[provider]

              return (
                <div key={provider}>
                  {/* Provider header */}
                  <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5">
                    <span className="text-[11px] font-black uppercase tracking-widest"
                      style={{ background: `linear-gradient(130deg, ${colors.from}, ${colors.to})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                      {PROVIDER_LABELS[provider]}
                    </span>
                    {/* Built-in note (no external link) */}
                    {freeNote && !keyLink && (
                      <span className="text-[10px] font-semibold" style={{ color: colors.from }}>
                        ✓ Built-in
                      </span>
                    )}
                    {/* Free with optional external key */}
                    {freeNote && keyLink && (
                      <a href={keyLink} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[10px] font-semibold hover:opacity-70 transition-opacity"
                        style={{ color: colors.from }}>
                        {providerHasKey ? '✓ Key set' : 'Get free key'} <IconExternalLink />
                      </a>
                    )}
                    {/* Paid provider — no key set */}
                    {!freeNote && !providerHasKey && keyLink && (
                      <a href={keyLink} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[10px] font-semibold hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--text-muted)' }}>
                        Add key <IconExternalLink />
                      </a>
                    )}
                    {/* Paid provider — key saved */}
                    {!freeNote && providerHasKey && (
                      <span className="text-[10px] font-semibold" style={{ color: colors.from }}>✓ Key set</span>
                    )}
                  </div>

                  {/* Model rows */}
                  {models.map((model) => {
                    const available = providerHasKey
                    const isSelected = value === model.id
                    const classes = [
                      'velora-model-dropdown-item',
                      isSelected ? 'selected' : '',
                      !available ? 'unavailable' : '',
                    ].filter(Boolean).join(' ')

                    return (
                      <button
                        key={model.id}
                        className={classes}
                        style={isSelected ? { borderLeftColor: colors.from } : undefined}
                        onClick={() => { if (available) { onChange(model.id); setOpen(false) } }}
                        title={!available ? 'Add an API key in Settings to use this model' : undefined}
                      >
                        <div className="mt-[3px] h-2 w-2 rounded-full shrink-0"
                          style={{ background: isSelected ? colors.from : available ? colors.from + '66' : 'var(--text-muted)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[13px] font-semibold leading-tight">{model.name}</span>
                            <ModelBadgePill badge={model.badge} />
                            <span className="text-[10px] font-medium ml-auto shrink-0 opacity-70">{model.context}</span>
                          </div>
                          <p className={`text-[11px] leading-snug ${available ? 'opacity-80' : 'opacity-70'}`}>
                            {!available ? '⚠ Requires API key in Settings' : model.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}

                  {provider !== lastProvider && <div className="velora-model-dropdown-divider" />}
                </div>
              )
            })}
          </div>

          <div className="velora-model-dropdown-footer">
            DeepSeek & Gemini are free & built-in. OpenAI/Anthropic need a key in{' '}
            <button className="underline font-semibold hover:opacity-70"
              onClick={() => setOpen(false)}
              style={{ color: 'var(--accent-cyan)' }}>
              Settings
            </button>.
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const {
    activeTab, selectedModel, selectedAction, shareSafetyMode, isLoading,
    imageDataUrl, auth, settings, topics, folders, bookmarks, memoryItems,
    personalization, conversations, activeConversationId,
    setActiveTab, setSelectedModel, setSelectedAction, setShareSafetyMode,
    setExpanded, setLoading, setImageDataUrl, setAuthState, setSaveLocal,
    setSaveCloud, setTheme, setPersonalization, addMemoryItem,
    toggleMemoryPin, removeMemoryItem, createTopic, deleteTopic, addTopicSource,
    removeTopicSource, getVisibleTopicSources, createFolder, updateFolder, deleteFolder,
    assignConversationToFolder, addBookmark, removeBookmark, createConversation, deleteConversation,
    setActiveConversation, addMessageToConversation, getCloudSnapshot,
    hydrateFromCloudSnapshot, clearHistory,
  } = useVeloraStore()

  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKeys, setApiKeys] = useState({ openai: '', anthropic: '', gemini: '', deepseek: '' })
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ openai: false, anthropic: false, gemini: true, deepseek: true, ollama: true })
  const [rawApiKeyStatus, setRawApiKeyStatus] = useState({ openai: false, anthropic: false, gemini: false, deepseek: false })
  const [chatSearchText, setChatSearchText] = useState('')
  const [topicSearchText, setTopicSearchText] = useState('')
  const [folderSearchText, setFolderSearchText] = useState('')
  const [bookmarkSearchText, setBookmarkSearchText] = useState('')
  const [topicNameInput, setTopicNameInput] = useState('')
  const [topicDescriptionInput, setTopicDescriptionInput] = useState('')
  const [topicSourceLabel, setTopicSourceLabel] = useState('')
  const [topicSourceContent, setTopicSourceContent] = useState('')
  const [topicSourceType, setTopicSourceType] = useState<'image' | 'text' | 'url'>('image')
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [folderNameInput, setFolderNameInput] = useState('')
  const [folderColorInput, setFolderColorInput] = useState('#3b82f6')
  const [topicColorInput, setTopicColorInput] = useState('#3b82f6')
  const [memoryInput, setMemoryInput] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [toast, setToast] = useState('')
  const [captureProtectionMode, setCaptureProtectionMode] = useState(false)
  const [widgetShortcut, setWidgetShortcut] = useState(() => normalizeShortcutForDisplay('Alt+Space'))
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isWidgetMode, setIsWidgetMode] = useState(false)
  const [attachments, setAttachments] = useState<{ name: string; type: string; url: string }[]>([])
  const [screenContextFeature, setScreenContextFeature] = useState(false)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editingFolderColor, setEditingFolderColor] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [liveHelperShortcut, setLiveHelperShortcut] = useState('CommandOrControl+Shift+H')
  const [shareModalConvId, setShareModalConvId] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importCodeInput, setImportCodeInput] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const [stealthOverlay, setStealthOverlay] = useState(false)
  const [liveAudioOpen, setLiveAudioOpen] = useState(false)
  const [appMeta, setAppMeta] = useState<{
    version: string
    releasesUrl: string
    downloadPageUrl: string
    homepage: string
  } | null>(null)
  const [updateReady, setUpdateReady] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const handleSendRef = useRef<typeof handleSend | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => { handleSendRef.current = handleSend })

  // Theme sync — applies in both main window and widget
  useEffect(() => {
    function applyTheme(themePreference: string) {
      const mode = themePreference === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : themePreference
      document.documentElement.classList.toggle('dark', mode === 'dark')
    }

    applyTheme(settings.theme || 'system')

    // Re-apply if the OS preference changes while "System" is selected
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const mqHandler = () => { if ((settings.theme || 'system') === 'system') applyTheme('system') }
    mq.addEventListener('change', mqHandler)
    return () => mq.removeEventListener('change', mqHandler)
  }, [settings.theme])

  // Widget mode detection
  useEffect(() => {
    setIsWidgetMode(window.location.hash === '#widget')
    const handler = () => setIsWidgetMode(window.location.hash === '#widget')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Derived state
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  )

  const filteredConversations = useMemo(() => {
    const q = chatSearchText.trim().toLowerCase()
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations
  }, [conversations, chatSearchText])

  const filteredTopics = useMemo(() => {
    const q = topicSearchText.trim().toLowerCase()
    return q ? topics.filter((t) => t.name.toLowerCase().includes(q)) : topics
  }, [topics, topicSearchText])

  const filteredFolders = useMemo(() => {
    const q = folderSearchText.trim().toLowerCase()
    return q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders
  }, [folders, folderSearchText])

  const filteredBookmarks = useMemo(() => {
    const q = bookmarkSearchText.trim().toLowerCase()
    return q ? bookmarks.filter((b) => b.excerpt.toLowerCase().includes(q)) : bookmarks
  }, [bookmarks, bookmarkSearchText])

  const activeTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) ?? null,
    [selectedTopicId, topics],
  )

  const memoryForPrompt = useMemo(
    () => memoryItems.filter((m) => m.pinned).slice(0, 5).map((m) => m.text),
    [memoryItems],
  )

  // ─── Callbacks ───────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2400)
  }, [])

  const handleCapture = useCallback(async () => {
    setLoading(true)
    try {
      const dataUrl = await window.velora.captureScreen()
      setImageDataUrl(dataUrl)
    } finally {
      setLoading(false)
    }
  }, [setImageDataUrl, setLoading])

  useEffect(() => {
    const removeUpdater = window.velora.onUpdater((p) => {
      if (p.event === 'available' && p.version) showToast(`Update v${p.version} available — downloading…`)
      if (p.event === 'downloaded' && p.version) {
        setUpdateReady(true)
        showToast(`Update v${p.version} ready — use “Restart to update” below.`)
      }
      if (p.event === 'error' && p.message) showToast(`Update: ${p.message}`)
    })
    return removeUpdater
  }, [showToast])

  // Initialization
  useEffect(() => {
    window.velora.getWindowState().then(({ isExpanded }) => setExpanded(isExpanded))
    window.velora.getAppMeta().then(setAppMeta).catch(() => null)
    window.velora.getSettings().then((s) => {
      setShareSafetyMode(s.shareSafetyMode)
      setCaptureProtectionMode(s.captureProtectionMode)
      setWidgetShortcut(normalizeShortcutForDisplay(s.widgetShortcut || 'Alt+Space'))
      setScreenContextFeature(s.screenContextFeature || false)
      setLiveHelperShortcut(s.liveHelperShortcut || 'CommandOrControl+Shift+H')
      setStealthOverlay(s.stealthOverlay || false)
    })
    window.velora.getApiKeyStatus().then((s) => {
      setRawApiKeyStatus({ openai: s.openai, anthropic: s.anthropic, gemini: s.gemini, deepseek: s.deepseek })
      setApiKeyStatus({ ...s, gemini: s.gemini || true, deepseek: s.deepseek || true, ollama: true })
    })

    const removeWindowState = window.velora.onWindowState(({ isExpanded }) => setExpanded(isExpanded))
    const removeShortcut = window.velora.onShortcut(({ action, imageDataUrl: payloadUrl }) => {
      if (action === 'capture') void handleCapture()
      if (action === 'explain') setSelectedAction('explain')
      if (action === 'screen-context' && payloadUrl) {
        setImageDataUrl(payloadUrl)
        setAttachments([])
        const prompt = 'Explain what is on my screen'
        setInput(prompt)
        setTimeout(() => { if (handleSendRef.current) void handleSendRef.current(prompt, payloadUrl) }, 100)
      }
      if (action === 'live-helper' && payloadUrl) {
        setImageDataUrl(payloadUrl)
        setAttachments([])
        const prompt = "What's on my screen? Give me quick, useful insight about what I'm looking at."
        setInput(prompt)
        setTimeout(() => { if (handleSendRef.current) void handleSendRef.current(prompt, payloadUrl) }, 100)
      }
    })
    return () => { removeWindowState(); removeShortcut() }
  }, [handleCapture, setExpanded, setImageDataUrl, setSelectedAction, setShareSafetyMode])

  // Supabase auth
  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) return
    let mounted = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted || !data.user) return
      setAuthState({ userId: data.user.id, email: data.user.email ?? null, isAuthenticated: true })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user
      setAuthState({ userId: u?.id ?? null, email: u?.email ?? null, isAuthenticated: Boolean(u) })
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [setAuthState])

  // Auto-scroll
  useEffect(() => {
    const el = messageListRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [activeConversationId, activeConversation?.messages.length, isLoading])

  const handleBookmark = useCallback(
    (conversationId: string, messageId: string, excerpt: string) => addBookmark(conversationId, messageId, excerpt),
    [addBookmark],
  )

  function handleDictation() {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) { showToast('Speech recognition not supported.'); return }
    if (isRecording) { recognitionRef.current?.stop(); return }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setIsRecording(true)
    recognition.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? ''
      if (text) setInput((prev) => prev + (prev ? ' ' : '') + text)
    }
    recognition.onerror = (e) => {
      const msg =
        e.error === 'network'
          ? 'Speech: Web Speech needs Google’s service — use Live Audio (Whisper) or try again.'
          : `Speech error: ${e.error}`
      showToast(msg)
      setIsRecording(false)
      recognitionRef.current = null
    }
    recognition.onend = () => { setIsRecording(false); recognitionRef.current = null }
    recognition.start()
  }

  async function handleSend(overrideInput?: string, overrideImageDataUrl?: string | null) {
    const text = (overrideInput !== undefined ? overrideInput : input).trim()
    if (!text || !activeConversation) return
    if (containsProfanity(text)) { showToast('Message contains inappropriate language.'); return }

    const targetId = activeConversation.id
    const curAttachments = [...attachments]
    const curImageUrl = overrideImageDataUrl !== undefined ? overrideImageDataUrl : imageDataUrl

    addMessageToConversation(targetId, {
      id: `msg_${Date.now()}`, role: 'user', content: text, model: selectedModel,
      createdAt: Date.now(), attachments: curAttachments.length > 0 ? curAttachments : undefined,
    })
    if (overrideInput === undefined) setInput('')
    setAttachments([])
    setLoading(true)

    const t0 = performance.now()
    try {
      const prompt = buildPrompt(selectedAction, text, {
        memoryNotes: memoryForPrompt,
        personalization: {
          preferredName: personalization.preferredName,
          responseTone: personalization.responseTone,
          learningGoal: personalization.learningGoal,
          customInstructions: personalization.customInstructions,
        },
      })

      const response = await window.velora.runAI({ model: selectedModel, prompt, imageDataUrl: curImageUrl ?? undefined })
      addMessageToConversation(targetId, {
        id: `msg_${Date.now()}_asst`, role: 'assistant', content: response,
        model: selectedModel, createdAt: Date.now(), latencyMs: Math.round(performance.now() - t0),
      })
      if (overrideImageDataUrl === undefined) setImageDataUrl(null)
    } catch (error) {
      addMessageToConversation(targetId, {
        id: `msg_${Date.now()}_err`, role: 'assistant',
        content: error instanceof Error ? error.message : 'Unexpected error',
        model: selectedModel, createdAt: Date.now(),
      })
    } finally {
      setLoading(false)
    }
  }

  const syncToCloud = useCallback(async (showMessage = true) => {
    if (!supabase || !auth.userId) return
    const snapshot = getCloudSnapshot()
    const { error } = await supabase.from('velora_user_state').upsert({
      user_id: auth.userId, state: snapshot, updated_at: new Date().toISOString(),
    })
    if (error) { if (showMessage) showToast(`Cloud sync failed: ${error.message}`); return }
    if (showMessage) showToast('Synced to cloud')
  }, [auth.userId, getCloudSnapshot, showToast])

  useEffect(() => {
    if (!settings.saveCloud || !auth.userId || !supabase) return
    const id = setTimeout(() => void syncToCloud(false), 1200)
    return () => clearTimeout(id)
  }, [settings.saveCloud, auth.userId, conversations, topics, folders, bookmarks, memoryItems, personalization, syncToCloud])

  async function pullFromCloud() {
    if (!supabase || !auth.userId) return
    const { data, error } = await supabase.from('velora_user_state').select('state').eq('user_id', auth.userId).maybeSingle()
    if (error) { showToast(`Cloud pull failed: ${error.message}`); return }
    if (data?.state) { hydrateFromCloudSnapshot(data.state); showToast('Cloud state loaded') }
  }

  async function handleSaveKeys() {
    const status = await window.velora.saveApiKeys(apiKeys)
    setRawApiKeyStatus({ openai: status.openai, anthropic: status.anthropic, gemini: status.gemini, deepseek: status.deepseek })
    setApiKeyStatus({ ...status, gemini: status.gemini || true, deepseek: status.deepseek || true, ollama: true })
    setApiKeys({ openai: '', anthropic: '', gemini: '', deepseek: '' })
    setSettingsOpen(false)
  }

  async function handleSaveKeysQuiet() {
    if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.gemini && !apiKeys.deepseek) return
    const status = await window.velora.saveApiKeys(apiKeys)
    setRawApiKeyStatus({ openai: status.openai, anthropic: status.anthropic, gemini: status.gemini, deepseek: status.deepseek })
    setApiKeyStatus({ ...status, gemini: status.gemini || true, deepseek: status.deepseek || true, ollama: true })
    setApiKeys({ openai: '', anthropic: '', gemini: '', deepseek: '' })
    setToast('API keys saved')
    window.setTimeout(() => setToast(''), 2500)
  }

  async function handleShareSafetyChange(enabled: boolean) {
    const next = await window.velora.setShareSafetyMode(enabled)
    setShareSafetyMode(next.shareSafetyMode)
  }

  async function handleWidgetShortcutChange(shortcut: string) {
    const next = await window.velora.setWidgetShortcut(normalizeShortcutForStorage(shortcut))
    setWidgetShortcut(normalizeShortcutForDisplay(next.widgetShortcut || 'Alt+Space'))
  }

  async function handleCaptureProtectionChange(enabled: boolean) {
    const next = await window.velora.setCaptureProtectionMode(enabled)
    setCaptureProtectionMode(next.captureProtectionMode)
  }

  async function handleScreenContextChange(enabled: boolean) {
    const next = await window.velora.setScreenContextFeature(enabled)
    setScreenContextFeature(next.screenContextFeature)
    useVeloraStore.getState().setScreenContextFeature(next.screenContextFeature)
  }

  async function handleLiveHelperShortcutChange(shortcut: string) {
    const next = await window.velora.setLiveHelperShortcut(shortcut)
    setLiveHelperShortcut(next.liveHelperShortcut || 'CommandOrControl+Shift+H')
  }

  async function handleStealthOverlayToggle(enabled: boolean) {
    const result = await window.velora.setStealthOverlay(enabled)
    setStealthOverlay(result.stealthOverlay)
    showToast(enabled ? '👻 Stealth Overlay ON — widget is now invisible to recorders' : 'Stealth Overlay OFF')
  }

  function handleInsertToChat(text: string) {
    setInput(prev => (prev.trim() ? `${prev}\n${text}` : text))
    showToast('Added to chat input')
  }

  async function handleShareConversation(convId: string) {
    const conv = conversations.find((c) => c.id === convId)
    if (!conv) return
    setShareModalConvId(convId)
    setShareToken('')
    setShareLoading(true)
    const result = await shareConversation(conv, auth.email ?? undefined)
    setShareLoading(false)
    if ('error' in result) { showToast(result.error); setShareModalConvId(null); return }
    setShareToken(result.token)
  }

  async function handleImportChat() {
    const code = importCodeInput.trim()
    if (!code) return
    setImportLoading(true)
    setImportError('')
    const result = await fetchSharedConversation(code)
    setImportLoading(false)
    if ('error' in result) { setImportError(result.error); return }
    const raw = result.conversation as { id?: string; title?: string; messages?: unknown[]; updatedAt?: number; folderId?: string | null }
    const imported = {
      id: `conv_imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `[Shared] ${raw.title ?? 'Untitled'}`,
      updatedAt: Date.now(),
      folderId: null as string | null,
      messages: Array.isArray(raw.messages) ? (raw.messages as { id: string; role: 'user' | 'assistant'; content: string; model?: 'gpt' | 'claude' | 'gemini'; createdAt: number; latencyMs?: number; attachments?: { name: string; type: string; url: string }[] }[]) : [],
    }
    useVeloraStore.setState((state) => ({
      conversations: [imported, ...state.conversations],
      activeConversationId: imported.id,
    }))
    setImportModalOpen(false)
    setImportCodeInput('')
    setActiveTab('chatlogs')
    setActiveConversation(imported.id)
    showToast('Chat imported successfully')
  }

  async function submitAuth() {
    if (!supabase) { setAuthError('Supabase is not configured.'); return }
    setAuthError('')
    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
      if (error) { setAuthError(error.message); return }
      showToast('Sign up successful. Check your email.')
      setAuthOpen(false)
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) { setAuthError(error.message); return }
    showToast('Signed in')
    setAuthOpen(false)
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    showToast('Signed out')
  }

  // ─── Composer shared UI ───────────────────────────────────────────────────

  function renderComposer(isWidget = false) {
    return (
      <div className={`velora-composer relative flex items-end gap-2 rounded-2xl p-2 ${isWidget ? 'drop-shadow-xl' : ''}`}>
        <input type="file" multiple className="hidden" ref={fileInputRef} onChange={(e) => {
          if (e.target.files) {
            const files = Array.from(e.target.files).map((f) => ({ name: f.name, type: f.type, url: URL.createObjectURL(f) }))
            setAttachments((prev) => [...prev, ...files])
          }
        }} />

        <button
          onClick={() => fileInputRef.current?.click()}
          className={`velora-icon-btn flex ${isWidget ? 'h-11 w-11' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl`}
          disabled={isLoading}
          title="Attach Files"
        >
          <IconAttach />
        </button>

        <button
          onClick={() => void handleCapture()}
          className={`velora-icon-btn flex ${isWidget ? 'h-11 w-11' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl`}
          disabled={isLoading}
          title="Capture Screen"
        >
          <IconCapture />
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={1}
          className={`max-h-56 ${isWidget ? 'min-h-[44px]' : 'min-h-[40px]'} w-full resize-none bg-transparent py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none custom-scrollbar`}
          placeholder={isWidget ? 'Ask Velora...' : 'Ask anything, paste text, or describe what to solve...'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (input.trim() && !isLoading) void handleSend()
            }
          }}
        />

        <button
          onClick={handleDictation}
          className={`velora-icon-btn flex ${isWidget ? 'h-11 w-11' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl ${isRecording ? 'animate-pulse !text-red-500' : ''}`}
          title="Dictate"
        >
          <IconMic />
        </button>

        <button
          onClick={() => void handleSend()}
          className={`velora-send-btn flex ${isWidget ? 'h-11 w-11' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl`}
          disabled={isLoading || !input.trim()}
        >
          <IconSend />
        </button>
      </div>
    )
  }

  // ─── Widget mode ──────────────────────────────────────────────────────────

  if (isWidgetMode) {
    return (
      <main className="velora-widget-shell relative flex h-screen w-screen flex-col overflow-hidden rounded-[22px] text-zinc-900 dark:text-zinc-100">
        <div className="velora-accent-bar rounded-t-[22px]" />

        <header className="velora-widget-header flex items-center justify-between px-5 py-3" style={appRegionDrag}>
          <div className="flex items-center gap-2.5" style={appRegionNoDrag}>
            <div className="velora-logo-badge">
              <div className="velora-logo-badge-inner">
                <img src="/android-chrome-192x192.png" alt="Velora" className="h-5 w-5 object-contain" />
              </div>
            </div>
            <span className="text-sm font-bold velora-logo-gradient">Velora</span>
          </div>
          <div className="flex items-center gap-1.5" style={appRegionNoDrag}>
            <ModelPicker
              value={selectedModel}
              onChange={setSelectedModel}
              apiKeyStatus={apiKeyStatus}
              compact
            />
            <button
              onClick={createConversation}
              className="velora-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              title="New Chat"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 1v12M1 7h12" />
              </svg>
            </button>
            <button
              onClick={() => void window.velora.hideWidget()}
              className="velora-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-red-500/10 hover:text-red-400 transition-colors"
              title="Close widget"
            >
              <IconX />
            </button>
          </div>
        </header>

        <div ref={messageListRef} className="velora-widget-scroll flex-1 min-h-0 space-y-3 overflow-y-auto px-5 py-4 custom-scrollbar">
          {activeConversation?.messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              index={idx}
              conversationId={activeConversation.id}
              onBookmark={handleBookmark}
            />
          ))}
          {isLoading && (
            <div className="velora-loading-pill inline-flex items-center gap-3 rounded-full px-4 py-2.5 text-xs font-medium">
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-cyan)' }} />
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-blue)' }} />
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
              <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>Thinking</span>
            </div>
          )}
        </div>

        {imageDataUrl && (
          <div className="velora-attachment-preview mx-5 mb-2 rounded-xl p-2 relative group">
            <img src={imageDataUrl} alt="Screen capture" className="max-h-20 rounded-lg object-cover" />
            <button
              onClick={() => setImageDataUrl(null)}
              className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
              title="Remove image"
            >
              <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M1 1L13 13M13 1L1 13" />
              </svg>
            </button>
          </div>
        )}

        <footer className="velora-widget-footer p-3 space-y-2">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action.id as QuickActionId)}
                className={`velora-pill rounded-full px-3 py-1 text-[11px] font-medium ${
                  selectedAction === action.id ? 'velora-pill-active' : ''
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((file, i) => (
                <div key={i} className="velora-chip flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]">
                  <span className="truncate max-w-[90px]" title={file.name}>{file.name}</span>
                  <button onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))} className="opacity-60 hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          )}

          {renderComposer(true)}
        </footer>
      </main>
    )
  }

  // ─── Tab renderers ────────────────────────────────────────────────────────

  function renderChatTab() {
    if (!activeConversation) {
      return <section className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>No conversation selected.</section>
    }

    return (
      <section className="velora-tab-content velora-chat-stage flex h-full min-h-0 flex-col z-10">
        <header className="velora-chat-header flex items-center justify-between px-6 py-3.5" style={appRegionDrag}>
          <div className="flex items-center gap-2" style={appRegionNoDrag}>
            <ModelPicker
              value={selectedModel}
              onChange={setSelectedModel}
              apiKeyStatus={apiKeyStatus}
            />
          </div>
          <button
            className="velora-pill rounded-full px-4 py-1.5 text-sm font-medium"
            onClick={() => setSettingsOpen(true)}
            style={appRegionNoDrag}
          >
            Settings
          </button>
        </header>

        <div ref={messageListRef} className="velora-chat-scroll flex-1 min-h-0 space-y-4 overflow-y-auto px-6 py-5 custom-scrollbar">
          {activeConversation.messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              index={idx}
              conversationId={activeConversation.id}
              onBookmark={handleBookmark}
            />
          ))}

          {isLoading && (
            <div className="velora-loading-pill inline-flex items-center gap-3 rounded-full px-5 py-2.5 text-xs font-medium">
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-cyan)' }} />
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-blue)' }} />
              <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
              <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>Thinking</span>
            </div>
          )}

        </div>

        {imageDataUrl && (
          <div className="velora-attachment-preview mx-6 mb-2 rounded-xl p-2">
            <p className="mb-1.5 px-1 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Screenshot attached</p>
            <img src={imageDataUrl} alt="Captured screen" className="max-h-24 rounded-xl object-cover" />
          </div>
        )}

        <footer className="velora-chat-footer p-4">
          <div className="w-full max-w-3xl mx-auto space-y-2">
            <div className="flex justify-center flex-wrap gap-1.5">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => setSelectedAction(action.id as QuickActionId)}
                  className={`velora-pill rounded-full px-3.5 py-1.5 text-xs font-medium ${
                    selectedAction === action.id ? 'velora-pill-active' : ''
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {attachments.map((file, i) => (
                  <div key={i} className="velora-chip flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]">
                    <span className="truncate max-w-[100px]" title={file.name}>{file.name}</span>
                    <button onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))} className="opacity-60 hover:opacity-100">×</button>
                  </div>
                ))}
              </div>
            )}

            {renderComposer()}
            <p className="text-center text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Velora can make mistakes. Verify critical information.
            </p>
          </div>
        </footer>
      </section>
    )
  }

  function renderTopicsTab() {
    return (
      <section className="velora-tab-content flex h-full min-h-0 flex-col p-4 gap-4">
        <div className="velora-panel rounded-2xl p-4">
          <h2 className="mb-1 text-base font-bold">Topics</h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            Build focused context sets with sources.
          </p>
          <div className="flex gap-2 items-center">
            <input type="color" value={topicColorInput} onChange={(e) => setTopicColorInput(e.target.value)}
              className="h-9 w-9 rounded-lg overflow-hidden cursor-pointer shrink-0" />
            <div className="grid grid-cols-2 gap-2 flex-1">
              <input value={topicNameInput} onChange={(e) => setTopicNameInput(e.target.value)}
                placeholder="Topic name"
                className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/30" />
              <input value={topicDescriptionInput} onChange={(e) => setTopicDescriptionInput(e.target.value)}
                placeholder="Description"
                className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/30" />
            </div>
            <button className="velora-primary-btn rounded-xl px-4 py-2 text-sm"
              onClick={() => {
                if (!topicNameInput.trim()) return
                createTopic(topicNameInput.trim(), topicDescriptionInput.trim(), topicColorInput)
                setTopicNameInput(''); setTopicDescriptionInput('')
              }}>
              Create
            </button>
          </div>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-[300px_1fr] gap-4 overflow-hidden">
          <div className="velora-panel flex min-h-0 flex-col rounded-2xl p-3">
            <input value={topicSearchText} onChange={(e) => setTopicSearchText(e.target.value)}
              placeholder="Search topics..."
              className="mb-3 w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none" />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
              {filteredTopics.map((topic) => (
                <div key={topic.id} className="group relative">
                  <button
                    className={`w-full rounded-xl border p-3 text-left transition-all ${
                      selectedTopicId === topic.id
                        ? 'velora-chat-item-active border-blue-500/25'
                        : 'velora-chat-item'
                    }`}
                    onClick={() => setSelectedTopicId(topic.id)}>
                    <div className="flex items-center gap-2 mb-1 pr-12">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: topic.color || '#3b82f6' }} />
                      <p className="font-semibold text-sm">{topic.name}</p>
                    </div>
                    <p className="line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{topic.description || 'No description'}</p>
                  </button>
                  <button
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded-md hover:bg-red-500/10 text-red-500/70 hover:text-red-500 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete topic "${topic.name}" and all its sources?`)) { if (selectedTopicId === topic.id) setSelectedTopicId(null); deleteTopic(topic.id) } }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="velora-panel flex min-h-0 flex-col rounded-2xl p-4">
            {!activeTopic ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a topic to manage sources.</p>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-bold">{activeTopic.name}</h3>
                </div>

                <div className="mb-3 grid grid-cols-[140px_1fr_1fr_auto] gap-2">
                  <select value={topicSourceType} onChange={(e) => setTopicSourceType(e.target.value as 'image' | 'text' | 'url')}
                    className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none">
                    <option value="image">Image</option>
                    <option value="text">Text</option>
                    <option value="url">URL</option>
                  </select>
                  <input value={topicSourceLabel} onChange={(e) => setTopicSourceLabel(e.target.value)}
                    className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none"
                    placeholder="Label" />
                  <input value={topicSourceContent} onChange={(e) => setTopicSourceContent(e.target.value)}
                    className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none"
                    placeholder="URL, note, or base64" />
                  <button className="velora-primary-btn rounded-xl px-3 py-2 text-sm"
                    onClick={() => {
                      const result = addTopicSource(activeTopic.id, {
                        type: topicSourceType, label: topicSourceLabel.trim() || 'Untitled', content: topicSourceContent.trim(),
                      }, true)
                      if (!result.ok) { showToast(result.error ?? 'Unable to add source'); return }
                      setTopicSourceLabel(''); setTopicSourceContent('')
                    }}>
                    Add
                  </button>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
                  {getVisibleTopicSources(activeTopic, true).map((source) => (
                    <article key={source.id} className="velora-panel rounded-xl p-3">
                      <div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <span className="velora-model-badge">{source.type.toUpperCase()}</span>
                        <div className="flex items-center gap-2">
                          <span>{new Date(source.createdAt).toLocaleDateString()}</span>
                          <button
                            className="px-1.5 py-0.5 rounded-md hover:bg-red-500/10 text-red-500/70 hover:text-red-500 transition-colors"
                            onClick={() => removeTopicSource(activeTopic.id, source.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <p className="font-semibold text-sm">{source.label}</p>
                      <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>{source.content || 'No content'}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    )
  }

  function renderFoldersTab() {
    return (
      <section className="velora-tab-content flex h-full min-h-0 flex-col overflow-hidden p-4 gap-4">
        <div className="velora-panel rounded-2xl p-4">
          <h2 className="mb-3 text-base font-bold">Folders</h2>
          <div className="flex gap-2 items-center">
            <input type="color" value={folderColorInput} onChange={(e) => setFolderColorInput(e.target.value)}
              className="h-9 w-9 rounded-lg overflow-hidden cursor-pointer shrink-0" />
            <input value={folderNameInput} onChange={(e) => setFolderNameInput(e.target.value)}
              className="flex-1 rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none"
              placeholder="Folder name" />
            <button className="velora-primary-btn rounded-xl px-4 py-2 text-sm"
              onClick={() => { if (!folderNameInput.trim()) return; createFolder(folderNameInput.trim(), folderColorInput); setFolderNameInput('') }}>
              Create
            </button>
          </div>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr] gap-4">
          <div className="velora-panel flex min-h-0 flex-col rounded-2xl p-3">
            <input value={folderSearchText} onChange={(e) => setFolderSearchText(e.target.value)}
              placeholder="Search folders..." className="mb-3 w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none" />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
              {filteredFolders.map((folder) => (
                <div key={folder.id} className="velora-chat-item rounded-xl px-3 py-2.5 text-sm flex items-center gap-2 group">
                  {editingFolderId === folder.id ? (
                    <div className="flex gap-2 w-full items-center">
                      <input type="color" value={editingFolderColor} onChange={(e) => setEditingFolderColor(e.target.value)} className="h-6 w-6 rounded shrink-0" />
                      <input autoFocus value={editingFolderName} onChange={(e) => setEditingFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { updateFolder(folder.id, editingFolderName, editingFolderColor); setEditingFolderId(null) }
                          else if (e.key === 'Escape') setEditingFolderId(null)
                        }}
                        onBlur={() => { updateFolder(folder.id, editingFolderName, editingFolderColor); setEditingFolderId(null) }}
                        className="flex-1 min-w-0 bg-transparent focus:outline-none" />
                    </div>
                  ) : (
                    <>
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: folder.color || '#3b82f6' }} />
                      <span className="flex-1 font-medium">{folder.name}</span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                        <button onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setEditingFolderColor(folder.color || '#3b82f6') }}
                          className="text-xs px-1.5 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10" style={{ color: 'var(--text-muted)' }}>
                          Edit
                        </button>
                        <button onClick={() => { if (window.confirm(`Delete folder "${folder.name}"? Chats inside will be unassigned.`)) deleteFolder(folder.id) }}
                          className="text-xs px-1.5 py-0.5 rounded-md hover:bg-red-500/10 text-red-500/70 hover:text-red-500">
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="velora-panel flex min-h-0 flex-col rounded-2xl p-4">
            <h3 className="mb-3 text-base font-bold">Assign Chats</h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
              {conversations.map((conv) => (
                <div key={conv.id} className="velora-panel rounded-xl p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{conv.title}</p>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {conv.folderId ? folders.find((f) => f.id === conv.folderId)?.name ?? 'Assigned' : 'No folder'}
                    </span>
                  </div>
                  <select value={conv.folderId ?? ''} onChange={(e) => assignConversationToFolder(conv.id, e.target.value || null)}
                    className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none">
                    <option value="">No folder</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderBookmarksTab() {
    return (
      <section className="velora-tab-content flex h-full min-h-0 flex-col overflow-hidden p-4 gap-4">
        <div className="velora-panel rounded-2xl p-4">
          <h2 className="mb-3 text-base font-bold">Bookmarks</h2>
          <input value={bookmarkSearchText} onChange={(e) => setBookmarkSearchText(e.target.value)}
            className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm focus:outline-none"
            placeholder="Search bookmarks..." />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
          {filteredBookmarks.map((bm) => (
            <article key={bm.id} className="velora-panel rounded-xl p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <button className="text-left text-sm font-semibold hover:underline"
                  style={{ color: 'var(--accent-cyan)' }}
                  onClick={() => { setActiveConversation(bm.conversationId); setActiveTab('chatlogs') }}>
                  Open in chat ↗
                </button>
                <button className="velora-pill rounded-full px-2.5 py-1 text-xs"
                  onClick={() => removeBookmark(bm.id)}>
                  Remove
                </button>
              </div>
              <p className="text-sm">{bm.excerpt}</p>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(bm.createdAt).toLocaleString()}</p>
            </article>
          ))}
        </div>
      </section>
    )
  }

  // ─── Settings modal ───────────────────────────────────────────────────────

  function renderSettings() {
    return (
      <AnimatedModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} zIndex={100}>
        <div className="velora-modal-card w-full max-w-2xl rounded-2xl p-5 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-bold">Settings</h2>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setSettingsOpen(false)}
              title="Close"
            >
              <IconX />
            </button>
          </div>

          {/* API Keys */}
          <div className="mb-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold">API Keys</p>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Auto-saves when you leave each field</span>
            </div>
            {[
              { key: 'openai', label: 'OpenAI', saved: rawApiKeyStatus.openai },
              { key: 'anthropic', label: 'Anthropic', saved: rawApiKeyStatus.anthropic },
              { key: 'gemini', label: 'Gemini', saved: rawApiKeyStatus.gemini },
              { key: 'deepseek', label: 'DeepSeek', saved: rawApiKeyStatus.deepseek },
            ].map(({ key, label, saved }) => (
              <label key={key} className="block text-sm">
                <span className="mb-1.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  {label} API Key
                  {saved && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/25">✓ Saved</span>}
                </span>
                <input
                  type="password"
                  className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={saved ? '••••••••••••  (key saved — paste new to replace)' : `Paste ${label} key...`}
                  value={apiKeys[key as keyof typeof apiKeys]}
                  onChange={(e) => setApiKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                  onBlur={() => void handleSaveKeysQuiet()}
                />
              </label>
            ))}
          </div>

          {/* Widget shortcut */}
          <div className="mb-5">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold">Widget Global Shortcut</span>
              <input type="text"
                className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={widgetShortcut} placeholder={widgetShortcutPlaceholder()}
                onChange={(e) => setWidgetShortcut(e.target.value)}
                onBlur={() => handleWidgetShortcutChange(widgetShortcut)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleWidgetShortcutChange(widgetShortcut) }} />
              <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-muted)' }}>Click outside or press Enter to apply</span>
            </label>
          </div>

          {/* Theme */}
          <div className="mb-5 velora-panel rounded-xl p-3">
            <p className="text-sm font-bold mb-2.5">Theme</p>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button key={t}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium capitalize transition-all ${
                    settings.theme === t ? 'velora-tab-active' : 'velora-tab-btn'
                  }`}
                  onClick={() => setTheme(t)}>
                  {t === 'light' ? '☀️ Light' : t === 'dark' ? '🌙 Dark' : '🖥 System'}
                </button>
              ))}
            </div>
          </div>

          {/* Privacy & Safety */}
          <div className="mb-5 velora-panel rounded-xl p-3 text-sm space-y-2.5">
            <p className="font-bold">Privacy & Safety</p>
            {[
              { id: 'share-mode', checked: shareSafetyMode, onChange: (v: boolean) => void handleShareSafetyChange(v), label: 'Screen Share Safety Mode' },
              { id: 'capture-prot', checked: captureProtectionMode, onChange: (v: boolean) => void handleCaptureProtectionChange(v), label: 'Capture Protection' },
              { id: 'screen-ctx', checked: screenContextFeature, onChange: (v: boolean) => void handleScreenContextChange(v), label: `Screen Context (${formatGlobalShortcutDisplay('CommandOrControl+Shift+A')})` },
            ].map(({ id, checked, onChange, label }) => (
              <div key={id} className="flex items-center gap-2.5">
                <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                <label htmlFor={id} className="cursor-pointer">{label}</label>
              </div>
            ))}
          </div>

          {/* Live Helper */}
          <div className="mb-5 velora-panel rounded-xl overflow-hidden">
            <div className="p-3 border-b border-black/5 dark:border-white/8">
              <p className="text-sm font-bold">Live Helper</p>
            </div>
            <div className="p-3 text-sm space-y-3">
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Press the hotkey anytime — Velora instantly analyzes your screen and gives you AI insight.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Global Hotkey</span>
                <input type="text"
                  className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={liveHelperShortcut}
                  placeholder="e.g. CommandOrControl+Shift+H"
                  onChange={(e) => setLiveHelperShortcut(e.target.value)}
                  onBlur={() => void handleLiveHelperShortcutChange(liveHelperShortcut)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleLiveHelperShortcutChange(liveHelperShortcut) }} />
                <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-muted)' }}>Click outside or press Enter to apply</span>
              </label>
            </div>
          </div>

          {/* Stealth Overlay */}
          <div className="mb-5 velora-panel rounded-xl overflow-hidden">
            <div className="p-3 border-b border-black/5 dark:border-white/8 flex items-center justify-between">
              <p className="text-sm font-bold">Stealth Overlay</p>
              <label className="relative inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={stealthOverlay} onChange={(e) => void handleStealthOverlayToggle(e.target.checked)} className="sr-only peer" />
                <div className="h-5 w-9 rounded-full bg-black/10 dark:bg-white/10 transition-colors peer-checked:bg-blue-500 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            </div>
            <div className="p-3 text-sm">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Makes the widget invisible to screen capture software. The overlay appears on top of any full-screen app using the highest system z-order.
              </p>
            </div>
          </div>

          {/* Storage */}
          <div className="mb-5 velora-panel rounded-xl p-3 text-sm space-y-2.5">
            <p className="font-bold">Storage & Sync</p>
            <div className="flex items-center gap-2.5">
              <input id="save-local" type="checkbox" checked={settings.saveLocal} onChange={(e) => setSaveLocal(e.target.checked)} className="h-4 w-4 accent-blue-500" />
              <label htmlFor="save-local" className="cursor-pointer">Save locally on this computer</label>
            </div>
            <div className="flex items-center gap-2.5">
              <input id="save-cloud" type="checkbox" checked={settings.saveCloud}
                onChange={(e) => setSaveCloud(e.target.checked)}
                disabled={!auth.isAuthenticated}
                className="h-4 w-4 accent-blue-500" />
              <label htmlFor="save-cloud" className="cursor-pointer">Sync to cloud (Supabase)</label>
            </div>
          </div>

          {/* Personalization */}
          <div className="mb-5 velora-panel rounded-xl p-3 text-sm">
            <p className="font-bold mb-2.5">Personalization</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 focus:outline-none"
                placeholder="Preferred name" value={personalization.preferredName}
                onChange={(e) => setPersonalization({ preferredName: e.target.value })} />
              <select className="rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 focus:outline-none"
                value={personalization.responseTone} onChange={(e) => setPersonalization({ responseTone: e.target.value as 'concise' | 'balanced' | 'detailed' })}>
                <option value="concise">Concise tone</option>
                <option value="balanced">Balanced tone</option>
                <option value="detailed">Detailed tone</option>
              </select>
              <input className="col-span-2 rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 focus:outline-none"
                placeholder="Learning goal" value={personalization.learningGoal}
                onChange={(e) => setPersonalization({ learningGoal: e.target.value })} />
              <textarea className="col-span-2 rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 focus:outline-none"
                rows={3} placeholder="Custom instructions" value={personalization.customInstructions}
                onChange={(e) => setPersonalization({ customInstructions: e.target.value })} />
            </div>
          </div>

          {/* About & updates — installers + auto-update */}
          <div className="mb-5 velora-panel rounded-xl p-3 text-sm space-y-3">
            <p className="font-bold">About & updates</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {appMeta ? (
                <>Version <span className="font-mono text-[13px]" style={{ color: 'var(--text-main)' }}>{appMeta.version}</span></>
              ) : (
                '…'
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="velora-pill rounded-xl px-3 py-1.5 text-xs font-medium"
                onClick={() => void window.velora.openExternal(appMeta?.downloadPageUrl ?? PUBLIC_DOWNLOAD.downloadPage)}
              >
                Download page
              </button>
              <button
                type="button"
                className="velora-pill rounded-xl px-3 py-1.5 text-xs font-medium"
                onClick={() => void window.velora.openExternal(appMeta?.releasesUrl ?? PUBLIC_DOWNLOAD.releases)}
              >
                GitHub Releases
              </button>
              <button
                type="button"
                className="velora-pill rounded-xl px-3 py-1.5 text-xs font-medium"
                onClick={() => void window.velora.openExternal(appMeta?.homepage ?? PUBLIC_DOWNLOAD.homepage)}
              >
                Website
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                className="velora-primary-btn rounded-xl px-3 py-1.5 text-xs font-semibold"
                onClick={() => void window.velora.checkForUpdates()}
              >
                Check for updates
              </button>
              {updateReady && (
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-emerald-500/35 bg-emerald-500/15 text-emerald-400"
                  onClick={() => void window.velora.installUpdate()}
                >
                  Restart to update
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              New here? Download the installer for your OS from the download page, run it, then add API keys above. Existing installs update automatically from GitHub Releases.
            </p>
          </div>

          {/* Memory */}
          <div className="mb-5 velora-panel rounded-xl p-3 text-sm">
            <p className="font-bold mb-2.5">Memory</p>
            <div className="mb-2 flex gap-2">
              <input value={memoryInput} onChange={(e) => setMemoryInput(e.target.value)}
                className="flex-1 rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2 focus:outline-none"
                placeholder="Remember this preference..." />
              <button className="velora-primary-btn rounded-xl px-3 py-2 text-sm"
                onClick={() => { if (!memoryInput.trim()) return; addMemoryItem(memoryInput.trim()); setMemoryInput('') }}>
                Add
              </button>
            </div>
            <div className="space-y-1.5">
              {memoryItems.slice(0, 4).map((item) => (
                <div key={item.id} className="velora-panel rounded-xl p-2.5 text-sm">
                  <p className="line-clamp-2">{item.text}</p>
                  <div className="mt-1.5 flex gap-2">
                    <button className="velora-pill rounded-full px-2.5 py-0.5 text-[11px]" onClick={() => toggleMemoryPin(item.id)}>
                      {item.pinned ? '📌 Unpin' : 'Pin'}
                    </button>
                    <button className="velora-pill rounded-full px-2.5 py-0.5 text-[11px]" onClick={() => removeMemoryItem(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="velora-pill rounded-xl px-4 py-2 text-sm" onClick={() => setSettingsOpen(false)}>Cancel</button>
            <button className="velora-primary-btn rounded-xl px-4 py-2 text-sm" onClick={() => void handleSaveKeys()}>Save Keys</button>
          </div>
        </div>
      </AnimatedModal>
    )
  }

  // ─── Share modal ──────────────────────────────────────────────────────────

  function renderShareModal() {
    const conv = conversations.find((c) => c.id === shareModalConvId)
    return (
      <AnimatedModal
        isOpen={Boolean(shareModalConvId)}
        onClose={() => { setShareModalConvId(null); setShareToken('') }}
        zIndex={100}
      >
        <div className="velora-modal-card w-full max-w-md rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold">Share Chat</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => { setShareModalConvId(null); setShareToken('') }}
              title="Close"
            >
              <IconX />
            </button>
          </div>
          <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Share <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>"{conv?.title}"</span> with anyone.
            They can import it into their Velora app using the code below.
          </p>
          {shareLoading ? (
            <div className="flex items-center gap-2.5 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--accent-cyan)' }} />
              Generating share code...
            </div>
          ) : shareToken ? (
            <div className="space-y-3">
              <div className="velora-panel rounded-xl p-3 flex items-center gap-2">
                <code className="flex-1 text-sm font-mono break-all" style={{ color: 'var(--accent-cyan)' }}>{shareToken}</code>
                <button
                  className="velora-primary-btn shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
                  onClick={() => { navigator.clipboard.writeText(shareToken); showToast('Code copied!') }}>
                  Copy
                </button>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                The recipient pastes this code in Velora → Import Chat to receive a read-only copy.
              </p>
            </div>
          ) : null}
        </div>
      </AnimatedModal>
    )
  }

  // ─── Import modal ─────────────────────────────────────────────────────────

  function renderImportModal() {
    return (
      <AnimatedModal
        isOpen={importModalOpen}
        onClose={() => { setImportModalOpen(false); setImportCodeInput(''); setImportError('') }}
        zIndex={100}
      >
        <div className="velora-modal-card w-full max-w-md rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold">Import Shared Chat</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => { setImportModalOpen(false); setImportCodeInput(''); setImportError('') }}
              title="Close"
            >
              <IconX />
            </button>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Paste the share code you received to import a conversation.
          </p>
          <input
            value={importCodeInput}
            onChange={(e) => { setImportCodeInput(e.target.value); setImportError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' && importCodeInput.trim() && !importLoading) void handleImportChat() }}
            className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 mb-2"
            placeholder="Paste share code here…"
          />
          {importError && <p className="text-xs text-red-400 mb-3">{importError}</p>}
          <button
            disabled={!importCodeInput.trim() || importLoading}
            className="velora-primary-btn w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            onClick={() => void handleImportChat()}
          >
            {importLoading ? 'Importing…' : 'Import Chat'}
          </button>
        </div>
      </AnimatedModal>
    )
  }

  // ─── Main layout ──────────────────────────────────────────────────────────

  return (
    <main className="velora-desktop-shell relative flex h-screen w-screen flex-col overflow-hidden text-zinc-900 dark:text-zinc-100 selection:bg-blue-500/20">
      {/* Ambient blobs */}
      <div className="velora-bg-blur velora-bg-blur-a" />
      <div className="velora-bg-blur velora-bg-blur-b" />

      {/* Drag handle / title bar */}
      <div className="h-10 w-full shrink-0 z-10" style={appRegionDrag} />

      <div className="flex flex-1 min-h-0 overflow-hidden z-10">
        {!sidebarOpen && (
          <button
            type="button"
            aria-label="Show sidebar"
            title="Show sidebar"
            className="velora-sidebar-reveal flex w-10 shrink-0 flex-col items-center border-r border-black/[0.06] dark:border-white/[0.08] bg-[color-mix(in_srgb,var(--surface-soft)_80%,transparent)] pt-12 transition-colors hover:bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)]"
            style={appRegionNoDrag}
            onClick={() => setSidebarOpen(true)}
          >
            <span className="text-lg font-semibold" style={{ color: 'var(--text-muted)' }}>⟩</span>
          </button>
        )}
        {sidebarOpen && (
        <aside className="velora-sidebar flex w-[272px] shrink-0 min-h-0 flex-col overflow-hidden border-r border-black/[0.06] dark:border-white/[0.08]" style={appRegionNoDrag}>
          <div className="velora-accent-bar" />

          <div className="flex flex-col flex-1 min-h-0 p-4 overflow-hidden">
            {/* Logo + New chat */}
            <div className="mb-5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="velora-logo-badge shrink-0">
                  <div className="velora-logo-badge-inner">
                    <img src="/android-chrome-192x192.png" alt="Velora" className="h-6 w-6 object-contain" />
                  </div>
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-black tracking-tight velora-logo-gradient">Velora</h1>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title="Hide sidebar"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  style={{ color: 'var(--text-muted)' }}
                  onClick={() => setSidebarOpen(false)}
                >
                  ⟨
                </button>
                <button className="velora-primary-btn rounded-full px-3.5 py-1.5 text-xs" onClick={createConversation}>
                  + New
                </button>
              </div>
            </div>

            {/* Live Helper + Stealth + Live Audio status */}
            <div className="mb-3 space-y-1.5">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.06))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-cyan)' }} />
                <span className="font-semibold" style={{ color: 'var(--accent-cyan)' }}>Live Helper</span>
                <span className="ml-auto font-mono opacity-60">{formatGlobalShortcutDisplay(liveHelperShortcut)}</span>
              </div>
              {stealthOverlay && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]"
                  style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(99,102,241,0.08))', border: '1px solid rgba(168,85,247,0.3)' }}>
                  <IconGhost />
                  <span className="font-semibold" style={{ color: '#a78bfa' }}>Stealth Active</span>
                  <span className="ml-auto text-[9px] font-black text-purple-400 opacity-70">INVISIBLE</span>
                </div>
              )}
              <button
                onClick={() => setLiveAudioOpen(v => !v)}
                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] transition-all"
                style={{
                  background: liveAudioOpen
                    ? 'linear-gradient(135deg, rgba(52,211,153,0.12), rgba(16,185,129,0.08))'
                    : 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(52,211,153,0.04))',
                  border: `1px solid ${liveAudioOpen ? 'rgba(52,211,153,0.35)' : 'rgba(16,185,129,0.2)'}`,
                }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke={liveAudioOpen ? '#34d399' : 'var(--text-muted)'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8"  y1="23" x2="16" y2="23" />
                </svg>
                <span className="font-semibold" style={{ color: liveAudioOpen ? '#34d399' : 'var(--text-muted)' }}>
                  Live Audio {liveAudioOpen ? '— ON' : 'Checker'}
                </span>
                {liveAudioOpen && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                )}
              </button>
            </div>

            {/* Nav tabs */}
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              {(['chatlogs', 'topics', 'folders', 'bookmarks'] as const).map((tab) => (
                <button key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`velora-tab-btn rounded-xl px-2 py-2 text-xs font-medium capitalize ${activeTab === tab ? 'velora-tab-active' : ''}`}>
                  {tab === 'chatlogs' ? 'Chats' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Account panel */}
            <div className="velora-panel mb-4 rounded-2xl p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Account</p>
                {!auth.isAuthenticated ? (
                  <button className="velora-pill rounded-full px-2.5 py-1 text-[11px] font-medium" onClick={() => setAuthOpen(true)}>Log In</button>
                ) : (
                  <button className="velora-pill rounded-full px-2.5 py-1 text-[11px] font-medium" onClick={() => void signOut()}>Sign Out</button>
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{auth.email ?? 'Not signed in'}</p>
              {!hasSupabaseEnv && (
                <p className="text-xs text-amber-400">Supabase env missing</p>
              )}
              <div className="flex gap-1.5">
                <button className="velora-pill flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium"
                  onClick={() => void syncToCloud()} disabled={!auth.isAuthenticated || !settings.saveCloud}>
                  ↑ Sync
                </button>
                <button className="velora-pill flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium"
                  onClick={() => void pullFromCloud()} disabled={!auth.isAuthenticated}>
                  ↓ Pull
                </button>
              </div>
            </div>

            {/* Chat history */}
            {activeTab === 'chatlogs' && (
              <div className="velora-panel flex min-h-0 flex-1 flex-col rounded-2xl p-3">
                <div className="mb-2 flex items-center justify-between gap-1">
                  <p className="text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: 'var(--text-muted)' }}>Chat History</p>
                  <div className="flex items-center gap-1">
                    {hasSupabaseEnv && (
                      <button
                        title="Import shared chat"
                        className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors"
                        style={{ color: 'var(--accent-cyan)', background: 'color-mix(in srgb, var(--accent-cyan) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent)' }}
                        onClick={() => { setImportModalOpen(true); setImportError('') }}>
                        <IconDownload />
                        Import
                      </button>
                    )}
                    <button
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                      onClick={() => { if (window.confirm('Clear all chat history?')) clearHistory() }}>
                      Clear All
                    </button>
                  </div>
                </div>
                <input value={chatSearchText} onChange={(e) => setChatSearchText(e.target.value)}
                  className="mb-2 w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-1.5 text-xs focus:outline-none"
                  placeholder="Search chats..." />
                <div className="velora-chat-list min-h-0 flex-1 space-y-1.5 overflow-y-auto custom-scrollbar">
                  {filteredConversations.map((conv) => (
                    <div key={conv.id}
                      role="button" tabIndex={0}
                      onClick={() => setActiveConversation(conv.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setActiveConversation(conv.id) }}
                      className={`group w-full rounded-xl p-2.5 text-left text-xs transition-all cursor-pointer ${
                        conv.id === activeConversationId ? 'velora-chat-item velora-chat-item-active' : 'velora-chat-item'
                      }`}>
                      <div className="flex items-center justify-between">
                        {editingChatId === conv.id ? (
                          <input autoFocus value={editingChatTitle} onChange={(e) => setEditingChatTitle(e.target.value)}
                            onBlur={() => {
                              if (editingChatTitle.trim() && !containsProfanity(editingChatTitle))
                                useVeloraStore.getState().renameConversation(conv.id, editingChatTitle.trim())
                              else if (containsProfanity(editingChatTitle)) showToast('Inappropriate language not allowed.')
                              setEditingChatId(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (editingChatTitle.trim() && !containsProfanity(editingChatTitle))
                                  useVeloraStore.getState().renameConversation(conv.id, editingChatTitle.trim())
                                setEditingChatId(null)
                              } else if (e.key === 'Escape') setEditingChatId(null)
                            }}
                            className="flex-1 bg-transparent border-b border-blue-500/30 focus:outline-none px-0.5 min-w-0 text-xs" />
                        ) : (
                          <p className="truncate font-semibold flex-1 mr-1" onDoubleClick={(e) => {
                            e.stopPropagation(); setEditingChatTitle(conv.title); setEditingChatId(conv.id)
                          }}>{conv.title}</p>
                        )}
                        {editingChatId !== conv.id && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {hasSupabaseEnv && (
                              <button
                                title="Share chat"
                                onClick={(e) => { e.stopPropagation(); void handleShareConversation(conv.id) }}
                                className="rounded-md p-1 hover:bg-blue-500/15 hover:text-blue-400 transition-colors"
                                style={{ color: 'var(--text-muted)' }}>
                                <IconShare />
                              </button>
                            )}
                            <button
                              title="Delete chat"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (window.confirm(`Delete "${conv.title}"?`)) deleteConversation(conv.id)
                              }}
                              className="rounded-md p-1 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                              style={{ color: 'var(--text-muted)' }}>
                              <IconTrash />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {new Date(conv.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
        )}

        {/* Main area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'chatlogs' && renderChatTab()}
        {activeTab === 'topics' && renderTopicsTab()}
        {activeTab === 'folders' && renderFoldersTab()}
        {activeTab === 'bookmarks' && renderBookmarksTab()}
        </div>
      </div>

      {/* Live Audio Panel — floating bottom-right */}
      {liveAudioOpen && (
        <div
          className="absolute bottom-5 right-5 z-[90]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <LiveAudioPanel
            selectedModel={selectedModel}
            onInsertToChat={handleInsertToChat}
            onClose={() => setLiveAudioOpen(false)}
          />
        </div>
      )}

      {/* Settings modal */}
      {renderSettings()}

      {/* Share modal */}
      {renderShareModal()}

      {/* Import modal */}
      {renderImportModal()}

      {/* Auth modal */}
      <AnimatedModal isOpen={authOpen} onClose={() => setAuthOpen(false)} zIndex={100}>
        <div className="velora-modal-card w-full max-w-md rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold">{authMode === 'signin' ? 'Sign In' : 'Create Account'}</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setAuthOpen(false)}
              title="Close"
            >
              <IconX />
            </button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(['signin', 'signup'] as const).map((m) => (
              <button key={m}
                className={`rounded-xl px-3 py-2.5 text-sm font-medium capitalize transition-all ${authMode === m ? 'velora-tab-active' : 'velora-tab-btn'}`}
                onClick={() => setAuthMode(m)}>
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>
          <div className="space-y-2.5">
            <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Email" type="email" />
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
              className="w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/60 dark:bg-black/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Password" />
          </div>
          {authError && <p className="mt-2.5 text-xs text-rose-400">{authError}</p>}
          <div className="mt-4 flex justify-end">
            <button className="velora-primary-btn rounded-xl px-5 py-2.5 text-sm" onClick={() => void submitAuth()}>Continue</button>
          </div>
        </div>
      </AnimatedModal>

      {/* Toast */}
      {toast && (
        <div className="velora-toast pointer-events-none absolute bottom-5 right-5 px-4 py-2.5 text-xs font-medium">
          {toast}
        </div>
      )}
    </main>
  )
}

export default App
