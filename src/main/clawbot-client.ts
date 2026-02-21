import { EventEmitter } from 'events';
import type { ActivityEvent } from './watchers';

interface ClawBotResponse {
  type: 'message' | 'suggestion' | 'action';
  text?: string;
  action?: {
    type: string;
    payload: unknown;
  };
}

export class ClawBotClient extends EventEmitter {
  private baseUrl: string;
  private token: string;
  private connected: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(baseUrl: string, token: string = '') {
    super();
    this.baseUrl = baseUrl;
    this.token = token;
    this.checkConnection();
    this.startPolling();
  }

  // Update configuration
  updateConfig(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl;
    this.token = token;
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
    return headers;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async checkConnection(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      this.connected = response.ok;
    } catch {
      this.connected = false;
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

  // Send a chat message to ClawBot (OpenAI-compatible API)
  async chat(message: string): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'main',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'openclaw',
          messages: [{ role: 'user', content: message }],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content || 'No response';
        return { type: 'message', text };
      } else {
        const errorText = await response.text();
        console.error(`ClawBot chat error (${response.status}):`, errorText);
        return { type: 'message', text: `ClawBot error ${response.status}: ${errorText.slice(0, 200)}` };
      }
    } catch (error) {
      console.error('Failed to chat with ClawBot:', error);
      return { type: 'message', text: `Failed to reach ClawBot: ${error}` };
    }
  }

  // Send a screen capture to ClawBot for analysis
  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected.' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/analyze-screen`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          image: imageDataUrl,
          question: question || 'What am I looking at? How can you help?',
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        return (await response.json()) as ClawBotResponse;
      } else {
        return { type: 'message', text: 'Screen analysis failed.' };
      }
    } catch (error) {
      console.error('Failed to analyze screen:', error);
      return { type: 'message', text: 'Failed to analyze screen.' };
    }
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

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
