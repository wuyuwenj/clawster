export interface UserFact {
  key: string;
  value: string;
  person: string;
  updatedAt: string;
}

export interface EmotionalMemory {
  id: string;
  summary: string;
  emotions: string;   // JSON stringified array: '["frustrated","exhausted"]'
  people: string;     // JSON stringified array: '["Jake","Emily"]'
  vector: number[];   // 1536-dim from text-embedding-3-small
  timestamp: string;
}

export interface MemoryContext {
  facts: UserFact[];
  relevantMemories: EmotionalMemory[];
}

export interface MemoryExtraction {
  memorable: boolean;
  facts: Array<{ key: string; value: string; person?: string }>;
  emotional?: string;
  emotions?: string[];
  people?: string[];
}
