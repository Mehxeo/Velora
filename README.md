# Velora

**Velora** is a cross-platform desktop app (Electron + React) that helps you understand what’s on your screen: capture, chat with AI models, and use a compact floating widget with global shortcuts.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-veloraapp.xyz-6366f1)](https://veloraapp.xyz)

---

## Install

**Recommended:** download installers from **[GitHub Releases](https://github.com/Mehxeo/velora/releases/latest)**.

You can also get builds from **[veloraapp.xyz](https://veloraapp.xyz)**.

| Platform | Typical file |
|----------|----------------|
| macOS (Apple Silicon) | `Velora-*-mac-arm64.dmg` |
| macOS (Intel) | `Velora-*-mac-x64.dmg` |
| Windows | `Velora-*-win-x64.exe` (NSIS installer) |
| Linux | `Velora-*-linux-x64.AppImage` |

**macOS:** If Gatekeeper blocks the app the first time, right-click the app → **Open**, or use **System Settings → Privacy & Security → Open Anyway**.

**Windows:** If SmartScreen appears, use **More info** → **Run anyway** (strongly reduced when the app is signed with an Authenticode certificate).

**Updates:** Installed builds use `electron-updater` and check GitHub Releases for new versions.

---

## What you can do

- **Floating widget** — Always-on-top compact window with shortcuts.
- **Main panel** — Full chat UI with history, folders, bookmarks, topics, and memory snippets.
- **Screen + AI** — Capture the screen and send context to GPT, Claude, Gemini, DeepSeek, Ollama (model-dependent).
- **Quick actions** — Explain, summarize, solve, simplify, translate, and more.
- **BYOK** — Bring your own API keys; stored locally and encrypted with the OS where available.
- **Optional account** — Supabase sign-in and cloud sync of workspace state (chats, settings) when configured.
- **Privacy tools** — Screen Share Safety Mode, capture protection, optional stealth overlay (see in-app descriptions).

---

## Configuration (optional)

### API keys

Add keys in **Settings** inside the app. If a provider has no key, Velora may show a short placeholder response for that model.

### Supabase (auth + cloud sync)

1. Create a Supabase project and run the SQL in **`supabase/schema.sql`** (creates `velora_user_state` with RLS).
2. For **local dev**, set in `.env` or `.env.local`:

   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Optional CI / release env vars are listed in **Contributing** and `.github/workflows/release.yml`.

Without Supabase, the app runs in **local-only** mode (no sign-in or cloud sync).

---

## Development

```bash
git clone https://github.com/Mehxeo/velora.git
cd velora
npm ci
npm run dev
```

- **`npm run build`** — Production bundle (renderer + Electron main/preload).
- **`npm run lint`** — ESLint.

Contributor workflow, release tagging, and CI details: **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**.

---

## Tech stack

| Layer | Notes |
|-------|--------|
| **Electron** | Main process, preload, IPC, global shortcuts, secure storage, auto-update |
| **React + Vite** | Renderer UI |
| **Tailwind CSS** | Styling |
| **Zustand** | Local-first state and persistence |

---

## Building distributables locally

```bash
npm run dist:mac     # macOS only
npm run dist:win     # Windows only
npm run dist:linux   # Linux AppImage
```

Place platform icons at `build/icon.icns`, `build/icon.ico`, and `build/icon.png` as referenced from `package.json`.

---

## Repository layout

| Path | Purpose |
|------|---------|
| `electron/` | Main process, preload, IPC |
| `src/` | React application |
| `supabase/` | SQL for optional cloud sync |
| `.github/workflows/` | CI (e.g. release builds on `v*` tags) |

---

## Security & privacy

- API keys stay on the device (encrypted when the platform supports it).
- Screen / privacy-related features are intended for legitimate workflow and privacy needs, not for bypassing institutional or exam rules.

For security vulnerabilities, please report privately to the maintainers (e.g. via GitHub Security Advisories if enabled on the repo).

---

## License

**MIT** — see [LICENSE](LICENSE).

---

## Links

| Resource | URL |
|----------|-----|
| Website | [veloraapp.xyz](https://veloraapp.xyz) |
| Releases | [GitHub Releases](https://github.com/Mehxeo/velora/releases) |
| Contributing | [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) |
