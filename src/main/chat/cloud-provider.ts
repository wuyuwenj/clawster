import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatProvider, ChatResponse, ChatStreamHandlers } from './types';
import { parseActionFromResponse } from './parse-action';
import { buildAuthHeaders } from './hmac-auth';
import { SYSTEM_PROMPT } from './system-prompt';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export class CloudChatProvider extends EventEmitter implements ChatProvider {
  private baseUrl: string;
  private deviceId: string;
  private connected: boolean = false;
  private lastError: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private identityPrompt: string = '';
  private soulPrompt: string = '';

  constructor(baseUrl: string, deviceId: string, personalityDir: string) {
    super();
    this.baseUrl = baseUrl;
    this.deviceId = deviceId;
    this.loadPersonalityFiles(personalityDir);
    this.checkConnection();
    this.startPolling();
  }

  updateConfig(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.checkConnection();
  }

  isAvailable(): boolean {
    return this.connected;
  }

  getConnectionStatus(): { connected: boolean; error: string | null } {
    return { connected: this.connected, error: this.lastError };
  }

  private loadPersonalityFiles(personalityDir: string): void {
    try {
      const identityPath = path.join(personalityDir, 'IDENTITY.md');
      if (fs.existsSync(identityPath)) {
        this.identityPrompt = fs.readFileSync(identityPath, 'utf-8');
      }
    } catch { /* no identity file */ }
    try {
      const soulPath = path.join(personalityDir, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        this.soulPrompt = fs.readFileSync(soulPath, 'utf-8');
      }
    } catch { /* no soul file */ }
  }

  private buildSystemPrompt(): string {
    const parts = [SYSTEM_PROMPT];
    if (this.identityPrompt) parts.push(`\n\nIDENTITY:\n${this.identityPrompt}`);
    if (this.soulPrompt) parts.push(`\n\nSOUL:\n${this.soulPrompt}`);
    return parts.join('');
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<Response> {
    const bodyStr = JSON.stringify(body);
    const authHeaders = buildAuthHeaders(bodyStr, this.deviceId);
    return fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: bodyStr,
      signal: AbortSignal.timeout(120000),
    });
  }

  private async checkConnection(): Promise<void> {
    const wasConnected = this.connected;
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      this.connected = response.ok;
      this.lastError = response.ok ? null : `Server returned status ${response.status}`;
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : 'Connection failed';
    }

    if (wasConnected !== this.connected) {
      this.emit('connection-changed', this.getConnectionStatus());
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      this.checkConnection();
    }, 15000);
  }

  private buildMessages(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): ChatMessage[] {
    const recentHistory = history.slice(-20);
    return [
      { role: 'system', content: this.buildSystemPrompt() },
      ...recentHistory,
      { role: 'user', content: message },
    ];
  }

  private toResponse(rawText: string): ChatResponse {
    const { cleanText, action } = parseActionFromResponse(rawText);
    return {
      type: action ? 'action' : 'message',
      text: cleanText,
      action: action ? { type: (action as { type: string }).type, payload: action } : undefined,
    };
  }

  private extractText(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const obj = data as Record<string, unknown>;

    if (typeof obj.output_text === 'string') return obj.output_text;

    if (Array.isArray(obj.choices)) {
      const content = (obj.choices as Array<{ message?: { content?: string } }>)[0]?.message?.content;
      if (typeof content === 'string') return content;
    }

    return '';
  }

  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ChatResponse> {
    if (!this.connected) {
      return { type: 'message', text: "I can't reach my brain right now. Check your internet connection!" };
    }

    try {
      const messages = this.buildMessages(message, history);
      const response = await this.makeRequest('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          return { type: 'message', text: "I'm getting sleepy... let's chat more tomorrow!" };
        }
        console.error(`[CloudChat] Error (${response.status}):`, errorText);
        return { type: 'message', text: 'Something went wrong. Try again in a moment!' };
      }

      const data = await response.json();
      const rawText = this.extractText(data) || 'No response';
      return this.toResponse(rawText);
    } catch (error) {
      console.error('[CloudChat] Failed:', error);
      return { type: 'message', text: "I can't reach my brain right now. Check your internet connection!" };
    }
  }

  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ChatResponse> {
    if (!this.connected) {
      return { type: 'message', text: "I can't reach my brain right now. Check your internet connection!" };
    }

    try {
      const messages = this.buildMessages(message, history);
      const response = await this.makeRequest('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages,
        stream: true,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          return { type: 'message', text: "I'm getting sleepy... let's chat more tomorrow!" };
        }
        console.error(`[CloudChat] Stream error (${response.status}):`, errorText);
        return { type: 'message', text: 'Something went wrong. Try again in a moment!' };
      }

      if (!response.body) {
        return { type: 'message', text: 'No response body received.' };
      }

      return this.consumeStream(response, handlers);
    } catch (error) {
      console.error('[CloudChat] Stream failed:', error);
      return { type: 'message', text: "I can't reach my brain right now. Check your internet connection!" };
    }
  }

  private parseSseLines(
    text: string,
    handlers: ChatStreamHandlers,
    state: { rawText: string }
  ): boolean {
    let shouldStop = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { shouldStop = true; continue; }

      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          state.rawText += delta;
          handlers.onDelta?.(delta, state.rawText);
        }
      } catch { /* skip malformed chunks */ }
    }
    return shouldStop;
  }

  private async consumeStream(
    response: Response,
    handlers: ChatStreamHandlers
  ): Promise<ChatResponse> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const state = { rawText: '' };
    let done = false;

    while (!done) {
      const result = await reader.read();
      done = result.done;

      if (result.value) {
        buffer += decoder.decode(result.value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          if (this.parseSseLines(evt, handlers, state)) done = true;
        }
      }
    }

    if (buffer.trim()) {
      this.parseSseLines(buffer, handlers, state);
    }

    return this.toResponse(state.rawText || 'No response');
  }

  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
    const userQuestion = question || 'What do you see? How can you help?';

    if (!this.connected) {
      return { type: 'message', text: "I can't reach my brain right now. Check your internet connection!" };
    }

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildSystemPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: `${userQuestion}\n\nPlease analyze the attached screenshot and answer specifically about what is visible.` },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ];

      const response = await this.makeRequest('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CloudChat] Image analysis error (${response.status}):`, errorText);
        return { type: 'message', text: 'Failed to analyze screenshot.' };
      }

      const data = await response.json();
      const rawText = this.extractText(data) || 'No response';
      return this.toResponse(rawText);
    } catch (error) {
      console.error('[CloudChat] Image analysis failed:', error);
      return { type: 'message', text: 'Failed to analyze screenshot.' };
    }
  }

  async sendEvent(event: unknown): Promise<void> {
    // Events are local-only for now; no need to send to the proxy
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export interface VisionProvider {
  analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse>;
}

// Lightweight, on-demand screen-analysis client. Unlike CloudChatProvider it
// does NOT poll or hold a connection — it only contacts the proxy when the user
// explicitly asks about their screen, preserving the local-first default.
export function createProxyVision(baseUrl: string, deviceId: string): VisionProvider {
  return {
    async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
      if (!imageDataUrl) {
        return { type: 'message', text: "I couldn't grab a screenshot to look at." };
      }
      const userQuestion = question?.trim() || 'What do you see on my screen?';
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `${userQuestion}\n\nPlease describe what is visible in the attached screenshot, briefly and helpfully.` },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      });
      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(body, deviceId) },
          body,
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          return { type: 'message', text: "I couldn't analyze your screen right now — my cloud eyes are offline." };
        }
        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim();
        return { type: 'message', text: text || "I looked but couldn't make out anything useful." };
      } catch {
        return { type: 'message', text: "I couldn't reach my cloud eyes to look at your screen." };
      }
    },
  };
}
