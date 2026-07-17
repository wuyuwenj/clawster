// Regenerates the README marketing screenshots in assets/screenshots/.
//
// Why this exists: the originals were hand-captured off a developer's desktop
// with no recipe, so they silently went stale when the Tidepool restyle landed
// (CLA-60). This script re-shoots them from the REAL Electron app, so the next
// restyle is one command away from correct marketing art.
//
//   npm run capture:screenshots          # writes assets/screenshots/*.png
//   OUT_DIR=/tmp/shots npm run capture:screenshots
//
// Needs the Vite dev server for THIS worktree. Pass VITE_DEV_PORT (and start
// `npx vite --port <p> --strictPort`) — do NOT rely on a bare :5173, which may
// belong to a different checkout and would silently shoot the wrong codebase.
//
// Two stages:
//   1. Capture the real windows (chatbar / pet-chat / pet) via Playwright's
//      Electron driver. Nothing is mocked or re-implemented — these are the
//      shipping React surfaces under the real Tidepool CSS.
//   2. Composite those captures onto a desktop stage in Chromium at DPR 2, so
//      the output matches the originals' Retina dimensions.
//
// Audio safety: launch flags mute output and hand Chromium a fake media device,
// and NODE_ENV=test no-ops the Animalese engine, so a capture run can never
// play sound or open the real microphone.

import { _electron as electron, chromium } from 'playwright';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AUDIO_SAFE_ARGS, findWindow } from '../e2e/electron-launch.mjs';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.OUT_DIR || path.join(PROJECT_ROOT, 'assets', 'screenshots');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-marketing-'));
const DEV_PORT = process.env.VITE_DEV_PORT || '5173';

// Retina dimensions of the committed originals, so the refreshed art drops into
// the same README table without reflowing it.
const QUICK_CHAT = { w: 796, h: 496 }; // ×2 => 1592×992
const CHAT_POPUP = { w: 363, h: 338 }; // ×2 =>  726×676

// The tip keeps the original chat-popup.png's subject and its default chip set,
// trimmed a little: Tidepool's rounder face sets the same sentence in more
// lines, and the original 726×676 frame was cropped around the older, shorter
// bubble. DEFAULT_QUICK_REPLIES is the real vocabulary from
// src/renderer/pet-chat/quick-replies.ts, so "Tell me more" takes the coral
// primary chip exactly as it does in the app.
const POPUP_TIP =
  'Chrome time! 🦞 Eating your RAM? Right-click a tab and hit "Close other tabs" — instant relief.';
const POPUP_REPLIES = ['Thanks!', 'Tell me more', 'Not now'];

