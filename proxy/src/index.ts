interface Env {
  RATE_LIMITS: KVNamespace;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  APP_SECRET: string;
  DAILY_MESSAGE_LIMIT: string;
  MONTHLY_BUDGET_LIMIT: string;
}

const CLOCK_SKEW_TOLERANCE_SECONDS = 300;

async function verifyHmac(request: Request, body: string, env: Env): Promise<{ valid: boolean; deviceId: string; error?: string }> {
  const timestamp = request.headers.get('X-Clawster-Timestamp');
  const deviceId = request.headers.get('X-Clawster-Device');
  const signature = request.headers.get('X-Clawster-Signature');

  if (!timestamp || !deviceId || !signature) {
    return { valid: false, deviceId: '', error: 'Missing auth headers' };
  }

  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { valid: false, deviceId, error: 'Request timestamp too old or too far in the future' };
  }

  const payload = `${timestamp}.${deviceId}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== signature) {
    return { valid: false, deviceId, error: 'Invalid signature' };
  }

  return { valid: true, deviceId };
}

function todayKey(deviceId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `daily:${deviceId}:${date}`;
}

function monthKey(): string {
  const month = new Date().toISOString().slice(0, 7);
  return `global:${month}`;
}

async function checkRateLimit(deviceId: string, env: Env): Promise<{ allowed: boolean; error?: string }> {
  const disabled = await env.RATE_LIMITS.get('global:disabled');
  if (disabled === 'true') {
    return { allowed: false, error: 'Service temporarily unavailable' };
  }

  const dailyLimit = parseInt(env.DAILY_MESSAGE_LIMIT || '50', 10);
  const monthlyLimit = parseInt(env.MONTHLY_BUDGET_LIMIT || '10000', 10);

  const dk = todayKey(deviceId);
  const dailyCount = parseInt(await env.RATE_LIMITS.get(dk) || '0', 10);
  if (dailyCount >= dailyLimit) {
    return { allowed: false, error: 'daily_limit' };
  }

  const mk = monthKey();
  const monthlyCount = parseInt(await env.RATE_LIMITS.get(mk) || '0', 10);
  if (monthlyCount >= monthlyLimit) {
    return { allowed: false, error: 'Service temporarily unavailable' };
  }

  return { allowed: true };
}

async function incrementCounters(deviceId: string, env: Env): Promise<void> {
  const dk = todayKey(deviceId);
  const dailyCount = parseInt(await env.RATE_LIMITS.get(dk) || '0', 10);
  await env.RATE_LIMITS.put(dk, String(dailyCount + 1), { expirationTtl: 86400 });

  const mk = monthKey();
  const monthlyCount = parseInt(await env.RATE_LIMITS.get(mk) || '0', 10);
  await env.RATE_LIMITS.put(mk, String(monthlyCount + 1), { expirationTtl: 2678400 });
}

async function moderateContent(text: string, apiKey: string): Promise<{ flagged: boolean; categories?: string[] }> {
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!response.ok) return { flagged: false };

    const data = await response.json() as {
      results: Array<{ flagged: boolean; categories: Record<string, boolean> }>;
    };
    const result = data.results[0];
    if (!result?.flagged) return { flagged: false };

    const flaggedCategories = Object.entries(result.categories)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return { flagged: true, categories: flaggedCategories };
  } catch {
    return { flagged: false };
  }
}

function extractUserText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const obj = body as { messages?: Array<{ role?: string; content?: unknown }> };
  if (!Array.isArray(obj.messages)) return '';

  return obj.messages
    .filter(m => m.role === 'user')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: { type?: string }) => p.type === 'text')
          .map((p: { text?: string }) => p.text || '')
          .join(' ');
      }
      return '';
    })
    .join(' ');
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Clawster-Timestamp, X-Clawster-Device, X-Clawster-Signature',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (url.pathname !== '/v1/chat/completions') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const body = await request.text();

    const auth = await verifyHmac(request, body, env);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const rateCheck = await checkRateLimit(auth.deviceId, env);
    if (!rateCheck.allowed) {
      const status = rateCheck.error === 'daily_limit' ? 429 : 503;
      return new Response(JSON.stringify({ error: rateCheck.error }), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const userText = extractUserText(parsed);
    if (userText) {
      const moderation = await moderateContent(userText, env.OPENAI_API_KEY);
      if (moderation.flagged) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: "I'd rather talk about something else! What's on your mind?",
            },
            finish_reason: 'stop',
          }],
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    const requestBody = parsed as { model?: string; stream?: boolean };
    const openaiBody = { ...requestBody, model: env.OPENAI_MODEL || 'gpt-4o-mini' };

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error(`OpenAI error (${openaiResponse.status}):`, errorText.slice(0, 200));
      const status = openaiResponse.status === 429 ? 429 : 502;
      return new Response(JSON.stringify({ error: 'AI service temporarily unavailable' }), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    await incrementCounters(auth.deviceId, env);

    if (requestBody.stream) {
      return new Response(openaiResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders(),
        },
      });
    }

    const responseData = await openaiResponse.text();
    return new Response(responseData, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
} satisfies ExportedHandler<Env>;
