Self-improving UX test + retrain loop with autoresearch-style ratcheting. Each round: test → diagnose → add examples → retrain → eval → ratchet (keep or revert) → re-test. Run `/loop /ux-train-loop` for continuous.

## Autoresearch principles (Karpathy)

This loop follows the autoresearch pattern: propose → execute → evaluate → ratchet.
- **Ratchet baseline**: eval score only goes up. If a round's examples drop the score → auto-revert.
- **Memory file**: `test-results/persona-testing/EXPERIMENT-LOG.md` persists what was tried, what worked, what failed. Read it before every round.
- **Failed experiment log**: `test-results/persona-testing/FAILED-EXPERIMENTS.md` tracks reverted approaches so we don't re-propose them.
- **Contrastive pairs**: When two tools are confused, add examples for BOTH sides of the boundary, not just one.
- **Ceiling detection**: After 2 consecutive rounds where added examples don't improve a specific failure → mark it as a model ceiling, stop trying.

## Phase 0: Read Memory

Before anything else:
1. Read `test-results/persona-testing/EXPERIMENT-LOG.md` (create if missing). Know what was tried.
2. Read `test-results/persona-testing/FAILED-EXPERIMENTS.md` (create if missing). Don't re-propose these.
3. Read `eval/mlx-results-paraphrase-qwen3-8b-fused.json` → get current baseline score.
4. Read `test-results/persona-testing/SCORES.json` → get prior persona names/scores.

## Phase 1: Test

1. Build: `npm run build:main`
2. Ensure Vite dev server is running (`curl -s http://localhost:5173/pet.html` — start with `npx vite --port 5173 &` if not)
3. Generate 6 fresh personas using the randomization rules from `/ux-test` (read SCORES.json to avoid repeats, read FAILED-EXPERIMENTS.md to target known weak spots)
4. Run all 6 in parallel via `node test-results/persona-testing/run-persona.mjs`
5. Score each 1-10 on friendliness, usefulness, quality, "keep using"

## Phase 2: Diagnose

For each failure (score <7 on any dimension OR incorrect tool/args):

1. Classify as **CODE** or **MODEL** issue
2. For MODEL issues, categorize:
   - `MISROUTE` — wrong tool selected
   - `TRUNCATION` — args value truncated
   - `NULL_TOOL` — should have fired a tool but didn't
   - `EMOTIONAL_MISROUTE` — emotional input routed to a tool
   - `CAPS_FAIL` — ALL CAPS input caused failure
   - `PREAMBLE_FAIL` — verbose/polite phrasing confused the model
   - `MEMORY_FAIL` — remember/recall didn't work correctly
   - `NEW` — a failure type not seen before

3. **Check FAILED-EXPERIMENTS.md** — if this exact failure was already tried and reverted, skip it. Log: "Skipping [failure] — previously tried in round N, reverted."

4. **Check ceiling**: if this failure has been targeted in 2+ prior rounds without improvement, mark as `CEILING` and skip. Append to FAILED-EXPERIMENTS.md: "CEILING: [failure description] — tried N times, model cannot learn this from data alone."

5. Skip entire retrain if avg keep_using ≥ 9.0 AND 0 new model failures (model is good enough).

## Phase 3: Generate Training Examples

For each MODEL failure that passed the Phase 2 filters (max 3 examples per failure, max 9 per round):

1. Read the system prompt from the first line of `eval/train-data/train.jsonl`
2. For each failure, generate **3 examples**: the exact failing input + 2 paraphrased variants
3. **Contrastive pairs**: If the failure is a tool confusion (e.g. list_files vs search_files, create_reminder vs set_timer), add examples for BOTH tools in the same batch — 2 for the correct tool, 1 for the tool it was confused with:
   ```
   "peek into downloads" → list_files      (correct)
   "show me my downloads folder" → list_files   (paraphrase)  
   "find the pdf in downloads" → search_files   (contrastive — shows the boundary)
   ```
4. Format:
   ```json
   {"messages":[
     {"role":"system","content":"<TOOL_PROMPT from train.jsonl line 1>"},
     {"role":"user","content":"<the input>"},
     {"role":"assistant","content":"<correct JSON output with mood>"}
   ]}
   ```
5. Run `/validate-training` structural checks on the new examples before appending
6. Backup: `cp eval/train-data/train.jsonl eval/train-data/train.jsonl.bak`
7. Append to `eval/train-data/train.jsonl`

## Phase 4: Retrain

Only if new examples were added in Phase 3.

1. Delete old adapters: `rm -rf eval/qwen3-8b-adapters-clean`
2. Calculate iters: `ITERS = (num_train_examples * 3) / batch_size` (3 epochs, rounded up). Cap at 2000.
3. Train with checkpoints:
   ```bash
   eval/.venv312/bin/python -m mlx_lm lora \
     --model eval/qwen3-8b-base \
     --train --data eval/train-data \
     --adapter-path eval/qwen3-8b-adapters-clean \
     --num-layers 16 --batch-size 4 --learning-rate 0.00005 \
     --iters $ITERS --max-seq-length 2048 --steps-per-eval 50 \
     --save-every 200
   ```
