import { describe, it, expect } from 'vitest';
import { extractMemoryBlock, stripMemoryBlockFromStream } from '../src/main/chat/memory';

describe('extractMemoryBlock', () => {
  it('returns null when no memory block is present', () => {
    const { cleanResponse, memoryData } = extractMemoryBlock('Hello there! How are you?');
    expect(cleanResponse).toBe('Hello there! How are you?');
    expect(memoryData).toBeNull();
  });

  it('extracts a valid memory block and strips it from response', () => {
    const raw = `I'm sorry to hear that!\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"mom_name","value":"Linda","person":"mom"}],"emotional":"Worried about mom's surgery","emotions":["worried","anxious"],"people":["Linda"]}\n\`\`\``;
    const { cleanResponse, memoryData } = extractMemoryBlock(raw);
    expect(cleanResponse).toBe("I'm sorry to hear that!");
    expect(memoryData?.memorable).toBe(true);
    expect(memoryData?.facts).toHaveLength(1);
    expect(memoryData?.facts[0].key).toBe('mom_name');
    expect(memoryData?.facts[0].value).toBe('Linda');
    expect(memoryData?.emotional).toBe("Worried about mom's surgery");
    expect(memoryData?.emotions).toEqual(['worried', 'anxious']);
    expect(memoryData?.people).toEqual(['Linda']);
  });

  it('handles memorable: false', () => {
    const raw = `Sure thing!\n\`\`\`memory\n{"memorable":false}\n\`\`\``;
    const { cleanResponse, memoryData } = extractMemoryBlock(raw);
    expect(cleanResponse).toBe('Sure thing!');
    expect(memoryData?.memorable).toBe(false);
    expect(memoryData?.facts).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const raw = `Hey!\n\`\`\`memory\n{not valid json\n\`\`\``;
    const { cleanResponse, memoryData } = extractMemoryBlock(raw);
    expect(cleanResponse).toBe('Hey!');
    expect(memoryData).toBeNull();
  });

  it('handles missing fields gracefully', () => {
    const raw = `Ok!\n\`\`\`memory\n{"memorable":true}\n\`\`\``;
    const { cleanResponse, memoryData } = extractMemoryBlock(raw);
    expect(cleanResponse).toBe('Ok!');
    expect(memoryData?.memorable).toBe(true);
    expect(memoryData?.facts).toEqual([]);
    expect(memoryData?.emotional).toBeUndefined();
  });

  it('takes only the first memory block if multiple exist', () => {
    const raw = `Response\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"a","value":"1"}]}\n\`\`\`\nMore text\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"b","value":"2"}]}\n\`\`\``;
    const { memoryData } = extractMemoryBlock(raw);
    expect(memoryData?.facts[0].key).toBe('a');
  });

  it('truncates long values', () => {
    const longValue = 'x'.repeat(1000);
    const raw = `Hi\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"long","value":"${longValue}"}]}\n\`\`\``;
    const { memoryData } = extractMemoryBlock(raw);
    expect(memoryData?.facts[0].value.length).toBeLessThanOrEqual(500);
  });

  it('filters out facts with missing key or value', () => {
    const raw = `Hi\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"good","value":"yes"},{"value":"no-key"},{"key":"no-value"}]}\n\`\`\``;
    const { memoryData } = extractMemoryBlock(raw);
    expect(memoryData?.facts).toHaveLength(1);
    expect(memoryData?.facts[0].key).toBe('good');
  });

  it('handles unicode/emoji in facts and summaries', () => {
    const raw = `Hi\n\`\`\`memory\n{"memorable":true,"facts":[{"key":"mood","value":"feeling 🎉"}],"emotional":"Super excited about concert 🎵"}\n\`\`\``;
    const { memoryData } = extractMemoryBlock(raw);
    expect(memoryData?.facts[0].value).toBe('feeling 🎉');
    expect(memoryData?.emotional).toBe('Super excited about concert 🎵');
  });
});

describe('stripMemoryBlockFromStream', () => {
  it('strips complete memory block', () => {
    const text = 'Hello!\n```memory\n{"memorable":true}\n```';
    expect(stripMemoryBlockFromStream(text)).toBe('Hello!');
  });

  it('strips incomplete memory block at end of stream', () => {
    const text = 'Hello!\n```memory\n{"memorable":tr';
    expect(stripMemoryBlockFromStream(text)).toBe('Hello!');
  });

  it('returns unchanged text with no memory block', () => {
    expect(stripMemoryBlockFromStream('Just normal text')).toBe('Just normal text');
  });
});
