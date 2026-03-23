# Clawster Web Mascot

Clawster is now a **web-based AI sales mascot** for clothing brands.

This repository has been migrated from a local Electron/macOS app to a web architecture:
- **Frontend:** React + Vite widget with Shadow DOM encapsulation
- **Backend:** Express API route that calls OpenAI
- **Mascot logic:** mood/action parsing that maps AI actions to lobster animations

## What's included

- Animated lobster companion with movement-aware SVG behavior and cursor-following eyes
- Larger glass chat UI designed for embedded concierge experiences
- Action parser that supports mood, movement, look, wave, and snip commands
- Zustand global store for mood + chat state
- OpenAI-powered backend with page-aware concierge prompting and namespaced knowledge
- Widget entry bundle that can be injected with a single `<script>` tag

## Quick start

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Create a `.env` file in repo root:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
PORT=8787
CLAWSTER_BRAND_NAME=Northshore Apparel
VITE_BRAND_NAME=Northshore Apparel
CLAWSTER_BRAND_BRIEF=Performance-inspired coastal basics for everyday wear.
CLAWSTER_SITE_GOALS=Guide visitors to the right collection, product, and next step.
```

### 3) Run web + backend

```bash
npm run dev
```

- Web app: `http://localhost:5173`
- API: `http://localhost:8787`

## Local testing

1. Start both servers with `npm run dev`.
2. Open `http://localhost:5173`.
3. Confirm the lobster is large, visible, and docked near the bottom-right corner by default.
4. Send a chat prompt like `Build me a spring weekend outfit`.
5. Verify the response appears in the glass speech bubble and the mascot can move or emote when the backend includes action JSON lines.
6. Check backend health with `curl http://localhost:8787/health`.

## Build targets

```bash
npm run build
```

Outputs:
- `dist/web` → web app build
- `dist/widget/clawster-widget.js` → standalone widget bundle

## Widget usage

```html
<script
  src="/path/to/clawster-widget.js"
  data-api-base-url="https://your-domain.com"
  data-brand-name="Northshore Apparel"
  data-guide-mode="sales_concierge"
  data-knowledge-namespace="default"
  data-brand-brief="Performance-inspired coastal basics for everyday wear."
  data-site-goals="Guide visitors to the right collection and product."
  data-page-type="homepage"
  data-section-name="new arrivals"
  data-highlights="Bestsellers|Lightweight layers|Free shipping over $100"
></script>
```

The widget auto-mounts when the script loads. You can also mount manually or use a custom host element:

```js
window.ClawsterMascotWidget.mount({
  target: document.getElementById('my-slot'),
  apiBaseUrl: 'https://your-domain.com',
  brandName: 'Northshore Apparel',
  mode: 'overlay',
  guideMode: 'sales_concierge',
  knowledgeNamespace: 'default',
  brandBrief: 'Performance-inspired coastal basics for everyday wear.',
  siteGoals: 'Guide visitors to the right collection, product, and next step.',
  pageContextSelectors: {
    pageType: '[data-page-type]',
    sectionName: '[data-section-name]',
    highlights: '[data-clawster-highlight]',
  },
  pageContextProvider: () => ({
    pageType: window.__PAGE_TYPE__,
    sectionName: window.__CURRENT_SECTION__,
  }),
});
```

## Integrating into a test website

### Step 1: Put your real API key in `.env`

Open the repo root `.env` file and replace the placeholder value:

```bash
OPENAI_API_KEY=sk-your-real-key-here
OPENAI_MODEL=gpt-4.1-mini
PORT=8787
CLAWSTER_BRAND_NAME=Northshore Apparel
VITE_BRAND_NAME=Northshore Apparel
CLAWSTER_BRAND_BRIEF=Performance-inspired coastal basics for everyday wear.
CLAWSTER_SITE_GOALS=Guide visitors to the right collection, product, and next step.
```

If `OPENAI_API_KEY` is still a placeholder, the UI may load but the chat replies will fail.

### Step 2: Start the project locally

From the repo root run:

```bash
npm install
npm run dev
```

This starts:
- frontend dev site at `http://localhost:5173`
- backend API at `http://localhost:8787`

Check that the backend is alive:

```bash
curl http://localhost:8787/health
```

You should get JSON back with `ok: true`.

### Step 3: Build the embeddable widget

When you want to add Clawster to another website, build the widget bundle:

```bash
npm run build
```

This creates:
- `dist/widget/clawster-widget.js`

