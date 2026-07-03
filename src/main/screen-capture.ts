import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

// Constants (injected from main via init)
let PET_CAMERA_SNAP_CAPTURE_DELAY_MS = 560;
let PET_CAMERA_SNAP_DURATION_MS = 920;
let PET_CAMERA_SNAP_FLASH_DURATION_MS = 120;

// Dependencies
let getPetWindow: () => BrowserWindow | null = () => null;
let getIsSleeping: () => boolean = () => false;

export function initScreenCapture(deps: {
  getPetWindow: () => BrowserWindow | null;
  getIsSleeping: () => boolean;
  cameraSnapCaptureDelayMs?: number;
  cameraSnapDurationMs?: number;
  cameraSnapFlashDurationMs?: number;
}): void {
  getPetWindow = deps.getPetWindow;
  getIsSleeping = deps.getIsSleeping;
  if (deps.cameraSnapCaptureDelayMs !== undefined) PET_CAMERA_SNAP_CAPTURE_DELAY_MS = deps.cameraSnapCaptureDelayMs;
  if (deps.cameraSnapDurationMs !== undefined) PET_CAMERA_SNAP_DURATION_MS = deps.cameraSnapDurationMs;
  if (deps.cameraSnapFlashDurationMs !== undefined) PET_CAMERA_SNAP_FLASH_DURATION_MS = deps.cameraSnapFlashDurationMs;
}

// Get screen recording permission status on macOS
export function getScreenCapturePermissionStatus(): string {
  if (process.platform !== 'darwin') {
    return 'granted';
  }
  return systemPreferences.getMediaAccessStatus('screen');
}

// Get current screen context for ClawBot
export async function getScreenContext(): Promise<{
  cursor: { x: number; y: number };
  petPosition: { x: number; y: number };
  screenSize: { width: number; height: number };
  screenshot?: string;
}> {
  const cursor = screen.getCursorScreenPoint();
  const petWindow = getPetWindow();
  const [petX, petY] = petWindow?.getPosition() ?? [0, 0];
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  return {
    cursor,
    petPosition: { x: petX, y: petY },
    screenSize: { width, height },
  };
}

export async function playPetCameraSnapAnimationBeforeCapture(): Promise<void> {
  const petWindow = getPetWindow();
  if (!petWindow || petWindow.isDestroyed() || getIsSleeping()) return;

  petWindow.webContents.send('pet-camera-snap', {
    captureAtMs: PET_CAMERA_SNAP_CAPTURE_DELAY_MS,
    durationMs: PET_CAMERA_SNAP_DURATION_MS,
    flashDurationMs: PET_CAMERA_SNAP_FLASH_DURATION_MS,
  });

  await new Promise((resolve) => setTimeout(resolve, PET_CAMERA_SNAP_CAPTURE_DELAY_MS));
}

// Native macOS screen capture using screencapture command (much faster than desktopCapturer)
export async function captureScreenNative(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return captureScreenFallback();
  }

  const permissionStatus = getScreenCapturePermissionStatus();
  if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
    console.log('[ScreenCapture] Permission denied — enable in System Preferences > Privacy & Security > Screen Recording');
    return null;
  }

  const tempPath = path.join(os.tmpdir(), `clawster-screenshot-${Date.now()}.jpg`);

  try {
    execSync(`screencapture -x -C -t jpg "${tempPath}"`, {
      timeout: 5000,
      windowsHide: true,
    });

    const imageBuffer = fs.readFileSync(tempPath);
    const base64 = imageBuffer.toString('base64');

    fs.unlinkSync(tempPath);

    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('[ScreenCapture] Native capture failed:', error);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    return captureScreenFallback();
  }
}

// Fallback capture using desktopCapturer (slower, used on non-macOS)
export async function captureScreenFallback(): Promise<string | null> {
  try {
    const permissionStatus = getScreenCapturePermissionStatus();

    if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
      console.log('[ScreenCapture] Permission denied — enable in System Preferences > Privacy & Security > Screen Recording');
      return null;
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail;
      return screenshot.toDataURL();
    }
    return null;
  } catch (error) {
    console.error('Fallback screen capture failed:', error);
    return null;
  }
}

// Capture screen with cursor position overlay info
export async function captureScreenWithContext(): Promise<{
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
} | null> {
  try {
    const image = await captureScreenNative();

    if (image) {
      const cursor = screen.getCursorScreenPoint();
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      return {
        image,
        cursor,
        screenSize: { width, height },
      };
    }
    return null;
  } catch (error) {
    console.error('Screen capture failed:', error);
    return null;
  }
}

// Screen capture - uses native capture for speed
export async function captureScreen(): Promise<string | null> {
  return captureScreenNative();
}
