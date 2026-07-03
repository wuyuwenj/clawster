Validate training data quality for the Clawster tool classifier. Run `/loop /validate-training` for continuous, or `/validate-training` for a single pass.

Each round:

## Phase 1: Structural Validation

Run these checks on `eval/train-data/train.jsonl` and `eval/train-data/valid.jsonl`:

1. **Schema check**: Every example has exactly 3 messages: system → user → assistant (multi-turn examples have system → user → assistant → user → assistant)
2. **System prompt match**: Every system message matches the current `TOOL_PROMPT` from `src/main/chat/tool-definitions.ts` exactly. Flag any mismatch with char count diff.
3. **JSON validity**: Every assistant message is valid JSON (optionally followed by a ` ```memory` block). Parse the JSON and verify it has `tool` field.
4. **Tool allowlist**: Every non-null `tool` value is in the `KNOWN_TOOLS` set from `src/main/chat/chat-router.ts`. Flag unknown tools.
5. **Mood validity**: Every example has a `mood` field with a value from: happy, excited, proud, curious, idle, worried, mad, huff, side-eye, doze, spin, thinking.
6. **Args completeness**: Check required args per tool:
   - `open_app`: must have `app`
   - `open_url`: must have `url` starting with `http`
   - `remember_preference`: must have `preference` with length > 5
   - `send_message`: must have `recipient` and `message`
   - `run_shell`: must have `command`
   - `play_music`: must have `query` OR `action`
   - `block_apps`: should have `minutes`
   - `create_reminder`: must have `text`
   - `create_calendar_event`: must have `title` and `start`
7. **No empty user messages**
8. **No duplicate user inputs** (exact match, case-insensitive) appearing 3+ times

## Phase 2: Semantic Validation

1. **Remember vs Remind routing**: Find examples where user says "remember" — verify:
   - "remember that X" / "remember my X" → `remember_preference` (storing a fact)
   - "remember to X" / "remind me to X" → `create_reminder` (scheduling)
   - "do you remember" / "what did I tell you to remember" → `recall_preferences` (retrieving)
   - Flag any that seem misrouted.

2. **Emotional misroute check**: Find null-tool examples with emotional language — verify they're NOT routed to tools:
   - "block everything out" should NOT be `block_apps`
   - "I want to shut down" should NOT be `system_control`
   - "I want to close everything" should NOT be `close_app`
   - Flag any that seem emotionally misrouted.

3. **Truncation check**: For `remember_preference` examples, verify the `preference` arg contains the FULL value from the user message, not a truncated label. Flag examples where the preference arg is shorter than 40% of the user's stated value.

4. **Response quality**: Sample 20 random examples and check:
   - Responses are under 15 words (per the system prompt instruction)
   - Responses match the mood (worried mood shouldn't have excited responses)
   - Responses are in-character for a lobster pet

5. **Memory block validation** (for examples with ` ```memory` blocks):
   - JSON inside the memory block is valid
   - `memorable` is true
   - `facts` array has entries with `key` and `value`
   - `emotional` is a descriptive sentence
   - No memory block on tool-calling examples (only on conversational ones with personal info)

## Phase 3: Distribution Analysis

1. **Tool balance**: Print tool counts sorted by frequency. Flag any tool with <15 examples.
2. **Mood balance**: Print mood counts. Flag any valid mood with <5 examples.
3. **Null-tool ratio**: Print percentage. Flag if >35% or <15%.
4. **Input diversity**: For each tool, count unique first-words. Flag tools where >50% of examples start with the same word (e.g. all `open_app` examples start with "open").
5. **ALL CAPS coverage**: Count examples with all-uppercase user input. Flag if <3.
6. **Multi-turn coverage**: Count examples with conversation history. Report count.

## Phase 4: Report

Print a summary:

```
TRAINING DATA VALIDATION REPORT
════════════════════════════════
Total examples: N (train) + N (valid)
Structural issues: N
Semantic issues: N  
Distribution warnings: N

ISSUES (fix these):
  [LINE N] description

WARNINGS (review these):
  description

DISTRIBUTION:
  Tools: min=N (tool_name), max=N (tool_name)
  Moods: min=N (mood), max=N (mood)
  Null-tool ratio: N%
  ALL CAPS examples: N
  Memory extraction examples: N
```

## Phase 5: Auto-fix (if issues found)

For structural issues only (not semantic — those need human judgment):
- Missing mood → infer from context and add
- System prompt mismatch → replace with current TOOL_PROMPT
- Duplicate inputs (3+) → remove extras

Ask before applying fixes. Never auto-fix semantic issues.

## Stop conditions

- Single pass: report and stop
- In `/loop` mode: stop after 1 clean pass (0 structural issues) OR 3 consecutive passes with no new issues found
