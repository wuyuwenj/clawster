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
- [ ] T5: Delete OpenClaw references (workspace browser, cron, gateway UI)
- [ ] T6: Consolidate StoreSchema types
- [ ] T2: ChatProvider interface + CloudChatProvider
- [ ] T3: Decompose main.ts
- [ ] T4: Rewrite onboarding flow
- [ ] T1: Build Cloudflare Worker proxy
- [ ] T8: Local event logging
- [ ] T7: Set up vitest + Playwright tests
- [ ] T9: Worker budget caps + kill switch

## Progress Log