That file is the one you place on your website or hosting bucket/CDN.

### Step 4: Add site knowledge

Create a new file in:

```bash
server/knowledge/<your-namespace>.json
```

Example:

```bash
server/knowledge/northshore.json
```

Put stable, evergreen knowledge in that file, such as:
- product categories
- sizing guidance
- return/shipping policies
- brand voice
- FAQ-style help
- permanent collection summaries

Example:

```json
{
  "brandBrief": "Premium coastal-inspired fashion with a warm, stylist-like tone.",
  "siteGoals": "Help shoppers discover the right items, explain promotions, and guide them to the next step.",
  "pages": [
    {
      "title": "Dresses",
      "summary": "Lightweight dresses for day events, vacations, and dinners out."
    },
    {
      "title": "Linen Collection",
      "summary": "Breathable summer pieces with relaxed silhouettes."
    }
  ],
  "faq": [
    "If a visitor asks where to start, suggest the collection that best matches their occasion.",
    "If a visitor shares an outfit idea, respond supportively and confidently."
  ]
}
```

The namespace in the filename must match the `knowledgeNamespace` you pass to the widget later.

### Step 5: Decide what data is static vs live

Use this split:

- `server/knowledge/<namespace>.json`
  Use for stable knowledge that does not change often.
- `brandBrief` and `siteGoals`
  Use for tone and behavior instructions.
- `pageContextProvider`
  Use for live page data such as:
  - current page type
  - current section
  - visible product names
  - active promotions
  - shipping banners
  - featured items

This matters because promotions usually change often, so they should come from the website at runtime, not from a static JSON file.

### Step 6: Add Clawster to a plain HTML site

Copy `dist/widget/clawster-widget.js` into your website’s static assets folder.

Example:

```bash
public/clawster-widget.js
```

Then add this near the bottom of your HTML, before `</body>`:

```html
<script
  src="/clawster-widget.js"
  data-api-base-url="https://your-domain.com"
  data-brand-name="Northshore Apparel"
  data-guide-mode="sales_concierge"
  data-knowledge-namespace="northshore"
></script>
```

Important:
- `data-api-base-url` should point to the server running your `/api/chat` endpoint
- `data-knowledge-namespace` must match your JSON filename, for example `northshore`

### Step 7: Add Clawster to an existing React / Next.js / Shopify / app site

Load the built widget script on the page, then mount it manually.

Example:

```html
<script src="/clawster-widget.js"></script>
<script>
  window.ClawsterMascotWidget.mount({
    apiBaseUrl: 'https://your-domain.com',
    brandName: 'Northshore Apparel',
    guideMode: 'sales_concierge',
    knowledgeNamespace: 'northshore',
    brandBrief: 'Warm, stylish, confidence-boosting fashion guidance.',
    siteGoals: 'Help shoppers discover products and highlight the best next click.',
  });
</script>
```

Use this manual mount approach when your site already has JS state and you want more control.

### Step 8: Give Clawster live sight of the current website page

If your website already knows what page the visitor is on, pass that data in `pageContextProvider`.

Example:

```js
window.ClawsterMascotWidget.mount({
  apiBaseUrl: 'https://your-domain.com',
  brandName: 'Northshore Apparel',
  knowledgeNamespace: 'northshore',
  pageContextProvider: () => ({
    pageType: 'product',
    sectionName: 'summer dresses',
    highlights: [
      'Floral wrap dress',
      'Linen midi dress',
      'Buy 2 get 1 on accessories'
    ],
    facts: {
      promotion: '20% off dresses through Sunday',
      shipping: 'Free shipping over $75'
    }
  })
});
```

That is the best place to give the bot:
- current promotions
- visible products
- page banners
- category names
- live campaign info

### Step 9: Pull data directly from the website DOM if needed

If your website already renders the needed information in HTML, you can use `pageContextSelectors`.

Example:

```js
window.ClawsterMascotWidget.mount({
  apiBaseUrl: 'https://your-domain.com',
  brandName: 'Northshore Apparel',
  knowledgeNamespace: 'northshore',
  pageContextSelectors: {
    pageType: '[data-page-type]',
    sectionName: '[data-section-name]',
    highlights: '.product-card .product-title'
  }
});
```

This works well when:
- the page already contains the info visually
- you do not want to manually construct JS objects

### Step 10: Run the API on your real domain

Your website embed needs a working backend route for:

```bash
POST /api/chat
```

The simplest setup is to host this project’s backend on your server and expose it at something like:

