import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ActivityEvent } from './watchers';

const execAsync = promisify(exec);

// Cron job types
interface CronJob {
  id: string;
  name: string;
  status: string;
}

interface CronRunEntry {
  ts: number;
  jobId: string;
  action: string;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  summary?: string;
  runAtMs: number;
  durationMs: number;
  nextRunAtMs: number;
}

interface CronRunsResponse {
  entries: CronRunEntry[];
}

interface ClawBotResponse {
  type: 'message' | 'suggestion' | 'action';
  text?: string;
  action?: {
    type: string;
    payload: unknown;
  };
}

interface ChatStreamHandlers {
  onDelta?: (delta: string, fullText: string) => void;
}

type ResponsesInputTextPart = {
  type: 'input_text';
  text: string;
};

type ResponsesInputImagePart = {
  type: 'input_image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

type ResponsesInputPart = ResponsesInputTextPart | ResponsesInputImagePart;

type ResponsesInputItem = {
  type: 'message';
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: ResponsesInputPart[];
};

type ChatCompletionsContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type ChatCompletionsMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatCompletionsContentPart[];
};

// Desktop capabilities prompt - generic, no personality (identity comes from workspace files)
const SYSTEM_PROMPT = `You are a desktop pet assistant running on the user's computer. You appear as an animated character on the user's screen.

Your capabilities:
- You can see which app the user is currently using
- You can see window titles (if enabled)
- You can watch for file changes in folders the user specifies
- You can capture and analyze what's on the user's screen
- You can move around on the desktop
- You can change your mood/animation state
- You can see cursor position when screen context is provided

ACTIONS - You can perform physical actions by including a JSON action block in your response:
\`\`\`action
{"type": "set_mood", "value": "happy"}
\`\`\`

Available actions:
- set_mood: Change your animation. Values: "idle", "happy", "curious", "sleeping", "thinking", "excited"
- move_to: Move to screen position. Include x, y coordinates: {"type": "move_to", "x": 500, "y": 300}
- move_to_cursor: Move near the user's cursor: {"type": "move_to_cursor"}
- snip: Do a claw snip animation: {"type": "snip"}
- wave: Wave your claws happily: {"type": "wave"}
- look_at: Move to look at a position: {"type": "look_at", "x": 800, "y": 400}

Screen coordinates: Top-left is (0,0). When you receive [Screen Context: ...], you'll see cursor position and screen size.

Interaction guidelines:
- Keep ALL responses very short (1-2 sentences max). You're a tiny desktop pet, not a chatbot. Be punchy and brief.
- When asked to move or do actions, DO include the action block AND a short verbal response.

Example response when asked to move:
"Coming over!
\`\`\`action
{"type": "move_to_cursor"}
\`\`\`"`;

// Parse action block from response text
function parseActionFromResponse(text: string): { cleanText: string; action?: unknown } {
  // Match ```action followed by JSON (flexible whitespace)
  const actionMatch = text.match(/```action\s*(\{[\s\S]*?\})\s*```/);
  if (actionMatch) {
    try {
      const jsonStr = actionMatch[1].trim();
      const action = JSON.parse(jsonStr);
      const cleanText = text.replace(/```action\s*\{[\s\S]*?\}\s*```/g, '').trim();
      return { cleanText, action };
    } catch (e) {
      // Model returned malformed JSON (e.g. {"type": "set_mood", "curious"} instead of {"type": "set_mood", "value": "curious"})
      // This is expected - fallback parser will handle it
      console.log('[ClawBot] Parsing malformed action JSON with fallback:', actionMatch[1]);
      // Try to extract action type and value from malformed JSON
      const typeMatch = actionMatch[1].match(/"type"\s*:\s*"([^"]+)"/);
      const valueMatch = actionMatch[1].match(/"value"\s*:\s*"([^"]+)"/);
      const xMatch = actionMatch[1].match(/"x"\s*:\s*(\d+)/);
      const yMatch = actionMatch[1].match(/"y"\s*:\s*(\d+)/);

      // Also try to find bare string values like {"type": "set_mood", "happy"}
      // Match any quoted string that's not a key (not followed by :)
      let bareValue: string | undefined;
      if (!valueMatch) {
        const allStrings = actionMatch[1].match(/"([^"]+)"/g);
        if (allStrings && allStrings.length >= 2) {
          // Find strings that aren't keys (type, value, x, y) and aren't the type value
          for (const str of allStrings) {
            const val = str.replace(/"/g, '');
            if (!['type', 'value', 'x', 'y', typeMatch?.[1]].includes(val)) {
              bareValue = val;
              break;
            }
          }
        }
      }

      if (typeMatch) {
        const cleanText = text.replace(/```action\s*\{[\s\S]*?\}\s*```/g, '').trim();
        return {
          cleanText,
          action: {
            type: typeMatch[1],
            value: valueMatch?.[1] || bareValue,
            x: xMatch ? parseInt(xMatch[1]) : undefined,
            y: yMatch ? parseInt(yMatch[1]) : undefined,
          }
        };
      }
      return { cleanText: text };
    }
  }
  return { cleanText: text };
}

