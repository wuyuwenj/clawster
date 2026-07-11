import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  WHISPER_MODEL,
  MIN_MACOS_VERSION,
  deleteWhisperModel,
  verifyCachedWhisperModel,
  downloadModel,
  downloadPercent,
  ensureWhisperModel,
  fileSha256,
  formatVoiceSetupMessage,
  isWhisperModelInstalled,
  isWhisperSupportedMacOS,
  resetWhisperModelState,
  whisperModelDir,
  whisperModelPath,
} from '../src/main/whisper-model';

let dataDir: string;
const originalDataDir = process.env.CLAWSTER_DATA_DIR;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-whisper-'));
  process.env.CLAWSTER_DATA_DIR = dataDir;
  resetWhisperModelState();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.CLAWSTER_DATA_DIR;
  else process.env.CLAWSTER_DATA_DIR = originalDataDir;
  vi.unstubAllGlobals();
});

/** Writes a sparse file of the exact model size without allocating 148 MB. */
function writeSparseModel(size = WHISPER_MODEL.bytes): void {
  fs.mkdirSync(whisperModelDir(), { recursive: true });
  fs.closeSync(fs.openSync(whisperModelPath(), 'w'));
  fs.truncateSync(whisperModelPath(), size);
}

function fakeResponse(body: Buffer, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ 'content-length': String(body.length) }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(body));
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe('model paths', () => {
  it('caches the model under the Clawster data directory', () => {
    expect(whisperModelDir()).toBe(path.join(dataDir, 'models', 'whisper'));
    expect(whisperModelPath()).toBe(path.join(dataDir, 'models', 'whisper', 'ggml-base.en.bin'));
  });

  it('follows CLAWSTER_DATA_DIR so tests never touch real user data', () => {
    process.env.CLAWSTER_DATA_DIR = '/tmp/somewhere-else';
    expect(whisperModelPath()).toBe('/tmp/somewhere-else/models/whisper/ggml-base.en.bin');
  });
});

describe('isWhisperModelInstalled', () => {
  it('is false when the model is absent', () => {
    expect(isWhisperModelInstalled()).toBe(false);
  });

  it('is false for a truncated download', () => {
    writeSparseModel(WHISPER_MODEL.bytes - 1);
    expect(isWhisperModelInstalled()).toBe(false);
  });

  it('is true at the exact expected size', () => {
    writeSparseModel();
    expect(isWhisperModelInstalled()).toBe(true);
  });
});

describe('isWhisperSupportedMacOS', () => {
  it('accepts the minimum version and newer', () => {
    expect(isWhisperSupportedMacOS(MIN_MACOS_VERSION)).toBe(true);
    expect(isWhisperSupportedMacOS('13.3.1')).toBe(true);
    expect(isWhisperSupportedMacOS('14.0')).toBe(true);
    expect(isWhisperSupportedMacOS('26.1.0')).toBe(true);
  });

  it('rejects anything older than whisper.framework supports', () => {
    expect(isWhisperSupportedMacOS('13.2.1')).toBe(false);
    expect(isWhisperSupportedMacOS('12.7.6')).toBe(false);
    expect(isWhisperSupportedMacOS('11.0')).toBe(false);
  });
});

describe('downloadPercent', () => {
  it('floors progress into 0-100', () => {
    expect(downloadPercent(0, 200)).toBe(0);
    expect(downloadPercent(99, 200)).toBe(49);
    expect(downloadPercent(200, 200)).toBe(100);
  });

  it('clamps overshoot and guards a missing total', () => {
    expect(downloadPercent(300, 200)).toBe(100);
    expect(downloadPercent(50, 0)).toBe(0);
  });
});

describe('formatVoiceSetupMessage', () => {
  it('tells the user setup is one-time and shows progress', () => {
    const message = formatVoiceSetupMessage(42);
    expect(message).toContain('42%');
    expect(message).toContain('once');
  });
});

