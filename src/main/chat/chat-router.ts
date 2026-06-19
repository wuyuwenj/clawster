import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { CloudChatProvider } from './cloud-provider';
import { LocalToolProvider } from './local-tool-provider';
import { executeTool } from './tool-executor';

export class ChatRouter extends EventEmitter {
  private cloud: CloudChatProvider;
  private local: LocalToolProvider;

  constructor(cloud: CloudChatProvider, local: LocalToolProvider) {
    super();
    this.cloud = cloud;
    this.local = local;

    this.cloud.on('connection-changed', (status) => {
      this.emit('connection-changed', status);
    });
  }

  isAvailable(): boolean {
    return this.cloud.isAvailable() || this.local.isAvailable();
  }

  getConnectionStatus(): { connected: boolean; error: string | null } {
    return this.cloud.getConnectionStatus();
  }

  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ChatResponse> {
    if (this.local.isAvailable()) {
      const toolCall = await this.local.classify(message);

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
    }

    return this.cloud.chat(message, history);
  }

  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ChatResponse> {
    if (this.local.isAvailable()) {
      const toolCall = await this.local.classify(message);

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
    }

    return this.cloud.chatStream(message, history, handlers);
  }

  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
    return this.cloud.analyzeScreen(imageDataUrl, question);
  }

  updateConfig(baseUrl: string): void {
    this.cloud.updateConfig(baseUrl);
  }

  destroy(): void {
    this.cloud.destroy();
    this.local.destroy();
  }
}
