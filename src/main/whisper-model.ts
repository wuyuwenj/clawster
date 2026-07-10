import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { clawsterDataDir } from './paths';

// The Whisper weights are ~148 MB, far too large to commit or bundle. They are
// fetched once on first voice use and cached under the Clawster data directory.
export interface WhisperModelSpec {
  /** File name on disk. */
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

// Pinned to a revision rather than `main`: a re-upload upstream would make the
// checksum below unmatchable and break voice input for everyone without a cache.
export const WHISPER_MODEL: WhisperModelSpec = {
  name: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  bytes: 147964211,
};

/** Give up if the server never responds, or if a transfer goes quiet mid-flight. */
export interface DownloadTimeouts {
  connectMs: number;
  stallMs: number;
}

export const DEFAULT_DOWNLOAD_TIMEOUTS: DownloadTimeouts = {
  connectMs: 30_000,
  stallMs: 60_000,
};

// whisper.framework (the prebuilt whisper.cpp xcframework the helper links
// against) is built for macOS 13.3, so voice input cannot run below it.
export const MIN_MACOS_VERSION = '13.3';

export type VoiceSetupState =
  | { status: 'ready'; modelPath: string }
  | { status: 'downloading'; percent: number }
  | { status: 'error'; message: string };

export function whisperModelDir(): string {
  return path.join(clawsterDataDir(), 'models', 'whisper');
}

export function whisperModelPath(): string {
  return path.join(whisperModelDir(), WHISPER_MODEL.name);
}

/** True once the fully-downloaded model is on disk. */
export function isWhisperModelInstalled(modelPath = whisperModelPath()): boolean {
  try {
    return fs.statSync(modelPath).size === WHISPER_MODEL.bytes;
  } catch {
    return false;
  }
}

/** Removes the cached model so the next attempt re-downloads it. */
export function deleteWhisperModel(modelPath = whisperModelPath()): void {
  fs.rmSync(modelPath, { force: true });
}

/**
 * Removes the cached model only if its bytes no longer match `spec.sha256`.
 * The helper reports the same load failure for environmental problems (Metal
 * backend init, OOM, a sandbox denial), and deleting a healthy model on those
 * would re-download ~148 MB on every mic press without ever succeeding.
 */
export async function deleteWhisperModelIfCorrupt(
  spec: WhisperModelSpec = WHISPER_MODEL,
  modelPath = whisperModelPath()
): Promise<boolean> {
  let actual: string;
  try {
    actual = await fileSha256(modelPath);
  } catch {
    return false;
  }

  if (actual === spec.sha256) return false;

  deleteWhisperModel(modelPath);
  return true;
}

/** Compares a `major.minor.patch` macOS version against MIN_MACOS_VERSION. */
export function isWhisperSupportedMacOS(version: string): boolean {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const actual = parse(version);
  const minimum = parse(MIN_MACOS_VERSION);

  for (let i = 0; i < Math.max(actual.length, minimum.length); i++) {
    const a = actual[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function downloadPercent(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

export function formatVoiceSetupMessage(percent: number): string {
  return `Setting up voice… downloading the speech model (${percent}%). This only happens once — tap the mic again in a moment!`;
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Streams a model to `<destDir>/<spec.name>`, verifying its checksum before the
 * file is moved into place. A partial or corrupt download never becomes the
 * cached model. A silent socket aborts the transfer rather than hanging forever.
 */
export async function downloadModel(
  spec: WhisperModelSpec,
  destDir: string,
  onProgress: (percent: number) => void = () => {},
  timeouts: DownloadTimeouts = DEFAULT_DOWNLOAD_TIMEOUTS
): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });

  const finalPath = path.join(destDir, spec.name);
  const tempPath = `${finalPath}.part`;

  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  // Re-armed on every chunk, so a stall is measured from the last byte received.
  const armTimeout = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    timer.unref();
  };

  armTimeout(timeouts.connectMs);

  try {
    const response = await fetch(spec.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      // Release the socket now rather than leaving the body for the collector.
      controller.abort();
      throw new Error(`Download failed with status ${response.status}`);
    }

    const total = Number(response.headers.get('content-length')) || spec.bytes;
    let received = 0;
    let lastPercent = -1;

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    armTimeout(timeouts.stallMs);
    source.on('data', (chunk: Buffer) => {
      armTimeout(timeouts.stallMs);
      received += chunk.length;
      const percent = downloadPercent(received, total);
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    });

    await pipeline(source, fs.createWriteStream(tempPath), { signal: controller.signal });
    clearTimeout(timer);

    const actual = await fileSha256(tempPath);
    if (actual !== spec.sha256) {
      throw new Error('Downloaded speech model failed its checksum check');
    }

    fs.renameSync(tempPath, finalPath);
    return finalPath;
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    if (timedOut) {
      throw new Error('The speech model download stalled. Check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// --- First-use setup state ----------------------------------------------------

let activeDownload: { promise: Promise<unknown>; percent: number } | null = null;
let lastError: string | null = null;

/** Test seam: forget any in-flight download or recorded failure. */
export function resetWhisperModelState(): void {
  activeDownload = null;
  lastError = null;
}

/**
 * Snapshot of whether voice input can start right now. The first call with no
 * cached model kicks off the download in the background and reports progress on
 * subsequent calls, so the caller never blocks on a ~148 MB fetch.
 */
export function ensureWhisperModel(): VoiceSetupState {
  const modelPath = whisperModelPath();

  if (isWhisperModelInstalled(modelPath)) {
    return { status: 'ready', modelPath };
  }

  if (lastError) {
    // Surface the failure once, then allow the next attempt to retry.
    const message = lastError;
    lastError = null;
    return { status: 'error', message };
  }

  if (activeDownload) {
    return { status: 'downloading', percent: activeDownload.percent };
  }

  const download = { promise: Promise.resolve(), percent: 0 };
  download.promise = downloadModel(WHISPER_MODEL, whisperModelDir(), (percent) => {
    download.percent = percent;
  })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : 'Failed to download the speech model';
    })
    .finally(() => {
      if (activeDownload === download) activeDownload = null;
    });

  activeDownload = download;
  return { status: 'downloading', percent: 0 };
}
