import { app } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { verifyCachedWhisperModel, whisperModelPath, WhisperModelVerdict } from './whisper-model';
import { sanitizeTranscript } from './whisper-transcript';

// Speech recognition state
let speechProcess: ChildProcess | null = null;
let speechSender: Electron.WebContents | null = null;
let speechHelperReady = false;
let speechSessionActive = false;
let speechStartPending = false;
let speechHelperStartup: Promise<ChildProcess> | null = null;
let speechProcessExitExpected = false;
let speechStartSequence = 0;

export function getSpeechHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'speech-helper');
  }
  return path.join(__dirname, '../../native/speech-helper/speech-helper');
}

export function getSpeechEventSender(): Electron.WebContents | null {
  if (speechSender?.isDestroyed()) {
    speechSender = null;
  }
  return speechSender;
}

export function formatSpeechHelperExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `Speech helper exited unexpectedly (signal ${signal})`;
  }
  if (code === null) {
    return 'Speech helper exited unexpectedly';
  }
  return `Speech helper exited unexpectedly (code ${code})`;
}

export function notifySpeechErrorToSender(sender: Electron.WebContents | null, message: string): void {
  if (!sender || sender.isDestroyed()) return;
  sender.send('speech-error', { type: 'error', message });
}

/** Matches the helper's own message when whisper cannot open the model file. */
export function isSpeechModelLoadFailure(message: unknown): boolean {
  return typeof message === 'string' && /failed to load the speech model/i.test(message);
}

/** The cached model is missing or was corrupt and removed, so the next press re-downloads it. */
export const SPEECH_MODEL_LOAD_USER_MESSAGE =
  "Clawster's voice needs setting up again — tap the mic to retry.";

/**
 * Shown whenever a recording yields nothing usable. The helper emits this exact
 * text when its voice-activity gate never armed; whisper can also decode a
 * detected-voice recording (music, a cough, a door slam) to annotations that
 * `sanitizeTranscript` reduces to nothing, and that must not fail silently either.
 */
export const SPEECH_NO_SPEECH_USER_MESSAGE = "I didn't catch that — try again!";

/**
 * The model is intact, so whisper failed for a reason retrying cannot fix — a
 * Metal backend that will not initialise, an OOM, a sandbox denial.
 */
export const SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE =
  "Clawster's voice can't start on this Mac right now.";

/**
 * Generous enough for the one-time model read plus a cold Metal shader warm-up,
 * short enough that a wedged helper does not strand the mic indicator forever.
 */
export const SPEECH_HELPER_STARTUP_TIMEOUT_MS = 30_000;

export const SPEECH_HELPER_TIMEOUT_USER_MESSAGE =
  "Clawster's voice took too long to wake up — tap the mic to try again.";

/**
 * A helper wedged inside a driver call is precisely one that may never act on
 * SIGTERM, and it holds the microphone and its whisper context until it dies.
 */
export const SPEECH_HELPER_SIGKILL_DELAY_MS = 3_000;

/** Only an intact (or unremovable) cached model makes a retry pointless. */
export function speechModelVerdictMessage(verdict: WhisperModelVerdict): string {
  return verdict === 'unrecoverable'
    ? SPEECH_MODEL_UNAVAILABLE_USER_MESSAGE
    : SPEECH_MODEL_LOAD_USER_MESSAGE;
}

/**
 * The helper names the model's absolute path on a load failure, which would put
 * `/Users/<name>/…` in front of a child. The raw message still reaches the
 * main-process log; only the renderer sees the friendly form.
 */
export function userFacingSpeechError(message: unknown): string {
  if (isSpeechModelLoadFailure(message)) return SPEECH_MODEL_LOAD_USER_MESSAGE;
  return typeof message === 'string' ? message : 'Speech recognition failed';
}

export function resetSpeechHelperState(): void {
  speechProcess = null;
  speechSender = null;
  speechHelperReady = false;
  speechSessionActive = false;
  speechStartPending = false;
  speechHelperStartup = null;
  speechProcessExitExpected = false;
}

