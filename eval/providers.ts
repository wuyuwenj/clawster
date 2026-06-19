// Provider adapters for evaluating different model backends.
// Each provider takes a user input and returns a parsed tool call + latency.

import { toOpenAITools, toToolPrompt, TOOL_NAMES } from './tools';

export interface ToolCall {
  tool: string | null;
  args: Record<string, any>;
}

export interface ProviderResult {
  toolCall: ToolCall;
  latencyMs: number;
  raw?: string;
}

export type Provider = (input: string) => Promise<ProviderResult>;

// --- OpenAI provider (works for GPT-4o, GPT-4o-mini, fine-tuned models) ---
// OpenAI auto-caches identical prefixes (system + tools) for prompts >1024 tokens.
// We serialize requests to maximize cache hits (parallel requests may miss the cache).
export function createOpenAIProvider(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Provider {
  const { apiKey, model, baseUrl = 'https://api.openai.com/v1' } = options;
  const tools = toOpenAITools();
  const systemMessage = {
    role: 'system',
    content:
      'You are a desktop pet assistant called Clawster. Use the provided tools to fulfill user requests. If the request is conversational and does not require an action, respond normally without calling any tool.',
  };

  let cachedTokens = 0;
  let totalInputTokens = 0;

  return async (input: string): Promise<ProviderResult> => {
    const start = performance.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [systemMessage, { role: 'user', content: input }],
        tools,
        tool_choice: 'auto',
        temperature: 0,
      }),
    });

    const latencyMs = Math.round(performance.now() - start);
    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${JSON.stringify(data)}`);
    }

    // Track cache hits from usage stats
    const usage = data.usage;
    if (usage) {
      totalInputTokens += usage.prompt_tokens || 0;
      cachedTokens += usage.prompt_tokens_details?.cached_tokens || 0;
      if (cachedTokens > 0) {
        const pct = ((cachedTokens / totalInputTokens) * 100).toFixed(0);
        process.stdout.write(` [cache: ${pct}%]`);
      }
    }

    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0];
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {}
      return { toolCall: { tool: tc.function.name, args }, latencyMs, raw: JSON.stringify(toolCalls) };
    }

    return { toolCall: { tool: null, args: {} }, latencyMs, raw: choice?.message?.content };
  };
}

// --- Anthropic provider (Claude models with native tool use) ---
// Uses explicit cache_control on system prompt and tools (Anthropic's prompt caching).
// Cached input tokens are billed at 10% of the normal rate.
export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
}): Provider {
  const { apiKey, model } = options;

  const rawTools = toOpenAITools().map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
  // Mark the last tool with cache_control so the entire tools array is cached
  const tools = rawTools.map((t, i) =>
    i === rawTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
  );

  const systemMessage = [
    {
      type: 'text',
      text: 'You are a desktop pet assistant called Clawster. Use the provided tools to fulfill user requests. If the request is conversational and does not require an action, respond normally without calling any tool.',
      cache_control: { type: 'ephemeral' },
    },
  ];

  let cachedInputTokens = 0;
  let totalInputTokens = 0;

  return async (input: string): Promise<ProviderResult> => {
    const start = performance.now();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system: systemMessage,
        messages: [{ role: 'user', content: input }],
        tools,
        tool_choice: { type: 'auto' },
        temperature: 0,
      }),
    });

    const latencyMs = Math.round(performance.now() - start);
    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${JSON.stringify(data)}`);
    }

    // Track cache hits
    const usage = data.usage;
    if (usage) {
      totalInputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      cachedInputTokens += usage.cache_read_input_tokens || 0;
      if (cachedInputTokens > 0) {
        const pct = ((cachedInputTokens / totalInputTokens) * 100).toFixed(0);
        process.stdout.write(` [cache: ${pct}%]`);
      }
    }

    const toolUse = data.content?.find((c: any) => c.type === 'tool_use');
    if (toolUse) {
      return { toolCall: { tool: toolUse.name, args: toolUse.input || {} }, latencyMs, raw: JSON.stringify(toolUse) };
    }

    const text = data.content?.find((c: any) => c.type === 'text')?.text || '';
    return { toolCall: { tool: null, args: {} }, latencyMs, raw: text };
  };
}

// --- Local model provider (for llama.cpp, Ollama, or any OpenAI-compatible local server) ---
// Uses text-based tool calling (JSON output) since small models may not support native tool calling.
export function createLocalProvider(options: {
  baseUrl: string;
  model?: string;
}): Provider {
  const { baseUrl, model = 'default' } = options;
  const systemPrompt = toToolPrompt();

  return async (input: string): Promise<ProviderResult> => {
    const start = performance.now();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0,
        max_tokens: 128,
      }),
    });

    const latencyMs = Math.round(performance.now() - start);
    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new Error(`Local model error ${response.status}: ${JSON.stringify(data)}`);
    }

    const raw = data.choices?.[0]?.message?.content || '';
    const toolCall = parseToolCallFromText(raw);

    return { toolCall, latencyMs, raw };
  };
}

// --- Ollama provider (native Ollama API) ---
// Uses keep_alive to hold the model in memory across requests, preserving KV cache
// for the shared system prompt prefix. This avoids reloading the model between calls.
export function createOllamaProvider(options: {
  model: string;
  baseUrl?: string;
}): Provider {
  const { model, baseUrl = 'http://localhost:11434' } = options;
  const systemPrompt = toToolPrompt();

  return async (input: string): Promise<ProviderResult> => {
    const start = performance.now();

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0 },
      }),
    });

    const latencyMs = Math.round(performance.now() - start);
    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${JSON.stringify(data)}`);
    }

    const raw = data.message?.content || '';
    const toolCall = parseToolCallFromText(raw);

    return { toolCall, latencyMs, raw };
  };
}

// Parse a tool call from free-form text output (for local models)
function parseToolCallFromText(text: string): ToolCall {
  const cleaned = text.trim();

  // Try to extract JSON from the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { tool: null, args: {} };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Handle {"tool": "name", "args": {...}} format
    if ('tool' in parsed) {
      const toolName = parsed.tool;
      if (toolName === null || toolName === 'null' || toolName === 'none') {
        return { tool: null, args: {} };
      }
      if (TOOL_NAMES.includes(toolName)) {
        return { tool: toolName, args: parsed.args || {} };
      }
    }

    // Handle {"name": "tool_name", "arguments": {...}} format
    if ('name' in parsed && TOOL_NAMES.includes(parsed.name)) {
      return { tool: parsed.name, args: parsed.arguments || parsed.args || {} };
    }

    // Handle {"function": "tool_name", ...} format
    if ('function' in parsed && TOOL_NAMES.includes(parsed.function)) {
      return { tool: parsed.function, args: parsed.arguments || parsed.args || {} };
    }

    return { tool: null, args: {} };
  } catch {
    return { tool: null, args: {} };
  }
}
