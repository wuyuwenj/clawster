<!-- Generated: 2026-06-25 | Updated: 2026-07-11 -->

# Clawster

## Purpose
AI desktop pet for macOS — an animated lobster that lives on your screen, watches what you're doing, and helps you via tool calling, screen analysis, and memory. Electron app with React renderer, hybrid local + cloud AI architecture.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Dependencies, scripts (`npm start`, `npm test`, `npm run dist:mac`) |
| `tsconfig.json` | Root TypeScript config (references `tsconfig.main.json`, `tsconfig.node.json`) |
| `vite.config.ts` | Vite build config for Electron renderer |
| `vitest.config.ts` | Test runner config (Vitest) |
| `playwright.config.ts` | E2E test config (Playwright) |
| `CLAUDE.md` | Project instructions for Claude Code |
| `README.md` | User-facing documentation |
| `tailwind.config.js` | Tailwind CSS config for renderer |
| `.github/CODEOWNERS` | Safety filter + its tests require owner review |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Application source — `main/` (Electron backend), `renderer/` (React UI), `shared/` (types) |
| `proxy/` | Cloudflare Worker proxy for cloud AI (see `proxy/AGENTS.md`) |
| `eval/` | Model evaluation framework and fine-tuning data (JSONL) |
| `test/` | Vitest test suite (unit + integration) |
| `e2e/` | Playwright E2E tests |
| `assets/` | Icons, animations (SVG), screenshots |
| `clawster-assets/` | Lobster sprite parts for animation |
| `personality/` | Default personality files (IDENTITY.md, SOUL.md) and presets |
| `scripts/` | Build helper scripts (icon builder, speech helper) |
| `.github/workflows/` | CI: `ci.yml` (test + safety checks for staging), `release.yml` (build + notarize), `update-landing.yml` |
| `.no-mistakes/evidence/` | Committed E2E evidence screenshots for PR review, grouped per issue (e.g. `cla50/`) |

## For AI Agents

### Architecture Overview
```
User message
  ├─ Local model (Qwen, fine-tuned, via Ollama) → tool classification
  ├─ Cloud proxy (Cloudflare Worker → GPT-4o-mini) → conversation + vision
  └─ Memory layer (SQLite via better-sqlite3) → facts + emotional memories
```

