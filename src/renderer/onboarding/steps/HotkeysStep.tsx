import type { OnboardingData } from '../Onboarding';
import { HotkeyInput } from '../../components/HotkeyInput';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

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
