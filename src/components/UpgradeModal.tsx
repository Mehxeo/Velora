import { memo, useState } from 'react'

type UserTier = 'free' | 'pro' | 'power'

type Props = {
  currentTier: UserTier
  onClose: () => void
  onCheckout: (tier: 'pro' | 'power') => Promise<void>
  onVerify: () => Promise<void>
  onPortal: () => Promise<void>
  isLoading?: boolean
  errorMessage?: string
}

type Feature = { label: string; free: boolean; byok: boolean; pro: boolean }

const FEATURES: Feature[] = [
  { label: 'Chat with built-in Gemini & DeepSeek (no key)', free: true, byok: true, pro: true },
  { label: 'Unlimited conversations', free: true, byok: true, pro: true },
  { label: 'Quick modes: Explain, Summarize, Solve, Translate', free: true, byok: true, pro: true },
  { label: 'Voice dictation & screen capture', free: true, byok: true, pro: true },
  { label: 'Local AI via Ollama (private, runs on device)', free: true, byok: true, pro: true },
  { label: 'Topics, folders & bookmarks', free: true, byok: true, pro: true },
  { label: 'Memory & personalization', free: true, byok: true, pro: true },
  { label: '3 topic sources per topic', free: true, byok: false, pro: false },
  { label: 'Multi-model Compare (GPT vs Claude vs Gemini)', free: false, byok: true, pro: true },
  { label: 'Unlimited topic sources', free: false, byok: true, pro: true },
  { label: 'Live Helper — hotkey → instant screen AI', free: false, byok: true, pro: true },
  { label: 'Live Audio Checker — mic → AI in real time', free: false, byok: true, pro: true },
  { label: 'Stealth Overlay — invisible to screen recorders', free: false, byok: true, pro: true },
  { label: 'Cloud sync across devices', free: false, byok: true, pro: true },
]

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 1L13 13M13 1L1 13" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 7L5.5 10.5L12 3.5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const DashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="opacity-25" />
  </svg>
)

