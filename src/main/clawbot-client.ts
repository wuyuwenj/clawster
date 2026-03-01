import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

  // Send a chat message to ClawBot (OpenAI-compatible API)
  async chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<ClawBotResponse> {
    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    try {
      // Build messages array with history (last 20 messages for context)
      const recentHistory = history.slice(-20);
      const messages: Array<{ role: string; content: string }> = [];

      // Only send system prompt when using Clawster workspace (agentId is set)
      // When using OpenClaw workspace, let the workspace files define the identity
      if (this.agentId) {
        messages.push({ role: 'system', content: SYSTEM_PROMPT });
      }

      messages.push(...recentHistory, { role: 'user', content: message });

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
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

  // Save screenshot to temp file and send path to OpenClaw for analysis
  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ClawBotResponse> {
    console.log('[ClawBot] analyzeScreen called');
    console.log('[ClawBot] Question:', question);
    console.log('[ClawBot] Image length:', imageDataUrl?.length || 0);

    const userQuestion = question || 'What do you see? How can you help?';

    if (!this.connected) {
      return { type: 'message', text: 'ClawBot is not connected. Check if it\'s running.' };
    }

    // Save screenshot to a temp file so OpenClaw can read it directly
    let screenshotPath: string | null = null;
    try {
      const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const tmpDir = path.join(os.tmpdir(), 'clawster');
      fs.mkdirSync(tmpDir, { recursive: true });
      screenshotPath = path.join(tmpDir, `screenshot-${Date.now()}.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
      console.log('[ClawBot] Screenshot saved to:', screenshotPath);
    } catch (error) {
      console.error('[ClawBot] Failed to save screenshot:', error);
      return { type: 'message', text: 'Failed to save screenshot for analysis.' };
    }

    try {
      const clawbotPrompt = `[SCREENSHOT: The user has captured a screenshot. The image file is located at: ${screenshotPath}]

USER QUESTION: "${userQuestion}"

Please read the screenshot file and answer the user's question. Be helpful and specific about what's shown in the screenshot.`;

      return await this.chat(clawbotPrompt);
    } catch (error) {
      console.error('[ClawBot] ClawBot chat failed:', error);
      return { type: 'message', text: 'Failed to analyze screenshot.' };
    } finally {
      // Clean up temp file after a delay to ensure OpenClaw has time to read it
      if (screenshotPath) {
        const filePath = screenshotPath;
        setTimeout(() => {
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }, 60000);
      }
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