### Working In This Directory
- Main process code is in `src/main/`, renderer in `src/renderer/`
- The proxy is a separate Cloudflare Worker in `proxy/` with its own `package.json`
- HMAC authentication links the client and proxy (shared secret)
- Local model requires Ollama running at `localhost:11434`
- Electron's native `win.setPosition(x, y)` throws a hard `TypeError` ("Error processing argument at index N, conversion failure") on any argument V8 doesn't treat as an Int32 — NaN, ±Infinity, non-integers, and **negative zero**. The CLA-56 crash was `-0`: an unclamped drag parked the pet above the top edge (negative y), and `Math.round` in the move animation returned `-0` on frames easing across zero (`-0` passes `Number.isFinite`). Guard coords with `areUsableCoords` (`pet-behaviors.ts`), normalize with `+ 0` before the native sink, and clamp drags via `clampPetPosition` (`windows.ts`). Note the store cannot be poisoned with NaN (`JSON.stringify(NaN)` is `null`), but `resolvePetStartPosition` still guards startup against `Infinity` (`1e999` parses as Infinity) and partial/stringified legacy values
- Renderer behavior that needs unit tests lives in pure logic modules (no React/Electron imports) next to the component, e.g. `src/renderer/pet/emote-bubbles.ts` — the Vitest suite runs in a node environment with no DOM
- Main broadcasts companion-window visibility to the pet window on the `pet-ui-visibility` channel (chatbar/pet-chat/assistant show+hide+close, plus once on pet-window load); the pet uses it for the chatbar→curious mood (CLA-27) and emote-bubble suppression (CLA-13). Gotcha: on Electron 28.3.3/macOS the BrowserWindow `show`/`hide` events never fire, so `windows.ts` also broadcasts explicitly at the chatbar show()/hide() call sites — hide the chatbar via `hideChatbarWindow()` (as the `close-chatbar` IPC and toggle do), never a bare `.hide()`, or the pet stays curious. A last-payload dedup guard keeps the pet from receiving the same state twice where the events do fire; it resets when the pet window (re)loads
- The `pet.muted` setting (Assistant panel toggle) silences both of Clawster's sound sources (CLA-52). Main pushes changes to the **pet-chat** window on the `pet-muted-changed` channel — that window owns the Animalese engine, so sending to the pet window would never gate the voice — and `main.ts` calls `setMutedProvider` so `chat/tool-executor.ts` can raise notifications with `silent: true`. The engine seeds itself from persisted settings on the first utterance and applies later changes mid-utterance; character timing is unchanged when muted
- Persona must never leak implementation internals to the child audience. "Are you real / are you AI / is someone typing" probes are caught deterministically in `chat-router.ts` via `isIdentityProbe()` (before the tool classifier, like the emotional-message path) and answered in character by `getIdentityResponse()` — the fine-tuned model otherwise blurts "...respond with JSON only" (CLA-38). The persona prompts (`system-prompt.ts`, `tool-definitions.ts`, the local naturalization prompt, `personality/IDENTITY.md`+`SOUL.md`) also carry a "stay in character, never mention JSON/prompts/models/tools/AI" guard as defense-in-depth
- Tidepool is a **toggleable "Light" theme** (CLA-58); **dark is the default**. Theme tokens live in `src/renderer/styles/theme.css`: bare `:root` = dark (flat, pre-Tidepool look), `:root[data-theme="light"]` = Tidepool. It defines the `--tp-*` tokens (colors + structure: `--tp-outline`, `--tp-sticker-shadow`, `--tp-candy-shadow`, `--tp-spring`, `--tp-font-round`, warm-literal tokens) AND `--app-*` semantic tokens (`--app-bg`, `--app-surface`, `--app-text`, `--app-muted`, `--app-border`, `--app-accent`, `--app-bg-deep`, `--app-track`, `--app-surface-hover`) for surfaces that were hardcoded-dark. `src/renderer/styles/tidepool.css` now holds only the Tidepool component classes (`.tp-capsule`/`.tp-bubble`/`.tp-chip`/`.tp-candy`/`.markdown-message`), all token-driven so they flip automatically. Nunito is bundled via `@fontsource/nunito` (Latin subsets, no runtime fetch) but only applied in Light (`--tp-font-round` is a system stack in dark).
- Theme wiring: setting is `appearance.theme` (store default `'dark'`). Every renderer entry (`*/main.tsx`) calls `initTheme()` from `src/renderer/theme.ts` — reads the persisted theme via `getSettings()`, sets `document.documentElement.dataset.theme`, subscribes to `onThemeChanged`. The Settings toggle (Assistant "Appearance" group) calls `updateSettings('appearance.theme', …)`; `main.ts` broadcasts `theme-changed` to every window (live, no restart) and repaints the opaque windows' `backgroundColor` via `applyThemeToWindows` (chatbar/assistant/onboarding — `windows.ts` `OPAQUE_WINDOW_BG`). Dark stays visually the pre-Tidepool look on every surface; Light restyles all of them (chatbar, pet-chat, assistant/settings, onboarding, context menu, screenshot-question, tutorial overlay).
- **Audio safety in tests:** `animalese.speak()` is a no-op when `window.clawster.audioMuted` is true (`NODE_ENV==='test'` or `CLAWSTER_MUTE_AUDIO=1`, exposed by preload), and `e2e/helpers.ts` passes Chromium `--mute-audio`. The mic is only opened by the `speech-start` IPC (never on launch), so screenshot/e2e runs never play sound or open the microphone.
- The chatbar `BrowserWindow` is opaque (`transparent: false`, `backgroundColor` follows the theme — dark `#0f0f0f` / light shell cream `#FFF9F2`, opens at 650×300, user-resizable down to 300×80, no renderer resize IPC) — the renderer must paint the entire window an opaque surface; the pet-chat window IS transparent and self-resizes via `resize-pet-chat`

