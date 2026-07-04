<!-- Generated: 2026-06-25 | Updated: 2026-06-25 -->

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
| `.github/workflows/` | CI: `release.yml` (build + notarize), `update-landing.yml` |

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

### Testing Requirements
- `npm test` — Vitest unit tests (no external services needed)
- `npm run test:e2e` — Playwright E2E (needs Vite dev server + optionally Ollama)
- `npx tsc --noEmit` — Type checking

### Build & Release
- `npm run dist:mac` — Build + notarize for macOS
- Tag `vX.Y.Z` and push to trigger CI release via GitHub Actions
- Auto-update via `electron-updater` checks GitHub Releases

### Testing Gotchas
- Use `vi.mock('electron')`, never `vi.doMock` — known Vitest bug (#4166) leaves exports undefined
- Unit tests that route through `executeTool` (e.g. via `ChatRouter.chat`) must also `vi.mock('child_process')` — otherwise `tool-executor.ts` runs real `osascript` against macOS apps, which can stall under parallel test load (see `test/quick-replies.test.ts`)
- Integration tests (`test/e2e-*.test.ts`) need Ollama running — they skip gracefully if unavailable
- E2E tests use `CLAWSTER_DATA_DIR` env var to isolate test data from real user data

### Model Conversion Pipeline
When fine-tuning a new local model:
1. HuggingFace safetensors → GGUF F16 (via `llama.cpp/convert_hf_to_gguf.py`)
2. GGUF F16 → Q4_K_M quantization (via `llama-quantize`)
3. Register with Ollama via `Modelfile` → `ollama create`
4. Training data in `eval/train-data/` (JSONL format)

<!-- MANUAL: -->
