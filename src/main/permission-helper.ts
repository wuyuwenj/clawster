import { systemPreferences, shell } from 'electron';

export type PermissionType = 'accessibility' | 'screen-recording' | 'microphone';
export type PermissionStatus = 'granted' | 'needs-permission' | 'restricted' | 'waiting';

const SETTINGS_URLS: Record<PermissionType, string> = {
  'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

export const PERMISSION_INFO: Record<PermissionType, {
  title: string;
  why: string;
  reassurance: string;
  unlocks: string[];
  instructions: string;
  needsRestart: boolean;
}> = {
  'accessibility': {
    title: 'Accessibility',
    why: 'Clawster needs Accessibility access to close apps, hide distracting apps, and adjust brightness.',
    reassurance: 'It does not read your screen contents.',
    unlocks: [
      'Close & quit apps',
      'Focus mode — hide distracting apps',
      'Brightness control',
      'See which app you\'re using',
    ],
    instructions: 'Open System Settings → Privacy & Security → Accessibility. Turn on the switch next to Clawster.',
    needsRestart: false,
  },
  'screen-recording': {
    title: 'Screen Recording',
    why: 'Clawster needs Screen Recording to see what\'s on your screen and help you with it.',
    reassurance: 'It does not record or save your screen.',
    unlocks: [
      'Screenshot analysis',
      'Screen context awareness',
    ],
    instructions: 'Open System Settings → Privacy & Security → Screen Recording. Turn on the switch next to Clawster.',
    needsRestart: true,
  },
  'microphone': {
    title: 'Microphone',
    why: 'Clawster needs microphone access for voice input.',
    reassurance: 'Audio is processed locally and never stored.',
    unlocks: ['Talk to your pet with your voice'],
    instructions: 'Click Allow when the system prompt appears.',
    needsRestart: false,
  },
};

// Polling state
const activePollers: Map<PermissionType, ReturnType<typeof setInterval>> = new Map();
let storeRef: any = null;

export function setPermissionStore(store: any): void {
  storeRef = store;
}

export function checkPermission(type: PermissionType): boolean {
  try {
    switch (type) {
      case 'accessibility':
        return systemPreferences.isTrustedAccessibilityClient(false);
      case 'screen-recording':
        return systemPreferences.getMediaAccessStatus('screen') === 'granted';
      case 'microphone':
        return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
    }
  } catch {
    return true;
  }
}

export function getPermissionStatus(type: PermissionType): PermissionStatus {
  try {
    if (type === 'accessibility') {
      return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'needs-permission';
    }
    const status = systemPreferences.getMediaAccessStatus(
      type === 'screen-recording' ? 'screen' : type
    );
    if (status === 'granted') return 'granted';
    if (status === 'restricted') return 'restricted';
    return 'needs-permission';
  } catch {
    return 'granted';
  }
}

export function getAllPermissionStatuses(): Record<PermissionType, PermissionStatus> {
  return {
    'accessibility': getPermissionStatus('accessibility'),
    'screen-recording': getPermissionStatus('screen-recording'),
    'microphone': getPermissionStatus('microphone'),
  };
}

export async function requestPermission(type: PermissionType): Promise<boolean> {
  if (checkPermission(type)) return true;

  if (type === 'microphone') {
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return true;
    }
  }

  // Accessibility and Screen Recording: open the exact System Settings pane
  shell.openExternal(SETTINGS_URLS[type]);
  return false;
}

export function openPermissionSettings(type: PermissionType): void {
  shell.openExternal(SETTINGS_URLS[type]);
}

export function startPolling(type: PermissionType, onGranted: () => void): void {
  stopPolling(type);
  const timer = setInterval(() => {
    if (checkPermission(type)) {
      stopPolling(type);
      console.log(`[Permission] ${type} granted (detected by poll)`);
      try { require('./analytics').trackPermissionRequested({ permission: type, granted: true }); } catch {}
      onGranted();
    }
  }, 1500);
  activePollers.set(type, timer);
}

export function stopPolling(type: PermissionType): void {
  const timer = activePollers.get(type);
  if (timer) {
    clearInterval(timer);
    activePollers.delete(type);
  }
}

export function stopAllPolling(): void {
  for (const [type] of activePollers) {
    stopPolling(type);
  }
}

export function getRequiredPermission(tool: string, args?: Record<string, unknown>): PermissionType | null {
  switch (tool) {
    case 'close_app':
    case 'block_apps':
      return 'accessibility';
    case 'system_control': {
      const action = String(args?.action || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (['battery', 'volume_up', 'volume_down', 'mute', 'unmute', 'set_volume'].includes(action)) return null;
      return 'accessibility';
    }
    case 'take_screenshot':
      return 'screen-recording';
    default:
      return null;
  }
}

export function getDegradedMessage(type: PermissionType): string {
  const info = PERMISSION_INFO[type];
  const features = info.unlocks.slice(0, 2).join(' and ');
  return `I need ${info.title} permission for that! It lets me do ${features}. Say "Open Settings" and I'll take you there.`;
}

export function needsRestart(type: PermissionType): boolean {
  return PERMISSION_INFO[type].needsRestart;
}
