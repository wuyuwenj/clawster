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
- [x] P4: iMessage integration (send_message + native confirmation dialog)
- [x] P5: Clipboard tools (read_clipboard, summarize_clipboard)
- [x] P6: Screen analysis (take_screenshot → cloud vision, graceful fallback)
- [ ] P7: Focus mode (block_apps for N minutes)
- [ ] P8: Personalization memory (~/.clawster/prefs.json → system prompt)
- [ ] P9: Close/quit app (close_app via osascript)
- [ ] P10: Time/date (what_time, day of week, countdowns)
- [ ] P11: Natural conversation (inline personality responses)
- [ ] P12: Contextual quick replies (dynamic buttons by tool/mood)

## Retrain Status
- ✅ **RETRAINED → clawster-tool-v5-q4** (2026-06-20) after P1+P2+P3. Bakes in
  multi-turn, run_shell, and system_control. Promoted: LocalToolProvider default
  is now `clawster-tool-v5-q4:latest`. See benchmark + retrain log below.
- ⏳ **RETRAIN DUE (P4+P5+P6 = 3 features):** send_message (P4, 12),
  read/summarize_clipboard (P5, 12), screen-analysis phrasing (P6, +8
  take_screenshot). Retraining now per cadence rule.

## Benchmark Results (current 119-case standard dataset, fixed harness)
| Model | Std tool | Std args | reject | shell | system | multiturn | holdout tool |
|-------|----------|----------|--------|-------|--------|-----------|--------------|
| clawster-tool-v4-q4 | 88.2% | 97.2% | 90% | 0% | 0% | 100% | 85.7% |
| **clawster-tool-v5-q4** | **96.6%** | 96.1% | 100% | 100% | 100% | 67% | 80.4% |

Net: v5 is +8.4pp standard tool acc, unlocks shell+system (0→100%), reject
90→100%. Standard now >95% target. Open items: multiturn 4/6 (small sample),
holdout 80.4% (<90% target, no new categories in holdout — revisit after more
training data).

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

### 2026-06-20 — Retrain → clawster-tool-v5-q4 (promoted)
- **Pipeline:** LoRA 600 iters (16 layers, lr 2e-4, batch 4) on 462 examples →
  val loss 4.156→0.146 (stable, no overfit), train loss 0.059. Fused → Ollama
  import → Q4_K_M quantize → clawster-tool-v5-q4 (986 MB).
- **Eval-harness bugs found & fixed during validation (not model regressions):**
  1. Ollama eval provider set no `num_predict`, so the Modelfile default of 20
     truncated longer JSON (reminders, calendar events) → scored as "no tool".
     Both v4 and v5 hit reminder=0% until fixed. Set eval + runtime to 80.
  2. `eval/tools.ts` lacked `system_control`, so valid outputs were rejected
     (system=0%). Added it.
  Also raised runtime `LocalToolProvider` num_predict 40→80 (classify +
  classifyStream): 40 truncated the longest valid tool call
  (create_calendar_event with start+end ≈ 60 tokens) in the real app.
- **Result:** v5 standard 96.6% (v4 88.2%), reject 100% (v4 90%), shell+system
  0→100%. Decisively better → promoted (LocalToolProvider default = v5).
- **Verified live (default model):** reminder, run_shell, system_control
  (volume+lock), and long create_calendar_event{start,end} all classify
  correctly. 74 tests pass, build green.
- **Watch:** multiturn 4/6 on standard (v4 was 6/6) and holdout 80.4% (<90%).
  Tiny multiturn sample; revisit holdout after P4-P12 add more training data.

### 2026-06-20 — P4: iMessage send_message (shipped)
- **send_message tool** via AppleScript (Messages.app, iMessage buddy send).
  Accepts recipient (name/phone/email) + message; arg aliases tolerated
  (to/contact, body/text).
- **Confirmation generalized:** the run_shell gate was refactored from a bare
  `(command: string)` callback to a structured `ConfirmRequest {title, detail}`
  so the same native dialog serves run_shell, send_message, and future
  close_app. ToolResult.confirmation field `command`→`detail`. main.ts dialog
  buttons Confirm/Cancel (default Cancel), shows recipient + body preview.
  Nothing sends without explicit approval; safe default (no callback → no send).
- **Injection-safe:** recipient/body escaped for AppleScript string literals
  then for the single-quoted `-e` arg. Verified preview preserves quotes/&/$/'.
- **Definitions:** TOOL_PROMPT, CONFIRM_TOOLS, chat-router KNOWN_TOOLS,
  eval/tools.ts.
- **Eval/training:** 4 message eval cases (123 total), 12 examples (474 total).
- **Tests:** 5 send_message gate tests (no-callback/decline/preview/missing-
  recipient/missing-body) — the approve→send path is deliberately NOT tested
  (would send a real iMessage). Updated 2 run_shell tests for the new
  ConfirmRequest shape. 79 passed (was 74). Build green.
- **Live:** v5 (untrained) misclassifies → staged for next retrain. No iMessage
  can fire pre-retrain; post-retrain still confirmation-gated.

### 2026-06-20 — P5: Clipboard tools (shipped)
- **read_clipboard** (pbpaste, truncated to 1200 chars, empty-state message) and
  **summarize_clipboard** (deterministic structural summary via summarizeText:
  detects link/email/JSON/code/list, reports words/lines/chars + a one-line
  preview). Local-only, no LLM — fast and reliable. Both read-only, no
  confirmation.
- **Definitions:** TOOL_PROMPT, chat-router KNOWN_TOOLS, eval/tools.ts.
- **Eval/training:** 4 clipboard eval cases (127 total), 12 examples (486 total).
- **Tests:** 4 clipboard tests with save/restore of the user's real clipboard
  (read text, empty state, summary stats, link detection). 83 passed (was 79).
  Build green.
- **Live:** summarizeText correctly tags JSON/code/plain; clipboard restored
  after probing. v5 untrained → misclassifies (take_screenshot/list_files,
  harmless), staged for retrain.

### 2026-06-20 — P6: Screen analysis (shipped)
- **Cloud vision wired:** ChatRouter.analyzeScreen() (was a "Coming soon" stub)
  now delegates to an injectable VisionProvider. take_screenshot is special-
  cased in chat()/chatStream(): capture screen via setScreenCapturer →
  analyzeScreen. This activates the existing ScreenshotQuestion hotkey flow too.
- **Local-first preserved:** new `createProxyVision(url, deviceId)` factory is a
  one-shot HMAC-authed client — NO background polling/connection (unlike
  CloudChatProvider). Cloud is contacted only when the user asks about their
  screen. Persistent deviceId added to store (clawbot.deviceId).
- **Graceful degradation everywhere:** no vision provider → "needs cloud"; no
  image → "couldn't grab a screenshot"; proxy unreachable → "couldn't reach my
  cloud eyes". Verified live (proxy is unreachable in this env → friendly
  fallback, no crash).
- **Eval/training:** 6 screenshot eval cases (130 total), +8 screen-analysis
  examples (494 total, take_screenshot 25).
- **Tests:** 5 chat-router screen tests (delegate, no-provider, capture+analyze
  routing, no-provider degrade, capture-fail). 88 passed (was 83). Build green.
- **Note:** test/e2e-local-model.test.ts is flaky under vitest parallelism when
  Ollama is under load (live-model dep) — passes in isolation; not caused by
  feature changes.
