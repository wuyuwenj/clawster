import { describe, it, expect, beforeAll } from 'vitest';
import { LocalToolProvider } from '../src/main/chat/local-tool-provider';

describe('LocalToolProvider E2E', () => {
  let local: LocalToolProvider;

  beforeAll(async () => {
    local = new LocalToolProvider();
    await new Promise(r => setTimeout(r, 2000));
  });

  it('detects Ollama availability', () => {
    if (!local.isAvailable()) {
      console.log('SKIP: Ollama not running or model not loaded');
      return;
    }
    expect(local.isAvailable()).toBe(true);
  });

  it('classifies "open spotify" as open_app', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('open spotify');
    expect(result.tool).toBe('open_app');
    expect(result.args).toHaveProperty('app');
  });

  it('classifies "wave at me" as wave', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('wave at me');
    expect(result.tool).toBe('wave');
  });

  it('classifies "go to sleep" as set_mood', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('go to sleep');
    expect(result.tool).toBe('set_mood');
    expect(result.args).toHaveProperty('value');
  });

  it('classifies "hello" as null (conversation, not tool)', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('hello how are you');
    expect(result.tool).toBeNull();
  });

  it('classifies "take a screenshot" as take_screenshot', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('take a screenshot');
    expect(result.tool).toBe('take_screenshot');
  });

  it('classifies "weather in tokyo" as get_weather', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('weather in tokyo');
    expect(result.tool).toBe('get_weather');
  });

  it('classifies "set a timer for 5 minutes" as set_timer', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('set a timer for 5 minutes');
    expect(['set_timer', 'create_timer']).toContain(result.tool);
  });

  it('classifies "come here" as a move action', async () => {
    if (!local.isAvailable()) return;
    const result = await local.classify('come here');
    expect(['move_to_cursor', 'move_to']).toContain(result.tool);
  });
});
