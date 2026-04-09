import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuickActionId } from '../lib/prompts'
import { migrateModelId, DEFAULT_MODEL_ID } from '../lib/models'

type ModelName = string
type MainTab = 'chatlogs' | 'topics' | 'folders' | 'bookmarks'
type UserTier = 'free' | 'pro' | 'power'

const FREE_TOPIC_SOURCE_LIMIT = 3

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: ModelName
  createdAt: number
  latencyMs?: number
  attachments?: { name: string; type: string; url: string }[]
}

type Conversation = {
  id: string
  title: string
  updatedAt: number
  folderId?: string | null
  messages: Message[]
}

type TopicSource = {
  id: string
  type: 'image' | 'text' | 'url'
  label: string
  content: string
  createdAt: number
}

type Topic = {
  id: string
  name: string
  description: string
  createdAt: number
  sources: TopicSource[]
  color?: string
}

type Folder = {
  id: string
  name: string
  createdAt: number
  color?: string
}

type Bookmark = {
  id: string
  conversationId: string
  messageId: string
  excerpt: string
  createdAt: number
}

type MemoryItem = {
  id: string
  text: string
  pinned: boolean
  createdAt: number
}

type Personalization = {
  preferredName: string
  responseTone: 'concise' | 'balanced' | 'detailed'
  learningGoal: string
  customInstructions: string
}

type LocalSettings = {
  saveLocal: boolean
  saveCloud: boolean
  premiumStatus: UserTier
  theme: 'system' | 'light' | 'dark'
  screenContextFeature?: boolean
}

type AuthState = {
  userId: string | null
  email: string | null
  isAuthenticated: boolean
}

type CloudSnapshot = {
  conversations: Conversation[]
  topics: Topic[]
  folders: Folder[]
  bookmarks: Bookmark[]
  memoryItems: MemoryItem[]
  personalization: Personalization
  settings: LocalSettings
  activeConversationId: string
}