describe('downloadModel', () => {
  const body = Buffer.from('pretend ggml weights');
  const spec = {
    name: 'test-model.bin',
    url: 'https://example.invalid/test-model.bin',
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
  };

  it('writes the model and reports progress', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    const progress: number[] = [];

    const result = await downloadModel(spec, dataDir, (p) => progress.push(p));

    expect(result).toBe(path.join(dataDir, 'test-model.bin'));
    expect(fs.readFileSync(result)).toEqual(body);
    expect(progress.at(-1)).toBe(100);
  });

  it('rejects a corrupt download and leaves no partial file behind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(Buffer.from('corrupted'))));

    await expect(downloadModel(spec, dataDir)).rejects.toThrow(/checksum/i);
    expect(fs.existsSync(path.join(dataDir, 'test-model.bin'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'test-model.bin.part'))).toBe(false);
  });

  it('surfaces an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body, { ok: false, status: 404 })));
    await expect(downloadModel(spec, dataDir)).rejects.toThrow(/404/);
  });

  it('gives up when the server never responds', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));

    await expect(
      downloadModel(spec, dataDir, () => {}, { connectMs: 10, stallMs: 10_000 })
    ).rejects.toThrow(/stalled/i);
  });

  it('gives up when the transfer goes quiet mid-download, leaving no partial file', async () => {
    // A body that yields one chunk and then never another.
    const stalled = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '9999' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(body));
        },
      }),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => stalled));

    await expect(
      downloadModel(spec, dataDir, () => {}, { connectMs: 10_000, stallMs: 20 })
    ).rejects.toThrow(/stalled/i);
    expect(fs.existsSync(path.join(dataDir, 'test-model.bin.part'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'test-model.bin'))).toBe(false);
  });
});

describe('deleteWhisperModel', () => {
  it('removes a cached model so the next attempt re-downloads', () => {
    writeSparseModel();
    expect(isWhisperModelInstalled()).toBe(true);

    deleteWhisperModel();

    expect(isWhisperModelInstalled()).toBe(false);
  });

  it('is a no-op when nothing is cached', () => {
    expect(() => deleteWhisperModel()).not.toThrow();
  });
});

describe('verifyCachedWhisperModel', () => {
  const body = Buffer.from('pretend ggml weights');
  const spec = {
    name: 'test-model.bin',
    url: 'https://example.invalid/test-model.bin',
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
  };
  const modelPath = () => path.join(dataDir, spec.name);

  it('deletes a model whose bytes no longer match the checksum', async () => {
    fs.writeFileSync(modelPath(), 'corrupted in place');

    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('corrupt');
    expect(fs.existsSync(modelPath())).toBe(false);
  });

  it('keeps a healthy model, so an environmental failure cannot loop re-downloading', async () => {
    fs.writeFileSync(modelPath(), body);

    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('unrecoverable');
    expect(fs.existsSync(modelPath())).toBe(true);
  });

  it('reports a missing model as absent rather than as an unusable machine', async () => {
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('absent');
  });

  it('shares one pass between overlapping callers rather than hashing twice', async () => {
    fs.writeFileSync(modelPath(), body);

    const first = verifyCachedWhisperModel(spec, modelPath());
    const second = verifyCachedWhisperModel(spec, modelPath());

    expect(second).toBe(first);
    await expect(first).resolves.toBe('unrecoverable');
  });

  it('reports unrecoverable instead of rejecting when the model cannot be removed', async () => {
    const lockedDir = path.join(dataDir, 'locked');
    const lockedModel = path.join(lockedDir, spec.name);
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(lockedModel, 'corrupted in place');
    fs.chmodSync(lockedDir, 0o555);

    try {
      await expect(verifyCachedWhisperModel(spec, lockedModel)).resolves.toBe('unrecoverable');
      expect(fs.existsSync(lockedModel)).toBe(true);
    } finally {
      fs.chmodSync(lockedDir, 0o755);
    }
  });

  it('remembers an unrecoverable verdict rather than re-hashing 148 MB per mic press', async () => {
    fs.writeFileSync(modelPath(), body);
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('unrecoverable');

    // A second hashing pass over a now-missing file would report `absent`, so an
    // unchanged verdict proves the bytes were not read again.
    fs.rmSync(modelPath());
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('unrecoverable');
  });

  it('forgets an unrecoverable verdict once the model is deleted through deleteWhisperModel', async () => {
    fs.writeFileSync(modelPath(), body);
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('unrecoverable');

    deleteWhisperModel(modelPath());

    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('absent');
  });

  it('forgets an unrecoverable verdict once the model is re-downloaded', async () => {
    fs.writeFileSync(modelPath(), body);
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('unrecoverable');

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(body)));
    await downloadModel(spec, dataDir);

    fs.writeFileSync(modelPath(), 'corrupted in place');
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('corrupt');
  });

  it('does not memoize a corrupt model that resisted deletion, so a later press can retry', async () => {
    const lockedDir = path.join(dataDir, 'stuck');
    const lockedModel = path.join(lockedDir, spec.name);
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(lockedModel, 'corrupted in place');
    fs.chmodSync(lockedDir, 0o555);

    try {
      await expect(verifyCachedWhisperModel(spec, lockedModel)).resolves.toBe('unrecoverable');
    } finally {
      fs.chmodSync(lockedDir, 0o755);
    }

    await expect(verifyCachedWhisperModel(spec, lockedModel)).resolves.toBe('corrupt');
    expect(fs.existsSync(lockedModel)).toBe(false);
  });

  it('retries on a later call once an earlier pass has settled', async () => {
    fs.writeFileSync(modelPath(), 'corrupted in place');
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('corrupt');

    fs.writeFileSync(modelPath(), 'corrupted again');
    await expect(verifyCachedWhisperModel(spec, modelPath())).resolves.toBe('corrupt');
    expect(fs.existsSync(modelPath())).toBe(false);
  });
});

