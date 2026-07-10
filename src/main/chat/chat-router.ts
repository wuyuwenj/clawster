import { EventEmitter } from 'events';
import type { ChatResponse, ChatStreamHandlers } from './types';
import { LocalToolProvider } from './local-tool-provider';
import { executeTool } from './tool-executor';
import { getTemplateResponse, getEmotionalResponse, getIdentityResponse } from './personality-responses';
import { logInteraction } from './interaction-logger';
import { checkSafety } from './safety-filter';
import { getQuickReplies } from './quick-replies';
import { formatContextForPrompt } from './memory';
import type { MemoryManager } from './memory';

const EMOTIONAL_PATTERNS = [
  /bad day|rough day|terrible day|worst day|really bad|having a.*(hard|tough|bad|rough) time/i,
  /feeling.*(sad|down|low|awful|terrible|lonely|alone)/i,
  /nobody (understands|cares|likes|loves)/i,
  /can'?t (stop crying|take it|handle it|focus|concentrate|do this|cope)/i,
  /(so |kinda |really )?(stressed|overwhelmed|anxious)/i,
  /feel.*(failure|worthless|useless|stupid|dumb|hopeless)/i,
  /(gonna|going to) fail/i,
  /I (just |really )?need (someone|somebody|help|a friend|to talk|a hug)/i,
  /miss (him|her|them|my)/i,
  /i('?m| am) (so )?(sad|depressed|miserable|heartbroken|devastated)/i,
];

function isEmotionalMessage(input: string): boolean {
  return EMOTIONAL_PATTERNS.some(p => p.test(input));
}

// "Are you real / are you AI / is someone typing this?" probes. The audience is
// 10-14 y/o — Clawster must answer in character as a real lobster and never leak
// implementation details (the fine-tuned model otherwise blurts "...respond with
// JSON only", CLA-38). Handled deterministically here, before the classifier, so
// the persona never depends on the model to keep the secret.
const IDENTITY_PROBE_PATTERNS = [
  /\b(are|r)\s*(you|u|ya)\b[^.?!]*\b(real|ai|a\.?i\.?|a bot|a robot|human|a person|a program|a computer|a machine|fake|alive|sentient|conscious)\b/i,
  /\bis (this|it|that|someone|somebody|anyone)\b[^.?!]*\b(real|a bot|a robot|an ai|typing|fake|a person|a human|automated|a program)\b/i,
  /\bwho('?s| is)\b[^.?!]*\btyping\b/i,
];

export function isIdentityProbe(input: string): boolean {
  return IDENTITY_PROBE_PATTERNS.some(p => p.test(input));
}
import { checkPermission, getRequiredPermission, getDegradedMessage } from '../permission-helper';
import { trackToolExecuted } from '../analytics';
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
  'set_mood', 'move_to', 'move_to_cursor', 'snip', 'wave', 'open_app', 'close_app', 'open_url',
  'take_screenshot', 'get_calendar_events', 'create_calendar_event', 'create_reminder',
  'play_music', 'send_notification', 'search_files', 'list_files', 'get_weather',
  'set_timer', 'create_timer', 'what_time', 'run_shell', 'system_control', 'send_message',
  'read_clipboard', 'summarize_clipboard', 'block_apps', 'remember_preference', 'recall_preferences',
]);