export function handleSpeechHelperMessage(msg: any): void {
  const sender = getSpeechEventSender();

  console.log('[Speech]', JSON.stringify(msg));

  if (msg.type === 'status') {
    console.log('[Speech] status:', msg.state);
    if (msg.state === 'ready') {
      speechHelperReady = true;
    } else if (msg.state === 'recording') {
      speechStartPending = false;
      speechSessionActive = true;
    } else if (msg.state === 'stopped') {
      speechStartPending = false;
      speechSessionActive = false;
    }
    return;
  }

  if (msg.type === 'partial' || msg.type === 'final') {
    const result = { ...msg, text: sanitizeTranscript(msg.text ?? '') };

    if (msg.type === 'final') {
      speechStartPending = false;
      speechSessionActive = false;
      if (sender) {
        // The final always goes out: it is the only message that clears the input
        // box, which still holds the last partial. An empty one cannot auto-submit,
        // so the error that follows is the sole thing the user reads.
        sender.send('speech-result', result);
        if (!result.text) {
          sender.send('speech-error', { type: 'error', message: SPEECH_NO_SPEECH_USER_MESSAGE });
        }
      }
      speechSender = null;
      return;
    }

    if (sender) {
      sender.send('speech-result', result);
    }
    return;
  }

  if (msg.type === 'error') {
    speechStartPending = false;
    speechSessionActive = false;

    // A model-load failure kills the helper before it ever reports `ready`, so it
    // is a startup failure: `speech-start` rejects with the same friendly text.
    // Sending it here as well would give the user two identical bubbles.
    const startupPending = speechHelperStartup !== null;
    if (sender && !(startupPending && isSpeechModelLoadFailure(msg.message))) {
      sender.send('speech-error', { ...msg, message: userFacingSpeechError(msg.message) });
    }
    speechSender = null;
  }
}

