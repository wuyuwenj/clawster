import type { ChatResponse } from './types';
import { TOOL_PROMPT } from './tool-definitions';

interface OllamaResponse {
  message?: { content?: string };
}

interface ToolCall {
  tool: string | null;
  args: Record<string, unknown>;
}

export class LocalToolProvider {
  private baseUrl: string;
  private model: string;
  private available: boolean = false;

  constructor(model: string = 'clawster-tool-1.5b-q4:latest', baseUrl: string = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) { this.available = false; return; }
      const data = await response.json() as { models?: Array<{ name: string }> };
      this.available = data.models?.some(m => m.name === this.model) ?? false;
      if (this.available) {
        console.log(`[LocalTool] Model ${this.model} available via Ollama`);
      }
    } catch {
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async classify(input: string): Promise<ToolCall> {
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
        if (toolName === null || toolName === 'null' || toolName === 'none') {
          return { tool: null, args: {} };
        }
        if (typeof toolName === 'string') {
          return { tool: toolName, args: (parsed.args as Record<string, unknown>) || {} };
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
