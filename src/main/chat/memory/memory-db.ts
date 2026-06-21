import * as lancedb from '@lancedb/lancedb';
import { randomUUID } from 'crypto';
import { cosineSimilarity } from './embeddings';
import type { UserFact, EmotionalMemory } from './types';

const DEDUP_THRESHOLD = 0.92;
const DEDUP_WINDOW = 10;
const MAX_MEMORIES = 500;
const DECAY_RATE = 0.02;
const MAX_SUMMARY_LENGTH = 500;

export class MemoryDB {
  private db: lancedb.Connection | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<boolean> {
    try {
      this.db = await lancedb.connect(this.dbPath);
      return true;
    } catch (error) {
      console.error('[MemoryDB] Failed to open database:', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.db !== null;
  }

  // --- Facts ---

  async getAllFacts(): Promise<UserFact[]> {
    if (!this.db) return [];
    try {
      const table = await this.db.openTable('facts').catch(() => null);
      if (!table) return [];
      const rows = await table.query().toArray();
      return rows.map(r => ({
        key: String(r.key),
        value: String(r.value),
        person: String(r.person || ''),
        updatedAt: String(r.updatedAt || ''),
      }));
    } catch {
      return [];
    }
  }

  async upsertFact(fact: UserFact): Promise<void> {
    if (!this.db) return;
    try {
      const row = { ...fact } as Record<string, unknown>;
      let table: lancedb.Table;
      try {
        table = await this.db.openTable('facts');
        await table.delete(`key = "${fact.key.replace(/"/g, '\\"')}"`);
      } catch {
        await this.db.createTable('facts', [row]);
        return;
      }
      await table.add([row]);
    } catch (error) {
      console.error('[MemoryDB] Failed to upsert fact:', error);
    }
  }

  // --- Emotional Memories ---

  async addMemory(memory: Omit<EmotionalMemory, 'id'>): Promise<boolean> {
    if (!this.db) return false;

    const summary = memory.summary.slice(0, MAX_SUMMARY_LENGTH);
    // LanceDB can't infer schema from empty arrays — use a zero vector as placeholder
    const vector = memory.vector.length > 0 ? memory.vector : Array(1536).fill(0);
    const entry: EmotionalMemory = {
      ...memory,
      summary,
      vector,
      id: randomUUID(),
    };

    try {
      // Dedup check
      if (entry.vector.length > 0) {
        const recent = await this.getRecentMemories(DEDUP_WINDOW);
        for (const existing of recent) {
          if (existing.vector.length > 0) {
            const sim = cosineSimilarity(entry.vector, existing.vector);
            if (sim > DEDUP_THRESHOLD) {
              console.log(`[MemoryDB] Skipping duplicate memory (similarity ${sim.toFixed(3)})`);
              return false;
            }
          }
        }
      }

      const row = { ...entry } as Record<string, unknown>;
      let table: lancedb.Table;
      try {
        table = await this.db.openTable('memories');
      } catch {
        await this.db.createTable('memories', [row]);
        return true;
      }

      await table.add([row]);
      await this.pruneIfNeeded(table);
      return true;
    } catch (error) {
      console.error('[MemoryDB] Failed to add memory:', error);
      return false;
    }
  }

  async searchMemories(queryVector: number[], limit: number = 5): Promise<EmotionalMemory[]> {
    if (!this.db || queryVector.length === 0) return this.getRecentMemories(limit);

    try {
      const table = await this.db.openTable('memories').catch(() => null);
      if (!table) return [];

      const results = await table.search(queryVector).limit(limit * 2).toArray();

      // Apply decay: older memories score lower
      const now = Date.now();
      const scored = results.map(r => {
        const ageMs = now - new Date(String(r.timestamp)).getTime();
        const ageDays = ageMs / 86400000;
        const decay = 1 / (1 + ageDays * DECAY_RATE);
        const score = (r._distance != null ? 1 / (1 + r._distance) : 0.5) * decay;
        return { memory: this.rowToMemory(r), score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map(s => s.memory);
    } catch {
      return this.getRecentMemories(limit);
    }
  }

  async getRecentMemories(limit: number = 5): Promise<EmotionalMemory[]> {
    if (!this.db) return [];
    try {
      const table = await this.db.openTable('memories').catch(() => null);
      if (!table) return [];
      const rows = await table.query().limit(1000).toArray();
      rows.sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime());
      return rows.slice(0, limit).map(r => this.rowToMemory(r));
    } catch {
      return [];
    }
  }

  private async pruneIfNeeded(table: lancedb.Table): Promise<void> {
    try {
      const rows = await table.query().limit(MAX_MEMORIES + 100).toArray();
      if (rows.length <= MAX_MEMORIES) return;

      rows.sort((a, b) => new Date(String(a.timestamp)).getTime() - new Date(String(b.timestamp)).getTime());
      const toDelete = rows.slice(0, rows.length - MAX_MEMORIES);

      for (const row of toDelete) {
        await table.delete(`id = "${String(row.id).replace(/"/g, '\\"')}"`);
      }
      console.log(`[MemoryDB] Pruned ${toDelete.length} old memories`);
    } catch (error) {
      console.error('[MemoryDB] Prune failed:', error);
    }
  }

  private rowToMemory(r: Record<string, unknown>): EmotionalMemory {
    let vector: number[] = [];
    if (r.vector) {
      vector = Array.from(r.vector as Iterable<number>);
    }
    return {
      id: String(r.id || ''),
      summary: String(r.summary || ''),
      emotions: String(r.emotions || '[]'),
      people: String(r.people || '[]'),
      vector,
      timestamp: String(r.timestamp || ''),
    };
  }
}
