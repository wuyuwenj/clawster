import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { LocalToolProvider } from './local-tool-provider';
import { executeTool } from './tool-executor';
import { getTemplateResponse } from './personality-responses';
import { logInteraction } from './interaction-logger';
import { checkSafety } from './safety-filter';
import type { EmotionEngine } from '../emotion-engine';

function stripScreenContext(message: string): string {
  return message.replace(/^\[Screen Context:.*?\]\s*/s, '');
}

// Prepare prior turns for the classifier: strip screen-context prefixes, drop
// empties, and keep only the last few messages so "how about downloads?" can
// resolve against "what files are on my desktop?".
function prepHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .map(m => ({ role: m.role, content: stripScreenContext(m.content || '').trim() }))
    .filter(m => m.content.length > 0)
    .slice(-3);
}

const MOOD_KEYWORDS = /\b(mood|sleep|happy|sad|spin|mad|angry|curious|excited|proud|huff|peek|side.eye|tap|scoot|idle|dance|wake|cheer|grumpy|tired|bored|nap|doze|wave|snip|chill|relax|calm)\b/i;

const KNOWN_TOOLS = new Set([
  'set_mood', 'move_to', 'move_to_cursor', 'snip', 'wave', 'open_app', 'open_url',
  'take_screenshot', 'get_calendar_events', 'create_calendar_event', 'create_reminder',
  'play_music', 'send_notification', 'search_files', 'list_files', 'get_weather',
  'set_timer', 'create_timer', 'run_shell', 'system_control', 'send_message',
  'read_clipboard', 'summarize_clipboard',
]);

function isFalsePositiveTool(input: string, tool: string | null): boolean {
  if (!tool) return false;
  if (!KNOWN_TOOLS.has(tool)) return true;
  if (tool !== 'set_mood') return false;
  if (MOOD_KEYWORDS.test(input)) return false;
  if (input.trim().length <= 2) return true;
  return true;
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
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);

    const safety = checkSafety(rawInput);
    if (safety.blocked) {
      this.emotionEngine?.onConversationMood('worried');
      logInteraction({ input: rawInput, tool: null, response: safety.response, mood: 'worried', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: safety.response! };
    }

    const start = Date.now();
    const toolCall = await this.toolModel.classify(rawInput, prepHistory(history));
    const latencyMs = Date.now() - start;

    this.emotionEngine?.onInteraction();
    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);

    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const result = await executeTool(toolCall.tool, toolCall.args);
      logInteraction({ input: rawInput, tool: toolCall.tool, args: toolCall.args, response: result.response, mood: toolCall.mood, latencyMs, ts: Date.now() });

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
    logInteraction({ input: rawInput, tool: null, response: reply, mood: toolCall.mood, latencyMs, ts: Date.now() });
    return { type: 'message', text: reply };
  }

  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ChatResponse> {
    const rawInput = stripScreenContext(message);

    const safety = checkSafety(rawInput);
    if (safety.blocked) {
      this.emotionEngine?.onConversationMood('worried');
      handlers.onDelta?.(safety.response!, safety.response!);
      logInteraction({ input: rawInput, tool: null, response: safety.response, mood: 'worried', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: safety.response! };
    }

    const start = Date.now();

    this.emotionEngine?.onInteraction();

    const toolCall = await this.toolModel.classify(rawInput, prepHistory(history));
    const latencyMs = Date.now() - start;

    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);

    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const result = await executeTool(toolCall.tool, toolCall.args);
      logInteraction({ input: rawInput, tool: toolCall.tool, args: toolCall.args, response: result.response, mood: toolCall.mood, latencyMs, ts: Date.now() });

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

    const reply = toolCall.response || getTemplateResponse(rawInput, toolCall.mood);
    logInteraction({ input: rawInput, tool: null, response: reply, mood: toolCall.mood, latencyMs, ts: Date.now() });
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
