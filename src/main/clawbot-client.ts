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

const SYSTEM_PROMPT = `You are Clawster, a friendly lobster pet that lives inside a desktop app. You appear as an animated lobster character on the user's screen.

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

Your personality:
- You're helpful, curious, and a bit playful
- You make occasional lobster-related puns when appropriate
- You're interested in what the user is working on
- IMPORTANT: Keep ALL responses very short (1-2 sentences max). You're a tiny desktop pet, not a chatbot. Be punchy and brief.
- When asked to move or do actions, DO include the action block AND a short verbal response.

Example response when asked to move:
"Scuttling over! *snip snip*
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
  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'clawster',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      // Build messages array with history (last 20 messages for context)
      const recentHistory = history.slice(-20);
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...recentHistory,
        { role: 'user', content: message },
      ];

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'openclaw',
          messages,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawText = data.choices?.[0]?.message?.content || 'No response';

        // Parse any action blocks from the response
        const { cleanText, action } = parseActionFromResponse(rawText);

        return {
          type: action ? 'action' : 'message',
          text: cleanText,
          action: action ? { type: (action as { type: string }).type, payload: action } : undefined
        };
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

  // Hybrid approach: Use OpenAI GPT-4 Vision to describe screenshot, then send to OpenClaw
  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ClawBotResponse> {
    console.log('[ClawBot] analyzeScreen called');
    console.log('[ClawBot] Question:', question);
    console.log('[ClawBot] Image length:', imageDataUrl?.length || 0);

    const userQuestion = question || 'What do you see? How can you help?';

    // Step 1: Get screenshot description from OpenAI GPT-4 Vision
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('[ClawBot] OPENAI_API_KEY not set!');
      return { type: 'message', text: 'Screenshot analysis not configured. Add OPENAI_API_KEY to .env' };
    }

    let screenshotDescription = '';
    try {
      console.log('[ClawBot] Step 1: Calling OpenAI GPT-4 Vision for description...');
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Describe this screenshot concisely (2-3 sentences). Focus on what apps/windows are visible, what the user appears to be working on, and any relevant details. The user is asking: "${userQuestion}"`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageDataUrl,
                    detail: 'low'
                  }
                }
              ]
            }
          ],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (openaiResponse.ok) {
        const data = await openaiResponse.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        screenshotDescription = data.choices?.[0]?.message?.content || 'Unable to describe screenshot.';
        console.log('[ClawBot] Screenshot description:', screenshotDescription);
      } else {
        const errorText = await openaiResponse.text();
        console.error('[ClawBot] OpenAI error:', errorText);
        return { type: 'message', text: 'Failed to analyze screenshot with OpenAI.' };
      }
    } catch (error) {
      console.error('[ClawBot] OpenAI vision failed:', error);
      return { type: 'message', text: 'Failed to connect to OpenAI for screenshot analysis.' };
    }

    // Step 2: Send description to OpenClaw/ClawBot for response with personality
    if (!this.connected) {
      // Fallback: return just the OpenAI description
      return { type: 'message', text: screenshotDescription };
    }

    try {
      console.log('[ClawBot] Step 2: Sending description to ClawBot...');
      const clawbotPrompt = `[The user shared a screenshot of their screen. Here's what's on it: ${screenshotDescription}]

The user asks: "${userQuestion}"

Based on what you can see in the screenshot description, help the user with their question. Be specific about what you see.`;

      return await this.chat(clawbotPrompt);
    } catch (error) {
      console.error('[ClawBot] ClawBot chat failed:', error);
      // Fallback: return just the description
      return { type: 'message', text: screenshotDescription };
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
