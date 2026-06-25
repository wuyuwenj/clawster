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
  vector: number[];   // 384-dim from bge-small-en-v1.5
  timestamp: string;
  access_count: number;
  emotional_weight: number;
  fact_extracted: number;
  archived: number;
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
