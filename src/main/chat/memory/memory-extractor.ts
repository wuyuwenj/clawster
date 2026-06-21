import type { MemoryExtraction } from './types';

const MEMORY_BLOCK_REGEX = /```memory\s*([\s\S]*?)```/;

export function extractMemoryBlock(rawResponse: string): {
  cleanResponse: string;
  memoryData: MemoryExtraction | null;
} {
  const match = rawResponse.match(MEMORY_BLOCK_REGEX);
  if (!match) {
    return { cleanResponse: rawResponse, memoryData: null };
  }

  const cleanResponse = rawResponse.replace(MEMORY_BLOCK_REGEX, '').trim();
  const jsonStr = match[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);

    if (typeof parsed !== 'object' || parsed === null) {
      return { cleanResponse, memoryData: null };
    }

    if (parsed.memorable === false) {
      return { cleanResponse, memoryData: { memorable: false, facts: [] } };
    }

    const extraction: MemoryExtraction = {
      memorable: true,
      facts: Array.isArray(parsed.facts)
        ? parsed.facts
            .filter((f: unknown) => f && typeof f === 'object' && 'key' in (f as Record<string, unknown>) && 'value' in (f as Record<string, unknown>))
            .map((f: Record<string, unknown>) => ({
              key: String(f.key).slice(0, 100),
              value: String(f.value).slice(0, 500),
              person: f.person ? String(f.person).slice(0, 100) : undefined,
            }))
        : [],
      emotional: typeof parsed.emotional === 'string'
        ? parsed.emotional.slice(0, 500)
        : undefined,
      emotions: Array.isArray(parsed.emotions)
        ? parsed.emotions.filter((e: unknown) => typeof e === 'string').slice(0, 10) as string[]
        : undefined,
      people: Array.isArray(parsed.people)
        ? parsed.people.filter((p: unknown) => typeof p === 'string').slice(0, 10) as string[]
        : undefined,
    };

    return { cleanResponse, memoryData: extraction };
  } catch {
    return { cleanResponse, memoryData: null };
  }
}

export function stripMemoryBlockFromStream(text: string): string {
  return text.replace(MEMORY_BLOCK_REGEX, '').replace(/```memory\s*[\s\S]*$/, '').trim();
}