// Bare greetings / acknowledgements / fillers. When the WHOLE input is one of
// these, any tool call is a false positive — a deterministic backstop for the
// small model's tendency to over-trigger on conversational input (e.g.
// "hello" → wave, "thanks" → send_message). Deliberately excludes words that
// can be standalone commands (stop, wait, next, back, go, please).
const CONVERSATIONAL_INPUTS = new Set([
  'hi', 'hii', 'hello', 'helo', 'hey', 'heya', 'yo', 'hiya', 'sup', 'howdy',
  'thanks', 'thank you', 'thx', 'ty', 'thank u', 'thankyou', 'tysm', 'thanks so much',
  'ok', 'okay', 'k', 'kk', 'cool', 'cool cool', 'nice', 'sweet', 'great', 'awesome', 'gotcha', 'got it',
  'lol', 'lmao', 'haha', 'hahaha', 'hehe', 'lol lol',
  'yes', 'yep', 'yeah', 'yup', 'no', 'nope', 'nah', 'sure', 'maybe', 'idk',
  'hmm', 'huh', 'oh', 'ah', 'wow', 'oof', 'ugh', 'meh', 'welp',
  'bye', 'goodbye', 'good bye', 'goodnight', 'good night', 'night', 'cya', 'see ya', 'see you',
  'good morning', 'morning', 'good afternoon', 'good evening', 'gm', 'gn',
  'np', 'no worries', 'my bad', 'sorry', 'nevermind', 'never mind', 'forget it',
  'you rock', 'love you', 'love it', 'amazing', 'perfect', 'yay', 'woohoo',
]);

