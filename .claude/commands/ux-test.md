Self-improving UX test loop with model fine-tuning. Run `/loop /ux-test` for continuous, or `/ux-test` for a single round.

Each round:

## Phase 1: Test (2 min)

1. Build: `npm run build:main`
2. Generate 6 fresh personas using the rules below, then test each using `node test-results/persona-testing/run-persona.mjs '[messages]' persona-name`
3. Score each 1-10 on friendliness, usefulness, response quality, "keep using"

### Persona generation rules

**Demographic slots (keep these 6 every round):**
(1) Teenager 13-17 (2) Non-technical adult 40-55 (3) Power user 20-30
(4) Elderly 65+ (5) Professional 25-40 (6) Emotionally vulnerable 18-25

**Randomization — EVERY round must differ from previous rounds:**
- Read `test-results/persona-testing/SCORES.json` to see what names, backstories, and message phrasings were already used. NEVER reuse a name or repeat a message verbatim.
- For each persona, roll a random **communication style** from this list (no repeats within a round):
  `typo-heavy` | `emoji-only-mixed` | `ALL CAPS` | `no-punctuation-stream` | `code-switching (mix English + another language)` | `voice-transcription (run-on, "um", "like")` | `one-word-answers` | `overly-polite-formal` | `sarcastic` | `gen-z-slang`
- For each persona, roll a random **session pattern** (no repeats within a round):
  `rapid-fire (send 8+ messages fast)` | `slow-single-question` | `multi-request-per-message ("play music and also set a timer")` | `mid-conversation-topic-switch` | `asks-then-corrects ("actually no, I meant...")` | `starts-with-emotional then-switches-to-task` | `tests-limits (asks for things Clawster can't do)` | `forgets-context (re-asks something already answered)`
- Messages per persona: **5-9 messages**, varying per persona (not always 6).

**Message content requirements — each round must include at least:**
- 1 persona that tests `recall_preferences` ("what do you know about me")
- 1 persona with a multi-part remember ("remember my name is X, I'm Y years old, and I like Z")
- 1 persona that says something ambiguous between 2 tools ("remind me about my dentist" — is that create_reminder or recall_preferences?)
- 1 persona that tries something Clawster can't do ("order me pizza", "text my mom on whatsapp", "translate this to french")
- 1 persona using a greeting/farewell that prior rounds got wrong (check SCORES.json notes)
- 1 persona who sends an emotional message that could be misrouted to a tool ("I just want to block everything out" — focus mode or emotional?)

**Anti-patterns to avoid:**
- Don't always start with a greeting — some users jump straight to a request
- Don't always end with a farewell — some users just stop messaging
- Don't test the same tool in the same slot each round (e.g. teen always tests music)
- Don't use clean, well-formed sentences for every persona — real users are messy

## Phase 2: Diagnose

Classify each issue as CODE or MODEL:

**CODE issues** (fix in personality-responses.ts, safety-filter.ts, chat-router.ts, tool-executor.ts):
- Template pattern gaps (farewell, emotional, capabilities)
- Response quality / ordering
- Safety filter gaps

**MODEL issues** (fix in eval/train-data/train.jsonl):
- Tool misclassification ("remember X" → create_reminder instead of remember_preference)
- Memory value truncation (model strips detail from args)
- Duration/time parsing errors (60min→25min)
- Intent misread ("what is this application" → open_app)
- Farewell/greeting mood confusion

## Phase 3A: Code fixes (<5 min)

If CODE issues found: apply fix, re-test affected persona, run `npm test`, revert if no improvement.

## Phase 3B: Model fine-tuning (~40 min)

If MODEL issues found and no code fix possible:

1. **Generate 3 training examples** per issue. Format:
   ```json
   {"messages":[
     {"role":"system","content":"<system prompt with tools>"},
     {"role":"user","content":"<the failing input>"},
     {"role":"assistant","content":"{\"tool\":\"correct_tool\",\"args\":{\"correct\":\"args\"},\"response\":\"response\"}"}
   ]}
   ```
   Read the system prompt from the first line of `eval/train-data/train.jsonl` to get the exact format.
   Add paraphrases — don't just add the exact failing input, add 2 variations.

2. **Append to train.jsonl**: `echo '<json>' >> eval/train-data/train.jsonl`

3. **Delete old adapters**: `rm -rf eval/qwen3-8b-adapters-clean`

4. **Train** (calculate iters: `(num_examples * 3) / batch_size`, cap 2000):
   ```bash
   eval/.venv312/bin/python -m mlx_lm lora \
     --model eval/qwen3-8b-base \
     --train --data eval/train-data \
     --adapter-path eval/qwen3-8b-adapters-clean \
     --num-layers 16 --batch-size 4 --learning-rate 0.00005 \
     --iters $ITERS --max-seq-length 2048 --steps-per-eval 50 \
     --save-every 200
   ```
   After training, pick the checkpoint with the lowest val loss (manual early stopping). If the best checkpoint isn't the final one, copy it over `adapters.safetensors`.

5. **Fuse** (~5 min):
   ```bash
   eval/.venv312/bin/python -m mlx_lm fuse \
     --model eval/qwen3-8b-base \
     --adapter-path eval/qwen3-8b-adapters-clean \
     --save-path eval/qwen3-8b-fused \
     --dequantize
   ```

6. **Evaluate**:
   ```bash
   eval/.venv312/bin/python eval/mlx_eval.py eval/qwen3-8b-fused paraphrase
   ```
   Baseline: the current baseline (check eval/mlx-results-paraphrase-*.json for latest score). If new score drops >2% from baseline, REVERT: restore train.jsonl backup, retrain from clean. Training is stochastic (~3% variance).

7. **Serve the new model**:
   ```bash
   eval/.venv312/bin/python -m mlx_lm server --model eval/qwen3-8b-fused --port 8899
   ```

8. **Re-test all 6 personas** against the new model using provider local --base-url http://localhost:8899

## Phase 4: Record

Append to `test-results/persona-testing/SCORES.json`:
- Round number, per-persona scores, fixes applied (code + model), training examples added, eval score delta

## Phase 5: Visual verification

Run UI click-through on lowest-scoring persona:
`node test-results/persona-testing/run-persona-ui.mjs '[messages]' persona-name-ui`
Read screenshots to check visual UX.

## Stop conditions

(a) Average "keep using" ≥ 8.0
(b) 3 consecutive rounds < 0.5 improvement (plateau)
(c) $ARGUMENTS rounds completed (default 5)
(d) Model eval score drops >2% from the current baseline (check eval/mlx-results-paraphrase-*.json for latest score) baseline (safety stop)

## Rules

- Max 3 training examples per issue per round (conservative, prevents regression)
- Always backup train.jsonl before modifying: `cp eval/train-data/train.jsonl eval/train-data/train.jsonl.bak`
- Zero tool-name overlap in personality examples (don't use words like "sleep", "happy", "wave" in null-tool examples)
- Always train from qwen3-8b-base, never from fused
- Report: delta table, code fixes, training examples added, eval score, screenshots
