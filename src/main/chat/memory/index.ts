import * as fs from 'fs';
import * as path from 'path';
import { MemoryDB } from './memory-db';
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
  proxyUrl: string;
  deviceId: string;
}

const DECISIONS_LOG = 'decisions.jsonl';

export class MemoryManager {
  private db: MemoryDB;
  private proxyUrl: string;
  private deviceId: string;
  private dbPath: string;
  private ready: boolean = false;
  private lastQueryVector: number[] = [];

  constructor(opts: MemoryManagerOptions) {
    this.dbPath = opts.dbPath;
    this.proxyUrl = opts.proxyUrl;
    this.deviceId = opts.deviceId;
    this.db = new MemoryDB(opts.dbPath);
  }

  async init(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
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

        // Store emotional memory with embedding
        if (memoryData.emotional) {
          const vector = await this.embedText(memoryData.emotional);
          await this.db.addMemory({
            summary: memoryData.emotional,
            emotions: JSON.stringify(memoryData.emotions || []),
            people: JSON.stringify(memoryData.people || []),
            vector,
            timestamp: new Date().toISOString(),
          });
          try { require('../../analytics').trackMemoryStored({ type: 'emotional', count: 1 }); } catch {}
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
    return embed(text, this.proxyUrl, this.deviceId);
  }

  private async migratePrefsJson(): Promise<void> {
    const prefsPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.clawster',
      'prefs.json'
    );

    if (!fs.existsSync(prefsPath)) return;

    try {
      const raw = fs.readFileSync(prefsPath, 'utf-8');
      const prefs = JSON.parse(raw);

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
      const logPath = path.join(this.dbPath, DECISIONS_LOG);
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
