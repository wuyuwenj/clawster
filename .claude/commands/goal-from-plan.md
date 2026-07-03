Read the plan file at $ARGUMENTS (or the most recent plan in ~/.claude/plans/ if no argument given). Generate a single production-ready /goal prompt that:

1. Names the plan file path for reference
2. Lists every concrete implementation step from the plan as a single imperative sentence
3. Lists every file to create or modify
4. Ends with verification criteria: tsc must pass, npm test must pass, and any visual/manual verification the plan describes

Output ONLY the goal prompt text — no explanation, no markdown fences. The user will copy it into /goal directly.

Keep it to one dense paragraph. Start with "Implement..." and end with the verification criteria.
