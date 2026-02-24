import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const WatchStep: React.FC<Props> = ({ data, updateData }) => {
  return (
    <div className="h-full px-8 pt-8">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Watch Preferences</h2>
      <p className="text-sm text-neutral-400 mb-8">
        Configure what Clawster can see while you work.
      </p>

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
                onChange={(e) => updateData({ watchActiveApp: e.target.checked })}
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
                onChange={(e) => updateData({ watchWindowTitles: e.target.checked })}
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
