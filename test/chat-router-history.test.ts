import { describe, it, expect } from 'vitest';
import { ChatRouter } from '../src/main/chat/chat-router';
import type { LocalToolProvider } from '../src/main/chat/local-tool-provider';

// Captures the (input, history) passed to classify so we can assert that
// ChatRouter wires multi-turn context through to the local model.
function makeFakeToolModel() {
  const calls: Array<{ input: string; history: Array<{ role: string; content: string }> }> = [];
  const fake = {
    classify: async (
      input: string,
      history: Array<{ role: 'user' | 'assistant'; content: string }> = []
    ) => {
      calls.push({ input, history });
      return { tool: null, args: {}, mood: 'happy', response: 'beep boop' };
    },
    destroy() {},
  };
  return { fake: fake as unknown as LocalToolProvider, calls };
}

describe('ChatRouter multi-turn memory', () => {
  it('passes prior turns through to classify()', async () => {
    const { fake, calls } = makeFakeToolModel();
    const router = new ChatRouter(fake);

    const history = [
      { role: 'user' as const, content: 'what files are on my desktop?' },
      { role: 'assistant' as const, content: 'Here are your Desktop files!' },
    ];
    await router.chat('how about downloads?', history);

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('how about downloads?');
    expect(calls[0].history).toEqual(history);
  });

  it('wires history through the streaming path too', async () => {
    const { fake, calls } = makeFakeToolModel();
    const router = new ChatRouter(fake);

    const history = [{ role: 'user' as const, content: 'open spotify' }];
    await router.chatStream('now open safari', history, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].history).toEqual(history);
  });

  it('strips screen-context prefixes from prior turns', async () => {
    const { fake, calls } = makeFakeToolModel();
    const router = new ChatRouter(fake);

    await router.chat('how about downloads?', [
      {
        role: 'user',
        content: '[Screen Context: Cursor at (10, 20)]\n\nwhat files are on my desktop?',
      },
      { role: 'assistant', content: 'Here you go!' },
    ]);

    expect(calls[0].history[0].content).toBe('what files are on my desktop?');
  });

  it('keeps only the last 3 prior turns and drops empties', async () => {
    const { fake, calls } = makeFakeToolModel();
    const router = new ChatRouter(fake);

    await router.chat('and now?', [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: '   ' }, // empty after trim — dropped
      { role: 'assistant', content: 'three' },
      { role: 'user', content: 'four' },
      { role: 'assistant', content: 'five' },
    ]);

    expect(calls[0].history.map(m => m.content)).toEqual(['three', 'four', 'five']);
  });

  it('defaults to empty history when none is provided', async () => {
    const { fake, calls } = makeFakeToolModel();
    const router = new ChatRouter(fake);

    await router.chat('hello');

    expect(calls[0].history).toEqual([]);
  });
});

// Tool model that always returns a fixed tool call.
function makeToolModelReturning(toolCall: Record<string, unknown>) {
  const fake = {
    classify: async () => toolCall,
    destroy() {},
  };
  return fake as unknown as LocalToolProvider;
}

describe('ChatRouter screen analysis', () => {
  it('analyzeScreen delegates to the vision provider', async () => {
    const router = new ChatRouter(makeToolModelReturning({ tool: null, args: {} }));
    const seen: Array<{ img: string; q?: string }> = [];
    router.setVisionProvider({
      analyzeScreen: async (img, q) => { seen.push({ img, q }); return { type: 'message', text: 'I see a code editor.' }; },
    });

    const res = await router.analyzeScreen('data:image/png;base64,AAAA', 'what is this?');

    expect(res.text).toBe('I see a code editor.');
    expect(seen[0]).toEqual({ img: 'data:image/png;base64,AAAA', q: 'what is this?' });
  });

  it('analyzeScreen returns a cloud-needed message when no provider is set', async () => {
    const router = new ChatRouter(makeToolModelReturning({ tool: null, args: {} }));
    const res = await router.analyzeScreen('data:image/png;base64,AAAA');
    expect(res.text).toMatch(/cloud/i);
  });

  it('routes take_screenshot through capture + vision analysis', async () => {
    const router = new ChatRouter(makeToolModelReturning({ tool: 'take_screenshot', args: {}, mood: 'curious' }));
    let captured = false;
    router.setScreenCapturer(async () => { captured = true; return 'data:image/png;base64,ZZZ'; });
    router.setVisionProvider({
      analyzeScreen: async (img, q) => ({ type: 'message', text: `analyzed ${img.slice(-3)} for "${q}"` }),
    });

    const res = await router.chat("what's on my screen?");

    expect(captured).toBe(true);
    expect(res.text).toBe('analyzed ZZZ for "what\'s on my screen?"');
  });

  it('take_screenshot degrades gracefully with no vision provider', async () => {
    const router = new ChatRouter(makeToolModelReturning({ tool: 'take_screenshot', args: {} }));
    const res = await router.chat('look at my screen');
    expect(res.text).toMatch(/cloud connection/i);
  });

  it('take_screenshot reports when capture fails', async () => {
    const router = new ChatRouter(makeToolModelReturning({ tool: 'take_screenshot', args: {} }));
    router.setVisionProvider({ analyzeScreen: async () => ({ type: 'message', text: 'nope' }) });
    router.setScreenCapturer(async () => null);
    const res = await router.chat('what do you see');
    expect(res.text).toMatch(/couldn't grab a screenshot|permission/i);
  });
});
