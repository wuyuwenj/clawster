#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const sourceDir = path.join(repoRoot, 'openclaw', 'channel-plugin', 'clawster');
const targetDir = path.join(os.homedir(), '.openclaw', 'extensions', 'clawster');
const openclawConfigPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const defaultEndpoint = 'http://127.0.0.1:18790/api/channel/message';

if (!fs.existsSync(sourceDir)) {
  console.error(`Plugin source directory not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

let gatewayToken = '';
try {
  if (fs.existsSync(openclawConfigPath)) {
    const parsed = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
    gatewayToken = parsed?.gateway?.auth?.token || '';
  }
} catch {
  // Keep output useful even if the config file cannot be parsed.
}

const suggestedAuthToken = gatewayToken || '<YOUR_GATEWAY_TOKEN>';

console.log('');
console.log('Installed Clawster channel plugin:');
console.log(`  ${targetDir}`);
console.log('');
console.log('Add/update this in ~/.openclaw/openclaw.json:');
console.log('');
console.log(JSON.stringify({
  channels: {
    clawster: {
      endpointUrl: defaultEndpoint,
      authToken: suggestedAuthToken,
      accounts: {
        default: {
          enabled: true,
        },
      },
    },
  },
}, null, 2));
console.log('');
console.log('Then restart OpenClaw gateway:');
console.log('  openclaw gateway restart');
console.log('');
