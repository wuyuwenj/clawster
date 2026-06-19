import type { ChatResponse } from './types';
import { TOOL_PROMPT } from './tool-definitions';

interface OllamaResponse {
  message?: { content?: string };
}

interface ToolCall {
  tool: string | null;
  args: Record<string, unknown>;
  response?: string;
}

export class LocalToolProvider {
  private baseUrl: string;
  private model: string;
  private available: boolean = false;
  private availabilityChecked: boolean = false;
  private checkPromise: Promise<void> | null = null;

  constructor(model: string = 'clawster-tool-v2-q4:latest', baseUrl: string = 'http://127.0.0.1:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
    this.checkPromise = this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
        const response = await fetch(`${this.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) continue;
        const data = await response.json() as { models?: Array<{ name: string }> };
        this.available = data.models?.some(m => m.name === this.model) ?? false;
        if (this.available) {
          console.log(`[LocalTool] Model ${this.model} available via Ollama`);
        } else {
          console.log(`[LocalTool] Model ${this.model} not found in Ollama`);
        }
        this.availabilityChecked = true;
        return;
      } catch {
        console.log(`[LocalTool] Ollama check attempt ${attempt + 1}/3 failed`);
      }
    }
    this.available = false;
    this.availabilityChecked = true;
    console.log(`[LocalTool] Ollama not reachable at ${this.baseUrl} after 3 attempts`);
  }

  private async ensureChecked(): Promise<void> {
    if (!this.availabilityChecked && this.checkPromise) {
      await this.checkPromise;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async classify(input: string): Promise<ToolCall> {
    await this.ensureChecked();
    if (!this.available) return { tool: null, args: {} };

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: TOOL_PROMPT },
            { role: 'user', content: input },
          ],
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return { tool: null, args: {} };

      const data = await response.json() as OllamaResponse;
      const raw = data.message?.content || '';
      return this.parseToolCall(raw);
    } catch (error) {
      console.error('[LocalTool] Classification failed:', error);
      return { tool: null, args: {} };
    }
  }

  private parseToolCall(text: string): ToolCall {
    const jsonMatch = text.trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { tool: null, args: {} };

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      if ('tool' in parsed) {
        const toolName = parsed.tool;
        const response = typeof parsed.response === 'string' ? parsed.response : undefined;
        if (toolName === null || toolName === 'null' || toolName === 'none') {
          return { tool: null, args: {}, response };
        }
        if (typeof toolName === 'string') {
          return { tool: toolName, args: (parsed.args as Record<string, unknown>) || {}, response };
        }
      }

      if ('name' in parsed && typeof parsed.name === 'string') {
        return { tool: parsed.name, args: (parsed.arguments as Record<string, unknown>) || (parsed.args as Record<string, unknown>) || {} };
      }

      return { tool: null, args: {} };
    } catch {
      return { tool: null, args: {} };
    }
  }

  destroy(): void {
    // Nothing to clean up — Ollama manages its own lifecycle
  }
}
