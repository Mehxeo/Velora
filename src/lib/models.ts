export type ModelProvider = 'google' | 'openai' | 'anthropic' | 'deepseek' | 'ollama'
export type ApiKeySlot = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'ollama'

export type ModelBadge = 'Free' | 'Fast' | 'Smart' | 'Best' | 'Reasoning' | 'Vision'

export type ModelConfig = {
  id: string
  name: string
  provider: ModelProvider
  keySlot: ApiKeySlot
  description: string
  badge: ModelBadge
  context: string
}

export const MODEL_CATALOG: ModelConfig[] = [
  // ── Google ──────────────────────────────────────────────────────────────────
  // Gemini 2.5 Flash is available on the free API tier from Google AI Studio
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    keySlot: 'gemini',
    description: 'Google\'s fastest multimodal model. Free tier via AI Studio. Great for everything.',
    badge: 'Free',
    context: '1M ctx',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    keySlot: 'gemini',
    description: 'Google\'s most powerful model. Deep reasoning, code, and complex analysis.',
    badge: 'Best',
    context: '1M ctx',
  },
  // ── OpenAI ──────────────────────────────────────────────────────────────────
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    keySlot: 'openai',
    description: 'Fast and cheap. Great for most everyday tasks with vision support.',
    badge: 'Fast',
    context: '128K ctx',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    keySlot: 'openai',
    description: 'Flagship multimodal model. Excellent at reasoning, vision, and complex tasks.',
    badge: 'Smart',
    context: '128K ctx',
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    keySlot: 'openai',
    description: 'Latest fast model from OpenAI with huge context. Efficient and capable.',
    badge: 'Fast',
    context: '1M ctx',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    keySlot: 'openai',
    description: 'OpenAI\'s latest flagship. Best at coding, instruction following, and analysis.',
    badge: 'Best',
    context: '1M ctx',
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    keySlot: 'openai',
    description: 'OpenAI\'s advanced reasoning model. Outstanding at math, science, and logic.',
    badge: 'Reasoning',
    context: '200K ctx',
  },
  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  // Built-in key — free for all Velora users, no setup required
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    keySlot: 'deepseek',
    description: 'DeepSeek V3.2 — fast, capable, and free for all Velora users. No API key needed.',
    badge: 'Free',
    context: '128K ctx',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    keySlot: 'deepseek',
    description: 'DeepSeek R1 thinking model. Deep reasoning built-in, free for all Velora users.',
    badge: 'Reasoning',
    context: '128K ctx',
  },
  // ── Ollama (Local) ────────────────────────────────────────────────────────────
  {
    id: 'ollama/llama3.2:1b',
    name: 'Llama 3.2 1B',
    provider: 'ollama',
    keySlot: 'ollama',
    description: 'Ultra-fast local model. Runs on your device — no internet or API key needed.',
    badge: 'Free',
    context: '128K ctx',
  },
  {
    id: 'ollama/llama3.2:3b',
    name: 'Llama 3.2 3B',
    provider: 'ollama',
    keySlot: 'ollama',
    description: 'Balanced local model. Better quality, still fast. Runs entirely on device.',
    badge: 'Free',
    context: '128K ctx',
  },
  {
    id: 'ollama/phi3:mini',
    name: 'Phi-3 Mini',
    provider: 'ollama',
    keySlot: 'ollama',
    description: "Microsoft's compact reasoning model. Surprisingly capable, runs locally.",
    badge: 'Free',
    context: '128K ctx',
  },
  {
    id: 'ollama/gemma2:2b',
    name: 'Gemma 2 2B',
    provider: 'ollama',
    keySlot: 'ollama',
    description: "Google's efficient local model. Great for quick tasks, zero cost.",
    badge: 'Free',
    context: '8K ctx',
  },
  // ── Anthropic ────────────────────────────────────────────────────────────────
  {
    id: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    keySlot: 'anthropic',
    description: 'Fastest Claude. High throughput, great for quick tasks and chat.',
    badge: 'Fast',
    context: '200K ctx',
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    keySlot: 'anthropic',
    description: 'Balanced and smart. Excellent at writing, analysis, and coding.',
    badge: 'Smart',
    context: '200K ctx',
  },
  {
    id: 'claude-3-7-sonnet-latest',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    keySlot: 'anthropic',
    description: "Anthropic's most intelligent model. Best for complex, nuanced tasks.",
    badge: 'Best',
    context: '200K ctx',
  },
]

export const DEFAULT_MODEL_ID = 'gemini-2.5-flash'

export const LEGACY_MODEL_MIGRATION: Record<string, string> = {
  gpt: 'gpt-4o-mini',
  claude: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-2.5-flash',
}

export function migrateModelId(id: string): string {
  return LEGACY_MODEL_MIGRATION[id] ?? id
}

export function getModelById(id: string): ModelConfig | undefined {
  return MODEL_CATALOG.find((m) => m.id === id)
}

export function getModelsByProvider(provider: ModelProvider): ModelConfig[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider)
}

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  ollama: 'Local (Ollama)',
}

export const PROVIDER_COLORS: Record<ModelProvider, { from: string; to: string }> = {
  google: { from: '#34d399', to: '#06b6d4' },
  openai: { from: '#60a5fa', to: '#818cf8' },
  anthropic: { from: '#fb923c', to: '#f59e0b' },
  deepseek: { from: '#a78bfa', to: '#6366f1' },
  ollama: { from: '#4ade80', to: '#22d3ee' },
}

export const BADGE_COLORS: Record<ModelBadge, { bg: string; text: string; border: string }> = {
  Free:      { bg: 'rgba(52,211,153,0.12)',  text: '#34d399', border: 'rgba(52,211,153,0.3)' },
  Fast:      { bg: 'rgba(96,165,250,0.12)',  text: '#60a5fa', border: 'rgba(96,165,250,0.3)' },
  Smart:     { bg: 'rgba(167,139,250,0.12)', text: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
  Best:      { bg: 'rgba(251,146,60,0.12)',  text: '#fb923c', border: 'rgba(251,146,60,0.3)' },
  Reasoning: { bg: 'rgba(232,121,249,0.12)', text: '#e879f9', border: 'rgba(232,121,249,0.3)' },
  Vision:    { bg: 'rgba(34,211,238,0.12)',  text: '#22d3ee', border: 'rgba(34,211,238,0.3)' },
}

export const PROVIDERS: ModelProvider[] = ['google', 'openai', 'anthropic', 'deepseek', 'ollama']

export const PROVIDER_FREE_NOTE: Partial<Record<ModelProvider, string>> = {
  google: 'Built-in — free for all Velora users',
  deepseek: 'Built-in — free for all Velora users',
  ollama: 'Runs locally — no API key needed',
}

export const PROVIDER_KEY_LINKS: Partial<Record<ModelProvider, string>> = {
  google: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  // deepseek intentionally omitted — key is built-in
  // ollama intentionally omitted — no key required
}

// Default compare models — one per provider
export const COMPARE_DEFAULT_MODELS: Record<ModelProvider, string> = {
  google: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  deepseek: 'deepseek-chat',
  ollama: 'ollama/llama3.2:3b',
}