### Testing Requirements
- `npm test` — Vitest unit tests (no external services needed)
- `npm run test:e2e` — Playwright E2E (needs Vite dev server + optionally Ollama)
- `npx tsc --noEmit` — Type checking
- CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `staging`: a `test` job (type check + full Vitest suite) and a separate `safety` job (child-safety tests: `test/safety-filter.test.ts`, `test/open-url-safety.test.ts`)

### Visual verification of UI changes (CLA-57 convention)
A UI change is **not done** until the rendered pixels change (or match an intended baseline) — not when a flag flips or a DOM node exists. On CLA-27 a "curious mood" e2e passed on a mood-flag assertion, yet the owner viewed the screenshots and the sprite looked identical: a false pass. So:

- **UI-changing PRs must assert on renders** through the shared helper `e2e/visual-diff.ts` — capture a surface before/after and `assertVisiblyDiffers` (or `assertVisiblyMatches` against an intended baseline). Comparison is masked + thresholded (pixelmatch, AA excluded), never raw pixel equality, so anti-aliasing / font rendering / 1px shifts don't cause false diffs; mask animated or non-deterministic regions with the `mask` option.
- **Reference example:** `e2e/chatbar-curious.spec.ts` (idle → curious). Copy its shape for new UI specs (theme/Tidepool, poses, panels, …).
- **The author must VIEW the renders before "done"** and confirm they match intent. Pass `evidenceDir` so the helper writes the real `*-before.png` / `*-after.png` / `*-diff.png`; open them (commit under `.no-mistakes/evidence/<issue>/` for PR review). A green pixel-diff number alone is not confirmation — look at the images.
- **Audio safety:** every Electron/e2e launch goes through `launchApp` (`e2e/helpers.ts`), which passes `--mute-audio` and Chromium fake-media-device flags so a test never opens the real microphone or plays sound on the dev machine.
- Pure comparison logic (`compareBuffers`, masking, thresholds) is unit-tested in `test/visual-diff.test.ts` — no browser, so it also documents the false-pass it prevents.

### Build & Release
- `npm run dist:mac` — Build + notarize for macOS
- Tag `vX.Y.Z` and push to trigger CI release via GitHub Actions
- Auto-update via `electron-updater` checks GitHub Releases

### Testing Gotchas
- Use `vi.mock('electron')`, never `vi.doMock` — known Vitest bug (#4166) leaves exports undefined
- Unit tests that route through `executeTool` (e.g. via `ChatRouter.chat`) must also `vi.mock('child_process')` — otherwise `tool-executor.ts` runs real `osascript` against macOS apps, which can stall under parallel test load (see `test/quick-replies.test.ts`)
- Integration tests (`test/e2e-*.test.ts`) need Ollama running — they skip gracefully if unavailable
- E2E tests use `CLAWSTER_DATA_DIR` env var to isolate test data from real user data
- E2E specs save screenshots when the `EVIDENCE_DIR` env var is set (skipped otherwise) — evidence for PR review is committed under `.no-mistakes/evidence/`
- E2E specs that assert on a chat popup must seed `permissionDeclines: { hintShown: true }` into `clawster-config.json` alongside the `onboarding`/`tutorial` flags — otherwise the first-launch permissions hint fires ~5s in, pushes its own popup, and replaces the bubble under test (see `e2e/cla58-tidepool-restyle.spec.ts`)
- E2E specs that compare screenshots diff them with `pixelmatch` + `pngjs` (dev dependencies). `e2e/cla58-tidepool-restyle.spec.ts` writes captures to `test-results/cla58/` by default; set `CAPTURE_BASELINE=1` (before-shots) or `CAPTURE_EVIDENCE=1` (after-shots) to redirect them to `.no-mistakes/evidence/cla58/` instead

### Model Conversion Pipeline
When fine-tuning a new local model:
1. HuggingFace safetensors → GGUF F16 (via `llama.cpp/convert_hf_to_gguf.py`)
2. GGUF F16 → Q4_K_M quantization (via `llama-quantize`)
3. Register with Ollama via `Modelfile` → `ollama create`
4. Training data in `eval/train-data/` (JSONL format)

<!-- MANUAL: -->