```bash
https://your-domain.com/api/chat
```

If your backend is hosted elsewhere, set:

```html
data-api-base-url="https://api.your-domain.com"
```

### Step 11: Test the final setup

After embedding, test these one by one:

1. The mascot appears on the page.
2. The mascot can be dragged.
3. The mascot moves around by itself.
4. Typing into the textbox sends a message.
5. The reply reflects your brand voice.
6. The reply is aware of live promotions or current page data.
7. Changing `knowledgeNamespace` changes the store knowledge.

If something is wrong, check:
- the API key is real
- the backend is running
- the `knowledgeNamespace` matches the filename
- `data-api-base-url` points to the correct backend
- your page context function is actually returning values

## Giving the bot site knowledge

Use three layers together:

1. `knowledgeNamespace`
   Create `server/knowledge/<namespace>.json` with evergreen store knowledge like categories, FAQs, positioning, sizing notes, and product summaries.

2. `brandBrief` and `siteGoals`
   Pass these in the script tag or `mount(...)` call for brand voice and what Clawster should optimize for.

3. `pageContext`
   Pass the current page, section, highlights, and any live facts from the host site so answers stay relevant to what the visitor is seeing right now.

Example with promotions and live page info:

```js
window.ClawsterMascotWidget.mount({
  apiBaseUrl: 'https://your-domain.com',
  brandName: 'Northshore Apparel',
  knowledgeNamespace: 'northshore',
  brandBrief: 'Relaxed premium essentials with a warm, stylist-like tone.',
  siteGoals: 'Help visitors discover products, highlight promotions, and guide them to the right next click.',
  pageContextProvider: () => ({
    pageType: window.__PAGE_TYPE__,
    sectionName: window.__CURRENT_SECTION__,
    highlights: [
      'Spring dresses',
      'Top-rated linen sets',
      'Buy 2 get 1 on accessories'
    ],
    facts: {
      promotion: '20% off dresses through Sunday',
      freeShipping: 'Free shipping on orders over $75'
    }
  })
});
```

For ongoing promotions, the easiest path is to inject them through `pageContextProvider` from your existing site so Clawster always gets fresh promo data without redeploying the bot.

## Adding Clawster to an existing website

For a plain HTML site:

```html
<script
  src="/assets/clawster-widget.js"
  data-api-base-url="https://your-domain.com"
  data-brand-name="Northshore Apparel"
  data-knowledge-namespace="northshore"
  data-guide-mode="sales_concierge"
></script>
```

For an existing React, Next.js, Shopify, or other app:

1. Serve `dist/widget/clawster-widget.js`.
2. Include the script globally or on selected pages.
3. Call `window.ClawsterMascotWidget.mount(...)` after the page loads.
4. Feed current page data, promotions, featured products, or cart context through `pageContextProvider`.
5. Keep reusable knowledge in `server/knowledge/<namespace>.json`.

Recommended split:
- Put stable knowledge in the JSON file.
- Put live promotions and page-specific data in `pageContextProvider`.
- Put brand tone and sales goals in `brandBrief` and `siteGoals`.

Example knowledge file:

```json
{
  "brandBrief": "Premium travel-friendly essentials for modern commuters.",
  "siteGoals": "Recommend the right bag, answer feature questions, and guide users to the best next click.",
  "pages": [
    { "title": "Backpacks", "summary": "Highlight commute, travel, and tech-carry differences." }
  ],
  "faq": [
    "If a user asks where to start, suggest the category that best matches their use case."
  ]
}
```

## API

`POST /api/chat`

Request:
```json
{
  "message": "Suggest a spring outfit",
  "guideMode": "sales_concierge",
  "knowledgeNamespace": "default",
  "brandName": "Northshore Apparel",
  "brandBrief": "Performance-inspired coastal basics for everyday wear.",
  "siteGoals": "Guide visitors to the right collection, product, and next step.",
  "pageContext": {
    "url": "https://example.com/new-arrivals",
    "title": "New Arrivals",
    "pageType": "collection",
    "sectionName": "new arrivals",
    "highlights": ["Bestsellers", "Lightweight layers"]
  }
}
```

Response:
```json
{ "text": "Try our linen shirt with tapered chinos. {\"type\":\"set_mood\",\"value\":\"happy\"}" }
```

The frontend parses action JSON lines such as `set_mood`, `move_to_anchor`, `move_to_cursor`, `look_at`, `wave`, and `snip`.
