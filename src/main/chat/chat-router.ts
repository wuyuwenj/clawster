import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { LocalToolProvider } from './local-tool-provider';
import { LocalChatProvider } from './local-chat-provider';
import { executeTool } from './tool-executor';

function stripScreenContext(message: string): string {
  return message.replace(/^\[Screen Context:.*?\]\s*/s, '');
}

export class ChatRouter extends EventEmitter {
  private toolModel: LocalToolProvider;
  private chatModel: LocalChatProvider;
  private personalityPrompt: string = '';

  constructor(toolModel: LocalToolProvider, chatModel: LocalChatProvider) {
    super();
    this.toolModel = toolModel;
    this.chatModel = chatModel;
  }

  setPersonalityPrompt(prompt: string): void {
    this.personalityPrompt = prompt;
  }

  isAvailable(): boolean {
    return true;
  }

  getConnectionStatus(): { connected: boolean; error: string | null } {
    return { connected: true, error: null };
  }

  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);
    const toolCall = await this.toolModel.classify(rawInput);

    if (toolCall.tool) {
      const result = await executeTool(toolCall.tool, toolCall.args);

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

    return this.chatModel.chat(rawInput, history, this.personalityPrompt);
  }

  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);
    const toolCall = await this.toolModel.classify(rawInput);

    if (toolCall.tool) {
      const result = await executeTool(toolCall.tool, toolCall.args);

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

    return this.chatModel.chatStream(rawInput, history, handlers, this.personalityPrompt);
  }

  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
    return { type: 'message', text: "Screen analysis needs the cloud connection. Coming soon!" };
  }

  updateConfig(_baseUrl: string): void {
    // No-op for local-only mode
  }

  destroy(): void {
    this.toolModel.destroy();
  }
}