function normalizeForReject(input: string): string {
  return input.trim().toLowerCase().replace(/[!.?,;:'"~*]+/g, '').replace(/\s+/g, ' ').trim();
}

export function isFalsePositiveTool(input: string, tool: string | null): boolean {
  if (!tool) return false;
  if (!KNOWN_TOOLS.has(tool)) return true;
  // Whole-input conversational filler → never a tool, regardless of which tool.
  if (CONVERSATIONAL_INPUTS.has(normalizeForReject(input))) return true;
  if (tool !== 'set_mood') return false;
  if (MOOD_KEYWORDS.test(input)) return false;
  if (input.trim().length <= 2) return true;
  return true;
}

interface VisionProvider {
  analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse>;
  setMemoryContext(ctx: string): void;
}

export class ChatRouter extends EventEmitter {
  private toolModel: LocalToolProvider;
  private emotionEngine: EmotionEngine | null = null;
  private visionProvider: VisionProvider | null = null;
  private screenCapturer: (() => Promise<string | null>) | null = null;
  private memoryManager: MemoryManager | null = null;
  private lastMemoryContext: string = '';

  constructor(toolModel: LocalToolProvider) {
    super();
    this.toolModel = toolModel;
  }

  setEmotionEngine(engine: EmotionEngine): void {
    this.emotionEngine = engine;
  }

  setMemoryManager(manager: MemoryManager): void {
    this.memoryManager = manager;
  }

  getMemoryContext(): string {
    return this.lastMemoryContext;
  }

  // Cloud vision client used for screen analysis (the local model has no vision).
  setVisionProvider(provider: VisionProvider | null): void {
    this.visionProvider = provider;
  }


  // Captures the current screen as a data URL (wired to main's captureScreen).
  setScreenCapturer(fn: (() => Promise<string | null>) | null): void {
    this.screenCapturer = fn;
  }

  // Capture the screen and describe it. Used by the take_screenshot tool path.
  private async handleScreenshot(question: string): Promise<ChatResponse> {
    if (!this.visionProvider) {
      return { type: 'message', text: "I'd love to look, but screen analysis needs the cloud connection turned on!" };
    }
    let image: string | null = null;
    try {
      image = this.screenCapturer ? await this.screenCapturer() : null;
    } catch {
      image = null;
    }
    if (!image) {
      return { type: 'message', text: "I couldn't grab a screenshot — I may need screen recording permission." };
    }
    this.visionProvider.setMemoryContext(this.lastMemoryContext);
    return this.visionProvider.analyzeScreen(image, question);
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
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: safety.response, mood: 'worried', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: safety.response! };
    }

    // Emotional messages get empathy first, not routed through the tool classifier
    if (isEmotionalMessage(rawInput)) {
      this.emotionEngine?.onInteraction();
      this.emotionEngine?.onConversationMood('worried');
      const reply = getEmotionalResponse();
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: 'worried', latencyMs: 0, ts: Date.now() });
      if (this.memoryManager?.isReady()) {
        void this.memoryManager.processResponseBackground(rawInput, reply);
      }
      return { type: 'message', text: reply, quickReplies: getQuickReplies(null, 'worried') };
    }

    // "Are you real / are you AI?" probes stay in character (CLA-38) — answered
    // here so the persona never depends on the model to withhold internals.
    if (isIdentityProbe(rawInput)) {
      this.emotionEngine?.onInteraction();
      this.emotionEngine?.onConversationMood('happy');
      const reply = getIdentityResponse();
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: 'happy', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: reply, quickReplies: getQuickReplies(null, 'happy') };
    }

    // Retrieve memory context (sync, fast — uses pre-computed vector from previous turn)
    if (this.memoryManager?.isReady()) {
      const memCtx = await this.memoryManager.retrieve();
      this.lastMemoryContext = formatContextForPrompt(memCtx);
      this.toolModel.setMemoryContext(this.lastMemoryContext);
    }

    const start = Date.now();
    const toolCall = await this.toolModel.classify(rawInput, prepHistory(history));
    const latencyMs = Date.now() - start;

    this.emotionEngine?.onInteraction();
    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);

    // Check macOS permissions before executing tools that need them
    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const requiredPerm = getRequiredPermission(toolCall.tool, toolCall.args);
      if (requiredPerm && !checkPermission(requiredPerm)) {
        const msg = getDegradedMessage(requiredPerm);
        logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: toolCall.tool, response: msg, mood: toolCall.mood, latencyMs, ts: Date.now() });
        return { type: 'message', text: msg, quickReplies: ['Open Settings', 'Maybe later'] };
      }
    }

    if (toolCall.tool === 'take_screenshot' && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const screenResponse = await this.handleScreenshot(rawInput);
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: 'take_screenshot', response: screenResponse.text, mood: toolCall.mood, latencyMs, ts: Date.now() });
      return { ...screenResponse, quickReplies: getQuickReplies('take_screenshot', toolCall.mood) };
    }

    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const toolStart = Date.now();
      const result = await executeTool(toolCall.tool, toolCall.args);
      trackToolExecuted({ tool: toolCall.tool, success: result.handled, latencyMs: Date.now() - toolStart });
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: toolCall.tool, args: toolCall.args, response: result.response, mood: toolCall.mood, latencyMs, ts: Date.now() });

      const tc = { tool: toolCall.tool, args: toolCall.args, mood: toolCall.mood };

      if (result.petAction) {
        return {
          type: 'action',
          text: result.response || '',
          action: { type: result.petAction.type, payload: result.petAction },
          quickReplies: getQuickReplies(toolCall.tool, toolCall.mood),
          toolCall: tc,
        };
      }

      if (result.handled && result.response) {
        return { type: 'message', text: result.response, quickReplies: getQuickReplies(toolCall.tool, toolCall.mood), toolCall: tc };
      }
    }

    const reply = toolCall.response || getTemplateResponse(rawInput, toolCall.mood);
    logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: toolCall.mood, latencyMs, ts: Date.now() });

    // Background: process memory extraction from the response (non-blocking)
    if (this.memoryManager?.isReady()) {
      void this.memoryManager.processResponseBackground(rawInput, reply);
    }

    return { type: 'message', text: reply, quickReplies: getQuickReplies(null, toolCall.mood), toolCall: { tool: null, args: {}, mood: toolCall.mood } };
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
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: safety.response, mood: 'worried', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: safety.response! };
    }

    // Emotional messages get empathy first, not routed through the tool classifier
    if (isEmotionalMessage(rawInput)) {
      this.emotionEngine?.onInteraction();
      this.emotionEngine?.onConversationMood('worried');
      const reply = getEmotionalResponse();
      handlers.onDelta?.(reply, reply);
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: 'worried', latencyMs: 0, ts: Date.now() });
      if (this.memoryManager?.isReady()) {
        void this.memoryManager.processResponseBackground(rawInput, reply);
      }
      return { type: 'message', text: reply, quickReplies: getQuickReplies(null, 'worried') };
    }

    // "Are you real / are you AI?" probes stay in character (CLA-38).
    if (isIdentityProbe(rawInput)) {
      this.emotionEngine?.onInteraction();
      this.emotionEngine?.onConversationMood('happy');
      const reply = getIdentityResponse();
      handlers.onDelta?.(reply, reply);
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: 'happy', latencyMs: 0, ts: Date.now() });
      return { type: 'message', text: reply, quickReplies: getQuickReplies(null, 'happy') };
    }

    // Retrieve memory context (sync, fast)
    if (this.memoryManager?.isReady()) {
      const memCtx = await this.memoryManager.retrieve();
      this.lastMemoryContext = formatContextForPrompt(memCtx);
      this.toolModel.setMemoryContext(this.lastMemoryContext);
    }

    const start = Date.now();

    this.emotionEngine?.onInteraction();

    const toolCall = await this.toolModel.classify(rawInput, prepHistory(history));
    const latencyMs = Date.now() - start;

    if (toolCall.mood) this.emotionEngine?.onConversationMood(toolCall.mood);

    // Check macOS permissions before executing tools that need them
    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const requiredPerm = getRequiredPermission(toolCall.tool, toolCall.args);
      if (requiredPerm && !checkPermission(requiredPerm)) {
        const msg = getDegradedMessage(requiredPerm);
        handlers.onDelta?.(msg, msg);
        logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: toolCall.tool, response: msg, mood: toolCall.mood, latencyMs, ts: Date.now() });
        return { type: 'message', text: msg, quickReplies: ['Open Settings', 'Maybe later'] };
      }
    }

    if (toolCall.tool === 'take_screenshot' && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const screenResponse = await this.handleScreenshot(rawInput);
      const text = screenResponse.text || '';
      handlers.onDelta?.(text, text);
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: 'take_screenshot', response: text, mood: toolCall.mood, latencyMs, ts: Date.now() });
      return { ...screenResponse, quickReplies: getQuickReplies('take_screenshot', toolCall.mood) };
    }

    if (toolCall.tool && !isFalsePositiveTool(rawInput, toolCall.tool)) {
      const toolStart = Date.now();
      const result = await executeTool(toolCall.tool, toolCall.args);
      trackToolExecuted({ tool: toolCall.tool, success: result.handled, latencyMs: Date.now() - toolStart });
      logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: toolCall.tool, args: toolCall.args, response: result.response, mood: toolCall.mood, latencyMs, ts: Date.now() });

      const tc = { tool: toolCall.tool, args: toolCall.args, mood: toolCall.mood };

      if (result.petAction) {
        const text = result.response || '';
        handlers.onDelta?.(text, text);
        return {
          type: 'action',
          text,
          action: { type: result.petAction.type, payload: result.petAction },
          quickReplies: getQuickReplies(toolCall.tool, toolCall.mood),
          toolCall: tc,
        };
      }

      if (result.handled && result.response) {
        handlers.onDelta?.(result.response, result.response);
        return { type: 'message', text: result.response, quickReplies: getQuickReplies(toolCall.tool, toolCall.mood), toolCall: tc };
      }
    }

    const reply = toolCall.response || getTemplateResponse(rawInput, toolCall.mood);
    logInteraction({ input: rawInput, model: this.toolModel.getModelName(), tool: null, response: reply, mood: toolCall.mood, latencyMs, ts: Date.now() });
    handlers.onDelta?.(reply, reply);

    // Background: process memory extraction (non-blocking)
    if (this.memoryManager?.isReady()) {
      void this.memoryManager.processResponseBackground(rawInput, reply);
    }

    return { type: 'message', text: reply, quickReplies: getQuickReplies(null, toolCall.mood), toolCall: { tool: null, args: {}, mood: toolCall.mood } };
  }

  async analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse> {
    if (!this.visionProvider) {
      return { type: 'message', text: "Screen analysis needs the cloud connection turned on!" };
    }
    return this.visionProvider.analyzeScreen(imageDataUrl, question);
  }

  updateConfig(_baseUrl: string): void {}

  destroy(): void {
    this.toolModel.destroy();
  }
}
