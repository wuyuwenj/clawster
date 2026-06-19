import { SYSTEM_PROMPT } from './system-prompt';
import { parseActionFromResponse } from './parse-action';
import type { ChatResponse, ChatStreamHandlers } from './types';

export class LocalChatProvider {
  private baseUrl: string;
  private model: string;

  constructor(model: string = 'qwen2.5:7b', baseUrl: string = 'http://127.0.0.1:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    personalityPrompt: string = ''
  ): Promise<ChatResponse> {
    try {
      const systemContent = personalityPrompt
        ? `${SYSTEM_PROMPT}\n\n${personalityPrompt}`
        : SYSTEM_PROMPT;

      const messages = [
        { role: 'system', content: systemContent },
        ...history.slice(-20),
        { role: 'user', content: message },
      ];

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.7, num_predict: 150 },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return { type: 'message', text: "My brain is still warming up... try again in a sec!" };
      }

      const data = await response.json() as { message?: { content?: string } };
      const rawText = data.message?.content || '';
      const { cleanText, action } = parseActionFromResponse(rawText);

      return {
        type: action ? 'action' : 'message',
        text: cleanText,
        action: action ? { type: (action as { type: string }).type, payload: action } : undefined,
      };
    } catch {
      return { type: 'message', text: "My brain is still warming up... try again in a sec!" };
    }
  }

  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {},
    personalityPrompt: string = ''
  ): Promise<ChatResponse> {
    try {
      const systemContent = personalityPrompt
        ? `${SYSTEM_PROMPT}\n\n${personalityPrompt}`
        : SYSTEM_PROMPT;

      const messages = [
        { role: 'system', content: systemContent },
        ...history.slice(-20),
        { role: 'user', content: message },
      ];

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          keep_alive: '10m',
          options: { temperature: 0.7, num_predict: 150 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok || !response.body) {
        return this.chat(message, history, personalityPrompt);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawText = '';
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
            const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const delta = chunk.message?.content || '';
            if (delta) {
              rawText += delta;
              handlers.onDelta?.(delta, rawText);
            }
          } catch { /* skip */ }
        }
      }

      const { cleanText, action } = parseActionFromResponse(rawText);
      return {
        type: action ? 'action' : 'message',
        text: cleanText,
        action: action ? { type: (action as { type: string }).type, payload: action } : undefined,
      };
    } catch {
      return { type: 'message', text: "My brain is still warming up... try again in a sec!" };
    }
  }
}
