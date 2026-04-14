import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  selectedModel: string
  onInsertToChat: (text: string) => void
  onClose: () => void
}

// Web Speech API types (Chromium built-in)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

// ─── Audio visualizer ─────────────────────────────────────────────────────────

function AudioVisualizer({ active }: { active: boolean }) {
  return (
    <div className="flex items-end justify-center gap-[3px]" style={{ height: 36 }}>
      {Array.from({ length: 16 }, (_, i) => (
        <div
          key={i}
          className={active ? 'velora-audio-bar rounded-full' : 'rounded-full'}
          style={{
            width: 3,
            height: active ? '100%' : 4,
            background: active
              ? i < 5
                ? 'var(--accent-blue)'
                : i < 10
                ? 'var(--accent-cyan)'
                : 'var(--accent-green)'
              : 'var(--panel-border)',
            transition: active ? undefined : 'height 300ms, background 300ms',
            transformOrigin: 'bottom center',
          }}
        />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LiveAudioPanel({ selectedModel, onInsertToChat, onClose }: Props) {
  const [isListening, setIsListening] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [autoRespond, setAutoRespond] = useState(false)
  const [sendResponseToChat, setSendResponseToChat] = useState(false)
  const [permError, setPermError] = useState('')
  // Whisper default: Chromium Web Speech routes through Google’s service and often fails with a
  // “network” error in Electron even when online.
  const [mode, setMode] = useState<'web-speech' | 'whisper'>('whisper')
  const [isRecordingWhisper, setIsRecordingWhisper] = useState(false)

  const recognitionRef = useRef<any>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const responseScrollRef = useRef<HTMLDivElement>(null)

  const fullTranscript = finalTranscript + interimTranscript

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [fullTranscript])

  useEffect(() => {
    if (responseScrollRef.current) {
      responseScrollRef.current.scrollTop = responseScrollRef.current.scrollHeight
    }
  }, [aiResponse])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening()
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const askAI = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isResponding) return
    setIsResponding(true)
    setAiResponse('')
    try {
      const result = await window.velora.runAI({ model: selectedModel, prompt: trimmed })
      setAiResponse(result)
      if (sendResponseToChat) {
        onInsertToChat(result)
      }
    } catch {
      setAiResponse('⚠ Could not get a response. Check your API key.')
    } finally {
      setIsResponding(false)
    }
  }, [selectedModel, isResponding, sendResponseToChat, onInsertToChat])

  const resetSilenceTimer = useCallback((transcript: string) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (autoRespond) {
      silenceTimerRef.current = setTimeout(() => {
        void askAI(transcript)
      }, 2500)
    }
  }, [autoRespond, askAI])

  // ─── Web Speech API ──────────────────────────────────────────────────────

  const startWebSpeech = useCallback(async () => {
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition
    if (!SR) {
      setPermError('Speech recognition is not available in this Electron build.')
      return
    }

    // Request system mic permission first (macOS)
    try {
      const granted = await window.velora.requestMicPermission()
      if (!granted) {
        setPermError('Microphone permission denied. Enable it in System Preferences → Privacy → Microphone.')
        return
      }
    } catch {
      // Non-macOS or permission API unavailable – proceed anyway
    }

    setPermError('')
    setFinalTranscript('')
    setInterimTranscript('')
    setAiResponse('')

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let newFinal = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) {
          newFinal += res[0].transcript + ' '
        } else {
          interim += res[0].transcript
        }
      }
      if (newFinal) {
        setFinalTranscript(prev => {
          const updated = prev + newFinal
          resetSilenceTimer(updated)
          return updated
        })
      }
      setInterimTranscript(interim)
    }

    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setPermError('Microphone access denied.')
        setIsListening(false)
      } else if (e.error === 'network') {
        setPermError(
          'Web Speech uses Google’s cloud and often fails in desktop apps. Switch to Whisper above (OpenAI key in Settings), or check firewall/VPN.',
        )
      }
    }

    recognition.onend = () => {
      // Auto-restart so listening is continuous until user stops
      if (recognitionRef.current === recognition) {
        try { recognition.start() } catch { /* already restarting */ }
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      setPermError('Could not start microphone.')
    }
  }, [resetSilenceTimer])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      const r = recognitionRef.current
      recognitionRef.current = null
      try { r.stop() } catch { /* ignore */ }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsListening(false)
    setIsRecordingWhisper(false)
    setInterimTranscript('')
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
  }, [])

  // ─── Whisper mode (MediaRecorder → IPC → Whisper API) ────────────────────

  const startWhisper = useCallback(async () => {
    setPermError('')
    setFinalTranscript('')
    setAiResponse('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const arrayBuf = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))
        const result = await window.velora.transcribeAudio(base64)
        if (result.ok && result.transcript) {
          setFinalTranscript(result.transcript)
          if (autoRespond) void askAI(result.transcript)
        } else {
          setPermError(result.error ?? 'Transcription failed.')
        }
        setIsRecordingWhisper(false)
        setIsListening(false)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecordingWhisper(true)
      setIsListening(true)
    } catch (err: any) {
      setPermError(`Microphone error: ${err?.message ?? err}`)
    }
  }, [autoRespond, askAI])

  const stopWhisper = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleToggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
      if (mode === 'whisper') stopWhisper()
    } else {
      if (mode === 'whisper') {
        void startWhisper()
      } else {
        void startWebSpeech()
      }
    }
  }, [isListening, mode, startWebSpeech, startWhisper, stopListening, stopWhisper])

  const handleClear = () => {
    stopListening()
    setFinalTranscript('')
    setInterimTranscript('')
    setAiResponse('')
    setPermError('')
  }

  return (
    <div
      className="velora-live-audio-panel flex flex-col overflow-hidden"
      style={{ width: 420, maxHeight: 600, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Header gradient bar */}
      <div className="h-0.5 w-full shrink-0" style={{ background: 'linear-gradient(90deg, #3b82f6, #06b6d4 40%, #10b981)' }} />

      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
            style={{ background: isListening ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.12)', border: `1px solid ${isListening ? 'rgba(52,211,153,0.3)' : 'rgba(99,102,241,0.25)'}` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isListening ? '#34d399' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8"  y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight">Live Audio Checker</p>
            <p className="text-[10px] leading-none mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {isListening
                ? mode === 'whisper' && isRecordingWhisper
                  ? '● Recording for Whisper…'
                  : '● Listening live…'
                : 'Click mic to start'}
            </p>
          </div>
        </div>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 hover:text-red-400"
          style={{ color: 'var(--text-muted)' }}
          onClick={onClose}
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1L11 11M11 1L1 11" />
          </svg>
        </button>
      </div>

      {/* Mode switcher */}
      <div className="px-4 pb-2 shrink-0">
        <div className="grid grid-cols-2 gap-1.5 rounded-xl p-1" style={{ background: 'var(--surface-soft)', border: '1px solid var(--panel-border)' }}>
          {([
            { id: 'web-speech', label: '⚡ Live (Web Speech)', desc: 'Real-time; uses Google cloud' },
            { id: 'whisper', label: '🎯 Whisper', desc: 'High accuracy (OpenAI key)' },
          ] as const).map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => { if (!isListening) setMode(id) }}
              disabled={isListening}
              className={`rounded-lg px-2.5 py-2 text-left transition-all disabled:opacity-50 ${mode === id ? 'velora-tab-active' : 'velora-tab-btn'}`}
            >
              <p className="text-[11px] font-semibold">{label}</p>
              <p className="text-[9px] mt-0.5 opacity-60">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Visualizer + mic button */}
      <div className="px-4 pb-3 shrink-0">
        <div className="flex items-center gap-4 rounded-2xl px-4 py-3" style={{ background: 'var(--surface-soft)', border: '1px solid var(--panel-border)' }}>
          <button
            onClick={handleToggleListening}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
            style={{
              background: isListening
                ? 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))'
                : 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(16,185,129,0.15))',
              border: `1.5px solid ${isListening ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.3)'}`,
              boxShadow: isListening ? '0 0 0 4px rgba(239,68,68,0.08)' : 'none',
            }}
            title={isListening ? 'Stop' : 'Start listening'}
          >
            {isListening ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="rgba(239,68,68,0.9)">
                <rect x="2" y="2" width="10" height="10" rx="2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8"  y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
          <AudioVisualizer active={isListening} />
        </div>
      </div>

      {/* Error */}
      {permError && (
        <div className="mx-4 mb-3 rounded-xl px-3 py-2 text-[11px] text-red-400 shrink-0"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {permError}
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col gap-2 overflow-hidden">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Transcript
          </p>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Auto-ask AI</span>
              <div
                onClick={() => setAutoRespond(v => !v)}
                className="relative h-4 w-7 rounded-full transition-colors cursor-pointer"
                style={{ background: autoRespond ? 'var(--accent-cyan)' : 'var(--surface-strong)', border: '1px solid var(--panel-border)' }}
              >
                <div className="absolute top-0.5 h-3 w-3 rounded-full transition-transform"
                  style={{ background: '#fff', transform: autoRespond ? 'translateX(14px)' : 'translateX(1px)', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
            </label>
          </div>
        </div>

        <div
          ref={transcriptScrollRef}
          className="flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-xl p-3 text-sm leading-relaxed"
          style={{ background: 'var(--surface-soft)', border: '1px solid var(--panel-border)', minHeight: 72 }}
        >
          {!finalTranscript && !interimTranscript ? (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {isListening ? 'Listening… speak now.' : 'Transcript will appear here.'}
            </span>
          ) : (
            <>
              <span>{finalTranscript}</span>
              {interimTranscript && (
                <span className="italic" style={{ color: 'var(--text-muted)' }}>{interimTranscript}</span>
              )}
            </>
          )}
        </div>

        {/* Transcript actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            disabled={!fullTranscript.trim() || isResponding}
            onClick={() => void askAI(fullTranscript)}
            className="velora-primary-btn flex-1 rounded-xl py-2 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isResponding ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="velora-dot-bounce h-1 w-1 rounded-full bg-white/70" />
                <span className="velora-dot-bounce h-1 w-1 rounded-full bg-white/70" />
                <span className="velora-dot-bounce h-1 w-1 rounded-full bg-white/70" />
              </span>
            ) : '🤖 Ask AI'}
          </button>
          <button
            disabled={!fullTranscript.trim()}
            onClick={() => onInsertToChat(fullTranscript.trim())}
            className="velora-pill flex-1 rounded-xl py-2 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ↗ Add to Chat
          </button>
          <button
            disabled={!fullTranscript && !aiResponse}
            onClick={handleClear}
            className="velora-pill rounded-xl px-3 py-2 text-[11px] font-semibold disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      {/* AI Response */}
      {(aiResponse || isResponding) && (
        <div className="px-4 pb-4 flex flex-col gap-2 shrink-0" style={{ maxHeight: 200 }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              AI Response
            </p>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Auto-add to chat</span>
              <div
                onClick={() => setSendResponseToChat(v => !v)}
                className="relative h-4 w-7 rounded-full transition-colors cursor-pointer"
                style={{ background: sendResponseToChat ? 'var(--accent-green)' : 'var(--surface-strong)', border: '1px solid var(--panel-border)' }}
              >
                <div className="absolute top-0.5 h-3 w-3 rounded-full transition-transform"
                  style={{ background: '#fff', transform: sendResponseToChat ? 'translateX(14px)' : 'translateX(1px)', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
            </label>
          </div>
          <div
            ref={responseScrollRef}
            className="overflow-y-auto custom-scrollbar rounded-xl p-3 text-[12px] leading-relaxed"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(16,185,129,0.04))', border: '1px solid rgba(59,130,246,0.2)', maxHeight: 120 }}
          >
            {isResponding && !aiResponse ? (
              <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-cyan)' }} />
                <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-blue)' }} />
                <span className="velora-dot-bounce h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
                <span className="text-[11px]">Generating response…</span>
              </div>
            ) : (
              <p style={{ color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>{aiResponse}</p>
            )}
          </div>
          {aiResponse && !sendResponseToChat && (
            <button
              onClick={() => onInsertToChat(aiResponse)}
              className="velora-pill self-end rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            >
              ↗ Add to Chat
            </button>
          )}
        </div>
      )}
    </div>
  )
}
