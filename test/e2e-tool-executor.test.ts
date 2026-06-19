import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

import { executeTool } from '../src/main/chat/tool-executor';

describe('Tool executor E2E', () => {
  it('get_weather returns real weather data', async () => {
    const result = await executeTool('get_weather', { location: 'London' });
    expect(result.handled).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response).not.toContain('coming soon');
    expect(result.response!.toLowerCase()).toContain('london');
  }, 10000);

  it('get_weather works without location', async () => {
    const result = await executeTool('get_weather', {});
    expect(result.handled).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response).not.toContain('coming soon');
  }, 10000);

  it('set_timer returns confirmation', async () => {
    const result = await executeTool('set_timer', { duration: '5 minutes' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('5 minutes');
  });

  it('set_timer with label includes label', async () => {
    const result = await executeTool('set_timer', { duration: '25 minutes', label: 'pomodoro' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('pomodoro');
  });

  it('create_reminder returns confirmation', async () => {
    const result = await executeTool('create_reminder', { text: 'buy milk', time: 'in 30 minutes' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('buy milk');
  });

  it('create_reminder with no text asks for input', async () => {
    const result = await executeTool('create_reminder', { text: '', time: '5pm' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('What should I remind');
  });

  it('search_files finds files on the system', async () => {
    const result = await executeTool('search_files', { query: 'package.json', directory: '~/Desktop' });
    expect(result.handled).toBe(true);
    expect(result.response).toBeDefined();
  }, 10000);

  it('search_files with vague query redirects to list_files', async () => {
    const result = await executeTool('search_files', { query: 'files', directory: '~/Desktop' });
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/Files in|empty/);
  });

  it('list_files lists desktop contents', async () => {
    const result = await executeTool('list_files', { directory: '~/Desktop' });
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/Files in|empty/);
  });

  it('send_notification returns confirmation', async () => {
    const result = await executeTool('send_notification', { title: 'Test', body: 'hello world' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Notification sent');
  });

  it('open_url opens external URL', async () => {
    const result = await executeTool('open_url', { url: 'https://example.com' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Opening');
  });

  it('pet actions return text responses', async () => {
    const result = await executeTool('wave', {});
    expect(result.handled).toBe(true);
    expect(result.petAction).toEqual({ type: 'wave' });
    expect(result.response).toBe('*waves claws*');
  });

  it('set_mood returns pet action', async () => {
    const result = await executeTool('set_mood', { value: 'happy' });
    expect(result.handled).toBe(true);
    expect(result.petAction).toEqual({ type: 'set_mood', value: 'happy' });
    expect(result.response).toBe('On it!');
  });

  it('unknown tool returns unhandled', async () => {
    const result = await executeTool('nonexistent_tool', {});
    expect(result.handled).toBe(false);
  });
});