export const UpgradeModal = memo(function UpgradeModal({
  currentTier, onClose, onCheckout, onVerify, onPortal, isLoading = false, errorMessage,
}: Props) {
  const [localLoading, setLocalLoading] = useState(false)
  const busy = isLoading || localLoading
  const isPro = currentTier !== 'free'

  async function handleCheckout() {
    setLocalLoading(true)
    try { await onCheckout('pro') } finally { setLocalLoading(false) }
  }

  async function handleVerify() {
    setLocalLoading(true)
    try { await onVerify() } finally { setLocalLoading(false) }
  }

  async function handlePortal() {
    setLocalLoading(true)
    try { await onPortal() } finally { setLocalLoading(false) }
  }

  return (
    <div className="velora-modal-card w-full max-w-2xl rounded-2xl overflow-hidden max-h-[85vh] flex flex-col">
      {/* Header gradient bar */}
      <div className="h-1 w-full shrink-0" style={{ background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #10b981)' }} />

      <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
        {/* Title row */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black velora-logo-gradient mb-1">Velora Pro</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Everything you need for interviews, homework &amp; beyond.
            </p>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400 mt-0.5"
            style={{ color: 'var(--text-muted)' }}
            onClick={onClose}
            title="Close"
          >
            <IconX />
          </button>
        </div>

          {/* Error */}
          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {errorMessage}
            </div>
          )}

          {/* BYOK callout */}
          <div className="mb-4 rounded-xl p-3 text-xs" style={{ background: 'linear-gradient(135deg, rgba(52,211,153,0.08), rgba(6,182,212,0.06))', border: '1px solid rgba(52,211,153,0.2)' }}>
            <p className="font-bold mb-1" style={{ color: '#34d399' }}>Bring Your Own API Key → Everything Free</p>
            <p style={{ color: 'var(--text-muted)' }}>
              Add your own OpenAI, Anthropic, or Gemini key in Settings and all features unlock at no extra cost. You pay your provider directly — Velora charges nothing.
            </p>
          </div>

          {/* Pricing + feature table */}
          <div className="grid grid-cols-[1fr_90px_110px_130px] gap-0 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--panel-border)' }}>
            {/* Table header */}
            <div className="px-4 py-3 text-xs font-bold uppercase tracking-widest" style={{ background: 'var(--surface-soft)', color: 'var(--text-muted)', borderBottom: '1px solid var(--panel-border)' }}>
              Feature
            </div>
            <div className="px-2 py-3 text-center" style={{ background: 'var(--surface-soft)', borderBottom: '1px solid var(--panel-border)', borderLeft: '1px solid var(--panel-border)' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Free</p>
              <p className="text-base font-black mt-0.5">$0</p>
            </div>
            <div className="px-2 py-3 text-center relative" style={{ background: 'linear-gradient(135deg, rgba(52,211,153,0.1) 0%, rgba(6,182,212,0.08) 100%)', borderBottom: '1px solid rgba(52,211,153,0.3)', borderLeft: '1px solid rgba(52,211,153,0.3)' }}>
              <div className="absolute -top-px left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, #34d399, #06b6d4)' }} />
              <p className="text-[10px] font-bold uppercase tracking-wide leading-tight" style={{ color: '#34d399' }}>Your Key</p>
              <p className="text-[10px] font-black mt-0.5" style={{ color: '#34d399' }}>Free ✓</p>
            </div>
            <div className="px-2 py-3 text-center relative" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(6,182,212,0.1) 100%)', borderBottom: '1px solid rgba(59,130,246,0.3)', borderLeft: '1px solid rgba(59,130,246,0.3)' }}>
              <div className="absolute -top-px left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, #3b82f6, #06b6d4)' }} />
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--accent-cyan)' }}>Pro</p>
              <div className="flex items-end justify-center gap-0.5 mt-0.5">
                <span className="text-base font-black">$9.99</span>
                <span className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>/mo</span>
              </div>
            </div>

            {/* Feature rows */}
            {FEATURES.map((feature) => (
              <div key={feature.label} className="contents">
                <div className="px-4 py-2.5 text-sm" style={{ borderTop: '1px solid var(--panel-border)', color: 'var(--text-main)' }}>
                  {feature.label}
                </div>
                <div className="flex items-center justify-center" style={{ borderTop: '1px solid var(--panel-border)', borderLeft: '1px solid var(--panel-border)' }}>
                  {feature.free ? <CheckIcon /> : <DashIcon />}
                </div>
                <div className="flex items-center justify-center" style={{ background: feature.byok && !feature.free ? 'rgba(52,211,153,0.04)' : undefined, borderTop: '1px solid rgba(52,211,153,0.2)', borderLeft: '1px solid rgba(52,211,153,0.2)' }}>
                  {feature.byok ? <CheckIcon /> : <DashIcon />}
                </div>
                <div className="flex items-center justify-center" style={{ background: feature.pro && !feature.free ? 'rgba(59,130,246,0.04)' : undefined, borderTop: '1px solid rgba(59,130,246,0.2)', borderLeft: '1px solid rgba(59,130,246,0.2)' }}>
                  {feature.pro ? <CheckIcon /> : <DashIcon />}
                </div>
              </div>
            ))}
          </div>

          {/* CTA section */}
          <div className="mt-6 rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(16,185,129,0.06) 100%)', border: '1px solid rgba(59,130,246,0.2)' }}>
            {isPro ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2.5 8L6 11.5L13.5 4" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-sm">You're on Pro</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>All features are unlocked. Cancel anytime.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handlePortal()}
                    disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold velora-pill transition-all hover:opacity-80"
                  >
                    Manage Billing
                  </button>
                  <button
                    onClick={() => void handleVerify()}
                    disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold velora-pill transition-all hover:opacity-80"
                  >
                    {busy ? 'Checking...' : 'Refresh Status'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <p className="font-bold mb-1">Unlock everything — two ways</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Add your own API key in Settings for instant free access, or subscribe to Pro for a built-in key included.
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => void handleCheckout()}
                  className="w-full rounded-xl py-3 text-sm font-black text-white transition-all hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-wait"
                  style={{
                    background: 'linear-gradient(130deg, #3b82f6, #06b6d4)',
                    boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
                  }}
                >
                  {busy ? 'Loading...' : '✦ Upgrade to Pro — $9.99/mo'}
                </button>
                <p className="w-full mt-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  or go to <strong>Settings → API Keys</strong> to add your own key for free access
                </p>
                <button
                  onClick={() => void handleVerify()}
                  disabled={busy}
                  className="w-full mt-1 rounded-xl py-2 text-xs font-medium transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Already paid? Verify purchase
                </button>
              </div>
            )}
          </div>
      </div>
    </div>
  )
})