// The quick-chat answer is new: the original answered a question about the
// iTerm2 window behind it, and that desktop isn't reproducible here.
// Sized to fill the response panel: the chatbar window opens at a fixed 650×300
// and the response area only grows to its content, so a two-line answer would
// leave a dead cream band under it.
const CHATBAR_QUESTION = 'how do I make my science poster pop?';
const CHATBAR_ANSWER = [
  'Ooh, poster night! 🦞 Three quick wins:',
  '',
  '1. **One big title** — readable from across the room',
  '2. **Pick two colors** and repeat them everywhere',
  '3. **Photos beat paragraphs** — show, don\'t tell',
  '',
  'Want a 20-minute timer so the glitter doesn\'t eat your whole night? I\'ll nudge you when it\'s up.',
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// macOS overlay scrollbars fade out when nobody is scrolling, so a real user
// never sees a track on a resting bubble — but an automated capture catches one
// mid-fade and freezes it into the art. Hiding them restores what the product
// actually looks like at rest; it does not restyle anything.
const hideScrollbars = (page) =>
  page.addStyleTag({ content: '::-webkit-scrollbar { width: 0 !important; height: 0 !important; }' });

// Crops fully-transparent margins so a capture can be positioned by its visible
// ink rather than by its window box. Partially-transparent pixels (the sticker
// shadow) are kept.
function trimTransparent(srcPath, dstPath) {
  const p = PNG.sync.read(fs.readFileSync(srcPath));
  let top = p.height, left = p.width, right = -1, bottom = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[((p.width * y + x) << 2) + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (right < 0) throw new Error(`${srcPath} is fully transparent`);
  const out = new PNG({ width: right - left + 1, height: bottom - top + 1 });
  PNG.bitblt(p, out, left, top, out.width, out.height, 0, 0);
  fs.writeFileSync(dstPath, PNG.sync.write(out));
  return { width: out.width, height: out.height };
}

const dataUrl = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;

async function captureWindows() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-marketing-data-'));
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      // The first-launch permissions hint fires ~5s in and would push its own
      // popup over the bubble being shot.
      permissionDeclines: { hintShown: true },
      // Tidepool is the opt-in Light theme; dark is the app default.
      appearance: { theme: 'light' },
      pet: { muted: true },
    }),
  );

  const app = await electron.launch({
    args: [PROJECT_ROOT, ...AUDIO_SAFE_ARGS],
    env: { ...process.env, NODE_ENV: 'test', CLAWSTER_DATA_DIR: dataDir, VITE_DEV_PORT: DEV_PORT },
  });

  try {
    const first = await app.firstWindow();
    await first.waitForLoadState('domcontentloaded');
    await first.waitForFunction(() => Boolean(window.clawster?.showPetChat));

    // ---- pet sprite (transparent window) ----
    // The idle mood runs infinite breathe/blink/bob/dart keyframes that never
    // settle, so `animations: 'disabled'` freezes them at their initial frame
    // (neutral pose, eyes open); the sleep just lets the sprite finish its first
    // paint. Together they make the trimmed bounding box deterministic run-to-run.
    const pet = await findWindow(app, 'pet.html');
    await sleep(1200);
    await pet.screenshot({ path: path.join(WORK_DIR, 'pet-raw.png'), omitBackground: true, animations: 'disabled' });

    // ---- pet-chat bubble ----
    await first.evaluate(({ text, quickReplies }) => {
      window.clawster.showPetChat({ id: 'marketing-popup', text, quickReplies });
    }, { text: POPUP_TIP, quickReplies: POPUP_REPLIES });
    const petChat = await findWindow(app, 'pet-chat');
    await petChat.getByText(POPUP_TIP).waitFor({ state: 'visible' });
    await petChat.evaluate(() => document.activeElement?.blur?.());
    await hideScrollbars(petChat);
    await sleep(700); // entrance springs top out at 450ms
    await petChat.screenshot({ path: path.join(WORK_DIR, 'petchat-raw.png'), omitBackground: true, animations: 'disabled' });

    // ---- chatbar with a rendered answer ----
    await first.evaluate(() => window.clawster.toggleChatbar());
    const chatbar = await findWindow(app, 'chatbar');
    const input = chatbar.locator('form input[type="text"]');
    await input.waitFor({ state: 'visible' });
    await input.fill(CHATBAR_QUESTION);

    // Render a real answer without a network round-trip: 'speech-error' is the
    // one main→renderer channel that sets the ChatBar's response state directly,
    // so the copy flows through the real MarkdownMessage + Tidepool response area.
    await app.evaluate(({ BrowserWindow }, answer) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('chatbar'));
      win?.webContents.send('speech-error', { type: 'error', message: answer });
    }, CHATBAR_ANSWER);

    await chatbar.locator('[data-tidepool="capsule"]').waitFor({ state: 'visible' });
    await chatbar.getByText('One big title').waitFor({ state: 'visible' });
    await chatbar.evaluate(() => document.activeElement?.blur?.());
    await hideScrollbars(chatbar);
    await sleep(700);

    // Guard against a silent regression to the dark theme: the capsule must be
    // shell cream. A dark-theme capture would be exactly the bug CLA-60 fixes.
    const capsuleBg = await chatbar
      .locator('[data-tidepool="capsule"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    if (capsuleBg !== 'rgb(255, 249, 242)') {
      throw new Error(`Expected the Tidepool cream capsule, got ${capsuleBg} — is the Light theme applied?`);
    }

    // The response panel caps at 200px and scrolls. Scrollbars are hidden for the
    // shot, so an over-long answer would be cut with nothing on screen to admit
    // it — catch that here instead of shipping a truncated sentence. Fail closed
    // if the panel selector ever stops matching (a restyle is exactly when this
    // script runs): -1 means "not found", which must error, not pass as 0px.
    const clipped = await chatbar.evaluate(() => {
      const el = document.querySelector('.overflow-y-auto');
      if (!el) return -1;
      return el.scrollHeight - el.clientHeight;
    });
    if (clipped < 0) {
      throw new Error('Response panel (.overflow-y-auto) not found — the ChatBar markup changed; update the selector.');
    }
    if (clipped > 2) {
      throw new Error(`CHATBAR_ANSWER overflows the response panel by ${clipped}px — shorten it.`);
    }

    // pet/bubble are composited as raw PNG pixels ÷ 2 while chatbarBox is CSS px,
    // so the two units only agree when the capture DPR is exactly 2. Assert it
    // rather than silently half-scaling the pet on a non-Retina display.
    const { chatbarBox, dpr } = await chatbar.evaluate(() => ({
      chatbarBox: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
    }));
    if (dpr !== 2) {
      throw new Error(`Captured at devicePixelRatio ${dpr}, but the composite assumes 2 — run on a Retina (2×) display.`);
    }
    await chatbar.screenshot({ path: path.join(WORK_DIR, 'chatbar-raw.png'), animations: 'disabled' });

    return { chatbarBox };
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function composite({ chatbarBox }) {
  const petPx = trimTransparent(path.join(WORK_DIR, 'pet-raw.png'), path.join(WORK_DIR, 'pet.png'));
  const bubblePx = trimTransparent(path.join(WORK_DIR, 'petchat-raw.png'), path.join(WORK_DIR, 'petchat.png'));

  // Everything is captured at DPR 2 and laid out at DPR 2, so placing each
  // surface at half its pixel size is 1:1 — the pet and the chatbar keep the
  // exact relative scale a user sees on a real screen. Nothing is enlarged to
  // flatter the pet.
  const pet = { width: petPx.width / 2, height: petPx.height / 2 };
  const bubble = { width: bubblePx.width / 2, height: bubblePx.height / 2 };
  console.log(`1:1 layout — chatbar ${chatbarBox.w}×${chatbarBox.h}, ` +
    `bubble ${bubble.width}×${bubble.height}, pet ${pet.width}×${pet.height}`);

  // Verify the chat-popup stack fits its frame BEFORE any PNG is written, so a
  // bubble that outgrows the original 726×676 crop fails the whole run instead of
  // leaving assets/screenshots/ half-updated (a fresh quick-chat.png beside a
  // stale chat-popup.png). Both inputs are already known here.
  const GAP = 14;
  const stackTop = Math.round((CHAT_POPUP.h - (bubble.height + GAP + pet.height)) / 2);
  if (stackTop < 0) {
    throw new Error(
      `Bubble (${bubble.height}px) + pet (${pet.height}px) exceed the ${CHAT_POPUP.h}px frame — shorten POPUP_TIP.`,
    );
  }

  const petUrl = dataUrl(path.join(WORK_DIR, 'pet.png'));
  const bubbleUrl = dataUrl(path.join(WORK_DIR, 'petchat.png'));
  const chatbarUrl = dataUrl(path.join(WORK_DIR, 'chatbar-raw.png'));

  const browser = await chromium.launch({ args: AUDIO_SAFE_ARGS });
  try {
    const page = await browser.newPage({
      viewport: { width: QUICK_CHAT.w, height: QUICK_CHAT.h },
      deviceScaleFactor: 2,
    });

    // --- quick-chat: the summon bar over a desktop ---
    // Set dressing only: a generic, unbranded document window and wallpaper, so
    // the shot reads as "Clawster floats over whatever you're doing" without
    // imitating anyone's product. Every Clawster pixel is a real window capture.
    await page.setContent(`
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: ${QUICK_CHAT.w}px; height: ${QUICK_CHAT.h}px; overflow: hidden;
               font-family: -apple-system, 'Helvetica Neue', sans-serif; }
        .desk { position: absolute; inset: 0;
                background:
                  radial-gradient(120% 90% at 12% 0%, #2f5d68 0%, transparent 55%),
                  radial-gradient(110% 90% at 92% 8%, #7a4a4f 0%, transparent 50%),
                  linear-gradient(160deg, #16323b 0%, #1d2a37 48%, #2a2330 100%); }
        .doc { position: absolute; left: 44px; top: 34px; width: 560px; height: 400px;
               background: #fffdf9; border-radius: 10px; overflow: hidden;
               box-shadow: 0 26px 60px rgba(0,0,0,.46), 0 2px 8px rgba(0,0,0,.3); }
        .bar { height: 34px; background: #f0ebe4; border-bottom: 1px solid #ddd5cb;
               display: flex; align-items: center; padding: 0 12px; gap: 7px; }
        .dot { width: 11px; height: 11px; border-radius: 50%; }
        .doc-title { flex: 1; text-align: center; font-size: 11px; color: #8d8378;
                     font-weight: 600; margin-right: 40px; }
        .page { padding: 22px 26px; }
        .page h1 { font-size: 17px; color: #2f2a26; margin-bottom: 14px; }
        .line { height: 8px; border-radius: 4px; background: #e8e2d9; margin-bottom: 11px; }
        .bullet { display: flex; align-items: center; gap: 9px; margin-bottom: 11px; }
        .bullet i { width: 7px; height: 7px; border-radius: 50%; background: #cfc6ba; flex: none; }
        .bullet .line { flex: 1; margin: 0; }
        /* The chatbar ships frameless + opaque with roundedCorners:true and a
           macOS shadow — mirror that here rather than inventing a floating panel. */
        .chatbar { position: absolute; left: ${Math.round((QUICK_CHAT.w - chatbarBox.w) / 2)}px; top: 126px;
                   width: ${chatbarBox.w}px; height: ${chatbarBox.h}px;
                   border-radius: 11px; overflow: hidden;
                   box-shadow: 0 30px 70px rgba(0,0,0,.5), 0 4px 14px rgba(0,0,0,.34); }
        .chatbar img { width: 100%; height: 100%; display: block; }
        /* The pet is alwaysOnTop in the app, so it legitimately stands in front
           of the chatbar's corner rather than being tucked behind it. */
        .pet { position: absolute; right: 30px; bottom: 10px;
               width: ${pet.width}px; height: ${pet.height}px; }
        .pet img { width: 100%; height: 100%; display: block; }
      </style>
      <div class="desk"></div>
      <div class="doc">
        <div class="bar">
          <span class="dot" style="background:#ff5f57"></span>
          <span class="dot" style="background:#febc2e"></span>
          <span class="dot" style="background:#28c840"></span>
          <span class="doc-title">Science Fair — notes</span>
        </div>
        <div class="page">
          <h1>Tide pools: why the water stays warm</h1>
          <div class="line" style="width:96%"></div>
          <div class="line" style="width:88%"></div>
          <div class="line" style="width:63%"></div>
          <div class="bullet"><i></i><div class="line" style="max-width:70%"></div></div>
          <div class="bullet"><i></i><div class="line" style="max-width:56%"></div></div>
          <div class="bullet"><i></i><div class="line" style="max-width:64%"></div></div>
          <div class="line" style="width:92%"></div>
          <div class="line" style="width:47%"></div>
        </div>
      </div>
      <div class="chatbar"><img src="${chatbarUrl}"></div>
      <div class="pet"><img src="${petUrl}"></div>
    `);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'quick-chat.png') });

    // --- chat-popup: the tip bubble + pet on white (matches the original) ---
    // Laid out 1:1 like the desktop shot: the bubble sits directly above the pet,
    // exactly as the app stacks them. The frame fit was validated above (before
    // any PNG was written), so this only positions the already-checked stack.
    await page.setViewportSize({ width: CHAT_POPUP.w, height: CHAT_POPUP.h });
    await page.setContent(`
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: ${CHAT_POPUP.w}px; height: ${CHAT_POPUP.h}px; overflow: hidden; background: #fff; }
        .bubble { position: absolute; left: 50%; transform: translateX(-50%); top: ${stackTop}px;
                  width: ${bubble.width}px; height: ${bubble.height}px; }
        .pet { position: absolute; left: 50%; transform: translateX(-50%);
               top: ${stackTop + bubble.height + GAP}px;
               width: ${pet.width}px; height: ${pet.height}px; }
        img { width: 100%; height: 100%; display: block; }
      </style>
      <div class="bubble"><img src="${bubbleUrl}"></div>
      <div class="pet"><img src="${petUrl}"></div>
    `);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())));
    await page.screenshot({ path: path.join(OUT_DIR, 'chat-popup.png') });
  } finally {
    await browser.close().catch(() => {});
  }
}

const meta = await captureWindows();
await composite(meta);
console.log(`Wrote quick-chat.png + chat-popup.png to ${OUT_DIR}`);
console.log(`Intermediate window captures: ${WORK_DIR}`);
