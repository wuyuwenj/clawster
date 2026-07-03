import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock electron before importing the module under test (vi.mock hoists).
// Never use vi.doMock here — Vitest bug #4166 leaves exports undefined.
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

import { shell } from 'electron';
import { executeTool } from '../src/main/chat/tool-executor';

const openExternal = shell.openExternal as unknown as ReturnType<typeof vi.fn>;

// CLA-35: open_url must only launch http(s) pages. file:/javascript:/data:/ftp:
// and other schemes are a security hole via shell.openExternal.
describe('open_url scheme safety (CLA-35)', () => {
  beforeEach(() => openExternal.mockClear());

  const allowed = [
    'https://github.com/user/repo/pull/42',
    'http://localhost:3000',
    'example.com',
    'github.com/user/repo',
    'example.com:8080/path',
    'HTTPS://GitHub.com',
  ];
  for (const input of allowed) {
    it(`opens safe web URL: ${input}`, async () => {
      const r = await executeTool('open_url', { url: input });
      expect(openExternal).toHaveBeenCalledTimes(1);
      const opened = openExternal.mock.calls[0][0] as string;
      expect(opened).toMatch(/^https?:\/\//i);
      expect(r.handled).toBe(true);
      expect(r.response).toMatch(/Opening/i);
    });
  }

  const blocked = [
    'file:///etc/passwd',
    'file://localhost/etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://files.example.com',
    'httpx://evil.example.com',
    'vbscript:msgbox(1)',
    'mailto:foo@bar.com',
    'about:blank',
  ];
  for (const input of blocked) {
    it(`refuses unsafe URL: ${input}`, async () => {
      const r = await executeTool('open_url', { url: input });
      expect(openExternal).not.toHaveBeenCalled();
      expect(r.handled).toBe(true);
      expect(r.response).toMatch(/only open web links|not safe/i);
    });
  }

  it('asks for a URL when the arg is empty', async () => {
    const r = await executeTool('open_url', { url: '' });
    expect(openExternal).not.toHaveBeenCalled();
    expect(r.response).toMatch(/What URL/i);
  });
});
