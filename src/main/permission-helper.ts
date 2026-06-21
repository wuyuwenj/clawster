import { systemPreferences, shell, dialog, BrowserWindow } from 'electron';

export type PermissionType = 'accessibility' | 'screen-recording' | 'microphone';

const SETTINGS_URLS: Record<PermissionType, string> = {
  'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

const PERMISSION_INFO: Record<PermissionType, { title: string; why: string; how: string }> = {
  'accessibility': {
    title: 'Accessibility Permission Needed',
    why: 'Clawster needs Accessibility permission to close apps, hide distracting apps during focus mode, adjust brightness, and see which app you\'re using.',
    how: 'Click "Open Settings" below, then toggle Clawster ON in the list.',
  },
  'screen-recording': {
    title: 'Screen Recording Permission Needed',
    why: 'Clawster needs Screen Recording permission to see what\'s on your screen and help you with it.',
    how: 'Click "Open Settings" below, then toggle Clawster ON in the list. You may need to restart Clawster after.',
  },
  'microphone': {
    title: 'Microphone Permission Needed',
    why: 'Clawster needs microphone access for voice input so you can talk to your pet.',
    how: 'Click "Allow" when the system prompt appears.',
  },
};

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

export async function requestPermission(type: PermissionType): Promise<boolean> {
  if (checkPermission(type)) return true;

  if (type === 'microphone') {
    return systemPreferences.askForMediaAccess('microphone');
  }

  // Accessibility and Screen Recording can't be auto-granted —
  // show a dialog that opens System Settings to the right pane
  const info = PERMISSION_INFO[type];
  const parent = BrowserWindow.getFocusedWindow();

  const opts: Electron.MessageBoxOptions = {
    type: 'info',
    title: info.title,
    message: info.why,
    detail: info.how,
    buttons: ['Open Settings', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  };

  const result = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);

  if (result.response === 0) {
    shell.openExternal(SETTINGS_URLS[type]);
  }

  // Poll for up to 30 seconds to see if the user granted it
  if (result.response === 0) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (checkPermission(type)) {
        console.log(`[Permission] ${type} granted by user`);
        return true;
      }
    }
  }

  return checkPermission(type);
}

export function getRequiredPermission(tool: string): PermissionType | null {
  switch (tool) {
    case 'close_app':
    case 'block_apps':
      return 'accessibility';
    case 'system_control':
      return 'accessibility';
    case 'take_screenshot':
      return 'screen-recording';
    default:
      return null;
  }
}
