import { app } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { whisperModelPath } from './whisper-model';
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
        sender.send('speech-result', result);
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

    if (sender) {
      sender.send('speech-error', msg);
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
  speechHelperStartup = new Promise((resolve, reject) => {
    // The helper loads the Whisper model before it reports "ready", so the model
    // must already be on disk by the time we spawn it.
    const child = spawn(helperPath, ['--model', whisperModelPath()]);
    let startupSettled = false;
    let buffer = '';

    speechProcess = child;
    speechHelperReady = false;
    speechProcessExitExpected = false;

    const resolveStartup = () => {
      if (startupSettled) return;
      startupSettled = true;
      speechHelperStartup = null;
      resolve(child);
    };

    const rejectStartup = (error: Error) => {
      if (startupSettled) return;
      startupSettled = true;
      speechHelperStartup = null;
      reject(error);
    };

    child.stdout?.on('data', (data: Buffer) => {
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
      const sender = getSpeechEventSender();
      const shouldNotify = speechSessionActive && !speechProcessExitExpected && startupSettled;
      resetSpeechHelperState();
      rejectStartup(err);
      if (shouldNotify) {
        notifySpeechErrorToSender(sender, err.message);
      }
    });

    child.on('exit', (code, signal) => {
      const exitMessage = formatSpeechHelperExit(code, signal);
      const sender = getSpeechEventSender();
      const shouldNotify = !speechProcessExitExpected && speechSessionActive && startupSettled;

      console.log('[Speech] exited:', { code, signal, expected: speechProcessExitExpected });

      resetSpeechHelperState();
      rejectStartup(new Error(exitMessage));

      if (shouldNotify) {
        notifySpeechErrorToSender(sender, exitMessage);
      }
    });
  });

  return speechHelperStartup;
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
