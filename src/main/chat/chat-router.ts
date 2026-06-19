import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { LocalToolProvider } from './local-tool-provider';
import { executeTool } from './tool-executor';
import { getTemplateResponse } from './personality-responses';
import { logInteraction } from './interaction-logger';
import type { EmotionEngine } from '../emotion-engine';

function stripScreenContext(message: string): string {
  return message.replace(/^\[Screen Context:.*?\]\s*/s, '');
}

export class ChatRouter extends EventEmitter {
  private toolModel: LocalToolProvider;
  private emotionEngine: EmotionEngine | null = null;

  constructor(toolModel: LocalToolProvider) {
    super();
    this.toolModel = toolModel;
  }

  setEmotionEngine(engine: EmotionEngine): void {
    this.emotionEngine = engine;
  }

  isAvailable(): boolean {
    return true;
  }

  getConnectionStatus(): { connected: boolean; error: string | null } {
    return { connected: true, error: null };
  }

  async chat(
    message: string,
    _history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);
    const start = Date.now();
    const toolCall = await this.toolModel.classify(rawInput);
    const latencyMs = Date.now() - start;

    this.emotionEngine?.onInteraction();

    if (toolCall.tool) {
      const result = await executeTool(toolCall.tool, toolCall.args);
      if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);
      logInteraction({ input: rawInput, tool: toolCall.tool, args: toolCall.args, response: result.response, latencyMs, ts: Date.now() });

      if (result.petAction) {
        return {
          type: 'action',
          text: result.response || '',
          action: { type: result.petAction.type, payload: result.petAction },
        };
      }

      if (result.handled && result.response) {
        return { type: 'message', text: result.response };
      }
    }

    const reply = toolCall.response || getTemplateResponse(rawInput, toolCall.mood);
    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);
    logInteraction({ input: rawInput, tool: null, response: reply, latencyMs, ts: Date.now() });
    return { type: 'message', text: reply };
  }

  async chatStream(
    message: string,
    _history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);
    const start = Date.now();

    this.emotionEngine?.onInteraction();

    let responseAborted = false;
    let streamedText = '';

    const responsePromise = this.toolModel.generateResponse(rawInput, 'happy', (delta, partial) => {
      if (!responseAborted) {
        streamedText = partial;
        handlers.onDelta?.(delta, partial);
      }
    });

    const toolCall = await this.toolModel.classify(rawInput);
    const latencyMs = Date.now() - start;

    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);

    if (toolCall.tool) {
      responseAborted = true;
      const result = await executeTool(toolCall.tool, toolCall.args);
      logInteraction({ input: rawInput, tool: toolCall.tool, args: toolCall.args, response: result.response, latencyMs, ts: Date.now() });

      if (result.petAction) {
        if (!streamedText) {
          const text = result.response || '';
          handlers.onDelta?.(text, text);
        }
        return {
          type: 'action',
          text: streamedText || result.response || '',
          action: { type: result.petAction.type, payload: result.petAction },
        };
      }

      if (result.handled && result.response) {
        if (!streamedText) handlers.onDelta?.(result.response, result.response);
        return { type: 'message', text: streamedText || result.response };
      }
    }

    const fullReply = await responsePromise;
    const reply = fullReply || getTemplateResponse(rawInput, toolCall.mood);
    logInteraction({ input: rawInput, tool: null, response: reply, latencyMs, ts: Date.now() });
    if (!fullReply) handlers.onDelta?.(reply, reply);
    return { type: 'message', text: reply };
  }

  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
    return { type: 'message', text: "Screen analysis needs the cloud connection. Coming soon!" };
  }

  updateConfig(_baseUrl: string): void {}

  destroy(): void {
    this.toolModel.destroy();
  }
}
