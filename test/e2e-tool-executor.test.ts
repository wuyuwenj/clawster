import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

import { executeTool, setConfirmCallback } from '../src/main/chat/tool-executor';

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

describe('run_shell confirmation gate', () => {
  afterEach(() => setConfirmCallback(null));

  it('does NOT execute when no confirmation callback is registered', async () => {
    setConfirmCallback(null);
    const result = await executeTool('run_shell', { command: 'echo should-not-run' });
    expect(result.handled).toBe(true);
    expect(result.confirmation).toEqual({ kind: 'run_shell', detail: 'echo should-not-run', executed: false });
  });

  it('does NOT execute when the user declines', async () => {
    let asked = '';
    setConfirmCallback(async (req) => { asked = req.detail; return false; });
    const result = await executeTool('run_shell', { command: 'echo nope' });
    expect(asked).toBe('echo nope');
    expect(result.confirmation?.executed).toBe(false);
    expect(result.response).toMatch(/skipping|won't|claws back/i);
  });

  it('executes and returns output when the user approves', async () => {
    setConfirmCallback(async () => true);
    const result = await executeTool('run_shell', { command: 'echo hello-from-shell' });
    expect(result.confirmation?.executed).toBe(true);
    expect(result.response).toContain('hello-from-shell');
  });

  it('refuses catastrophic commands even with approval', async () => {
    const approve = vi.fn(async () => true);
    setConfirmCallback(approve);
    const result = await executeTool('run_shell', { command: 'rm -rf /' });
    expect(approve).not.toHaveBeenCalled(); // never even asked
    expect(result.confirmation?.executed).toBe(false);
    expect(result.response).toMatch(/dangerous|won't/i);
  });

  it('refuses a fork bomb', async () => {
    setConfirmCallback(async () => true);
    const result = await executeTool('run_shell', { command: ':(){ :|:& };:' });
    expect(result.confirmation?.executed).toBe(false);
  });

  it('asks what to run when command is empty', async () => {
    setConfirmCallback(async () => true);
    const result = await executeTool('run_shell', { command: '' });
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/what command/i);
  });
});

// Never test the approve->send path: that would send a real iMessage. Only the
// safety gate (no send without explicit approval) is exercised here.
describe('send_message confirmation gate', () => {
  afterEach(() => setConfirmCallback(null));

  it('does NOT send when no confirmation callback is registered', async () => {
    setConfirmCallback(null);
    const result = await executeTool('send_message', { recipient: 'Mom', message: 'hi' });
    expect(result.handled).toBe(true);
    expect(result.confirmation).toEqual({ kind: 'send_message', detail: 'To Mom:\nhi', executed: false });
  });

  it('does NOT send when the user declines', async () => {
    let asked = '';
    setConfirmCallback(async (req) => { asked = req.detail; return false; });
    const result = await executeTool('send_message', { recipient: 'Mom', message: 'hi there' });
    expect(asked).toBe('To Mom:\nhi there');
    expect(result.confirmation?.executed).toBe(false);
    expect(result.response).toMatch(/won't send|holds the message/i);
  });

  it('shows recipient + body in the confirmation preview', async () => {
    const seen: string[] = [];
    setConfirmCallback(async (req) => { seen.push(req.title, req.detail); return false; });
    await executeTool('send_message', { recipient: 'Alex', message: 'see you at 5' });
    expect(seen[0]).toMatch(/send/i);
    expect(seen[1]).toContain('Alex');
    expect(seen[1]).toContain('see you at 5');
  });

  it('asks who to message when recipient is missing', async () => {
    setConfirmCallback(async () => true);
    const result = await executeTool('send_message', { message: 'hello' });
    expect(result.response).toMatch(/who/i);
    expect(result.confirmation).toBeUndefined();
  });

  it('asks what to say when message body is missing', async () => {
    setConfirmCallback(async () => true);
    const result = await executeTool('send_message', { recipient: 'Mom' });
    expect(result.response).toMatch(/what should I say/i);
  });
});

// Only exercise read-only / no-op paths here — volume/brightness/lock have real
// OS side effects and must never run in the test suite.
describe('system_control (safe paths only)', () => {
  it('battery returns a status string', async () => {
    const result = await executeTool('system_control', { action: 'battery' });
    expect(result.handled).toBe(true);
    expect(typeof result.response).toBe('string');
    expect(result.response).toMatch(/battery|couldn't/i);
  }, 6000);

  it('unknown action returns help without running anything', async () => {
    const result = await executeTool('system_control', { action: 'florp_the_widget' });
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/volume|brightness|battery/i);
  });

  it('normalizes action casing (uppercase "BATTERY" → battery path)', async () => {
    // Exercises the toLowerCase normalization on a read-only action.
    const result = await executeTool('system_control', { action: 'BATTERY' });
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/battery|couldn't/i);
  }, 6000);
});
