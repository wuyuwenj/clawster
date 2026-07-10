import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isWhisperModelInstalled, whisperModelPath } from '../src/main/whisper-model';
import { sanitizeTranscript } from '../src/main/whisper-transcript';

// Exercises the real Swift + whisper.cpp helper. Everything it needs is optional:
// on Linux CI, or before `npm run build:speech`, or before the model has been
// downloaded, the suite skips instead of failing.
const HELPER = path.join(__dirname, '../native/speech-helper/speech-helper');

function helperAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync(HELPER) && isWhisperModelInstalled();
}

const describeHelper = helperAvailable() ? describe : describe.skip;

interface HelperMessage {
  type: string;
  state?: string;
  text?: string;
  message?: string;
}

function parseMessages(stdout: string): HelperMessage[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as HelperMessage);
}

describeHelper('speech-helper (whisper.cpp)', () => {
  it('reports permissions without loading a model', () => {
    const stdout = execFileSync(HELPER, ['--check-permissions'], { encoding: 'utf8' });
    const result = JSON.parse(stdout.trim());

    expect(result).toHaveProperty('mic');
    // Transcription is local, so macOS speech authorization no longer gates it.
    expect(result.speech).toBe('granted');
  });

  it('fails clearly when the model is missing', () => {
    const child = spawn(HELPER, ['--model', path.join(os.tmpdir(), 'does-not-exist.bin')]);
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));

    return new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        expect(code).toBe(1);
        const messages = parseMessages(stdout);
        expect(messages[0].type).toBe('error');
        expect(messages[0].message).toMatch(/Failed to load the speech model/);
        resolve();
      });
    });
  }, 30_000);

  it('announces ready over stdout and exits cleanly on quit', () => {
    const child = spawn(HELPER, ['--model', whisperModelPath()]);
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('"ready"')) child.stdin.write('quit\n');
    });

    return new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        expect(parseMessages(stdout)).toContainEqual({ type: 'status', state: 'ready' });
        // ggml's Metal backend aborts at exit if the whisper context leaks.
        expect(code).toBe(0);
        resolve();
      });
    });
  }, 60_000);

  it('transcribes speech locally', () => {
    const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-say-')), 'speech.wav');
    try {
      // `say` gives us real speech audio without needing a microphone.
      execFileSync('say', ['-o', wav, '--data-format=LEF32@16000', 'open my email please']);

      const stdout = execFileSync(
        HELPER,
        ['--model', whisperModelPath(), '--transcribe-file', wav],
        { encoding: 'utf8', timeout: 60_000 }
      );

      const messages = parseMessages(stdout);
      const final = messages.find((m) => m.type === 'final');
      expect(final).toBeDefined();
      expect(sanitizeTranscript(final!.text ?? '').toLowerCase()).toContain('open my email');
    } finally {
      fs.rmSync(path.dirname(wav), { recursive: true, force: true });
    }
  }, 90_000);
});
