import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryDB } from '../src/main/chat/memory/memory-db';

const TEST_DB_PATH = path.join(os.tmpdir(), `clawster-memdb-test-${Date.now()}`);

describe('MemoryDB', () => {
  let db: MemoryDB;

  beforeEach(async () => {
    const uniquePath = `${TEST_DB_PATH}-${Math.random().toString(36).slice(2)}`;
    db = new MemoryDB(uniquePath);
    const ok = await db.init();
    expect(ok).toBe(true);
  });

  afterAll(() => {
    // Cleanup temp dirs (best-effort)
    try {
      const dirs = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('clawster-memdb-test-'));
      for (const d of dirs) {
        fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  // --- Facts ---

  it('returns empty facts when no table exists', async () => {
    const facts = await db.getAllFacts();
    expect(facts).toEqual([]);
  });

  it('upserts a fact and retrieves it', async () => {
    await db.upsertFact({ key: 'name', value: 'Emma', person: '', updatedAt: '2026-01-01' });
    const facts = await db.getAllFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('name');
    expect(facts[0].value).toBe('Emma');
  });

  it('upserts same key overwrites the value', async () => {
    await db.upsertFact({ key: 'name', value: 'Emma', person: '', updatedAt: '2026-01-01' });
    await db.upsertFact({ key: 'name', value: 'James', person: '', updatedAt: '2026-01-02' });
    const facts = await db.getAllFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('James');
  });

  it('stores multiple facts with different keys', async () => {
    await db.upsertFact({ key: 'name', value: 'Emma', person: '', updatedAt: '2026-01-01' });
    await db.upsertFact({ key: 'job', value: 'designer', person: '', updatedAt: '2026-01-01' });
    await db.upsertFact({ key: 'mom_name', value: 'Linda', person: 'mom', updatedAt: '2026-01-01' });
    const facts = await db.getAllFacts();
    expect(facts).toHaveLength(3);
  });

  it('handles unicode/emoji in fact values', async () => {
    await db.upsertFact({ key: 'mood', value: 'feeling 🎉', person: '', updatedAt: '2026-01-01' });
    const facts = await db.getAllFacts();
    expect(facts[0].value).toBe('feeling 🎉');
  });

  // --- Emotional Memories ---

  it('returns empty memories when no table exists', async () => {
    const memories = await db.getRecentMemories(5);
    expect(memories).toEqual([]);
  });

  it('adds and retrieves a memory', async () => {
    const vec = Array(1536).fill(0).map((_, i) => Math.sin(i));
    await db.addMemory({
      summary: 'Had a bad day at work',
      emotions: '["frustrated"]',
      people: '["Jake"]',
      vector: vec,
      timestamp: new Date().toISOString(),
    });
    const memories = await db.getRecentMemories(5);
    expect(memories).toHaveLength(1);
    expect(memories[0].summary).toBe('Had a bad day at work');
  });

  it('deduplicates similar memories (cosine > 0.92)', async () => {
    const vec = Array(1536).fill(0).map((_, i) => Math.sin(i));
    await db.addMemory({
      summary: 'Had a bad day',
      emotions: '["sad"]',
      people: '[]',
      vector: vec,
      timestamp: new Date().toISOString(),
    });
    // Same vector = cosine 1.0, should be deduped
    const added = await db.addMemory({
      summary: 'Had a terrible day',
      emotions: '["sad"]',
      people: '[]',
      vector: vec,
      timestamp: new Date().toISOString(),
    });
    expect(added).toBe(false);
    const memories = await db.getRecentMemories(10);
    expect(memories).toHaveLength(1);
  });

  it('allows dissimilar memories', async () => {
    const vec1 = Array(1536).fill(0).map((_, i) => Math.sin(i));
    const vec2 = Array(1536).fill(0).map((_, i) => Math.cos(i));
    await db.addMemory({
      summary: 'Bad day at work',
      emotions: '["frustrated"]',
      people: '[]',
      vector: vec1,
      timestamp: new Date().toISOString(),
    });
    const added = await db.addMemory({
      summary: 'Excited about concert',
      emotions: '["excited"]',
      people: '[]',
      vector: vec2,
      timestamp: new Date().toISOString(),
    });
    expect(added).toBe(true);
    const memories = await db.getRecentMemories(10);
    expect(memories).toHaveLength(2);
  });

  it('vector search returns nearest memory', async () => {
    const vec1 = Array(1536).fill(0).map((_, i) => Math.sin(i));
    const vec2 = Array(1536).fill(0).map((_, i) => Math.cos(i));
    await db.addMemory({
      summary: 'Work stress',
      emotions: '["stressed"]',
      people: '[]',
      vector: vec1,
      timestamp: new Date().toISOString(),
    });
    await db.addMemory({
      summary: 'Concert excitement',
      emotions: '["excited"]',
      people: '[]',
      vector: vec2,
      timestamp: new Date().toISOString(),
    });
    const results = await db.searchMemories(vec1, 1);
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Work stress');
  });

  it('falls back to recency when query vector is empty', async () => {
    const vec = Array(1536).fill(0).map((_, i) => Math.sin(i));
    await db.addMemory({
      summary: 'Old memory',
      emotions: '[]',
      people: '[]',
      vector: vec,
      timestamp: '2026-01-01T00:00:00Z',
    });
    await db.addMemory({
      summary: 'Recent memory',
      emotions: '[]',
      people: '[]',
      vector: vec.map(v => v + 0.5),
      timestamp: '2026-06-20T00:00:00Z',
    });
    const results = await db.searchMemories([], 1);
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Recent memory');
  });

  it('stores memory without vector (offline fallback)', async () => {
    const added = await db.addMemory({
      summary: 'Offline memory',
      emotions: '["happy"]',
      people: '[]',
      vector: [],
      timestamp: new Date().toISOString(),
    });
    expect(added).toBe(true);
    const memories = await db.getRecentMemories(5);
    expect(memories).toHaveLength(1);
    expect(memories[0].summary).toBe('Offline memory');
  });

  it('truncates long summaries', async () => {
    const longSummary = 'x'.repeat(1000);
    await db.addMemory({
      summary: longSummary,
      emotions: '[]',
      people: '[]',
      vector: [],
      timestamp: new Date().toISOString(),
    });
    const memories = await db.getRecentMemories(1);
    expect(memories[0].summary.length).toBeLessThanOrEqual(500);
  });
});
