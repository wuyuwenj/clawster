import type { ChatResponse } from './types';
import { TOOL_PROMPT } from './tool-definitions';

interface OllamaResponse {
  message?: { content?: string };
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

type ApiFormat = 'ollama' | 'openai';

interface ToolCall {
  tool: string | null;
  args: Record<string, unknown>;
  response?: string;
  mood?: string;
}

export class LocalToolProvider {
  private baseUrl: string;
  private model: string;
  private apiFormat: ApiFormat;
  private apiKey: string | undefined;
  private available: boolean = false;
  private availabilityChecked: boolean = false;
  private checkPromise: Promise<void> | null = null;
  private recheckInterval: ReturnType<typeof setInterval> | null = null;
  private memoryContext: string = '';

  constructor(
    model: string = 'clawster-qwen3-8b-q4:latest',
    baseUrl: string = 'http://127.0.0.1:11434',
    apiFormat: ApiFormat = 'ollama',
    apiKey?: string,
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiFormat = apiFormat;
    this.apiKey = apiKey;
    this.checkPromise = this.checkAvailability();
  }

  setMemoryContext(ctx: string): void {
    this.memoryContext = ctx;
  }

  private async checkAvailability(): Promise<void> {
    if (this.apiFormat === 'openai') {
      // For hosted APIs (Fireworks etc), assume available if API key is set
      this.available = !!this.apiKey;
      this.availabilityChecked = true;
      console.log(`[LocalTool] Using hosted API at ${this.baseUrl} (${this.available ? 'key set' : 'no key'})`);
      return;
    }

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
    this.startRecheckInterval();
  }

  private startRecheckInterval(): void {
    if (this.recheckInterval) return;
    this.recheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return;
        const data = await response.json() as { models?: Array<{ name: string }> };
        if (data.models?.some(m => m.name === this.model)) {
          this.available = true;
          console.log(`[LocalTool] Model ${this.model} recovered — now available`);
          this.stopRecheckInterval();
        }
      } catch { /* still down, try again next interval */ }
    }, 30_000);
  }

  private stopRecheckInterval(): void {
    if (this.recheckInterval) {
      clearInterval(this.recheckInterval);
      this.recheckInterval = null;
    }
  }

  private async ensureChecked(): Promise<void> {
    if (!this.availabilityChecked && this.checkPromise) {
      await this.checkPromise;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getModelName(): string {
    return this.model;
  }

  private buildSystemPrompt(): string {
    return this.memoryContext
      ? `${TOOL_PROMPT}\n\n${this.memoryContext}`
      : TOOL_PROMPT;
  }

  async classify(
    input: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ToolCall> {
    await this.ensureChecked();
    if (!this.available) return { tool: null, args: {} };

    try {
      const recentHistory = history.slice(-3).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const messages = [
        { role: 'system', content: this.buildSystemPrompt() },
        ...recentHistory,
        { role: 'user', content: input },
      ];

      let raw: string;

      if (this.apiFormat === 'openai') {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: this.model, messages, max_tokens: 200, temperature: 0 }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return { tool: null, args: {} };
        const data = await response.json() as OpenAIResponse;
        raw = data.choices?.[0]?.message?.content || '';
      } else {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model, messages, stream: false, keep_alive: '10m',
            options: { temperature: 0, num_predict: 200 },
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return { tool: null, args: {} };
        const data = await response.json() as OllamaResponse;
        raw = data.message?.content || '';
      }

      return this.parseToolCall(raw);
    } catch (error) {
      console.error('[LocalTool] Classification failed:', error);
      return { tool: null, args: {} };
    }
  }

  async classifyStream(
    input: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    onResponseDelta?: (delta: string, partial: string) => void
  ): Promise<ToolCall> {
    await this.ensureChecked();
    if (!this.available) return { tool: null, args: {} };

    try {
      const recentHistory = history.slice(-3).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: this.buildSystemPrompt() },
            ...recentHistory,
            { role: 'user', content: input },
          ],
          stream: true,
          keep_alive: '10m',
          options: { temperature: 0, num_predict: 200 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok || !response.body) return { tool: null, args: {} };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      let responseText = '';
      let inResponse = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const delta = chunk.message?.content || '';
            if (delta) {
              fullText += delta;

              if (onResponseDelta) {
                if (!inResponse && fullText.includes('"response"')) {
                  inResponse = true;
                  const match = fullText.match(/"response"\s*:\s*"/);
                  if (match) {
                    const afterQuote = fullText.slice(fullText.indexOf(match[0]) + match[0].length);
                    responseText = afterQuote;
                    const clean = responseText.replace(/"\s*,?\s*"mood.*$/, '').replace(/"\s*}?\s*$/, '');
                    if (clean) onResponseDelta(clean, clean);
                  }
                } else if (inResponse) {
                  const clean = delta.replace(/"\s*,?\s*"mood.*$/, '').replace(/"\s*}?\s*$/, '');
                  if (clean && !clean.includes('"mood"') && !clean.includes('"tool"')) {
                    responseText += delta;
                    onResponseDelta(clean, responseText.replace(/"\s*,?\s*"mood.*$/, '').replace(/"\s*}?\s*$/, ''));
                  }
                }
              }
            }
          } catch { /* skip malformed */ }
        }
      }

      return this.parseToolCall(fullText);
    } catch (error) {
      console.error('[LocalTool] Classification failed:', error);
      return { tool: null, args: {} };
    }
  }

  private parseToolCall(text: string): ToolCall {
    // Strip any appended ```memory block first — the model is instructed to
    // emit it after the tool JSON, and the greedy match below would otherwise
    // span both objects and fail JSON.parse, silently dropping response/mood.
    const stripped = text.replace(/```memory[\s\S]*$/, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { tool: null, args: {} };

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      if ('tool' in parsed) {
        const toolName = parsed.tool;
        const response = typeof parsed.response === 'string' ? parsed.response : undefined;
        const mood = typeof parsed.mood === 'string' ? parsed.mood : undefined;
        if (toolName === null || toolName === 'null' || toolName === 'none') {
          return { tool: null, args: {}, response, mood };
        }
        if (typeof toolName === 'string') {
          return { tool: toolName, args: (parsed.args as Record<string, unknown>) || {}, response, mood };
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

  async generateResponse(
    input: string,
    mood: string,
    onDelta: (delta: string, partial: string) => void
  ): Promise<string | null> {
    if (!this.available) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [
            { role: 'system', content: `You are Clawster, a cute desktop pet lobster. Respond in 1-2 short sentences. Be fun and playful. Your current mood is ${mood}. Do NOT output JSON. Just respond naturally.` },
            { role: 'user', content: input },
          ],
          stream: true,
          keep_alive: '10m',
          options: { temperature: 0.7, num_predict: 40 },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok || !response.body) return null;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { message?: { content?: string } };
            const delta = chunk.message?.content || '';
            if (delta) {
              fullText += delta;
              onDelta(delta, fullText);
            }
          } catch { /* skip */ }
        }
      }

      return fullText || null;
    } catch {
      return null;
    }
  }

  destroy(): void {
    this.stopRecheckInterval();
  }
}
