# TODOS

## Phase 0 (before shipping validation build)

### Worker hard budget caps + global disable switch
- **What:** Add daily and monthly request caps enforced at the Worker level, plus a KV-based global disable switch.
- **Why:** The $50/month OpenAI budget alarm is reactive — it notifies after money is spent. A bug or abuse spike can drain $200+ before you see the email. Hard caps prevent spend proactively.
- **Pros:** Prevents runaway costs. Global disable switch lets you kill all API traffic in seconds.
- **Cons:** Minor additional scope in the Worker (~10 min with CC).
- **Context:** The Worker already uses CF KV for per-device rate limiting (D4). Adding a global counter and a `disabled` KV key is marginal complexity. Check the counter on every request; if exceeded, return a 429 with a pet-friendly message. The disable switch is a single KV read.
- **Depends on:** Cloudflare Worker implementation.

## Pre-Phase 1 (before public App Store launch)

### Monetization decision
- **What:** Decide between paid ($4.99), freemium (basic free, premium personality packs), or subscription ($1.99/mo for cloud AI).
- **Why:** This decision directly affects proxy auth (do you need user identity for payment?), rate limiting tiers (free vs paid limits), App Store submission (pricing model), and onboarding flow (purchase step?). Building rate limiting for a free tier and then switching to paid means rearchitecting the Worker.
- **Pros:** Early decision avoids rework on auth, rate limiting, and onboarding.
- **Cons:** Hard to decide without Phase 0 validation data.
- **Context:** The design doc lists three options. The architecture decisions made in Phase 0 (HMAC auth, per-device rate limiting, no user accounts) assume a free-with-caps model. If you switch to subscription, you'll need user identity (accounts, not just device UUIDs).
- **Depends on:** Phase 0 validation results.

### Privacy policy + Worker data handling rules
- **What:** Write privacy policy, define data retention rules, prompt logging policy, abuse handling procedures, OpenAI key rotation plan, and incident response runbook.
- **Why:** The proxy Worker creates a data processing surface: user messages flow through your infrastructure to OpenAI. Mac App Store requires a privacy policy. Running a proxy for teens without data handling rules is a compliance risk.
- **Pros:** App Store ready. Demonstrates responsible AI use. Legal protection.
- **Cons:** May need legal review — template privacy policies exist but teen-audience apps have stricter requirements.
- **Context:** The design doc mentions privacy policy for App Store but focuses on "no data retained." The operational reality is broader: you need to define what happens when OpenAI's moderation flags content, how to handle abuse reports, how to rotate the OpenAI API key, and what your incident response looks like if the proxy is compromised.
- **Depends on:** Monetization decision (affects what data you collect). Proxy Worker implementation.
