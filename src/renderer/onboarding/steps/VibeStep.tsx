import type { OnboardingData } from '../Onboarding';
import { PERSONALITY_PRESETS } from '../../personality-presets';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const VibeStep: React.FC<Props> = ({ data, updateData }) => {
  const selected = data.personalityPreset;

  return (
    <div className="h-full px-8 pt-8 flex flex-col">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Pick Your Vibe</h2>
      <p className="text-sm text-neutral-400 mb-6">
        How should Clawster act? Tap one — you can change it anytime in Settings.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {PERSONALITY_PRESETS.map((preset) => {
          const active = selected === preset.id;
          return (
            <button
              key={preset.id}
              data-preset={preset.id}
              onClick={() => updateData({ personalityPreset: preset.id })}
              className={`text-left rounded-xl p-4 border transition-all ${
                active
                  ? 'border-[#FF8C69] bg-[#FF8C69]/10 shadow-[0_0_15px_rgba(255,140,105,0.15)]'
                  : 'border-white/10 bg-neutral-900/50 hover:border-white/20 hover:bg-neutral-900'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl leading-none">{preset.emoji}</span>
                {active && (
                  <iconify-icon icon="solar:check-circle-bold" className="text-[#FF8C69]" width="1.1rem"></iconify-icon>
                )}
              </div>
              <div className={`text-sm font-semibold mb-1 ${active ? 'text-[#FF8C69]' : 'text-neutral-100'}`}>
                {preset.label}
              </div>
              <div className="text-xs text-neutral-500 leading-snug">{preset.blurb}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