export function ensureSpeechHelper(): Promise<ChildProcess> {
  if (speechProcess && speechHelperReady) {
    return Promise.resolve(speechProcess);
  }

  if (speechHelperStartup) {
    return speechHelperStartup;
  }

  const helperPath = getSpeechHelperPath();
  let startupPromise: Promise<ChildProcess> | undefined;

  startupPromise = new Promise((resolve, reject) => {
    // The helper loads the Whisper model before it reports "ready", so the model
    // must already be on disk by the time we spawn it.
    const child = spawn(helperPath, ['--model', whisperModelPath()]);
    let startupSettled = false;
    let modelVerification: Promise<WhisperModelVerdict> | null = null;
    let buffer = '';
    let closed = false;
    let sigkillTimer: NodeJS.Timeout | null = null;

    speechProcess = child;
    speechHelperReady = false;
    speechProcessExitExpected = false;

    // The startup timeout can abandon a child that is still alive, so a later
    // helper may already own the module state. Everything this child's listeners
    // touch — the globals, the renderer, the startup slot — belongs to whoever
    // `speechProcess` names now.
    const isCurrentChild = () => speechProcess === child;

    // The model-load path settles asynchronously, so a newer startup may already
    // own the module slot by then; never clear someone else's.
    const releaseStartupSlot = () => {
      if (speechHelperStartup === startupPromise) speechHelperStartup = null;
    };

    const clearSigkillTimer = () => {
      if (sigkillTimer) clearTimeout(sigkillTimer);
      sigkillTimer = null;
    };

    const terminate = () => {
      if (!child.killed) child.kill();
      clearSigkillTimer();
      sigkillTimer = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, SPEECH_HELPER_SIGKILL_DELAY_MS);
      sigkillTimer.unref?.();
    };

    // Without this, a helper that neither reports `ready` nor exits — a wedged GPU
    // driver, say — leaves this promise pending forever. It is cached, so every
    // later `speech-start` awaits the same dead promise and never returns.
    const startupTimer = setTimeout(() => {
      // Disown the wedged child before killing it: its `close` may land after the
      // next mic press has spawned a replacement, and `speech-stop` must not write
      // to a process that is on its way out.
      if (isCurrentChild()) {
        speechProcess = null;
        speechHelperReady = false;
      }
      terminate();
      rejectStartup(new Error(SPEECH_HELPER_TIMEOUT_USER_MESSAGE));
    }, SPEECH_HELPER_STARTUP_TIMEOUT_MS);
    startupTimer.unref?.();

    const resolveStartup = () => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(startupTimer);
      releaseStartupSlot();
      resolve(child);
    };

    const rejectStartup = (error: Error) => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(startupTimer);
      releaseStartupSlot();
      reject(error);
    };

    child.stdout?.on('data', (data: Buffer) => {
      if (!isCurrentChild()) return;
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'status' && msg.state === 'ready') {
            speechHelperReady = true;
            resolveStartup();
          }
          if (msg.type === 'error' && isSpeechModelLoadFailure(msg.message)) {
            // The helper exits(1) straight after. The same error covers a missing
            // model, a corrupt one, and failures re-downloading cannot fix, so the
            // verdict decides both whether the model is deleted and what the user
            // is told.
            modelVerification = verifyCachedWhisperModel().catch((error: unknown) => {
              console.error('speech-helper model verification failed:', error);
              return 'unrecoverable' as const;
            });
          }
          handleSpeechHelperMessage(msg);
        } catch {
          // ignore malformed JSON
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.error('speech-helper stderr:', data.toString());
    });

    child.on('error', (err) => {
      console.error('speech-helper spawn error:', err);
      clearSigkillTimer();
      if (!isCurrentChild()) return;
      const sender = getSpeechEventSender();
      const shouldNotify = speechSessionActive && !speechProcessExitExpected && startupSettled;
      resetSpeechHelperState();
      rejectStartup(err);
      if (shouldNotify) {
        notifySpeechErrorToSender(sender, err.message);
      }
    });

    // `close`, not `exit`: the helper writes its JSON error line and exits at once,
    // and `exit` can fire before that line has been read off the pipe. Only `close`
    // guarantees stdout has been drained, so `modelVerification` is settled here.
    child.on('close', (code, signal) => {
      closed = true;
      clearSigkillTimer();
      if (!isCurrentChild()) return;

      const sender = getSpeechEventSender();
      const shouldNotify = !speechProcessExitExpected && speechSessionActive && startupSettled;

      console.log('[Speech] exited:', { code, signal, expected: speechProcessExitExpected });

      resetSpeechHelperState();

      if (modelVerification) {
        // The helper never reached `ready`, so nothing is listening on
        // `speech-error`; the rejection below is the user's single message.
        void modelVerification.then((verdict) => {
          rejectStartup(new Error(speechModelVerdictMessage(verdict)));
        });
        return;
      }

      const exitMessage = formatSpeechHelperExit(code, signal);
      rejectStartup(new Error(exitMessage));

      if (shouldNotify) {
        notifySpeechErrorToSender(sender, exitMessage);
      }
    });
  });

  speechHelperStartup = startupPromise;
  return startupPromise;
}

// State accessors for use by IPC handlers in main.ts
export function getSpeechProcess(): ChildProcess | null {
  return speechProcess;
}

export function isSpeechSessionActive(): boolean {
  return speechSessionActive;
}

export function isSpeechStartPending(): boolean {
  return speechStartPending;
}

export function setSpeechSender(sender: Electron.WebContents | null): void {
  speechSender = sender;
}

export function setSpeechSessionActive(active: boolean): void {
  speechSessionActive = active;
}

export function setSpeechStartPending(pending: boolean): void {
  speechStartPending = pending;
}

export function nextSpeechStartSequence(): number {
  return ++speechStartSequence;
}

export function getSpeechStartSequence(): number {
  return speechStartSequence;
}

export function setSpeechProcessExitExpected(expected: boolean): void {
  speechProcessExitExpected = expected;
}
