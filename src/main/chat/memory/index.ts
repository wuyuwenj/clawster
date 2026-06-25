import * as fs from 'fs';
import * as path from 'path';
import { clawsterDataDir } from '../../paths';
import { MemoryDB, computeEmotionalWeight } from './memory-db';
import { embed } from './embeddings';
import { extractMemoryBlock } from './memory-extractor';
import { retrieveContext, formatContextForPrompt } from './memory-retriever';
import type { MemoryContext, MemoryExtraction } from './types';

export type { MemoryContext, MemoryExtraction };
export { extractMemoryBlock, stripMemoryBlockFromStream } from './memory-extractor';
export { formatContextForPrompt } from './memory-retriever';
export { cosineSimilarity } from './embeddings';

interface MemoryManagerOptions {
  dbPath: string;
}

const DECISIONS_LOG = 'decisions.jsonl';

export class MemoryManager {
  private db: MemoryDB;
  private dbPath: string;
  private ready: boolean = false;
  private lastQueryVector: number[] = [];

  constructor(opts: MemoryManagerOptions) {
    this.dbPath = opts.dbPath;
    this.db = new MemoryDB(opts.dbPath);
  }

  async init(): Promise<boolean> {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.ready = await this.db.init();
      if (this.ready) {
        await this.migratePrefsJson();
      }
      return this.ready;
    } catch (error) {
      console.error('[MemoryManager] Init failed:', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async retrieve(): Promise<MemoryContext> {
    if (!this.ready) return { facts: [], relevantMemories: [] };
    return retrieveContext(this.db, this.lastQueryVector);
  }

  async processResponseBackground(
    userMessage: string,
    rawResponse: string
  ): Promise<void> {
    if (!this.ready) return;

    try {
      const { memoryData } = extractMemoryBlock(rawResponse);

      this.logDecision(userMessage, memoryData);

      if (memoryData?.memorable) {
        // Upsert facts
        for (const fact of memoryData.facts) {
          await this.db.upsertFact({
            key: fact.key,
            value: fact.value,
            person: fact.person || '',
            updatedAt: new Date().toISOString(),
          });
        }

        if (memoryData.facts.length > 0) {
          try { require('../../analytics').trackMemoryStored({ type: 'fact', count: memoryData.facts.length }); } catch {}
        }

        // Store emotional memory with embedding (skip if embedding failed)
        if (memoryData.emotional) {
          const vector = await this.embedText(memoryData.emotional);
          if (vector.length > 0) {
            const emotionsJson = JSON.stringify(memoryData.emotions || []);
            await this.db.addMemory({
              summary: memoryData.emotional,
              emotions: emotionsJson,
              people: JSON.stringify(memoryData.people || []),
              vector,
              timestamp: new Date().toISOString(),
              emotional_weight: computeEmotionalWeight(emotionsJson),
            });
            try { require('../../analytics').trackMemoryStored({ type: 'emotional', count: 1 }); } catch {}
          }
        }
      }

      // Pre-compute embedding for the user message (used in next retrieve)
      if (userMessage.trim().length > 4) {
        this.lastQueryVector = await this.embedText(userMessage);
      } else {
        this.lastQueryVector = [];
      }
    } catch (error) {
      console.error('[MemoryManager] Background processing failed:', error);
    }
  }

  getDB(): MemoryDB {
    return this.db;
  }

  private async embedText(text: string): Promise<number[]> {
    return embed(text);
  }

  private async migratePrefsJson(): Promise<void> {
    const prefsPath = path.join(clawsterDataDir(), 'prefs.json');

    if (!fs.existsSync(prefsPath)) return;

    try {
      const raw = fs.readFileSync(prefsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const prefs = Array.isArray(parsed) ? parsed : (parsed?.preferences ?? []);

      if (Array.isArray(prefs) && prefs.length > 0) {
        for (let i = 0; i < prefs.length; i++) {
          const pref = typeof prefs[i] === 'string' ? prefs[i] : String(prefs[i]);
          await this.db.upsertFact({
            key: `preference_${i}`,
            value: pref,
            person: '',
            updatedAt: new Date().toISOString(),
          });
        }
        console.log(`[MemoryManager] Migrated ${prefs.length} preferences to facts table`);
      }

      const migratedPath = prefsPath + '.migrated';
      fs.renameSync(prefsPath, migratedPath);
      console.log(`[MemoryManager] Renamed prefs.json → prefs.json.migrated`);
    } catch (error) {
      console.error('[MemoryManager] Prefs migration failed:', error);
    }
  }

  private logDecision(message: string, extraction: MemoryExtraction | null): void {
    try {
      const logPath = path.join(path.dirname(this.dbPath), DECISIONS_LOG);
      const entry = {
        message: message.slice(0, 200),
        memorable: extraction?.memorable ?? false,
        extracted: extraction?.memorable ? extraction : undefined,
        ts: new Date().toISOString(),
      };
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch { /* never crash for logging */ }
  }
}