describe('fileSha256', () => {
  it('hashes file contents', async () => {
    const target = path.join(dataDir, 'blob');
    fs.writeFileSync(target, 'abc');
    expect(await fileSha256(target)).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});

describe('ensureWhisperModel', () => {
  it('reports ready without touching the network when the model is cached', () => {
    writeSparseModel();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(ensureWhisperModel()).toEqual({ status: 'ready', modelPath: whisperModelPath() });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('withholds ready while a corruption check may still unlink the model', async () => {
    writeSparseModel();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // The sparse bytes cannot match the real checksum, so this pass deletes them.
    const verification = verifyCachedWhisperModel();

    expect(ensureWhisperModel()).toEqual({ status: 'downloading', percent: 0 });

    await expect(verification).resolves.toBe('corrupt');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never shows the setting-up state again once the cached model is known unusable', async () => {
    writeSparseModel();
    const intact = { ...WHISPER_MODEL, sha256: await fileSha256(whisperModelPath()) };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verifyCachedWhisperModel(intact, whisperModelPath())).resolves.toBe('unrecoverable');

    // The second press answers from memory, so no verification is in flight to hide
    // `ready` behind a "Setting up voice…" message that promises a download.
    const second = verifyCachedWhisperModel(intact, whisperModelPath());
    expect(ensureWhisperModel()).toEqual({ status: 'ready', modelPath: whisperModelPath() });
    await expect(second).resolves.toBe('unrecoverable');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(whisperModelPath())).toBe(true);
  });

  it('starts a background download and reports progress instead of blocking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(Buffer.from('too small'))));

    expect(ensureWhisperModel()).toEqual({ status: 'downloading', percent: 0 });

    // A second press while the download runs must not start another one.
    expect(ensureWhisperModel().status).toBe('downloading');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed download once, then retries on the next attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network is down');
    }));

    expect(ensureWhisperModel().status).toBe('downloading');
    await vi.waitFor(() => expect(ensureWhisperModel()).toEqual({
      status: 'error',
      message: 'network is down',
    }));

    // The error is consumed, so the next mic press kicks off a fresh attempt.
    expect(ensureWhisperModel().status).toBe('downloading');
  });
});
