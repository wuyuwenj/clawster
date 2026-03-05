import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { systemPreferences } from 'electron';
import type Store from 'electron-store';
import type { StoreSchema } from './store';
import { getFrontmostWindowTitleFromSystemEvents } from './window-title';

export interface ActivityEvent {
  type: 'app_focus_changed' | 'file_added' | 'file_changed' | 'file_deleted';
  app?: string;
  title?: string;
  path?: string;
  filename?: string;
  at: number;
}

type EventCallback = (event: ActivityEvent) => void;

export class Watchers {
  private store: Store<StoreSchema>;
  private onEvent: EventCallback;
  private fileWatcher: FSWatcher | null = null;
  private appWatcherInterval: NodeJS.Timeout | null = null;
  private lastActiveApp: string | null = null;
  private hasLoggedScreenRecordingWarning = false;

  constructor(store: Store<StoreSchema>, onEvent: EventCallback) {
    this.store = store;
    this.onEvent = onEvent;
  }

  async start() {
    await this.startAppWatcher();
    this.startFileWatcher();
  }

  stop() {
    this.stopAppWatcher();
    this.stopFileWatcher();
  }

  restart() {
    this.stop();
    this.start();
  }

  private async startAppWatcher() {
    const watchActiveApp = this.store.get('watch.activeApp') as boolean;
    if (!watchActiveApp) return;

    // Check accessibility permission first - don't start if not granted
    // This prevents spamming the user with permission prompts
    if (process.platform === 'darwin') {
      const hasPermission = systemPreferences.isTrustedAccessibilityClient(false);
      if (!hasPermission) {
        console.log('[Watchers] Accessibility permission not granted, skipping app watcher');
        return;
      }
    }

    // Dynamic import for ESM module
    const activeWin = await import('active-win');

    this.appWatcherInterval = setInterval(async () => {
      try {
        const sendTitles = this.store.get('watch.sendWindowTitles') as boolean;
        let screenRecordingDenied = false;

        let win: Awaited<ReturnType<typeof activeWin.default>> | undefined;
        try {
          win = await activeWin.default({
            accessibilityPermission: true,
            screenRecordingPermission: sendTitles,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const requiresScreenRecording = message.toLowerCase().includes('screen recording');
          if (requiresScreenRecording && sendTitles) {
            screenRecordingDenied = true;
            if (!this.hasLoggedScreenRecordingWarning) {
              console.warn('[Watchers] Screen Recording permission not granted. App watcher will continue without window titles.');
              this.hasLoggedScreenRecordingWarning = true;
            }
            win = await activeWin.default({
              accessibilityPermission: true,
              screenRecordingPermission: false,
            });
          } else {
            throw error;
          }
        }

        if (win && win.owner.name !== this.lastActiveApp) {
          let title = sendTitles ? win.title || undefined : undefined;
          if (sendTitles && screenRecordingDenied && !title) {
            title = await getFrontmostWindowTitleFromSystemEvents(win.owner.name);
          }

          this.onEvent({
            type: 'app_focus_changed',
            app: win.owner.name,
            title,
            at: Date.now(),
          });

          this.lastActiveApp = win.owner.name;
        }
      } catch (error) {
        console.error('App watcher error:', error);
      }
    }, 2000);
  }

  private stopAppWatcher() {
    if (this.appWatcherInterval) {
      clearInterval(this.appWatcherInterval);
      this.appWatcherInterval = null;
    }
  }

  private startFileWatcher() {
    const folders = this.store.get('watch.folders') as string[];
    if (!folders || folders.length === 0) return;

    this.fileWatcher = chokidar.watch(folders, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 10,
    });

    this.fileWatcher
      .on('add', (filePath) => this.emitFileEvent('file_added', filePath))
      .on('change', (filePath) => this.emitFileEvent('file_changed', filePath))
      .on('unlink', (filePath) => this.emitFileEvent('file_deleted', filePath));
  }

  private stopFileWatcher() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  private emitFileEvent(type: 'file_added' | 'file_changed' | 'file_deleted', filePath: string) {
    this.onEvent({
      type,
      path: filePath,
      filename: path.basename(filePath),
      at: Date.now(),
    });
  }
}
