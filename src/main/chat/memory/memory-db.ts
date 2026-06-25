import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { cosineSimilarity } from './embeddings';
import type { UserFact, EmotionalMemory } from './types';

const DEDUP_THRESHOLD = 0.92;
const DEDUP_WINDOW = 10;
const MAX_MEMORIES = 500;
const DECAY_RATE = 0.02;
const MAX_SUMMARY_LENGTH = 500;
const MAX_ARCHIVED = 200;

const EMOTION_WEIGHTS: Record<string, number> = {
  sad: 3.0, scared: 3.0, angry: 2.5, love: 2.5, excited: 2.5,
  proud: 2.0, frustrated: 2.0, anxious: 2.0, worried: 2.0,
  happy: 1.5, surprised: 1.5, curious: 1.0, calm: 0.5,
};

export function computeEmotionalWeight(emotionsJson: string): number {
  try {
    const emotions: string[] = JSON.parse(emotionsJson);
    if (!Array.isArray(emotions)) return 0;
    return emotions.reduce((sum, e) => sum + (EMOTION_WEIGHTS[e.toLowerCase()] || 0.5), 0);
  } catch {
    return 0;
  }
}

export class MemoryDB {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<boolean> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS facts (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          person TEXT DEFAULT '',
          updatedAt TEXT NOT NULL
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          emotions TEXT DEFAULT '[]',
          people TEXT DEFAULT '[]',
          vector TEXT DEFAULT '[]',
          timestamp TEXT NOT NULL,
          access_count INTEGER DEFAULT 0,
          emotional_weight REAL DEFAULT 0.0,
          fact_extracted INTEGER DEFAULT 0,
          archived INTEGER DEFAULT 0
        )
      `);
      this.migrateSchema();
      return true;
    } catch (error) {
      console.error('[MemoryDB] Failed to open database:', error);
      return false;
    }
  }

  private migrateSchema(): void {
    if (!this.db) return;
    const columns = [
      { name: 'access_count', sql: 'ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0' },
      { name: 'emotional_weight', sql: 'ALTER TABLE memories ADD COLUMN emotional_weight REAL DEFAULT 0.0' },
      { name: 'fact_extracted', sql: 'ALTER TABLE memories ADD COLUMN fact_extracted INTEGER DEFAULT 0' },
      { name: 'archived', sql: 'ALTER TABLE memories ADD COLUMN archived INTEGER DEFAULT 0' },
    ];
    for (const col of columns) {
      try { this.db.exec(col.sql); } catch { /* column already exists */ }
    }
  }

  isReady(): boolean {
    return this.db !== null;
  }

  // --- Facts ---

  async getAllFacts(): Promise<UserFact[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare('SELECT key, value, person, updatedAt FROM facts').all() as UserFact[];
      return rows;
    } catch {
      return [];
    }
  }

  async upsertFact(fact: UserFact): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare(
        'INSERT OR REPLACE INTO facts (key, value, person, updatedAt) VALUES (?, ?, ?, ?)'
      ).run(fact.key, fact.value, fact.person, fact.updatedAt);
    } catch (error) {
      console.error('[MemoryDB] Failed to upsert fact:', error);
    }
  }

  // --- Emotional Memories ---

  async addMemory(memory: Omit<EmotionalMemory, 'id' | 'access_count' | 'fact_extracted' | 'archived'> & { emotional_weight?: number }): Promise<boolean> {
    if (!this.db) return false;

    const summary = memory.summary.slice(0, MAX_SUMMARY_LENGTH);
    const id = randomUUID();
    const vectorJson = JSON.stringify(memory.vector);
    const emotionalWeight = memory.emotional_weight ?? computeEmotionalWeight(memory.emotions);

    try {
      if (memory.vector.length > 0) {
        const recent = await this.getRecentMemories(DEDUP_WINDOW);
        for (const existing of recent) {
          if (existing.vector.length > 0) {
            const sim = cosineSimilarity(memory.vector, existing.vector);
            if (sim > DEDUP_THRESHOLD) {
              console.log(`[MemoryDB] Skipping duplicate memory (similarity ${sim.toFixed(3)})`);
              return false;
            }
          }
        }
      }

      this.db.prepare(
        'INSERT INTO memories (id, summary, emotions, people, vector, timestamp, access_count, emotional_weight, fact_extracted, archived) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0)'
      ).run(id, summary, memory.emotions, memory.people, vectorJson, memory.timestamp, emotionalWeight);

      this.pruneIfNeeded();
      return true;
    } catch (error) {
      console.error('[MemoryDB] Failed to add memory:', error);
      return false;
    }
  }

  private computeRetentionScore(row: { emotional_weight: number; access_count: number; timestamp: string }): number {
    const ageMs = Date.now() - new Date(row.timestamp).getTime();
    const ageDays = ageMs / 86400000;
    const recencyDecay = 1 / (1 + ageDays * DECAY_RATE);
    return (row.emotional_weight * 2.0) + (row.access_count * 1.5) + recencyDecay;
  }

  async searchMemories(queryVector: number[], limit: number = 5): Promise<EmotionalMemory[]> {
    if (!this.db || queryVector.length === 0) return this.getRecentMemories(limit);

    try {
      const rows = this.db.prepare(
        'SELECT id, summary, emotions, people, vector, timestamp, access_count, emotional_weight, fact_extracted, archived FROM memories WHERE archived = 0'
      ).all() as Array<{
        id: string; summary: string; emotions: string; people: string; vector: string; timestamp: string;
        access_count: number; emotional_weight: number; fact_extracted: number; archived: number;
      }>;

      const now = Date.now();
      const scored = rows.map(r => {
        const vector = this.parseVector(r.vector);
        const ageMs = now - new Date(r.timestamp).getTime();
        const ageDays = ageMs / 86400000;
        const decay = 1 / (1 + ageDays * DECAY_RATE);
        const sim = vector.length > 0 ? cosineSimilarity(queryVector, vector) : 0;
        const score = sim * decay;
        return { memory: { ...r, vector } as EmotionalMemory, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, limit).map(s => s.memory);

      this.strengthenRetrieved(results);

      return results;
    } catch {
      return this.getRecentMemories(limit);
    }
  }

  async getRecentMemories(limit: number = 5): Promise<EmotionalMemory[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        'SELECT id, summary, emotions, people, vector, timestamp, access_count, emotional_weight, fact_extracted, archived FROM memories WHERE archived = 0 ORDER BY timestamp DESC LIMIT ?'
      ).all(limit) as Array<{
        id: string; summary: string; emotions: string; people: string; vector: string; timestamp: string;
        access_count: number; emotional_weight: number; fact_extracted: number; archived: number;
      }>;
      const results = rows.map(r => ({ ...r, vector: this.parseVector(r.vector) }));

      this.strengthenRetrieved(results);

      return results;
    } catch {
      return [];
    }
  }

  private strengthenRetrieved(memories: EmotionalMemory[]): void {
    if (!this.db || memories.length === 0) return;
    try {
      const stmt = this.db.prepare('UPDATE memories SET access_count = access_count + 1 WHERE id = ?');
      for (const m of memories) {
        stmt.run(m.id);
      }
    } catch { /* non-critical */ }
  }

  private pruneIfNeeded(): void {
    if (!this.db) return;
    try {
      const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE archived = 0').get() as { cnt: number }).cnt;
      if (count <= MAX_MEMORIES) return;

      const excess = count - MAX_MEMORIES;
      const rows = this.db.prepare(
        'SELECT id, emotional_weight, access_count, timestamp FROM memories WHERE archived = 0 AND access_count <= 10'
      ).all() as Array<{ id: string; emotional_weight: number; access_count: number; timestamp: string }>;

      const scored = rows.map(r => ({
        id: r.id,
        score: this.computeRetentionScore(r),
      }));
      scored.sort((a, b) => a.score - b.score);

      const toDelete = scored.slice(0, excess).map(s => s.id);
      if (toDelete.length === 0) return;

      const placeholders = toDelete.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...toDelete);
      console.log(`[MemoryDB] Pruned ${toDelete.length} lowest-scored memories`);
    } catch (error) {
      console.error('[MemoryDB] Prune failed:', error);
    }
  }

  // --- Consolidation helpers (Phase 3) ---

  async getConsolidationCandidates(minAgeDays: number = 3, maxAccessCount: number = 2): Promise<EmotionalMemory[]> {
    if (!this.db) return [];
    try {
      const cutoff = new Date(Date.now() - minAgeDays * 86400000).toISOString();
      const rows = this.db.prepare(
        'SELECT id, summary, emotions, people, vector, timestamp, access_count, emotional_weight, fact_extracted, archived FROM memories WHERE archived = 0 AND fact_extracted = 0 AND access_count <= ? AND timestamp < ?'
      ).all(maxAccessCount, cutoff) as Array<{
        id: string; summary: string; emotions: string; people: string; vector: string; timestamp: string;
        access_count: number; emotional_weight: number; fact_extracted: number; archived: number;
      }>;
      return rows.map(r => ({ ...r, vector: this.parseVector(r.vector) }));
    } catch {
      return [];
    }
  }

  async archiveMemory(id: string): Promise<void> {
    if (!this.db) return;
    try {
      this.db.prepare('UPDATE memories SET archived = 1 WHERE id = ?').run(id);
    } catch { /* non-critical */ }
  }

  async bulkMarkFactExtracted(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    try {
      const stmt = this.db.prepare('UPDATE memories SET fact_extracted = 1 WHERE id = ?');
      for (const id of ids) {
        stmt.run(id);
      }
    } catch { /* non-critical */ }
  }

  async pruneArchived(): Promise<void> {
    if (!this.db) return;
    try {
      const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE archived = 1').get() as { cnt: number }).cnt;
      if (count <= MAX_ARCHIVED) return;

      const excess = count - MAX_ARCHIVED;
      this.db.prepare(
        'DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE archived = 1 ORDER BY timestamp ASC LIMIT ?)'
      ).run(excess);
      console.log(`[MemoryDB] Hard-deleted ${excess} archived memories`);
    } catch { /* non-critical */ }
  }

  private parseVector(vectorJson: string): number[] {
    try {
      const parsed = JSON.parse(vectorJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
