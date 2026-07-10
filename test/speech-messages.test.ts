import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: vi.fn(() => '/app') },
}));

import {
  handleSpeechHelperMessage,
  isSpeechModelLoadFailure,
  isSpeechSessionActive,
  isSpeechStartPending,
  getSpeechEventSender,
  resetSpeechHelperState,
  setSpeechSender,
  setSpeechSessionActive,
  setSpeechStartPending,
} from '../src/main/speech';

function fakeSender() {
  return { send: vi.fn(), isDestroyed: () => false } as unknown as Electron.WebContents;
}

/** Puts the module in the state a `speech-start` IPC call would leave it in. */
function beginSession(sender: Electron.WebContents) {
  setSpeechSender(sender);
  setSpeechSessionActive(true);
  setSpeechStartPending(true);
}

beforeEach(() => {
  resetSpeechHelperState();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('handleSpeechHelperMessage', () => {
  it('forwards interim transcripts to the renderer and keeps the session open', () => {
    const sender = fakeSender();
    beginSession(sender);
    handleSpeechHelperMessage({ type: 'status', state: 'recording' });

    handleSpeechHelperMessage({ type: 'partial', text: ' open my' });

    expect(sender.send).toHaveBeenCalledWith('speech-result', { type: 'partial', text: 'open my' });
    expect(isSpeechSessionActive()).toBe(true);
    expect(getSpeechEventSender()).toBe(sender);
  });

  it('forwards the final transcript, then ends the session', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({ type: 'final', text: ' Open my email.' });

    expect(sender.send).toHaveBeenCalledWith('speech-result', {
      type: 'final',
      text: 'Open my email.',
    });
    expect(isSpeechSessionActive()).toBe(false);
    expect(isSpeechStartPending()).toBe(false);
    // The sender is released so a late message cannot reach a stale window.
    expect(getSpeechEventSender()).toBeNull();
  });

  it('strips whisper non-speech annotations before they reach the renderer', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({ type: 'final', text: ' [BLANK_AUDIO]' });

    expect(sender.send).toHaveBeenCalledWith('speech-result', { type: 'final', text: '' });
  });

  it('ignores the transcribing status the helper emits between stop and final', () => {
    const sender = fakeSender();
    beginSession(sender);
    handleSpeechHelperMessage({ type: 'status', state: 'recording' });

    handleSpeechHelperMessage({ type: 'status', state: 'transcribing' });

    expect(isSpeechSessionActive()).toBe(true);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('still delivers a final that arrives after the stopped status', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({ type: 'status', state: 'stopped' });
    handleSpeechHelperMessage({ type: 'final', text: ' hello' });

    expect(sender.send).toHaveBeenCalledWith('speech-result', { type: 'final', text: 'hello' });
  });

  it('routes errors to speech-error and ends the session', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({ type: 'error', message: 'Microphone permission denied.' });

    expect(sender.send).toHaveBeenCalledWith('speech-error', {
      type: 'error',
      message: 'Microphone permission denied.',
    });
    expect(isSpeechSessionActive()).toBe(false);
    expect(getSpeechEventSender()).toBeNull();
  });

  it('recognizes the helper message that means the cached model is unusable', () => {
    expect(isSpeechModelLoadFailure('Failed to load the speech model at /tmp/x.bin')).toBe(true);
    expect(isSpeechModelLoadFailure('Microphone permission denied.')).toBe(false);
    expect(isSpeechModelLoadFailure(undefined)).toBe(false);
  });

  it('drops results when the renderer window is gone', () => {
    const destroyed = { send: vi.fn(), isDestroyed: () => true } as unknown as Electron.WebContents;
    beginSession(destroyed);

    handleSpeechHelperMessage({ type: 'final', text: ' hello' });

    expect(destroyed.send).not.toHaveBeenCalled();
  });
});
