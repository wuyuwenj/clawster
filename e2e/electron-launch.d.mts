import type { ElectronApplication, Page } from 'playwright';

export declare const AUDIO_SAFE_ARGS: string[];

export declare function findWindow(
  app: ElectronApplication,
  substr: string,
  timeout?: number,
): Promise<Page>;
