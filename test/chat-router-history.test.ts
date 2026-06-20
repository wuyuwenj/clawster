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
