import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: vi.fn(() => '/app') },
}));

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('../src/main/whisper-model', () => ({
  whisperModelPath: () => '/tmp/ggml-base.en.bin',
  verifyCachedWhisperModel: vi.fn(async () => 'unrecoverable' as const),
}));

import { spawn } from 'child_process';
import { verifyCachedWhisperModel } from '../src/main/whisper-model';
import {
  SPEECH_MODEL_LOAD_USER_MESSAGE,
  SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE,
  SPEECH_NO_SPEECH_USER_MESSAGE,
  ensureSpeechHelper,
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

/** Stands in for the spawned Swift helper: stdout lines in, exit/error events out. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

/** Puts the module in the state a `speech-start` IPC call would leave it in. */
function beginSession(sender: Electron.WebContents) {
  setSpeechSender(sender);
  setSpeechSessionActive(true);
  setSpeechStartPending(true);
}

beforeEach(() => {
  resetSpeechHelperState();
  vi.mocked(verifyCachedWhisperModel).mockResolvedValue('unrecoverable');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

    handleSpeechHelperMessage({ type: 'final', text: ' hey [BLANK_AUDIO] clawster' });

    expect(sender.send).toHaveBeenCalledWith('speech-result', {
      type: 'final',
      text: 'hey clawster',
    });
  });

  it('signals an annotation-only final instead of delivering an empty transcript', () => {
    const sender = fakeSender();
    beginSession(sender);

    // Music, a cough or a door slam arms the helper's voice gate, then decodes to
    // annotations only. Forwarding "" would turn the mic off and do nothing else.
    handleSpeechHelperMessage({ type: 'final', text: ' (upbeat music)' });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith('speech-error', {
      type: 'error',
      message: SPEECH_NO_SPEECH_USER_MESSAGE,
    });
    expect(isSpeechSessionActive()).toBe(false);
    expect(isSpeechStartPending()).toBe(false);
    expect(getSpeechEventSender()).toBeNull();
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

  it('surfaces the helper’s "nothing heard" signal instead of a silent empty result', () => {
    const sender = fakeSender();
    beginSession(sender);
    handleSpeechHelperMessage({ type: 'status', state: 'recording' });

    handleSpeechHelperMessage({ type: 'error', message: "I didn't catch that — try again!" });
    handleSpeechHelperMessage({ type: 'status', state: 'stopped' });

    expect(sender.send).toHaveBeenCalledWith('speech-error', {
      type: 'error',
      message: "I didn't catch that — try again!",
    });
    expect(isSpeechSessionActive()).toBe(false);
    expect(isSpeechStartPending()).toBe(false);
    expect(getSpeechEventSender()).toBeNull();
  });

  it('replaces the model-load failure path with a friendly retry message', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({
      type: 'error',
      message: 'Failed to load the speech model at /Users/kid/.clawster/models/whisper/x.bin',
    });

    expect(sender.send).toHaveBeenCalledWith('speech-error', {
      type: 'error',
      message: SPEECH_MODEL_LOAD_USER_MESSAGE,
    });
    expect(SPEECH_MODEL_LOAD_USER_MESSAGE).not.toMatch(/\//);
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

describe('ensureSpeechHelper startup failures', () => {
  const MODEL_LOAD_ERROR = {
    type: 'error',
    message: 'Failed to load the speech model at /Users/kid/.clawster/models/whisper/x.bin',
  };

  function emitLine(child: { stdout: EventEmitter }, msg: unknown) {
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(msg)}\n`));
  }

  /** Drives the helper through the model-load failure it always follows with exit(1). */
  async function failToLoadModel(sender?: Electron.WebContents): Promise<Error> {
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);
    if (sender) beginSession(sender);

    emitLine(child, MODEL_LOAD_ERROR);
    child.emit('exit', 1, null);
    child.emit('close', 1, null);

    return (await startup) as Error;
  }

  it('surfaces the friendly message even when exit beats the stdout line', async () => {
    vi.mocked(verifyCachedWhisperModel).mockResolvedValue('corrupt');
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);

    // Node makes no promise that buffered stdout is delivered before `exit`; the
    // helper flushes its error and exits in the same breath. `close` is the only
    // event that follows both.
    child.emit('exit', 1, null);
    emitLine(child, MODEL_LOAD_ERROR);
    child.emit('close', 1, null);

    const error = (await startup) as Error;
    expect(error.message).toBe(SPEECH_MODEL_LOAD_USER_MESSAGE);
  });

  it('tells the user to retry once the corrupt model has been removed', async () => {
    vi.mocked(verifyCachedWhisperModel).mockResolvedValue('corrupt');

    const error = await failToLoadModel();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(SPEECH_MODEL_LOAD_USER_MESSAGE);
  });

  it('tells the user to retry when the model is simply missing', async () => {
    vi.mocked(verifyCachedWhisperModel).mockResolvedValue('absent');

    const error = await failToLoadModel();

    expect(error.message).toBe(SPEECH_MODEL_LOAD_USER_MESSAGE);
  });

  it('does not promise a retry when the model checksum is still valid', async () => {
    vi.mocked(verifyCachedWhisperModel).mockResolvedValue('unrecoverable');

    const error = await failToLoadModel();

    expect(error.message).toBe(SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE);
  });

  it('keeps the model-load path free of the absolute model path', () => {
    expect(SPEECH_MODEL_LOAD_USER_MESSAGE).not.toMatch(/\//);
    expect(SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE).not.toMatch(/\//);
  });

  it('surfaces a model-load failure exactly once, not on speech-error as well', async () => {
    vi.mocked(verifyCachedWhisperModel).mockResolvedValue('corrupt');
    const sender = fakeSender();

    const error = await failToLoadModel(sender);

    // `speech-start` rejects with the message; a `speech-error` too would render
    // a second, identical bubble.
    expect(error.message).toBe(SPEECH_MODEL_LOAD_USER_MESSAGE);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('still reports the raw exit for failures unrelated to the model', async () => {
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);

    child.emit('exit', 1, null);
    child.emit('close', 1, null);

    const error = await startup;
    expect((error as Error).message).toBe('Speech helper exited unexpectedly (code 1)');
  });
});
