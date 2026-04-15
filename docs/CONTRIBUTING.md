# Contributing to Velora

Thanks for your interest in the project. This document is for anyone cloning the repo, opening issues, or submitting changes.

## Getting started

1. **Clone** the repository and install dependencies:

   ```bash
   git clone https://github.com/Mehxeo/velora.git
   cd velora
   npm ci
   ```

2. **Run in development** (Vite + Electron with hot reload for the main process build):

   ```bash
   npm run dev
   ```

3. **Lint** before pushing:

   ```bash
   npm run lint
   ```

## Environment variables

For local development, copy `.env.example` to `.env` or `.env.local` if present, or create `.env.local` with:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (auth + cloud sync) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VELORA_BUILTIN_DEEPSEEK_KEY` | Optional bundled DeepSeek key for defaults |
| `VELORA_BUILTIN_GEMINI_KEY` | Optional bundled Gemini key for defaults |

If Supabase variables are missing, the app still runs in local-only mode (no sign-in or cloud sync).

Apply the SQL in `supabase/schema.sql` to your Supabase project if you use cloud sync.

## Building installers locally

| Command | Platform |
|---------|----------|
| `npm run dist:mac` | macOS (run on a Mac) |
| `npm run dist:win` | Windows (run on Windows) |

Unsigned builds may trigger Gatekeeper (macOS) or SmartScreen (Windows); see the main README for end-user workarounds. Release CI currently ships **macOS and Windows** only.

## Release builds (maintainers)

Releases are automated via `.github/workflows/release.yml` when you push a version tag `v*`.

1. Bump `version` in `package.json`.
2. Commit and push a tag: `git tag v1.2.3 && git push origin v1.2.3`.

The workflow creates the GitHub Release and runs `electron-builder --publish always` on macOS and Windows runners. Required secrets are documented in the workflow file header and in the main README.

### CI note: Windows publish

GitHub asset uploads are large; `package.json` sets a longer `build.publish[].timeout` for the GitHub publisher. The Windows job retries failed publishes a few times to handle transient network issues. Avoid defining multiple Windows targets that produce the **same** `artifactName` (e.g. NSIS + portable with identical names), or uploads can conflict on the release.

## Public download page (GitHub Pages)

The `docs/` folder includes `index.html`, a static page that calls the GitHub API and lists **Download** buttons for the latest release assets (Windows `.exe`, macOS `.dmg` and optional `.zip`).

- Workflow: `.github/workflows/pages.yml` pushes `docs/` to the **`gh-pages`** branch using [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) (no separate Pages API token required).
- **One-time setup:** After the first successful workflow run, open **Settings → Pages → Build and deployment** and set **Source** to **Deploy from a branch**, **Branch** `gh-pages`, folder **`/`** (root), then save. GitHub may also offer to enable this when `gh-pages` first appears.
- Typical URL: `https://<user>.github.io/<repo>/` (for example `https://mehxeo.github.io/velora/`).

## Code layout

- **`docs/`** — GitHub Pages download landing (`index.html`) and this guide.
- **`electron/`** — Main process (`main.ts`), preload (`preload.ts`), IPC, shortcuts, updater.
- **`src/`** — React renderer (UI, state, Supabase client).
- **`build/`** — Icons, macOS entitlements, etc.
- **`supabase/`** — SQL schema for optional cloud state.

## Issues and pull requests

- Use GitHub Issues for bugs and feature ideas. Include OS version, Velora version, and steps to reproduce when reporting bugs.
- Keep PRs focused; match existing TypeScript/React style and run `npm run lint`.

## License

By contributing, you agree that your contributions are licensed under the same [MIT License](../LICENSE) as the project.
