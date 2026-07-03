<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-25 | Updated: 2026-06-25 -->

# proxy

## Purpose
Cloudflare Worker that proxies chat, vision, and embedding requests from the Electron client to OpenAI. Handles HMAC authentication, rate limiting, content moderation, and parameter allowlisting to prevent cost amplification.

## Key Files

| File | Description |
|------|-------------|
| `src/index.ts` | Worker entry — routes `/chat`, `/vision`, `/embeddings`; HMAC verification; rate limiting |
| `wrangler.toml` | Cloudflare Workers deployment config |
| `package.json` | Worker dependencies (separate from root) |
| `tsconfig.json` | TypeScript config for worker environment |

## For AI Agents

### Working In This Directory
- This is a **separate deployment** with its own `package.json` — run `cd proxy && npm install` for deps
- HMAC secret must match between client (`src/main/chat/hmac-auth.ts`) and worker
- Only allowlisted parameters are forwarded to OpenAI (`messages`, `stream`) — never spread the full request body
- Deploy with `npx wrangler deploy` from this directory

### Security
- Parameter allowlisting prevents cost amplification (clients can't set `n:100` or `max_tokens:128000`)
- Rate limiting by device ID (stored in Cloudflare KV)
- Content moderation on both input and output

<!-- MANUAL: -->
