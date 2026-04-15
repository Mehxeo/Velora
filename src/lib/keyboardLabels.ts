/** Renderer-only: detect macOS for shortcut labels (Option vs Alt, ⌘ vs Ctrl). */
export function isMacOSClient(): boolean {
  if (typeof window !== 'undefined' && window.velora?.platform) {
    return window.velora.platform === 'darwin'
  }
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform ?? '')
}

/** Compact badge text for global shortcuts (sidebar, etc.). */
export function formatGlobalShortcutDisplay(raw: string): string {
  const mac = isMacOSClient()
  let s = raw.trim()
  if (mac) {
    s = s.replace(/\bAlt\b/gi, 'Option')
    s = s.replace(/CommandOrControl/g, '⌘')
  } else {
    s = s.replace(/CommandOrControl/g, 'Ctrl')
  }
  s = s.replace(/\bShift\b/g, '⇧')
  return s.split('+').map((p) => p.trim()).filter(Boolean).join('·')
}

/** Placeholder for shortcut inputs (Electron accepts Alt or Option on macOS). */
export function widgetShortcutPlaceholder(): string {
  return isMacOSClient() ? 'e.g. Option+Space' : 'e.g. Alt+Space'
}

/** Show Option on Mac in inputs; keep stored / Electron format as Alt. */
export function normalizeShortcutForDisplay(raw: string): string {
  if (!isMacOSClient()) return raw
  return raw.replace(/\bAlt\b/gi, 'Option')
}

export function normalizeShortcutForStorage(raw: string): string {
  return raw.replace(/\bOption\b/gi, 'Alt')
}
