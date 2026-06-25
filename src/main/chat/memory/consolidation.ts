import { cosineSimilarity } from './embeddings';
import type { MemoryDB } from './memory-db';
import type { EmotionalMemory, UserFact } from './types';

const CLUSTER_THRESHOLD = 0.75;

const FACT_PATTERNS: Array<{ regex: RegExp; keyFn: (m: RegExpMatchArray) => string; valueFn: (m: RegExpMatchArray) => string }> = [
  { regex: /(?:likes?|loves?|enjoys?)\s+(.+)/i, keyFn: () => 'preference', valueFn: m => m[1].trim() },
  { regex: /(?:name is|called|i'm|im)\s+(\w+)/i, keyFn: () => 'name', valueFn: m => m[1].trim() },
  { regex: /(?:has|have)\s+(?:a\s+)?(\w+)\s+named\s+(\w+)/i, keyFn: m => m[1].toLowerCase(), valueFn: m => `${m[1]} named ${m[2]}` },
  { regex: /allergic\s+to\s+(.+)/i, keyFn: () => 'allergy', valueFn: m => m[1].trim() },
  { regex: /favorite\s+(\w+)\s+is\s+(.+)/i, keyFn: m => `favorite_${m[1].toLowerCase()}`, valueFn: m => m[2].trim() },
  { regex: /(?:hates?|dislikes?)\s+(.+)/i, keyFn: () => 'dislike', valueFn: m => m[1].trim() },
  { regex: /(\d+)\s*(?:years?\s*old|yr)/i, keyFn: () => 'age', valueFn: m => m[1] },
  { regex: /birthday\s+(?:is\s+)?(.+)/i, keyFn: () => 'birthday', valueFn: m => m[1].trim() },
  { regex: /(?:sister|brother|mom|dad|mother|father)(?:'s|\s+is|\s+)?\s*(?:name(?:'s|\s+is)?\s+)?(\w+)/i, keyFn: () => 'family', valueFn: m => m[0].trim() },
];

function extractFactsFromSummary(summary: string): Array<{ key: string; value: string }> {
  const facts: Array<{ key: string; value: string }> = [];
  for (const pattern of FACT_PATTERNS) {
    const match = summary.match(pattern.regex);
    if (match) {
      facts.push({
        key: pattern.keyFn(match),
        value: pattern.valueFn(match),
      });
    }
  }
  return facts;
}

function clusterMemories(memories: EmotionalMemory[]): EmotionalMemory[][] {
  const visited = new Set<string>();
  const clusters: EmotionalMemory[][] = [];

  for (const mem of memories) {
    if (visited.has(mem.id)) continue;
    if (mem.vector.length === 0) {
      visited.add(mem.id);
      clusters.push([mem]);
      continue;
    }

    const cluster: EmotionalMemory[] = [mem];
    visited.add(mem.id);

    for (const other of memories) {
      if (visited.has(other.id) || other.vector.length === 0) continue;
      const sim = cosineSimilarity(mem.vector, other.vector);
      if (sim > CLUSTER_THRESHOLD) {
        cluster.push(other);
        visited.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function pickBestMemory(cluster: EmotionalMemory[]): EmotionalMemory {
  return cluster.reduce((best, mem) => {
    const bestScore = best.emotional_weight + best.access_count;
    const memScore = mem.emotional_weight + mem.access_count;
    return memScore > bestScore ? mem : best;
  });
}

export async function runConsolidation(db: MemoryDB): Promise<{ factsExtracted: number; memoriesArchived: number }> {
  let factsExtracted = 0;
  let memoriesArchived = 0;

  try {
    const candidates = await db.getConsolidationCandidates(3, 2);
    if (candidates.length === 0) {
      console.log('[Consolidation] No candidates found');
      return { factsExtracted, memoriesArchived };
    }

    console.log(`[Consolidation] Found ${candidates.length} candidates`);
    const clusters = clusterMemories(candidates);

    for (const cluster of clusters) {
      const allIds = cluster.map(m => m.id);

      if (cluster.length >= 2) {
        const allFacts: Array<{ key: string; value: string }> = [];
        for (const mem of cluster) {
          allFacts.push(...extractFactsFromSummary(mem.summary));
        }

        for (const fact of allFacts) {
          await db.upsertFact({
            key: fact.key,
            value: fact.value,
            person: '',
            updatedAt: new Date().toISOString(),
          });
          factsExtracted++;
        }

        await db.bulkMarkFactExtracted(allIds);

        const best = pickBestMemory(cluster);
        for (const mem of cluster) {
          if (mem.id !== best.id) {
            await db.archiveMemory(mem.id);
            memoriesArchived++;
          }
        }
      } else {
        const mem = cluster[0];
        const ageMs = Date.now() - new Date(mem.timestamp).getTime();
        const ageDays = ageMs / 86400000;
        if (ageDays > 14 && mem.access_count === 0) {
          const facts = extractFactsFromSummary(mem.summary);
          for (const fact of facts) {
            await db.upsertFact({
              key: fact.key,
              value: fact.value,
              person: '',
              updatedAt: new Date().toISOString(),
            });
            factsExtracted++;
          }
          await db.bulkMarkFactExtracted([mem.id]);
          await db.archiveMemory(mem.id);
          memoriesArchived++;
        }
      }
    }

    await db.pruneArchived();

    console.log(`[Consolidation] Done: ${factsExtracted} facts extracted, ${memoriesArchived} memories archived`);
  } catch (error) {
    console.error('[Consolidation] Failed:', error);
  }

  return { factsExtracted, memoriesArchived };
}
