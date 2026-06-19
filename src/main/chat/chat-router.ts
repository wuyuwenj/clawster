import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { LocalToolProvider } from './local-tool-provider';
import { executeTool } from './tool-executor';
import { getTemplateResponse } from './personality-responses';
import { logInteraction } from './interaction-logger';

function stripScreenContext(message: string): string {
  return message.replace(/^\[Screen Context:.*?\]\s*/s, '');
}

export class ChatRouter extends EventEmitter {
  private toolModel: LocalToolProvider;

  constructor(toolModel: LocalToolProvider) {
    super();
    this.toolModel = toolModel;
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

    if (toolCall.tool) {
      const result = await executeTool(toolCall.tool, toolCall.args);
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

    const reply = toolCall.response || getTemplateResponse(rawInput);
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
    const toolCall = await this.toolModel.classify(rawInput);
    const latencyMs = Date.now() - start;

    if (toolCall.tool) {
      const result = await executeTool(toolCall.tool, toolCall.args);
      logInteraction({ input: rawInput, tool: toolCall.tool, args: toolCall.args, response: result.response, latencyMs, ts: Date.now() });

      if (result.petAction) {
        const text = result.response || '';
        handlers.onDelta?.(text, text);
        return {
          type: 'action',
          text,
          action: { type: result.petAction.type, payload: result.petAction },
        };
      }

      if (result.handled && result.response) {
        handlers.onDelta?.(result.response, result.response);
        return { type: 'message', text: result.response };
      }
    }

    const reply = toolCall.response || getTemplateResponse(rawInput);
    logInteraction({ input: rawInput, tool: null, response: reply, latencyMs, ts: Date.now() });
    handlers.onDelta?.(reply, reply);
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
