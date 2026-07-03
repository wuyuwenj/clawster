# Plan: Add Memory Layer to Clawster

## Context

Clawster is a desktop pet companion (Electron app) that currently has minimal memory — 25 string preferences in a flat JSON file and the last 20 chat messages as context. User research on AI companion apps revealed that **persistent emotional memory** is the #1 retention driver and the #1 unmet need. This plan adds a two-layer memory system: structured facts (key-value) and emotional memories (vector-searchable summaries).

**Key decision: everything remote for best UX.** Models run on cloud (via existing Cloudflare Worker proxy), memory is stored locally on the user's machine. No Ollama required. Users install Clawster and it just works — no model downloads, no setup.

## Architecture Overview

```
Message arrives
    │
    ├─ 1. RETRIEVE (local): Query LanceDB
    │     ├─ Facts table: load all (small, always inject)
    │     └─ Memories table: vector search top 5 relevant
    │
    ├─ 2. INJECT: Add retrieved context to system prompt
    │     └─ cloud-provider.ts buildSystemPrompt() updated
    │
    ├─ 3. RESPOND (remote): Cloud LLM generates response + memory block
    │     └─ OpenAI gpt-4o-mini via existing proxy
    │     └─ System prompt tells LLM to append ```memory block
    │
    ├─ 4. CLASSIFY + EXTRACT: Parse memory block from response
    │     ├─ Not memorable → done
    │     └─ Memorable → extract facts + emotional summary
    │
    ├─ 5. EMBED (remote): Get embedding for emotional memory
    │     └─ Proxy /v1/embeddings → OpenAI text-embedding-3-small
    │
    └─ 6. STORE (local): Write to LanceDB on user's disk
          ├─ Facts → upsert in facts table
          └─ Emotional → append to memories table with vector
```

## Storage: Single LanceDB Instance, Two Tables

Everything lives in one LanceDB database at `~/.clawster/memory/`:

```
~/.clawster/memory/           ← LanceDB database directory
├── facts.lance/              ← facts table (upsert by key)
└── memories.lance/           ← emotional memories table (append-only, vector-indexed)
```

### Facts Table Schema

```typescript
interface UserFact {
  key: string;        // e.g. "mom_name", "job", "boundary_mode"
  value: string;
  person: string;     // who this relates to (empty string if N/A)
  updatedAt: string;  // ISO timestamp
}
```

- Upsert by `key` — if "mom_name" already exists, update the value
- No embeddings needed — always load all facts (there will be < 100)
- Simple structured lookups: "what's her mom's name?"

### Memories Table Schema

```typescript
interface EmotionalMemory {
  id: string;           // uuid
  summary: string;      // distilled 1-2 sentence summary
  emotions: string;     // JSON stringified array: '["frustrated","exhausted"]'
  people: string;       // JSON stringified array: '["Jake","Emily"]'
  vector: number[];     // 1536-dim from text-embedding-3-small
  timestamp: string;    // ISO timestamp
}
```

- Append-only — never overwrite, it's a journal
- Dedup: cosine similarity > 0.92 against last 10 entries → skip
- Vector-indexed for semantic search

Note: LanceDB requires flat columns (no nested arrays for non-vector fields), so `emotions` and `people` are JSON-stringified strings, parsed in application code.

## What Runs Where

| Component | Where | Why |
|-----------|-------|-----|
| Chat LLM (gpt-4o-mini) | Remote (existing proxy) | Already works, no change |
| Embedding model (text-embedding-3-small) | Remote (new proxy endpoint) | No Ollama dependency |
| Memory classification + extraction | Piggybacked on chat LLM | Free, no extra API call |
| LanceDB (facts + memories) | Local (`~/.clawster/memory/`) | User's data stays on their PC |
| Vector search | Local (LanceDB in-process) | Fast, no network round-trip |

## New Files

| File | Purpose |
|------|---------|
| `src/main/chat/memory/memory-db.ts` | LanceDB wrapper — init database, facts table CRUD, memories table CRUD + vector search |
| `src/main/chat/memory/memory-extractor.ts` | Parse LLM ```memory block, strip from visible response |
| `src/main/chat/memory/memory-retriever.ts` | Load all facts + vector-search memories, return MemoryContext |
| `src/main/chat/memory/embeddings.ts` | Call proxy /v1/embeddings endpoint, cosine similarity helper |
| `src/main/chat/memory/types.ts` | Shared interfaces: UserFact, EmotionalMemory, MemoryContext, MemoryExtraction |
| `src/main/chat/memory/index.ts` | MemoryManager class — orchestrates retrieve, extract, embed, store |