type VeloraStore = {
  activeTab: MainTab
  selectedModel: ModelName
  selectedAction: QuickActionId
  shareSafetyMode: boolean
  isExpanded: boolean
  isLoading: boolean
  imageDataUrl: string | null
  auth: AuthState
  settings: LocalSettings
  topics: Topic[]
  folders: Folder[]
  bookmarks: Bookmark[]
  memoryItems: MemoryItem[]
  personalization: Personalization
  conversations: Conversation[]
  activeConversationId: string
  setActiveTab: (value: MainTab) => void
  setSelectedModel: (value: ModelName) => void
  setSelectedAction: (value: QuickActionId) => void
  setShareSafetyMode: (value: boolean) => void
  setExpanded: (value: boolean) => void
  setLoading: (value: boolean) => void
  setImageDataUrl: (value: string | null) => void
  setAuthState: (value: AuthState) => void
  setSaveLocal: (value: boolean) => void
  setSaveCloud: (value: boolean) => void
  setScreenContextFeature: (value: boolean) => void
  setUserTier: (value: UserTier) => void
  setTheme: (value: 'system' | 'light' | 'dark') => void
  setPersonalization: (value: Partial<Personalization>) => void
  addMemoryItem: (text: string) => void
  toggleMemoryPin: (id: string) => void
  removeMemoryItem: (id: string) => void
  createTopic: (name: string, description: string, color?: string) => void
  deleteTopic: (id: string) => void
  addTopicSource: (topicId: string, source: Omit<TopicSource, 'id' | 'createdAt'>, bypassFreeLimit?: boolean) => { ok: boolean; error?: string }
  removeTopicSource: (topicId: string, sourceId: string) => void
  getVisibleTopicSources: (topic: Topic, bypassFreeLimit?: boolean) => TopicSource[]
  createFolder: (name: string, color?: string) => void
  updateFolder: (id: string, name: string, color?: string) => void
  deleteFolder: (id: string) => void
  renameConversation: (id: string, title: string) => void
  assignConversationToFolder: (conversationId: string, folderId: string | null) => void
  addBookmark: (conversationId: string, messageId: string, excerpt: string) => void
  removeBookmark: (bookmarkId: string) => void
  createConversation: () => void
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string) => void
  clearHistory: () => void
  addMessage: (message: Message) => void
  addMessageToConversation: (conversationId: string, message: Message) => void
  getCloudSnapshot: () => CloudSnapshot
  hydrateFromCloudSnapshot: (snapshot: CloudSnapshot) => void
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getTitleFromMessage(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}...` : oneLine
}

const initialConversationId = makeId('conv')

function withSeedConversation(conversations: Conversation[]): { list: Conversation[]; activeId: string } {
  if (conversations.length > 0) {
    return { list: conversations, activeId: conversations[0].id }
  }

  const id = makeId('conv')
  return {
    list: [
      {
        id,
        title: 'New Chat',
        updatedAt: Date.now(),
        folderId: null,
        messages: [],
      },
    ],
    activeId: id,
  }
}

function appendMessageToConversation(
  conversations: Conversation[],
  conversationId: string,
  message: Message,
): Conversation[] {
  let matched = false
  const now = Date.now()

  const updated = conversations.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation
    }

    matched = true
    const nextMessages = [...conversation.messages, message]
    const nextTitle =
      conversation.title === 'New Chat' && message.role === 'user'
        ? getTitleFromMessage(message.content)
        : conversation.title

    return {
      ...conversation,
      messages: nextMessages,
      title: nextTitle,
      updatedAt: now,
    }
  })

  if (!matched) {
    updated.push({
      id: conversationId,
      title: message.role === 'user' ? getTitleFromMessage(message.content) : 'New Chat',
      updatedAt: now,
      folderId: null,
      messages: [message],
    })
  }

  return updated.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useVeloraStore = create<VeloraStore>()(
  persist(
    (set, get) => ({
      activeTab: 'chatlogs',
      selectedModel: DEFAULT_MODEL_ID,
      selectedAction: 'explain',
      shareSafetyMode: false,
      isExpanded: false,
      isLoading: false,
      imageDataUrl: null,
      auth: {
        userId: null,
        email: null,
        isAuthenticated: false,
      },
      settings: {
        saveLocal: true,
        saveCloud: false,
        premiumStatus: 'free',
        theme: 'system',
        screenContextFeature: false,
      },
      topics: [],
      folders: [],
      bookmarks: [],
      memoryItems: [],
      personalization: {
        preferredName: '',
        responseTone: 'balanced',
        learningGoal: '',
        customInstructions: '',
      },
      conversations: [
        {
          id: initialConversationId,
          title: 'New Chat',
          updatedAt: Date.now(),
          folderId: null,
          messages: [],
        },
      ],
      activeConversationId: initialConversationId,

      setActiveTab: (value) => set({ activeTab: value }),
      setSelectedModel: (value) => set({ selectedModel: value }),
      setSelectedAction: (value) => set({ selectedAction: value }),
      setShareSafetyMode: (value) => set({ shareSafetyMode: value }),
      setExpanded: (value) => set({ isExpanded: value }),
      setLoading: (value) => set({ isLoading: value }),
      setImageDataUrl: (value) => set({ imageDataUrl: value }),
      setAuthState: (value) => set({ auth: value }),
      setSaveLocal: (value) =>
        set((state) => ({
          settings: { ...state.settings, saveLocal: value },
        })),
      setSaveCloud: (value) =>
        set((state) => ({
          settings: { ...state.settings, saveCloud: value },
        })),
      setScreenContextFeature: (value) =>
        set((state) => ({
          settings: { ...state.settings, screenContextFeature: value },
        })),
      setUserTier: (value) =>
        set((state) => ({
          settings: { ...state.settings, premiumStatus: value },
        })),
      setTheme: (value) =>
        set((state) => ({
          settings: { ...state.settings, theme: value },
        })),
      setPersonalization: (value) =>
        set((state) => ({
          personalization: {
            ...state.personalization,
            ...value,
          },
        })),

      addMemoryItem: (text) =>
        set((state) => ({
          memoryItems: [
            {
              id: makeId('mem'),
              text,
              pinned: false,
              createdAt: Date.now(),
            },
            ...state.memoryItems,
          ],
        })),
      toggleMemoryPin: (id) =>
        set((state) => ({
          memoryItems: state.memoryItems.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
        })),
      removeMemoryItem: (id) =>
        set((state) => ({
          memoryItems: state.memoryItems.filter((item) => item.id !== id),
        })),

      createTopic: (name, description, color) =>
        set((state) => ({
          topics: [
            {
              id: makeId('topic'),
              name,
              description,
              color,
              createdAt: Date.now(),
              sources: [],
            },
            ...state.topics,
          ],
        })),

      deleteTopic: (id) =>
        set((state) => ({
          topics: state.topics.filter((topic) => topic.id !== id),
        })),

      addTopicSource: (topicId, source, bypassFreeLimit = false) => {
        const tier = get().settings.premiumStatus
        const topic = get().topics.find((item) => item.id === topicId)
        if (!topic) {
          return { ok: false, error: 'Topic not found' }
        }

        if (!bypassFreeLimit && tier === 'free' && topic.sources.length >= FREE_TOPIC_SOURCE_LIMIT) {
          return { ok: false, error: `Free plan allows up to ${FREE_TOPIC_SOURCE_LIMIT} sources per topic. Add your own API key or upgrade to Premium for unlimited sources.` }
        }

        set((state) => ({
          topics: state.topics.map((item) =>
            item.id === topicId
              ? {
                  ...item,
                  sources: [
                    {
                      id: makeId('source'),
                      createdAt: Date.now(),
                      ...source,
                    },
                    ...item.sources,
                  ],
                }
              : item,
          ),
        }))

        return { ok: true }
      },

      removeTopicSource: (topicId, sourceId) =>
        set((state) => ({
          topics: state.topics.map((topic) =>
            topic.id === topicId
              ? { ...topic, sources: topic.sources.filter((s) => s.id !== sourceId) }
              : topic,
          ),
        })),

      getVisibleTopicSources: (topic, bypassFreeLimit = false) => {
        const tier = get().settings.premiumStatus
        if (tier === 'free' && !bypassFreeLimit) {
          return [...topic.sources].sort((a, b) => b.createdAt - a.createdAt).slice(0, FREE_TOPIC_SOURCE_LIMIT)
        }
        return topic.sources
      },

      createFolder: (name, color) =>
        set((state) => ({
          folders: [
            {
              id: makeId('folder'),
              name,
              color,
              createdAt: Date.now(),
            },
            ...state.folders,
          ],
        })),

      updateFolder: (id, name, color) =>
        set((state) => ({
          folders: state.folders.map((folder) =>
            folder.id === id ? { ...folder, name, color: color || folder.color } : folder
          ),
        })),

      deleteFolder: (id) =>
        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
          // Unassign all conversations that were in this folder
          conversations: state.conversations.map((conv) =>
            conv.folderId === id ? { ...conv, folderId: null } : conv,
          ),
        })),

      renameConversation: (id, title) =>
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, title } : item
          ),
        })),

      assignConversationToFolder: (conversationId, folderId) =>
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  folderId,
                }
              : item,
          ),
        })),

      addBookmark: (conversationId, messageId, excerpt) =>
        set((state) => {
          const alreadyExists = state.bookmarks.some(
            (item) => item.conversationId === conversationId && item.messageId === messageId,
          )

          if (alreadyExists) {
            return state
          }

          return {
            bookmarks: [
              {
                id: makeId('bookmark'),
                conversationId,
                messageId,
                excerpt,
                createdAt: Date.now(),
              },
              ...state.bookmarks,
            ],
          }
        }),

      removeBookmark: (bookmarkId) =>
        set((state) => ({
          bookmarks: state.bookmarks.filter((item) => item.id !== bookmarkId),
        })),

      createConversation: () => {
        const id = makeId('conv')
        set((state) => ({
          conversations: [
            {
              id,
              title: 'New Chat',
              updatedAt: Date.now(),
              folderId: null,
              messages: [],
            },
            ...state.conversations,
          ],
          activeConversationId: id,
        }))
      },

      setActiveConversation: (id) => set({ activeConversationId: id }),

      deleteConversation: (id) =>
        set((state) => {
          const remaining = state.conversations.filter((c) => c.id !== id)
          const seeded = withSeedConversation(remaining)
          const nextActiveId =
            state.activeConversationId === id ? seeded.activeId : state.activeConversationId
          return { conversations: seeded.list, activeConversationId: nextActiveId }
        }),

      clearHistory: () => set(() => {
        const seeded = withSeedConversation([])
        return { conversations: seeded.list, activeConversationId: seeded.activeId }
      }),

      addMessage: (message) => {
        const activeId = get().activeConversationId

        set((state) => ({
          conversations: appendMessageToConversation(state.conversations, activeId, message),
          activeConversationId: activeId,
        }))
      },

      addMessageToConversation: (conversationId, message) =>
        set((state) => ({
          conversations: appendMessageToConversation(state.conversations, conversationId, message),
          activeConversationId: conversationId,
        })),

      getCloudSnapshot: () => {
        const state = get()
        return {
          conversations: state.conversations,
          topics: state.topics,
          folders: state.folders,
          bookmarks: state.bookmarks,
          memoryItems: state.memoryItems,
          personalization: state.personalization,
          settings: state.settings,
          activeConversationId: state.activeConversationId,
        }
      },

      hydrateFromCloudSnapshot: (snapshot) => {
        const seeded = withSeedConversation(snapshot.conversations)
        const nextActiveId = seeded.list.some((item) => item.id === snapshot.activeConversationId)
          ? snapshot.activeConversationId
          : seeded.activeId
        set({
          conversations: seeded.list,
          topics: snapshot.topics,
          folders: snapshot.folders,
          bookmarks: snapshot.bookmarks,
          memoryItems: snapshot.memoryItems,
          personalization: snapshot.personalization,
          settings: snapshot.settings,
          activeConversationId: nextActiveId,
        })
      },
    }),
    {
      name: 'velora-local-store',
      version: 2,
      migrate: (persisted, version) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = persisted as any
        if (version < 2) {
          // Migrate legacy short model IDs to full specific model IDs
          if (s.selectedModel) {
            s.selectedModel = migrateModelId(s.selectedModel)
          }
          if (Array.isArray(s.conversations)) {
            s.conversations = s.conversations.map((conv: { messages?: { model?: string }[] }) => ({
              ...conv,
              messages: Array.isArray(conv.messages)
                ? conv.messages.map((msg) => ({
                    ...msg,
                    model: msg.model ? migrateModelId(msg.model) : msg.model,
                  }))
                : conv.messages,
            }))
          }
        }
        return s
      },
      partialize: (state) => ({
        activeTab: state.activeTab,
        selectedModel: state.selectedModel,
        selectedAction: state.selectedAction,
        shareSafetyMode: state.shareSafetyMode,
        settings: state.settings,
        topics: state.settings.saveLocal ? state.topics : [],
        folders: state.settings.saveLocal ? state.folders : [],
        bookmarks: state.settings.saveLocal ? state.bookmarks : [],
        memoryItems: state.settings.saveLocal ? state.memoryItems : [],
        personalization: state.personalization,
        conversations: state.settings.saveLocal ? state.conversations : [],
        activeConversationId: state.activeConversationId,
      }),
    },
  ),
)
