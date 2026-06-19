# OpenClaw Removal Migration — Progress

Branch: `clawster-remove-openclaw`
Started: 2026-06-18
Plan source: /plan-eng-review decisions D2-D19

## Architecture Decisions (from eng review)
- [x] D2: HMAC challenge-response for proxy auth
- [x] D3: ChatProvider interface upfront
- [x] D4: Server-side rate limiting on CF KV
- [x] D5: worker_threads for offline model (Phase 1)
- [x] D6: EventEmitter for online/offline mode state
- [x] D7: Decompose main.ts during Phase 0
- [x] D8: Defer vision to Phase 1
- [x] D9: Simplify response parser to single format
- [x] D10: Consolidate StoreSchema types
- [x] D11: Full test suite (vitest + Playwright)
- [x] D12: Lazy load + idle unload for offline model
- [x] D13: Keep full scope, extend to 3-4 weeks
- [x] D14: Keep Transformers.js for offline classifier
- [x] D15: OpenAI Moderation API in Phase 0 proxy
- [x] D16: Lightweight local event logging
- [x] D17-D19: TODOs captured

## Implementation Tasks
- [x] T5: Delete OpenClaw references (workspace browser, cron, gateway UI) — renderer done, -2530 lines
- [x] T6: Consolidate StoreSchema types — done in T5 commit
- [x] T2: ChatProvider interface + CloudChatProvider — done, +490/-843 lines, build passes, app launches
- [x] T3: Decompose main.ts — 1196 lines (was 3351), extracted speech/pet-behaviors/screen-capture/windows
- [x] T4: Onboarding flow rewritten in T5 commit (removed Connection/Workspace/Memory steps)
- [x] T1: Cloudflare Worker proxy — HMAC auth, KV rate limiting, OpenAI Moderation API
- [x] T8: Local event logging — app_launched, chat_sent, pet_clicked, pet_dragged, onboarding_completed
- [x] T7: vitest test suite — 27 tests, 4 files (HMAC auth, action parser, event logger, proxy compat)
- [x] T9: Worker budget caps — monthly cap + global:disabled kill switch built into T1

- [x] T10: Integrate fine-tuned Qwen 1.5B via Ollama — ChatRouter, LocalToolProvider, tool executor
- [x] T11: Port eval framework — 89+56 test cases, multi-provider benchmarking

## Benchmark Results
| Provider | Tool Acc | Args Acc | Latency p50 |
|----------|----------|----------|-------------|
| GPT-4o-mini (cloud) | 88.8% | 92.4% | 740ms |
| Fine-tuned Qwen 1.5B Q4 (local) | 95.5% | 93.4% | 328ms |

- [x] T12: Implement all pending tools (weather, timer, reminder, calendar, music)
- [x] T13: E2E tool executor tests (14 tests)
- [x] T14: Local-only architecture (no cloud dependency for basic usage)
- [x] T15: Conversation latency optimized to ~170ms (single-model, Q4 quantized)
- [x] T16: Interaction logger (JSONL at ~/.clawster/interactions/)
- [x] T17: Expose all 14 pet animation states to model
- [x] T18: Emotion engine (valence/arousal model, context-driven, conversation-aware)
- [x] T19: Mood field in training data (404 examples with emotional tags)

## Retrain Needed
The following changes require one model retrain to take effect:
- `list_files` tool (20 training examples)
- All 14 mood states (29 examples)
- Inline conversation responses with mood tags (77 examples)
- Run: `cp eval/train-data/*.jsonl ../clawster/eval/train-data/ && retrain`

## Progress Log
