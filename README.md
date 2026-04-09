# Velora Desktop

Velora is an Electron + React desktop assistant for instant on-screen understanding.

## Tech Stack

- Electron + TypeScript (main process, preload, global shortcuts)
- React + TypeScript + Vite (renderer UI)
- Tailwind CSS (styling)
- Zustand (local-first state + chat history persistence)

## Implemented MVP Features

- Floating always-on-top compact widget
- Expandable assistant panel with chat layout
- Screenshot capture and image-to-model request support
- Quick actions: Explain, Summarize, Solve, Simplify, Translate
- Model selector: GPT, Claude, Gemini
- BYOK settings (keys encrypted at rest using Electron safeStorage)
- Local conversation history with search
- Global shortcuts:
  - Cmd/Ctrl + Shift + V: Show/Hide Velora
  - Cmd/Ctrl + Shift + S: Trigger capture
  - Cmd/Ctrl + Shift + E: Set Explain mode
- Screen Share Safety Mode (transparent privacy mode that hides the overlay while enabled)

## Added Product Features

- Authentication with Supabase (Sign In / Sign Up)
- Cloud sync option for accounts (chat logs + app workspace state)
- Local save toggle and cloud save toggle in settings
- Personalization profile:
  - Preferred name
  - Response tone
  - Learning goal
  - Custom instructions
- Memory system:
  - Add memory notes
  - Pin memory notes that are injected into prompts
- Topics tab:
  - Create topics
  - Add sources (image/text/url)
  - Free-tier source visibility rules
- Folders tab:
  - Create folders
  - Assign chats to folders
- Bookmarks tab:
  - Bookmark important responses
  - Jump back to original chat quickly
- Chatlogs tab:
  - Search and navigate chat history

## Run

```bash
npm install
npm run dev
```

## Supabase Setup

1. Copy `.env.example` to `.env` or `.env.local` and set values:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

2. Optional shared API keys for DeepSeek / Gemini (otherwise users rely on BYOK in Settings):

```bash
VELORA_BUILTIN_DEEPSEEK_KEY=...
VELORA_BUILTIN_GEMINI_KEY=...
```

3. Run SQL in your Supabase project:

```sql
-- use file: supabase/schema.sql
```

This creates the `velora_user_state` table with row-level security for per-user cloud sync.

## Build

```bash
npm run build
```

## Download

Public releases are available at **[veloraapp.xyz](https://veloraapp.xyz)**.

| Platform | Installer |
|----------|-----------|
| macOS (Apple Silicon) | `Velora-x.x.x-mac-arm64.dmg` |
| macOS (Intel) | `Velora-x.x.x-mac-x64.dmg` |
| Windows | `Velora-x.x.x-win-x64.exe` (NSIS installer) |

## Distribution

### Publishing a new release

1. Bump `version` in `package.json`.
2. Push a git tag: `git tag v1.2.0 && git push origin v1.2.0`
3. GitHub Actions (`.github/workflows/release.yml`) builds for macOS and Windows, then publishes artifacts **directly to GitHub Releases** with `electron-builder --publish always`.
4. `electron-updater` in existing installs automatically picks up the update via the `latest.yml` / `latest-mac.yml` feeds on the next check (8 s after launch, then every 4 hours).

### Required GitHub Secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `GH_TOKEN` | **Yes** | Upload to GitHub Releases (needs `repo` scope) |
| `VITE_SUPABASE_URL` | Yes | Supabase URL baked into renderer |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `VELORA_BUILTIN_DEEPSEEK_KEY` | No | Bundled DeepSeek key |
| `VELORA_BUILTIN_GEMINI_KEY` | No | Bundled Gemini key |
| `MAC_CERTS` | No | base64 `.p12` — enables macOS code signing |
| `MAC_CERTS_PASSWORD` | No | Password for `MAC_CERTS` |
| `APPLE_ID` | No | Apple ID email for notarization |
| `APPLE_ID_PASSWORD` | No | App-specific password for notarization |
| `APPLE_TEAM_ID` | No | Apple Developer Team ID |
| `WIN_CERT` | No | base64 `.p12` — removes Windows SmartScreen warning |
| `WIN_CERT_PASSWORD` | No | Password for `WIN_CERT` |

### Local builds

```bash
npm run dist:mac    # macOS only (must run on macOS)
npm run dist:win    # Windows only (must run on Windows)
npm run dist:linux  # Linux AppImage
```

### What end users see without code signing

- **macOS:** Gatekeeper may block the first launch → right-click → Open, or System Settings → Privacy & Security → "Open Anyway".
- **Windows:** SmartScreen "Unknown publisher" warning → click *More info* → *Run anyway*.

Adding code signing certificates (Apple Developer ID + Windows Authenticode) eliminates both warnings and is strongly recommended for public releases.

### App icons

Place `build/icon.icns` (macOS), `build/icon.ico` (Windows), and `build/icon.png` (Linux) before building. See `build/ICONS.md` for generation instructions.

### In-app auto-update

`electron-updater` is integrated. Installed users are notified automatically when a new GitHub Release is published — no manual download needed after the first install.

### Privacy during screen sharing

Velora includes **Screen Share Safety Mode**, **capture protection**, and an optional **stealth overlay** so the assistant is less visible to screen capture in normal collaboration scenarios. These features are for legitimate privacy and workflow control, not for circumventing exam or institution policies.

## Notes

- If no API key is configured for a selected provider, Velora returns a local demo response.
- API keys are stored locally on device and encrypted when platform encryption is available.
- If Supabase is not configured, authentication and cloud sync are disabled while local mode still works.
