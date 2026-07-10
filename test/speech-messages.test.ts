import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

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
  SPEECH_HELPER_SIGKILL_DELAY_MS,
  SPEECH_HELPER_STARTUP_TIMEOUT_MS,
  SPEECH_HELPER_TIMEOUT_USER_MESSAGE,
  SPEECH_MODEL_LOAD_USER_MESSAGE,
  SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE,
  SPEECH_NO_SPEECH_USER_MESSAGE,
  ensureSpeechHelper,
  handleSpeechHelperMessage,
  isSpeechModelLoadFailure,
  isSpeechSessionActive,
  isSpeechStartPending,
  getSpeechEventSender,
  getSpeechProcess,
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
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
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
    handleSpeechHelperMessage({ type: 'partial', text: ' thank you' });
    vi.mocked(sender.send).mockClear();

    // Music, a cough or a door slam arms the helper's voice gate, then decodes to
    // annotations only. The empty final clears the stale partial out of the input
    // box; the error is what the user actually reads.
    handleSpeechHelperMessage({ type: 'final', text: ' (upbeat music)' });

    expect(vi.mocked(sender.send).mock.calls).toEqual([
      ['speech-result', { type: 'final', text: '' }],
      ['speech-error', { type: 'error', message: SPEECH_NO_SPEECH_USER_MESSAGE }],
    ]);
    expect(isSpeechSessionActive()).toBe(false);
    expect(isSpeechStartPending()).toBe(false);
    expect(getSpeechEventSender()).toBeNull();
  });

  it('does not signal no-speech when the final carries a transcript', () => {
    const sender = fakeSender();
    beginSession(sender);

    handleSpeechHelperMessage({ type: 'final', text: ' open my email' });

    expect(vi.mocked(sender.send).mock.calls).toEqual([
      ['speech-result', { type: 'final', text: 'open my email' }],
    ]);
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

describe('ensureSpeechHelper startup timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kills a helper that never reports ready, so the next press can retry', async () => {
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);

    // Neither `ready` nor an exit: the helper is wedged. Without the timer this
    // promise never settles, and it is cached for every later `speech-start`.
    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS);

    const error = (await startup) as Error;
    expect(error.message).toBe(SPEECH_HELPER_TIMEOUT_USER_MESSAGE);
    expect(child.kill).toHaveBeenCalled();

    // The cached startup slot was released, so a fresh helper is spawned.
    vi.mocked(spawn).mockClear();
    fakeChild();
    void ensureSpeechHelper().catch(() => {});
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not trip the timeout once the helper reports ready', async () => {
    const child = fakeChild();
    const startup = ensureSpeechHelper();

    child.stdout.emit('data', Buffer.from('{"type":"status","state":"ready"}\n'));
    await expect(startup).resolves.toBe(child);

    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS * 2);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('keeps the timeout message free of any file path', () => {
    expect(SPEECH_HELPER_TIMEOUT_USER_MESSAGE).not.toMatch(/\//);
  });

  it('escalates to SIGKILL when the wedged helper ignores SIGTERM', async () => {
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS);
    await startup;
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_SIGKILL_DELAY_MS);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('cancels the pending SIGKILL once the helper does exit', async () => {
    const child = fakeChild();
    const startup = ensureSpeechHelper().catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS);
    await startup;
    child.emit('close', null, 'SIGTERM');

    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_SIGKILL_DELAY_MS);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('ignores a superseded helper’s close, so it cannot tear down the live session', async () => {
    const wedged = fakeChild();
    const abandoned = ensureSpeechHelper().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS);
    await abandoned;

    // The next mic press gets a healthy helper while the wedged one is still dying.
    const fresh = fakeChild();
    const startup = ensureSpeechHelper();
    fresh.stdout.emit('data', Buffer.from('{"type":"status","state":"ready"}\n'));
    await expect(startup).resolves.toBe(fresh);

    const sender = fakeSender();
    beginSession(sender);
    handleSpeechHelperMessage({ type: 'status', state: 'recording' });

    wedged.emit('close', null, 'SIGTERM');

    expect(sender.send).not.toHaveBeenCalled();
    expect(isSpeechSessionActive()).toBe(true);
    expect(getSpeechProcess()).toBe(fresh);
    expect(getSpeechEventSender()).toBe(sender);
  });

  it('drops stdout from a superseded helper', async () => {
    const wedged = fakeChild();
    const abandoned = ensureSpeechHelper().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SPEECH_HELPER_STARTUP_TIMEOUT_MS);
    await abandoned;

    const fresh = fakeChild();
    const startup = ensureSpeechHelper();
    fresh.stdout.emit('data', Buffer.from('{"type":"status","state":"ready"}\n'));
    await expect(startup).resolves.toBe(fresh);

    const sender = fakeSender();
    beginSession(sender);
    wedged.stdout.emit('data', Buffer.from('{"type":"final","text":" ghost"}\n'));

    expect(sender.send).not.toHaveBeenCalled();
    expect(isSpeechSessionActive()).toBe(true);
  });
});

describe('cross-language user-facing strings', () => {
  // The helper hardcodes its own copy of the no-speech sentence, so the two
  // no-speech paths (its voice gate, and speech.ts's empty-final) can drift apart.
  it('matches the helper’s no-speech message byte for byte', () => {
    const source = path.join(__dirname, '../native/speech-helper/main.swift');
    let swift: string;
    try {
      swift = fs.readFileSync(source, 'utf8');
    } catch {
      return; // Swift source unavailable (e.g. a partial checkout); nothing to pin.
    }

    const match = swift.match(/let kNoSpeechUserMessage = "(.*)"/);
    expect(match, 'kNoSpeechUserMessage not found in main.swift').not.toBeNull();
    expect(match![1]).toBe(SPEECH_NO_SPEECH_USER_MESSAGE);
  });
});
