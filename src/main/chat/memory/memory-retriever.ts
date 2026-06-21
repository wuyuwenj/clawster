import type { MemoryDB } from './memory-db';
import type { MemoryContext } from './types';

export async function retrieveContext(
  db: MemoryDB,
  preComputedQueryVector?: number[]
): Promise<MemoryContext> {
  if (!db.isReady()) {
    return { facts: [], relevantMemories: [] };
  }

  const facts = await db.getAllFacts();

  let relevantMemories;
  if (preComputedQueryVector && preComputedQueryVector.length > 0) {
    relevantMemories = await db.searchMemories(preComputedQueryVector, 5);
  } else {
    relevantMemories = await db.getRecentMemories(5);
  }

  return { facts, relevantMemories };
}

export function formatContextForPrompt(ctx: MemoryContext): string {
  const parts: string[] = [];

  if (ctx.facts.length > 0) {
    parts.push('Things I know about you:');
    for (const fact of ctx.facts) {
      const personTag = fact.person ? ` (${fact.person})` : '';
      parts.push(`- ${fact.key}: ${fact.value}${personTag}`);
    }
  }

  if (ctx.relevantMemories.length > 0) {
    parts.push('');
    parts.push('Recent memories:');
    for (const mem of ctx.relevantMemories) {
      const date = mem.timestamp ? new Date(mem.timestamp).toLocaleDateString() : '';
      let emotions = '';
      try {
        const parsed = JSON.parse(mem.emotions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          emotions = ` (${parsed.join(', ')})`;
        }
      } catch { /* ignore */ }
      parts.push(`- ${date}: ${mem.summary}${emotions}`);
    }
  }

  return parts.join('\n');
}
