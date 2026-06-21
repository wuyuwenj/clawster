import { PostHog } from 'posthog-node';
import { app } from 'electron';
import os from 'os';

let client: PostHog | null = null;
let distinctId: string = '';
let enabled: boolean = false;
const launchTime = Date.now();

export function initAnalytics(opts: {
  apiKey: string;
  deviceId: string;
  analyticsEnabled: boolean;
  modelName?: string;
}): void {
  enabled = opts.analyticsEnabled;
  distinctId = opts.deviceId;

  if (!enabled || !opts.apiKey) {
    console.log('[Analytics] Disabled — opt-out or no API key');
    return;
  }

  client = new PostHog(opts.apiKey, {
    host: 'https://us.i.posthog.com',
    flushAt: 10,
    flushInterval: 30000,
  });

  client.identify({
    distinctId,
    properties: {
      app_version: app.getVersion(),
      os_version: os.release(),
      platform: process.platform,
      arch: process.arch,
      model_name: opts.modelName || 'unknown',
    },
  });

  console.log('[Analytics] PostHog initialized');
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!enabled || !client) return;

  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        app_version: app.getVersion(),
      },
    });
  } catch { /* never crash for analytics */ }
}

export function trackChatSent(props: {
  tool: string | null;
  latencyMs: number;
  model: string;
  mood?: string;
}): void {
  trackEvent('chat_sent', {
    tool: props.tool,
    latency_ms: props.latencyMs,
    model: props.model,
    mood: props.mood,
  });
}

export function trackToolExecuted(props: {
  tool: string;
  success: boolean;
  latencyMs: number;
}): void {
  trackEvent('tool_executed', {
    tool: props.tool,
    success: props.success,
    latency_ms: props.latencyMs,
  });
}

export function trackSafetyBlocked(category: string): void {
  trackEvent('safety_blocked', { category });
}

export function trackPermissionRequested(props: {
  permission: string;
  granted: boolean;
}): void {
  trackEvent('permission_requested', {
    permission: props.permission,
    granted: props.granted,
  });
}

export function trackMemoryStored(props: {
  type: 'fact' | 'emotional';
  count: number;
}): void {
  trackEvent('memory_stored', {
    memory_type: props.type,
    count: props.count,
  });
}

export function trackPetInteraction(action: string): void {
  trackEvent('pet_interaction', { action });
}

export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
  if (!value && client) {
    client.shutdown().catch(() => {});
    client = null;
    console.log('[Analytics] Disabled by user');
  }
}

export async function shutdownAnalytics(): Promise<void> {
  if (!enabled || !client) return;

  trackEvent('session_duration', {
    duration_ms: Date.now() - launchTime,
    duration_minutes: Math.round((Date.now() - launchTime) / 60000),
  });

  try {
    await client.shutdown();
    console.log('[Analytics] Flushed and shut down');
  } catch { /* best effort */ }
}
