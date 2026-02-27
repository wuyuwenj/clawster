import { useState } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const WatchStep: React.FC<Props> = ({ data, updateData }) => {
  const [showPermissionHint, setShowPermissionHint] = useState(false);

  const handleWatchActiveAppChange = async (enabled: boolean) => {
    if (enabled) {
      // Open System Settings for accessibility and enable the toggle
      // Note: Permission detection is unreliable in Electron, so we just
      // enable the toggle and let the watcher check permission at runtime
      await window.clawster.checkAccessibilityPermission(true);
      setShowPermissionHint(true);
      updateData({ watchActiveApp: true });
    } else {
      updateData({ watchActiveApp: false });
      setShowPermissionHint(false);
    }
  };

  const handleWatchWindowTitlesChange = async (enabled: boolean) => {
    if (enabled && !data.watchActiveApp) {
      // Also enable active app watching
      await window.clawster.checkAccessibilityPermission(true);
      setShowPermissionHint(true);
      updateData({ watchActiveApp: true, watchWindowTitles: true });
    } else {
      updateData({ watchWindowTitles: enabled });
    }
  };

  return (
    <div className="h-full px-8 pt-8">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Watch Preferences</h2>
      <p className="text-sm text-neutral-400 mb-6">
        Configure what Clawster can see while you work.
      </p>

      {/* Permission notice */}
      <div className="bg-neutral-900/50 border border-white/5 rounded-lg p-3 mb-6">
        <div className="flex items-start gap-2">
          <iconify-icon icon="solar:shield-warning-linear" width="1rem" className="text-amber-500 mt-0.5 flex-shrink-0"></iconify-icon>
          <div className="text-xs text-neutral-400">
            These features require <span className="text-neutral-200">Accessibility permission</span>.
            System Settings will open when you enable a feature.
          </div>
        </div>
      </div>

      {showPermissionHint && (
        <div className="bg-green-950/30 border border-green-500/20 rounded-lg p-3 mb-6">
          <div className="flex items-start gap-2">
            <iconify-icon icon="solar:check-circle-linear" width="1rem" className="text-green-400 mt-0.5 flex-shrink-0"></iconify-icon>
            <div className="text-xs text-green-300">
              Feature enabled! Make sure Clawster is turned on in the Accessibility settings that just opened.
            </div>
          </div>
        </div>
      )}


      <div className="space-y-6">
        {/* Toggle 1: Watch Active Application */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-neutral-200">Watch Active Application</div>
            <div className="text-xs text-neutral-500 mt-0.5">Know which app you're currently using</div>
          </div>
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={data.watchActiveApp}
                onChange={(e) => handleWatchActiveAppChange(e.target.checked)}
              />
              <div className="w-9 h-5 bg-neutral-800 rounded-full peer peer-checked:bg-[#FF8C69] transition-colors border border-white/5" />
              <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm" />
            </div>
          </label>
        </div>

        {/* Toggle 2: Send Window Titles */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-neutral-200">Send Window Titles</div>
            <div className="text-xs text-neutral-500 mt-0.5">Share window titles for context</div>
          </div>
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={data.watchWindowTitles}
                onChange={(e) => handleWatchWindowTitlesChange(e.target.checked)}
              />
              <div className="w-9 h-5 bg-neutral-800 rounded-full peer peer-checked:bg-[#FF8C69] transition-colors border border-white/5" />
              <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm" />
            </div>
          </label>
        </div>

      </div>
    </div>
  );
};