4. **Pick best checkpoint**: Parse training output for val loss at each eval step. Find the iter with lowest val loss. If not the final iter, copy that checkpoint:
   ```bash
   cp eval/qwen3-8b-adapters-clean/0000N00_adapters.safetensors \
      eval/qwen3-8b-adapters-clean/adapters.safetensors
   ```
5. Fuse:
   ```bash
   eval/.venv312/bin/python -m mlx_lm fuse \
     --model eval/qwen3-8b-base \
     --adapter-path eval/qwen3-8b-adapters-clean \
     --save-path eval/qwen3-8b-fused \
     --dequantize
   ```
6. Fix tokenizer if needed:
   ```bash
   python3 -c "
   import json
   cfg_path = 'eval/qwen3-8b-fused/tokenizer_config.json'
   with open(cfg_path) as f: cfg = json.load(f)
   if isinstance(cfg.get('extra_special_tokens'), list):
       cfg['extra_special_tokens'] = {t: t for t in cfg['extra_special_tokens']}
       with open(cfg_path, 'w') as f: json.dump(cfg, f, indent=2)
   "
   ```

## Phase 5: Evaluate + Ratchet (autoresearch pattern)

This is the critical step — the ratchet decides keep or revert.

1. Run eval:
   ```bash
   eval/.venv312/bin/python eval/mlx_eval.py eval/qwen3-8b-fused paraphrase
   ```
2. Read the new score from `eval/mlx-results-paraphrase-qwen3-8b-fused.json`
3. Compare against baseline (from Phase 0):

   **If new score >= baseline (improved or same):**
   - KEEP the examples. New score becomes the baseline.
   - Log to EXPERIMENT-LOG.md: `KEPT: Round N, +X examples, score A% → B% (+delta). Fixed: [list]`
   - Also check per-tool accuracy — if ANY tool category dropped >10pp, log a warning.

   **If new score < baseline by >2% (regression):**
   - REVERT: `cp eval/train-data/train.jsonl.bak eval/train-data/train.jsonl`
   - Log to EXPERIMENT-LOG.md: `REVERTED: Round N, +X examples caused regression A% → B%. Examples discarded.`
   - Log each reverted example to FAILED-EXPERIMENTS.md with the failure it was targeting
   - Retrain from the backup (or skip retrain — the backup model is still the best)
   - Skip to Phase 7

4. Convert + quantize + import to Ollama (only if KEPT):
   ```bash
   python3 /private/tmp/claude-501/llama-cpp-convert/convert_hf_to_gguf.py \
     eval/qwen3-8b-fused/ \
     --outfile /private/tmp/claude-501/qwen3-8b-gguf/qwen3-8b-f16.gguf \
     --outtype f16

   llama-quantize \
     /private/tmp/claude-501/qwen3-8b-gguf/qwen3-8b-f16.gguf \
     /private/tmp/claude-501/qwen3-8b-gguf/qwen3-8b-q4_k_m.gguf \
     Q4_K_M

   ollama create clawster-qwen3-8b-q4 -f /private/tmp/claude-501/-Users-jamesww-Desktop-code-clawster-remove-openclaw/83218edd-9be5-4a54-934c-12ce44af24f8/scratchpad/Modelfile.q4
   ```

## Phase 6: Re-test (only if KEPT)

Re-run the SAME 6 personas from Phase 1 against the new model:
1. Score each again
2. Compute delta per persona and overall avg
3. For each failure that was targeted by new examples, check if it's now fixed

## Phase 7: Record + Memory

1. Append to `test-results/persona-testing/SCORES.json` with round details, pre/post scores, eval score, examples added, ratchet decision (KEPT/REVERTED)

2. Update `test-results/persona-testing/EXPERIMENT-LOG.md`:
   ```
   ## Round N — [DATE]
   Baseline: X% | New: Y% | Decision: KEPT/REVERTED
   Examples added: N (targeting: [failure list])
   Contrastive pairs: [tool1 vs tool2]
   Failures fixed: [list]
   Failures remaining: [list]
   Ceiling failures: [list — stopped trying]
   Consecutive reverts: N/3
   ```

3. Print delta table:
   ```
   Round N: +X examples, eval Y% (was Z%), KEPT/REVERTED
     UX scores: A → B (+delta)
     Fixed: [list]
     Remaining: [list]
     Ceiling: [list]
   ```

## Stop conditions

(a) Average "keep using" ≥ 9.0
(b) 2 consecutive rounds with 0 MODEL failures found
(c) $ARGUMENTS rounds completed (default 3 — each round takes ~45 min)
(d) 3 consecutive REVERTED rounds (autoresearch 5-failure reset adapted to 3 — model can't improve from this data approach)
(e) Total training examples exceed 2500 (dataset size guard)
(f) All remaining failures marked as CEILING

## Rules

- Max 3 training examples per failure, max 9 per round (conservative)
- Always backup train.jsonl before modifying
- Always run `/validate-training` structural checks on new examples before appending
- Always train from `eval/qwen3-8b-base`, never from fused
- Never add examples with tool names as conversation words (no "sleep", "happy", "wave" in null-tool examples)
- Always use contrastive pairs for tool confusion failures
- Always read EXPERIMENT-LOG.md and FAILED-EXPERIMENTS.md before proposing examples
- If Phase 4 takes >60 min, something is wrong — stop and report
- Report after each round: delta table, examples added, eval score, ratchet decision
