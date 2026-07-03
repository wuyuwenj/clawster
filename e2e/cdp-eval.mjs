#!/usr/bin/env node
import http from 'http';
import { WebSocket } from 'ws';

const CDP_PORT = 9222;

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) {
        ws.close();
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.text || JSON.stringify(msg.result.exceptionDetails)));
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
  });
}

const [,, pageFilter, ...exprParts] = process.argv;
const expr = exprParts.join(' ');

if (!pageFilter || !expr) {
  console.error('Usage: node cdp-eval.mjs <page-filter> <js-expression>');
  console.error('  page-filter: substring match on page URL (e.g. "pet", "onboarding", "assistant")');
  process.exit(1);
}

const targets = await getTargets();
const target = targets.find(t => t.url.includes(pageFilter));
if (!target) {
  console.error('No page matching:', pageFilter);
  console.error('Available:', targets.map(t => t.url.split('/').pop()).join(', '));
  process.exit(1);
}

const result = await evaluate(target.webSocketDebuggerUrl, expr);
if (result !== undefined) {
  console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
}
