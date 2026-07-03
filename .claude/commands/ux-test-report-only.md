UX test loop — TEST ONLY, no code fixes, no training. Collect data for a morning report.

Each round:

1. Build: `npm run build:main`
2. Generate 6 fresh personas (new names/backstories each round):
   (1) Teenager 13-17 (2) Non-technical adult 40-55 (3) Power user 20-30
   (4) Elderly 65+ (5) Professional 25-40 (6) Emotionally vulnerable 18-25
3. Test each using `node test-results/persona-testing/run-persona.mjs '[messages]' persona-name`
4. Score each 1-10 on friendliness, usefulness, response quality, "keep using"
5. Log EVERY bad response to `test-results/persona-testing/TRAINING-NEEDED.md` with: exact input, what the model did (wrong), what it should have done (correct)
6. Append scores to `test-results/persona-testing/SCORES.json`
7. DO NOT fix any code. DO NOT train. Just observe and record.

After $ARGUMENTS rounds (default 5), write a final synthesis report to `test-results/persona-testing/OVERNIGHT-REPORT.md` containing:
- Score trends across all rounds (table)
- Top 10 most impactful failures ranked by frequency and severity
- Specific training examples needed (exact format for train.jsonl)
- Code fixes still possible (with file:line and what to change)
- UX design recommendations (non-code)
- A prioritized action plan: what to fix first for maximum score improvement
