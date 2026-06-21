import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockShutdown = vi.fn(async () => {});

vi.mock('posthog-node', () => ({
  PostHog: function() {
    this.capture = mockCapture;
    this.identify = mockIdentify;
    this.shutdown = mockShutdown;
  },
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.6' },
}));

import {
  initAnalytics,
  trackEvent,
  trackChatSent,
  trackToolExecuted,
  trackSafetyBlocked,
  trackPermissionRequested,
  trackMemoryStored,
  trackPetInteraction,
  setAnalyticsEnabled,
  shutdownAnalytics,
} from '../src/main/analytics';

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not send events when disabled', () => {
    initAnalytics({ apiKey: 'test', deviceId: 'dev1', analyticsEnabled: false });
    trackEvent('test_event');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does not send events when no API key', () => {
    initAnalytics({ apiKey: '', deviceId: 'dev1', analyticsEnabled: true });
    trackEvent('test_event');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('sends events when enabled with API key', () => {
    initAnalytics({ apiKey: 'phc_test123', deviceId: 'dev1', analyticsEnabled: true });
    trackEvent('test_event', { foo: 'bar' });
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'test_event',
      properties: expect.objectContaining({ foo: 'bar', app_version: '0.1.6' }),
    });
  });

  it('identifies user with device properties', () => {
    initAnalytics({ apiKey: 'phc_test123', deviceId: 'dev1', analyticsEnabled: true, modelName: 'v8' });
    expect(mockIdentify).toHaveBeenCalledWith({
      distinctId: 'dev1',
      properties: expect.objectContaining({
        app_version: '0.1.6',
        model_name: 'v8',
      }),
    });
  });

  it('trackChatSent sends correct properties', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackChatSent({ tool: 'get_weather', latencyMs: 250, model: 'v8', mood: 'happy' });
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'chat_sent',
      properties: expect.objectContaining({
        tool: 'get_weather',
        latency_ms: 250,
        model: 'v8',
        mood: 'happy',
      }),
    });
  });

  it('trackToolExecuted sends success/failure', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackToolExecuted({ tool: 'open_app', success: true, latencyMs: 100 });
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'tool_executed',
      properties: expect.objectContaining({
        tool: 'open_app',
        success: true,
        latency_ms: 100,
      }),
    });
  });

  it('trackSafetyBlocked sends category', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackSafetyBlocked('harmful');
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'safety_blocked',
      properties: expect.objectContaining({ category: 'harmful' }),
    });
  });

  it('trackPermissionRequested sends type and outcome', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackPermissionRequested({ permission: 'accessibility', granted: false });
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'permission_requested',
      properties: expect.objectContaining({
        permission: 'accessibility',
        granted: false,
      }),
    });
  });

  it('trackMemoryStored sends type and count', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackMemoryStored({ type: 'fact', count: 3 });
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'memory_stored',
      properties: expect.objectContaining({
        memory_type: 'fact',
        count: 3,
      }),
    });
  });

  it('trackPetInteraction sends action', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackPetInteraction('click');
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'dev1',
      event: 'pet_interaction',
      properties: expect.objectContaining({ action: 'click' }),
    });
  });

  it('setAnalyticsEnabled(false) stops sending events', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackEvent('before');
    expect(mockCapture).toHaveBeenCalledTimes(1);

    setAnalyticsEnabled(false);
    trackEvent('after');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('shutdownAnalytics sends session_duration and flushes', async () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    await shutdownAnalytics();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'session_duration',
        properties: expect.objectContaining({
          duration_ms: expect.any(Number),
          duration_minutes: expect.any(Number),
        }),
      })
    );
    expect(mockShutdown).toHaveBeenCalled();
  });

  it('never sends PII — no input or response content', () => {
    initAnalytics({ apiKey: 'phc_test', deviceId: 'dev1', analyticsEnabled: true });
    trackChatSent({ tool: 'wave', latencyMs: 100, model: 'v8' });
    const props = mockCapture.mock.calls[0][0].properties;
    expect(props).not.toHaveProperty('input');
    expect(props).not.toHaveProperty('response');
    expect(props).not.toHaveProperty('message');
    expect(props).not.toHaveProperty('content');
  });
});
