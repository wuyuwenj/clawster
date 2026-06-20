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

## OpenClaw Capability Parity Features
Bringing Clawster to OpenClaw feature parity (top = highest priority).
- [x] P1: Multi-turn memory — wire last 3 messages into classify()
- [x] P2: Shell command execution (run_shell + native confirmation dialog)
- [x] P3: System controls (volume/brightness/DND/battery/lock via osascript)
- [ ] P4: iMessage integration (send_message + confirmation)
- [ ] P5: Clipboard tools (read_clipboard, summarize_clipboard)
- [ ] P6: Screen analysis (take_screenshot → cloud model)
- [ ] P7: Focus mode (block_apps for N minutes)
- [ ] P8: Personalization memory (~/.clawster/prefs.json → system prompt)
- [ ] P9: Close/quit app (close_app via osascript)
- [ ] P10: Time/date (what_time, day of week, countdowns)
- [ ] P11: Natural conversation (inline personality responses)
- [ ] P12: Contextual quick replies (dynamic buttons by tool/mood)

## Retrain Needed
The following changes require one model retrain to take effect:
- `list_files` tool (20 training examples)
- All 14 mood states (29 examples)
- Inline conversation responses with mood tags (77 examples)
- **Multi-turn follow-ups (P1)** — 16 multi-turn examples teaching context resolution
  ("how about downloads?" after "what's on my desktop?"); v4 model already
  conditions on history but doesn't fully exploit it (e.g. "now do safari" →
  open_url instead of open_app). Retrain will fix.
- **run_shell (P2)** — 14 examples. v4 model has never seen run_shell, so it
  hallucinates tool names (run_git_status, execute) which chat-router's
  isFalsePositiveTool guard drops → no runtime breakage, but run_shell won't
  fire until retrain.
- **system_control (P3)** — 16 examples. v4 hallucinates (set_mood{loud},
  get_battery) → dropped by guard. Won't fire until retrain.
- **⚠️ RETRAIN DUE: P1+P2+P3 = 3 features.** Retraining now per cadence rule.
- Run: `cp eval/train-data/*.jsonl ../clawster/eval/train-data/ && retrain`

## Progress Log

### 2026-06-20 — P1: Multi-turn memory (shipped)
- **Runtime wiring:** `ChatRouter.chat`/`chatStream` now pass conversation
  `history` through to `LocalToolProvider.classify(input, history)` (previously
  dropped as `_history`). Added `prepHistory()`: strips `[Screen Context: …]`
  prefixes from prior turns, drops empties, keeps last 3.
- **Eval harness:** `Provider` type + OpenAI/Anthropic/Local/Ollama adapters now
  accept optional `history`; runner passes `tc.history`. `TestCase` gained an
  optional `history` field; added 6 multi-turn cases (`multiturn` category, 109
  total cases).
- **Training data:** `Example` gained optional `context`; `toMLXChatFormat`
  interleaves prior turns. Added 16 multi-turn examples → 432 total examples.
- **Tests:** new `test/chat-router-history.test.ts` (5 cases) — passes history
  through both chat paths, strips screen context, slices to 3, drops empties,
  defaults to empty. Suite: 65 passed (was 60). Build green.
- **Live check (clawster-tool-v4-q4):** history flows to model; "what about
  tomorrow?" after calendar → get_calendar_events{tomorrow}; no regression on
  no-context cases. Full context exploitation pending next retrain.

### 2026-06-20 — P2: Shell command execution (shipped)
- **run_shell tool** in tool-executor.ts, gated behind a `setConfirmCallback`
  approval gate. Safe default: when no callback is registered, it does NOT
  execute. Output captured (15s timeout, 1MB buffer), truncated to 1500 chars.
- **Native confirmation dialog** wired in main.ts via `dialog.showMessageBox`
  (Run/Cancel, default Cancel) showing the exact command — cannot be bypassed,
  nothing runs without an explicit click.
- **Catastrophic denylist** (`CATASTROPHIC_PATTERNS`): refuses `rm -rf /`/`~`,
  fork bombs, mkfs, `dd of=/dev/*`, shutdown/reboot/halt, disk overwrite/erase —
  even with approval (never even asks). Targeted `rm -rf /tmp/foo` still allowed
  but requires confirmation.
- **Definitions:** added to TOOL_PROMPT + new `CONFIRM_TOOLS` export; added to
  chat-router `KNOWN_TOOLS`.
- **Eval/training:** 5 shell eval cases (114 total), 14 run_shell training
  examples (446 total).
- **Tests:** 6 new gate tests in e2e-tool-executor (no-callback → no exec,
  decline → no exec, approve → exec+output, catastrophic refused, fork bomb
  refused, empty asks). Suite: 71 passed (was 65). Build green.
- **Live check:** v4 model never trained on run_shell → hallucinates tool names,
  dropped by isFalsePositiveTool guard (no breakage). Executor safety gate
  verified directly: echo runs, rm -rf / + fork bomb + shutdown refused.

### 2026-06-20 — P3: System controls (shipped)
- **system_control tool** (single tool, action enum — easier for 1.5B model than
  12 separate tools, matching play_music pattern). Actions: volume_up/down,
  mute/unmute, set_volume(value), brightness_up/down, battery, lock_screen,
  sleep, dnd_on/dnd_off. All via osascript/pmset one-liners. No confirmation
  (all benign/reversible). Action strings normalized (lowercase, spaces/hyphens
  → underscore).
- **Notes:** brightness uses System Events key codes 144/145 (needs Accessibility
  permission, built-in display). DND uses legacy NotificationCenter toggle —
  best-effort, may be a no-op on Focus-based macOS (documented limitation).
- **Definitions:** added to TOOL_PROMPT + chat-router KNOWN_TOOLS.
- **Eval/training:** 5 system eval cases (119 total), 16 examples (462 total).
- **Tests:** 3 read-only tests (battery, unknown-action help, casing) — the
  side-effectful actions (volume/lock) are deliberately NOT executed in tests.
  Suite: 74 passed (was 71). Build green.
- **Live check:** battery executor returns "Battery is at 46%, charging 🔋".
  Model hallucinates system_control intents (expected) → retrain due.