## Modified Files

| File | Change |
|------|--------|
| `src/main/chat/cloud-provider.ts` | `buildSystemPrompt()` accepts MemoryContext, injects facts + emotional memories. Response handling strips memory block. |
| `src/main/chat/system-prompt.ts` | Add memory extraction instructions to SYSTEM_PROMPT |
| `src/main/chat/chat-router.ts` | Wire MemoryManager: retrieve before LLM call, extract+store after |
| `src/main/main.ts` | Initialize MemoryManager on startup, pass to ChatRouter |
| `proxy/src/index.ts` | Add `/v1/embeddings` endpoint forwarding to OpenAI embeddings API |
| `package.json` | Add `@lancedb/lancedb` dependency |

## Implementation Steps

### Step 1: Add Embedding Endpoint to Proxy (`proxy/src/index.ts`)

Add `/v1/embeddings` route alongside existing `/v1/chat/completions`. Reuses existing HMAC auth + rate limiting infrastructure:

```typescript
if (url.pathname === '/v1/embeddings') {
  // Same auth (verifyHmac), rate limiting
  // Forward to: https://api.openai.com/v1/embeddings
  // Model: text-embedding-3-small
  // Returns: { data: [{ embedding: number[] }] }
}
```

### Step 2: Types (`memory/types.ts`)

Define shared interfaces: `UserFact`, `EmotionalMemory`, `MemoryContext`, `MemoryExtraction`. Used across all memory module files.

### Step 3: LanceDB Wrapper (`memory/memory-db.ts`)

Single module managing both tables in one LanceDB instance:

```typescript
class MemoryDB {
  private db: Connection;
  private factsTable: Table;
  private memoriesTable: Table;

  async init(dbPath: string): Promise<void>
  // Facts
  async getAllFacts(): Promise<UserFact[]>
  async upsertFact(fact: UserFact): Promise<void>
  // Memories
  async addMemory(memory: EmotionalMemory): Promise<void>
  async searchMemories(queryVector: number[], limit: number): Promise<EmotionalMemory[]>
  async getRecentMemories(limit: number): Promise<EmotionalMemory[]>
}
```

Dedup logic in `addMemory`: fetch last 10 memories, compute cosine similarity against new memory's vector. Skip if any > 0.92.

### Step 4: Embeddings Client (`memory/embeddings.ts`)

Calls the proxy's `/v1/embeddings` endpoint using existing `buildAuthHeaders`:

```typescript
async function embed(text: string, baseUrl: string, deviceId: string): Promise<number[]>
function cosineSimilarity(a: number[], b: number[]): number
```

Fallback: if embedding call fails (offline, rate limited), return empty array. Memory still stores without vector — retrievable by recency via `getRecentMemories()`. Retry embedding on next app launch for un-embedded memories.

### Step 5: Memory Retriever (`memory/memory-retriever.ts`)

Called BEFORE the LLM generates a response. Returns context to inject into prompt:

```typescript
async function retrieveContext(
  db: MemoryDB,
  userMessage: string,
  embedFn: (text: string) => Promise<number[]>
): Promise<MemoryContext> {
  const facts = await db.getAllFacts();
  const queryVector = await embedFn(userMessage);
  
  let relevantMemories: EmotionalMemory[];
  if (queryVector.length > 0) {
    relevantMemories = await db.searchMemories(queryVector, 5);
  } else {
    relevantMemories = await db.getRecentMemories(5); // fallback
  }
  
  return { facts, relevantMemories };
}
```

### Step 6: Update System Prompt (`system-prompt.ts`)

Append memory extraction instructions to the end of SYSTEM_PROMPT:

```
After your response, if the user's message contained personal information
worth remembering, append a memory block:

\`\`\`memory
{"memorable": true, 
 "facts": [{"key": "mom_name", "value": "Linda", "person": "mom"}],
 "emotional": "Frustrated at work — manager took credit for her roadmap again",
 "emotions": ["frustrated", "powerless"],
 "people": ["Jake"]}
\`\`\`

Include this block when the message contains: personal facts (names, jobs,
relationships, health), emotional states, significant events, preferences,
boundaries, or decisions. Do NOT include for greetings, filler, small talk,
or jokes. Keep the emotional summary to 1-2 sentences capturing the WHY, 
not just the feeling.
```

