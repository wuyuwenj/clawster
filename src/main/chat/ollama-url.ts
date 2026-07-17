export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

// CLA-62: dev convenience for pointing the app at a remote/self-hosted Ollama
// (Mac Mini over LAN or a Cloudflare Tunnel). Env var only — deliberately no
// electron-store setting and no Settings UI.
export function resolveOllamaUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAWSTER_OLLAMA_URL || DEFAULT_OLLAMA_URL;
}

// Base URL for the tool-classifier model. Dev always talks to Ollama; prod
// prefers Fireworks when FIREWORKS_BASE_URL is set, falling back to Ollama.
export function resolveToolBaseUrl(isDev: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const ollamaUrl = resolveOllamaUrl(env);
  return isDev ? ollamaUrl : (env.FIREWORKS_BASE_URL || ollamaUrl);
}
