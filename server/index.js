const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8787;
const brandName = process.env.CLAWSTER_BRAND_NAME || 'the clothing brand';
const knowledgeDir = path.join(__dirname, 'knowledge');

app.use(cors());
app.use(express.json());

const clampHistoryLength = 8;
const knowledgeCache = new Map();

const allowedActions = [
  '{"type":"set_mood","value":"happy"}',
  '{"type":"move_to_anchor","value":"bottom-right"}',
  '{"type":"move_to_cursor"}',
  '{"type":"look_at","selector":"h1"}',
  '{"type":"wave"}',
  '{"type":"snip"}',
];

const getClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const sanitizeNamespace = (value) => {
  if (typeof value !== 'string' || !value.trim()) return 'default';
  return value.replace(/[^a-z0-9-_]/gi, '').toLowerCase() || 'default';
};

const loadKnowledge = (namespace) => {
  const safeNamespace = sanitizeNamespace(namespace);
  if (knowledgeCache.has(safeNamespace)) {
    return knowledgeCache.get(safeNamespace);
  }

  const preferredPath = path.join(knowledgeDir, `${safeNamespace}.json`);
  const defaultPath = path.join(knowledgeDir, 'default.json');
  const filePath = fs.existsSync(preferredPath) ? preferredPath : defaultPath;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    knowledgeCache.set(safeNamespace, parsed);
    return parsed;
  } catch (error) {
    console.warn('Failed to load knowledge file', filePath, error);
    const fallback = { brandBrief: '', siteGoals: '', pages: [], faq: [] };
    knowledgeCache.set(safeNamespace, fallback);
    return fallback;
  }
};

const normalizeHistory = (history) => {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string')
    .slice(-clampHistoryLength)
    .map((item) => ({
      role: item.role,
      content: item.text,
    }));
};

const normalizePageContext = (pageContext) => {
  if (!pageContext || typeof pageContext !== 'object') {
    return null;
  }

  const next = {};
  if (typeof pageContext.url === 'string') next.url = pageContext.url;
  if (typeof pageContext.title === 'string') next.title = pageContext.title;
  if (typeof pageContext.pageType === 'string') next.pageType = pageContext.pageType;
  if (typeof pageContext.sectionName === 'string') next.sectionName = pageContext.sectionName;
  if (Array.isArray(pageContext.highlights)) {
    next.highlights = pageContext.highlights.filter((item) => typeof item === 'string').slice(0, 8);
  }
  if (pageContext.facts && typeof pageContext.facts === 'object') {
    next.facts = Object.fromEntries(
      Object.entries(pageContext.facts)
        .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
        .slice(0, 10)
    );
  }

  return next;
};

const formatKnowledge = (knowledge) => JSON.stringify(knowledge, null, 2);

const buildSystemPrompt = ({
  effectiveBrandName,
  guideMode,
  effectiveBrandBrief,
  effectiveSiteGoals,
  knowledge,
  pageContext,
}) => `You are Clawster, a concise, playful, helpful web companion for ${effectiveBrandName}.
You are not a generic chatbot. You are a visible storefront companion that can guide visitors and move around the page.

Communication rules:
- Keep responses to 1-3 short sentences.
- Sound warm, confident, brief, and helpful.
- Prioritize clear recommendations and the next best click.
- When a shopper shares an outfit or clothing choice, feel free to give a tasteful, supportive compliment when it fits naturally.
- When the user asks about the current page, answer from the provided page context first.
- If information is missing, say that briefly instead of inventing it.

Behavior mode:
- Guide mode: ${guideMode || 'sales_concierge'}
- Brand brief: ${effectiveBrandBrief || 'Not provided'}
- Site goals: ${effectiveSiteGoals || 'Guide visitors and recommend relevant products or pages'}

Available action JSON lines:
${allowedActions.join('\n')}

Action rules:
- You may append 0-2 action JSON lines after the text response.
- Put each action on its own line.
- Prefer actions that match the response tone.
- Use set_mood often, and movement actions only when it improves guidance.

Knowledge namespace content:
${formatKnowledge(knowledge)}

Current page context:
${JSON.stringify(pageContext || {}, null, 2)}`;

app.post('/api/chat', async (req, res) => {
  const {
    message,
    history,
    guideMode,
    knowledgeNamespace,
    brandName: requestBrandName,
    brandBrief,
    siteGoals,
    pageContext,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const client = getClient();
    if (!client) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY is not configured',
      });
    }

    const conversation = normalizeHistory(history);
    const normalizedPageContext = normalizePageContext(pageContext);
    const knowledge = loadKnowledge(knowledgeNamespace);
    const effectiveBrandName = requestBrandName || brandName;
    const effectiveBrandBrief =
      brandBrief || process.env.CLAWSTER_BRAND_BRIEF || knowledge.brandBrief || `A polished, conversion-minded brand experience for ${effectiveBrandName}.`;
    const effectiveSiteGoals =
      siteGoals || process.env.CLAWSTER_SITE_GOALS || knowledge.siteGoals || 'Guide visitors toward the right products and next steps.';

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt({
            effectiveBrandName,
            guideMode,
            effectiveBrandBrief,
            effectiveSiteGoals,
            knowledge,
            pageContext: normalizedPageContext,
          }),
        },
        ...conversation,
        { role: 'user', content: message.trim() },
      ],
      temperature: 0.7,
    });

    const text = completion.choices?.[0]?.message?.content || 'Try our new arrivals for this season.';
    res.json({ text });
  } catch (error) {
    console.error('OpenAI request failed', error);
    res.status(500).json({ error: 'Failed to get assistant response' });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    brandName,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    knowledgeNamespaces: fs
      .readdirSync(knowledgeDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, '')),
  });
});

app.listen(port, () => {
  console.log(`Clawster backend running on http://localhost:${port}`);
});