### Step 7: Memory Extractor (`memory/memory-extractor.ts`)

Parses ```memory block from LLM response. Strips it so user never sees it:

```typescript
function extractMemoryBlock(rawResponse: string): {
  cleanResponse: string;
  memoryData: MemoryExtraction | null;
}
```

Handles edge cases: malformed JSON, missing fields, multiple memory blocks (take first).

### Step 8: Update Cloud Provider (`cloud-provider.ts`)

Two changes:

1. `buildSystemPrompt(memoryContext?: MemoryContext)` — inject facts and emotional memories:
   - Facts as bullet list: `- mom_name: Linda`
   - Emotional memories as dated entries: `- Jun 3: frustrated, manager took credit for roadmap`
   - Append natural-usage rules: "Reference what you know naturally, like a friend."

2. Response handling: run `extractMemoryBlock()` on raw response before returning to ChatRouter.

### Step 9: Wire Into ChatRouter (`chat-router.ts`)

Add `MemoryManager` to the cloud chat path. The flow becomes:

1. `memory.retrieve(userMessage)` → MemoryContext
2. Pass MemoryContext to cloud provider's `chat()`/`chatStream()`
3. Cloud provider injects memories into prompt, gets response, strips memory block
4. If memory data extracted: `memory.storeFromExtraction(memoryData)` → embed emotional summary → upsert facts → add memory to LanceDB
5. Return clean response to user

The local-only path (Ollama tool classification + template responses) is unchanged — it doesn't generate rich enough responses for memory extraction.

### Step 10: Initialize in Main (`main.ts`)

```typescript
const memory = new MemoryManager({
  dbPath: path.join(os.homedir(), '.clawster', 'memory'),
  proxyUrl: store.get('clawbot.url'),
  deviceId: store.get('clawbot.deviceId'),
});
await memory.init();
chatRouter.setMemoryManager(memory);
```

### Step 11: Decision Logging

Log every memory classification to `~/.clawster/memory/decisions.jsonl` for future classifier training:

```jsonl
{"message":"my mom Linda had surgery","memorable":true,"extracted":{...},"ts":"2026-06-20T..."}
{"message":"haha yeah","memorable":false,"ts":"2026-06-20T..."}
```

## What Does NOT Change

- Local tool classification (`LocalToolProvider`) — still uses Ollama if available
- Emotion engine — still manages pet moods independently
- Safety filter — unchanged
- Existing preferences system (`preferences.ts`) — kept separate
- Streaming — memory block extracted from final assembled response text

## Verification

1. **Unit tests**: MemoryDB CRUD (facts upsert, memory add, vector search), memory block parsing, cosine similarity
2. **Proxy test**: `curl` the `/v1/embeddings` endpoint, verify it returns 1536-dim vectors
3. **Integration test**: send message with a name → verify fact in LanceDB → send follow-up → verify fact in system prompt
4. **Persistence test**: tell Clawster "my mom's name is Linda" → quit → relaunch → ask "what's my mom's name?" → it knows
5. **Vector search test**: add 20 memories about different topics → query about one topic → verify top results are relevant, not just recent
6. **Memory block stripping**: verify ```memory block never appears in chat UI
7. **Offline fallback**: disconnect internet → verify memories store without vectors, retrieval falls back to recency

## Rollout Order

1. Proxy: add `/v1/embeddings` endpoint
2. `memory/types.ts` — shared interfaces
3. `memory/embeddings.ts` — embedding client + cosine similarity
4. `memory/memory-db.ts` — LanceDB wrapper (both tables)
5. `memory/memory-retriever.ts` — retrieval logic
6. `memory/memory-extractor.ts` — parse memory blocks
7. `memory/index.ts` — MemoryManager orchestrator
8. Update `system-prompt.ts` — add memory instructions
9. Update `cloud-provider.ts` — inject memories, handle memory blocks
10. Update `chat-router.ts` — wire the full pipeline
11. Update `main.ts` — initialize MemoryManager
12. `package.json` — add `@lancedb/lancedb`
13. Tests + manual verification
