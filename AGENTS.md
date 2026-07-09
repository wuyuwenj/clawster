<!-- Generated: 2026-06-25 | Updated: 2026-07-06 -->

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
- Main broadcasts companion-window visibility to the pet window on the `pet-ui-visibility` channel (chatbar/pet-chat/assistant show+hide+close, plus once on pet-window load); the pet uses it for the chatbar→curious mood (CLA-27) and emote-bubble suppression (CLA-13)
- The `pet.muted` setting (Assistant panel toggle) silences both of Clawster's sound sources (CLA-52). Main pushes changes to the **pet-chat** window on the `pet-muted-changed` channel — that window owns the Animalese engine, so sending to the pet window would never gate the voice — and `main.ts` calls `setMutedProvider` so `chat/tool-executor.ts` can raise notifications with `silent: true`. The engine seeds itself from persisted settings on the first utterance and applies later changes mid-utterance; character timing is unchanged when muted

### Testing Requirements
- `npm test` — Vitest unit tests (no external services needed)
- `npm run test:e2e` — Playwright E2E (needs Vite dev server + optionally Ollama)
- `npx tsc --noEmit` — Type checking
- CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `staging`: a `test` job (type check + full Vitest suite) and a separate `safety` job (child-safety tests: `test/safety-filter.test.ts`, `test/open-url-safety.test.ts`)

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

### Model Conversion Pipeline
When fine-tuning a new local model:
1. HuggingFace safetensors → GGUF F16 (via `llama.cpp/convert_hf_to_gguf.py`)
2. GGUF F16 → Q4_K_M quantization (via `llama-quantize`)
3. Register with Ollama via `Modelfile` → `ollama create`
4. Training data in `eval/train-data/` (JSONL format)

<!-- MANUAL: -->
