import { useState } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

interface HotkeyInputProps {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}

const HotkeyInput: React.FC<HotkeyInputProps> = ({ label, description, value, onChange }) => {
  const [isRecording, setIsRecording] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];

    // Build modifier string
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    // Add the actual key (ignore modifier-only presses)
    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      // Normalize key names
      let normalizedKey = key;
      if (key === ' ') normalizedKey = 'Space';
      else if (key.length === 1) normalizedKey = key.toUpperCase();
      else if (key === 'ArrowUp') normalizedKey = 'Up';
      else if (key === 'ArrowDown') normalizedKey = 'Down';
      else if (key === 'ArrowLeft') normalizedKey = 'Left';
      else if (key === 'ArrowRight') normalizedKey = 'Right';

      parts.push(normalizedKey);

      onChange(parts.join('+'));
      setIsRecording(false);
    }
  };

  const formatHotkey = (hotkey: string) => {
    return hotkey
      .replace('CommandOrControl', '⌘')
      .replace('Shift', '⇧')
      .replace('Alt', '⌥')
      .replace('Space', 'Space')
      .replace(/\+/g, ' + ');
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm font-medium text-neutral-200">{label}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{description}</div>
      </div>
      <button
        onKeyDown={handleKeyDown}
        onClick={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        className={`px-3 py-2 rounded-lg text-sm font-mono transition-all min-w-[140px] text-center ${
          isRecording
            ? 'bg-[#FF8C69]/20 border border-[#FF8C69] text-[#FF8C69] animate-pulse'
            : 'bg-neutral-900 border border-white/10 text-neutral-300 hover:border-white/20'
        }`}
      >
        {isRecording ? 'Press keys...' : formatHotkey(value)}
      </button>
    </div>
  );
};

export const HotkeysStep: React.FC<Props> = ({ data, updateData }) => {
  return (
    <div className="h-full px-8 pt-8">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Keyboard Shortcuts</h2>
      <p className="text-sm text-neutral-400 mb-6">
        Customize hotkeys to quickly access Clawster.
      </p>

      <div className="space-y-1 divide-y divide-white/5">
        <HotkeyInput
          label="Open Chat"
          description="Summon the quick chat bar"
          value={data.hotkeyOpenChat}
          onChange={(value) => updateData({ hotkeyOpenChat: value })}
        />
        <HotkeyInput
          label="Capture Screen"
          description="Take a screenshot and ask about it"
          value={data.hotkeyCaptureScreen}
          onChange={(value) => updateData({ hotkeyCaptureScreen: value })}
        />
        <HotkeyInput
          label="Open Assistant"
          description="Open the full assistant panel"
          value={data.hotkeyOpenAssistant}
          onChange={(value) => updateData({ hotkeyOpenAssistant: value })}
        />
      </div>

      <div className="mt-6 px-3 py-2 bg-neutral-900/50 border border-white/5 rounded-lg">
        <p className="text-xs text-neutral-500">
          <iconify-icon icon="solar:info-circle-linear" width="0.875rem" className="inline mr-1.5 align-text-bottom"></iconify-icon>
          Click on a shortcut and press your desired key combination to change it.
        </p>
      </div>
    </div>
  );
};
