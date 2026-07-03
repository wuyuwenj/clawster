Self-improving persona test loop. Each iteration:

1. **Build**: Run `npm run build:main` to compile latest changes.

2. **Generate fresh personas and messages**. Keep the same 6 demographic slots but vary EVERYTHING else each round:
   - **Name + backstory**: new name, new specific details (e.g. slot 1 is always "teenager" but Round 1 might be Alex who plays Valorant, Round 2 might be Mia who's into K-pop, Round 3 might be Devon who skateboards)
   - **Messages**: completely new phrasing each round. Never reuse exact messages from previous rounds. The message types stay the same (greeting, tool request, remember, recall, edge case, goodbye) but the content should reflect the new backstory.
   - **Edge cases**: rotate through different edge cases each round (Round 1: slang, Round 2: typos, Round 3: emoji-heavy, etc.)
   
   The 6 demographic slots:
   (1) Teenager (13-17) — tests slang, casual tone, gaming/social media context
   (2) Non-technical adult (40-55) — tests polite formal phrasing, expects hand-holding
   (3) Power user / developer (20-30) — tests edge cases, security, technical requests
   (4) Elderly user (65+) — tests verbose phrasing, patience, emotional needs
   (5) Professional (25-40) — tests productivity, focus, efficiency
   (6) Emotionally vulnerable user (18-25) — tests empathy, support, sensitivity

   Test all 6 using the runner at `test-results/persona-testing/run-persona.mjs`. Send 5-7 realistic messages per persona. Collect all responses.

3. **Score**: Rate each persona 1-10 on friendliness, usefulness, response quality, and "keep using". Compare to previous round scores in `test-results/persona-testing/SCORES.json` (create if missing).

4. **Fix**: Identify the lowest-scoring interaction across all personas. If the fix is code-level (<15 lines in template responses, safety filter, or tool executor), apply it immediately. If it's a model training issue, log it to `test-results/persona-testing/TRAINING-NEEDED.md` and move to the next fixable issue.

5. **Verify**: After applying fixes, re-run ONLY the affected persona to confirm the score improved. If it didn't improve or regressed, revert the fix.

6. **Record**: Append the round results to `test-results/persona-testing/SCORES.json` with round number, per-persona scores, fixes applied, and delta from previous round.

7. **Stop condition**: Stop the loop when EITHER (a) average "keep using" score is ≥8.0 across all personas, OR (b) three consecutive rounds show <0.5 point improvement (plateau — remaining issues need model retraining, not code fixes), OR (c) 10 rounds completed.

Report after each round: the delta table, what was fixed, what remains, and whether to continue or stop.