export class ClawBotClient extends EventEmitter {
  private baseUrl: string;
  private token: string;
  private agentId: string | null;
  private connected: boolean = false;
  private lastError: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private cronPollInterval: NodeJS.Timeout | null = null;
  private cronJobs: CronJob[] = [];
  private lastSeenCronTs: Map<string, number> = new Map();
  private preferChatCompletions: boolean = false;

  constructor(baseUrl: string, token: string = '', agentId: string | null = null) {
    super();
    this.baseUrl = baseUrl;
    this.token = token;
    this.agentId = agentId;
    this.checkConnection();
    this.startPolling();
    this.startCronPolling();
  }

  // Update configuration
  updateConfig(baseUrl: string, token: string, agentId?: string | null): void {
    this.baseUrl = baseUrl;
    this.token = token;
    if (agentId !== undefined) {
      this.agentId = agentId;
    }
    this.preferChatCompletions = false;
    this.checkConnection();
  }

  // Get auth headers
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.agentId) {
      headers['x-openclaw-agent-id'] = this.agentId;
    }
    return headers;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionStatus(): { connected: boolean; error: string | null; gatewayUrl: string } {
    return {
      connected: this.connected,
      error: this.lastError,
      gatewayUrl: this.baseUrl,
    };
  }

  private async checkConnection(): Promise<void> {
    const wasConnected = this.connected;
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      this.connected = response.ok;
      this.lastError = response.ok ? null : `Gateway returned status ${response.status}`;
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : 'Connection failed';
    }

    // Emit event if connection state changed
    if (wasConnected !== this.connected) {
      this.emit('connection-changed', this.getConnectionStatus());
    }
  }

  // Start polling for suggestions/updates from ClawBot
  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      await this.checkConnection();

      if (!this.connected) return;

      try {
        const response = await fetch(`${this.baseUrl}/suggestions`, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = (await response.json()) as { suggestion?: unknown; mood?: unknown };

          if (data.suggestion) {
            this.emit('suggestion', data.suggestion);
          }

          if (data.mood) {
            this.emit('mood', data.mood);
          }
        }
      } catch {
        // Silently fail polling
      }
    }, 5000);
  }

  // Send an activity event to ClawBot
  async sendEvent(event: ActivityEvent): Promise<void> {
    if (!this.connected) return;

    try {
      await fetch(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      console.error('Failed to send event to ClawBot:', error);
    }
  }

  private buildTextChatMessages(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Array<{ role: string; content: string }> {
    const recentHistory = history.slice(-20);
    const messages: Array<{ role: string; content: string }> = [];

    // Only send system prompt when using Clawster workspace (agentId is set)
    // When using OpenClaw workspace, let the workspace files define the identity
    if (this.agentId) {
      messages.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    messages.push(...recentHistory, { role: 'user', content: message });
    return messages;
  }

  // Send a chat message to ClawBot via OpenClaw Responses API with chat-completions fallback
  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    const messages = this.buildTextChatMessages(message, history);

    if (this.preferChatCompletions) {
      return this.chatViaCompletions(messages);
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          input: this.buildResponsesTextInput(messages),
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = (await response.json()) as unknown;
        const rawText = this.extractTextFromResponsesPayload(data) || 'No response';
        return this.toClawBotResponse(rawText);
      }

      const errorText = await response.text();
      if (this.shouldFallbackToChatCompletions(response.status, errorText)) {
        this.markResponsesAsUnavailable(response.status, errorText);
        return this.chatViaCompletions(messages);
      }

      console.error(`ClawBot chat error (${response.status}):`, errorText);
      return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
    } catch (error) {
      console.error('Failed to chat with ClawBot:', error);
      return { type: 'message', text: `Failed to reach ClawBot: ${error}` };
    }
  }

  // Stream a chat message from ClawBot via Responses API with chat-completions fallback
  async chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    handlers: ChatStreamHandlers = {}
  ): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    const messages = this.buildTextChatMessages(message, history);

    if (this.preferChatCompletions) {
      return this.chatStreamViaCompletions(messages, handlers);
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          input: this.buildResponsesTextInput(messages),
          stream: true,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (this.shouldFallbackToChatCompletions(response.status, errorText)) {
          this.markResponsesAsUnavailable(response.status, errorText);
          return this.chatStreamViaCompletions(messages, handlers);
        }
        console.error(`ClawBot stream chat error (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      if (!response.body) {
        console.warn('[ClawBot] Responses stream missing body; falling back to non-streaming chat');
        return this.chat(message, history);
      }

      return this.consumeStreamResponse(response, handlers);
    } catch (error) {
      console.error('Failed to stream chat with ClawBot:', error);
      return { type: 'message', text: `Failed to reach ClawBot: ${error}` };
    }
  }

  // Send screenshot to Responses API first; fallback to chat-completions if responses endpoint is unavailable
  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ClawBotResponse> {
    const userQuestion = question || 'What do you see? How can you help?';

    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    const imageSource = this.parseBase64ImageSource(imageDataUrl);
    if (!imageSource) {
      return { type: 'message', text: 'Invalid screenshot format. Expected a base64 data URL.' };
    }

    if (this.preferChatCompletions) {
      return this.analyzeScreenViaCompletions(imageDataUrl, imageSource, userQuestion);
    }

    try {
      const input: ResponsesInputItem[] = [];
      if (this.agentId) {
        input.push({
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
        });
      }

      input.push({
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `${userQuestion}\n\nPlease analyze the attached screenshot and answer specifically about what is visible.`,
          },
          {
            type: 'input_image',
            source: imageSource,
          },
        ],
      });

      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          input,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (this.shouldFallbackToChatCompletions(response.status, errorText)) {
          this.markResponsesAsUnavailable(response.status, errorText);
          return this.analyzeScreenViaCompletions(imageDataUrl, imageSource, userQuestion);
        }
        console.error(`ClawBot image analysis error (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      const data = (await response.json()) as unknown;
      const rawText = this.extractTextFromResponsesPayload(data) || 'No response';
      return this.toClawBotResponse(rawText);
    } catch (error) {
      console.error('[ClawBot] ClawBot image analysis failed:', error);
      return { type: 'message', text: 'Failed to analyze screenshot.' };
    }
  }

  private buildResponsesTextInput(
    messages: Array<{ role: string; content: string }>
  ): ResponsesInputItem[] {
    return messages.map((msg) => ({
      type: 'message',
      role: this.normalizeMessageRole(msg.role),
      content: [{ type: 'input_text', text: msg.content }],
    }));
  }

  private normalizeMessageRole(role: string): ResponsesInputItem['role'] {
    if (role === 'system' || role === 'developer' || role === 'assistant' || role === 'user') {
      return role;
    }
    return 'user';
  }

  private parseBase64ImageSource(imageDataUrl: string): ResponsesInputImagePart['source'] | null {
    const dataUrlMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!dataUrlMatch) {
      return null;
    }

    return {
      type: 'base64',
      media_type: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  private normalizeChatCompletionsRole(role: string): ChatCompletionsMessage['role'] {
    if (role === 'system' || role === 'assistant' || role === 'user') {
      return role;
    }
    if (role === 'developer') {
      return 'system';
    }
    return 'user';
  }

  private buildChatCompletionsMessages(
    messages: Array<{ role: string; content: string }>
  ): ChatCompletionsMessage[] {
    return messages.map((message) => ({
      role: this.normalizeChatCompletionsRole(message.role),
      content: message.content,
    }));
  }

  private async chatViaCompletions(
    messages: Array<{ role: string; content: string }>
  ): Promise<ClawBotResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          messages: this.buildChatCompletionsMessages(messages),
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`ClawBot chat-completions error (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      const data = (await response.json()) as unknown;
      const rawText = this.extractTextFromResponsesPayload(data) || 'No response';
      return this.toClawBotResponse(rawText);
    } catch (error) {
      console.error('Failed to chat with ClawBot (chat-completions):', error);
      return { type: 'message', text: `Failed to reach ClawBot: ${error}` };
    }
  }

  private async chatStreamViaCompletions(
    messages: Array<{ role: string; content: string }>,
    handlers: ChatStreamHandlers
  ): Promise<ClawBotResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          messages: this.buildChatCompletionsMessages(messages),
          stream: true,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`ClawBot stream chat-completions error (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      if (!response.body) {
        console.warn('[ClawBot] Chat-completions stream missing body; falling back to non-streaming chat');
        return this.chatViaCompletions(messages);
      }

      return this.consumeStreamResponse(response, handlers);
    } catch (error) {
      console.error('Failed to stream chat with ClawBot (chat-completions):', error);
      return { type: 'message', text: `Failed to reach ClawBot: ${error}` };
    }
  }

  private async consumeStreamResponse(
    response: Response,
    handlers: ChatStreamHandlers
  ): Promise<ClawBotResponse> {
    if (!response.body) {
      return { type: 'message', text: 'No response body received from gateway.' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawText = '';
    let done = false;
    let completedPayload: unknown = null;

    const handleStreamPayload = (payload: string): void => {
      if (!payload) return;
      if (payload === '[DONE]') {
        done = true;
        return;
      }

      try {
        const chunk = JSON.parse(payload) as { type?: unknown; response?: unknown };
        const delta = this.extractDeltaFromResponsesStreamPayload(chunk);
        if (delta) {
          rawText += delta;
          handlers.onDelta?.(delta, rawText);
        }

        if (chunk.type === 'response.completed') {
          completedPayload = chunk.response || chunk;
        } else {
          completedPayload = chunk;
        }
      } catch (error) {
        console.warn('[ClawBot] Failed to parse stream chunk:', payload.slice(0, 120), error);
      }
    };

    while (!done) {
      const result = await reader.read();
      done = result.done;

      if (result.value) {
        buffer += decoder.decode(result.value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const lines = evt.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            handleStreamPayload(payload);
          }
        }
      }
    }

    if (buffer.trim().length > 0) {
      const trailingLines = buffer.split('\n');
      for (const line of trailingLines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        handleStreamPayload(payload);
      }
    }

    if (!rawText) {
      rawText = this.extractTextFromResponsesPayload(completedPayload) || 'No response';
    }

    return this.toClawBotResponse(rawText);
  }

  private async analyzeScreenViaCompletions(
    imageDataUrl: string,
    imageSource: ResponsesInputImagePart['source'],
    userQuestion: string
  ): Promise<ClawBotResponse> {
    const messages: ChatCompletionsMessage[] = [];
    if (this.agentId) {
      messages.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${userQuestion}\n\nPlease analyze the attached screenshot and answer specifically about what is visible.`,
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl },
        },
      ],
    });

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          messages,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (this.shouldRetryCompletionsImageWithFilePath(response.status, errorText)) {
          return this.analyzeScreenViaCompletionsFilePath(userQuestion, imageSource);
        }
        console.error(`ClawBot image analysis via chat-completions failed (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      const data = (await response.json()) as unknown;
      const rawText = this.extractTextFromResponsesPayload(data) || 'No response';
      return this.toClawBotResponse(rawText);
    } catch (error) {
      console.error('[ClawBot] ClawBot image analysis via chat-completions failed:', error);
      return { type: 'message', text: 'Failed to analyze screenshot.' };
    }
  }

  private async analyzeScreenViaCompletionsFilePath(
    userQuestion: string,
    imageSource: ResponsesInputImagePart['source']
  ): Promise<ClawBotResponse> {
    const extension = this.mediaTypeToExtension(imageSource.media_type);
    const tempPath = path.join(
      os.tmpdir(),
      `clawster-screenshot-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
    );

    try {
      await fs.writeFile(tempPath, Buffer.from(imageSource.data, 'base64'));

      const messages: ChatCompletionsMessage[] = [];
      if (this.agentId) {
        messages.push({ role: 'system', content: SYSTEM_PROMPT });
      }

      messages.push({
        role: 'user',
        content: `${userQuestion}\n\nAnalyze this screenshot file on disk: ${tempPath}\n\nPlease answer specifically about what is visible in this screenshot.`,
      });

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'openclaw',
          messages,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`ClawBot file-path screenshot analysis failed (${response.status}):`, errorText);
        return { type: 'message', text: this.formatGatewayError(response.status, errorText) };
      }

      const data = (await response.json()) as unknown;
      const rawText = this.extractTextFromResponsesPayload(data) || 'No response';
      return this.toClawBotResponse(rawText);
    } catch (error) {
      console.error('[ClawBot] Failed to analyze screenshot via file-path fallback:', error);
      return { type: 'message', text: 'Failed to analyze screenshot.' };
    } finally {
      void fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  private mediaTypeToExtension(mediaType: string): string {
    if (mediaType === 'image/jpeg') return 'jpg';
    if (mediaType === 'image/webp') return 'webp';
    if (mediaType === 'image/gif') return 'gif';
    return 'png';
  }

  private shouldFallbackToChatCompletions(status: number, errorText: string): boolean {
    if (status === 405) return true;
    if (status === 404 && this.isResponsesEndpointError(errorText)) return true;
    if (status >= 500 && this.isResponsesEndpointError(errorText)) return true;
    return false;
  }

  private markResponsesAsUnavailable(status: number, errorText: string): void {
    if (!this.preferChatCompletions) {
      console.warn(
        `[ClawBot] Responses endpoint unavailable (${status}); switching to /v1/chat/completions fallback`,
        errorText.slice(0, 300)
      );
    }
    this.preferChatCompletions = true;
  }

  private isResponsesEndpointError(errorText: string): boolean {
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('/v1/responses') ||
      normalized.includes('responses endpoint') ||
      normalized.includes('method not allowed') ||
      normalized.includes('not found') ||
      normalized.includes('unknown route') ||
      normalized.includes('unsupported route')
    );
  }

  private shouldRetryCompletionsImageWithFilePath(status: number, errorText: string): boolean {
    if (status !== 400 && status !== 422 && status !== 500) {
      return false;
    }
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('image_url') ||
      normalized.includes('invalid image') ||
      normalized.includes('unsupported image') ||
      normalized.includes('vision') ||
      normalized.includes('content')
    );
  }

  private formatGatewayError(status: number, errorText: string): string {
    if (status === 405 && this.isResponsesEndpointError(errorText)) {
      return 'ClawBot error 405: Responses endpoint disabled. Set gateway.http.endpoints.responses.enabled=true in ~/.openclaw/openclaw.json and restart the gateway.';
    }
    return `ClawBot error ${status}: ${errorText.slice(0, 200)}`;
  }

  private extractTextFromResponsesPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as {
      output_text?: unknown;
      output?: unknown;
      response?: unknown;
      choices?: Array<{
        message?: {
          content?: unknown;
        };
      }>;
    };

    if (typeof data.output_text === 'string' && data.output_text.length > 0) {
      return data.output_text;
    }

    if (Array.isArray(data.output_text)) {
      const textParts = data.output_text
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            return (part as { text: string }).text;
          }
          return '';
        })
        .filter((part) => part.length > 0);
      if (textParts.length > 0) {
        return textParts.join('');
      }
    }

    const outputTextParts: string[] = [];
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!item || typeof item !== 'object') continue;
        const itemObj = item as { text?: unknown; content?: unknown };
        if (typeof itemObj.text === 'string' && itemObj.text.length > 0) {
          outputTextParts.push(itemObj.text);
        }
        if (Array.isArray(itemObj.content)) {
          for (const part of itemObj.content) {
            if (!part || typeof part !== 'object') continue;
            const partObj = part as { type?: unknown; text?: unknown };
            if (typeof partObj.text === 'string' && partObj.text.length > 0) {
              const partType = typeof partObj.type === 'string' ? partObj.type : '';
              if (!partType || partType.includes('text')) {
                outputTextParts.push(partObj.text);
              }
            }
          }
        }
      }
    }
    if (outputTextParts.length > 0) {
      return outputTextParts.join('');
    }

    // response.completed events may nest the full response object under "response"
    if (data.response && typeof data.response === 'object') {
      const nested = this.extractTextFromResponsesPayload(data.response);
      if (nested) return nested;
    }

    // Compatibility with legacy chat-completions shape
    const fallbackText = data.choices?.[0]?.message?.content;
    if (typeof fallbackText === 'string' && fallbackText.length > 0) {
      return fallbackText;
    }
    if (Array.isArray(fallbackText)) {
      const parts = fallbackText
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }
          return '';
        })
        .filter((part) => part.length > 0);
      if (parts.length > 0) {
        return parts.join('');
      }
    }

    return null;
  }

  private extractDeltaFromResponsesStreamPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as {
      type?: unknown;
      delta?: unknown;
      part?: unknown;
      choices?: Array<{
        delta?: { content?: unknown };
      }>;
    };

    if (data.type === 'response.output_text.delta') {
      if (typeof data.delta === 'string' && data.delta.length > 0) {
        return data.delta;
      }
      if (data.delta && typeof data.delta === 'object' && typeof (data.delta as { text?: unknown }).text === 'string') {
        return (data.delta as { text: string }).text;
      }
    }

    if (data.type === 'response.content_part.added' && data.part && typeof data.part === 'object') {
      const part = data.part as { type?: unknown; text?: unknown };
      if (typeof part.text === 'string' && part.text.length > 0) {
        const partType = typeof part.type === 'string' ? part.type : '';
        if (!partType || partType.includes('text')) {
          return part.text;
        }
      }
    }

    const legacyDelta = data.choices?.[0]?.delta?.content;
    if (typeof legacyDelta === 'string' && legacyDelta.length > 0) {
      return legacyDelta;
    }
    if (Array.isArray(legacyDelta)) {
      const parts = legacyDelta
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }
          return '';
        })
        .filter((part) => part.length > 0);
      if (parts.length > 0) {
        return parts.join('');
      }
    }

    return null;
  }

  private toClawBotResponse(rawText: string): ClawBotResponse {
    const { cleanText, action } = parseActionFromResponse(rawText);
    return {
      type: action ? 'action' : 'message',
      text: cleanText,
      action: action ? { type: (action as { type: string }).type, payload: action } : undefined,
    };
  }

  // Request ClawBot to perform an action
  async performAction(actionType: string, payload: unknown): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected.' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/action`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ action: actionType, payload }),
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        return (await response.json()) as ClawBotResponse;
      } else {
        return { type: 'message', text: 'Action failed.' };
      }
    } catch (error) {
      console.error('Failed to perform action:', error);
      return { type: 'message', text: 'Failed to perform action.' };
    }
  }

  // List all cron jobs via CLI
  private async listCronJobs(): Promise<CronJob[]> {
    try {
      const { stdout } = await execAsync('openclaw cron list --json', {
        timeout: 10000,
        env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: this.token },
      });
      const data = JSON.parse(stdout);
      // The CLI might return { jobs: [...] } or just an array
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      return jobs.map((job: { id: string; name?: string; status?: string }) => ({
        id: job.id,
        name: job.name || 'Unnamed',
        status: job.status || 'unknown',
      }));
    } catch (error) {
      console.error('[ClawBot] Failed to list cron jobs:', error);
      return [];
    }
  }

  // Get recent runs for a specific cron job via CLI
  private async getCronRuns(jobId: string): Promise<CronRunEntry[]> {
    try {
      const { stdout } = await execAsync(`openclaw cron runs --id ${jobId} --limit 1`, {
        timeout: 10000,
        env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: this.token },
      });
      const data: CronRunsResponse = JSON.parse(stdout);
      return data.entries || [];
    } catch (error) {
      console.error(`[ClawBot] Failed to get cron runs for ${jobId}:`, error);
      return [];
    }
  }

  // Start polling for cron job results (every 30 seconds)
  private async startCronPolling(): Promise<void> {
    // Initial fetch of cron jobs
    console.log('[ClawBot] Starting cron polling...');
    this.cronJobs = await this.listCronJobs();
    console.log(`[ClawBot] Found ${this.cronJobs.length} cron jobs:`, this.cronJobs.map(j => j.name));

    // Poll every 30 seconds
    this.cronPollInterval = setInterval(async () => {
      if (!this.connected) return;

      // Refresh job list periodically (in case new jobs are added)
      this.cronJobs = await this.listCronJobs();

      for (const job of this.cronJobs) {
        const runs = await this.getCronRuns(job.id);
        if (runs.length === 0) continue;

        const latestRun = runs[0];
        const lastSeen = this.lastSeenCronTs.get(job.id) || 0;

        // Check if this is a new run we haven't seen
        if (latestRun.ts > lastSeen) {
          this.lastSeenCronTs.set(job.id, latestRun.ts);

          // Emit for any run with a summary (ok or skipped with content)
          if (latestRun.summary) {
            console.log(`[ClawBot] New cron result for "${job.name}" (${latestRun.status}):`, latestRun.summary.slice(0, 100));
            this.emit('cronResult', {
              jobId: job.id,
              jobName: job.name,
              status: latestRun.status,
              summary: latestRun.summary,
              timestamp: latestRun.ts,
            });
          } else if (latestRun.status === 'error' && latestRun.error) {
            console.log(`[ClawBot] Cron error for "${job.name}":`, latestRun.error);
            this.emit('cronError', {
              jobId: job.id,
              jobName: job.name,
              error: latestRun.error,
              timestamp: latestRun.ts,
            });
          }
        }
      }
    }, 30000);
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.cronPollInterval) {
      clearInterval(this.cronPollInterval);
      this.cronPollInterval = null;
    }
  }
}
