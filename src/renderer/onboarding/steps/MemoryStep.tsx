import { useState, useEffect } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const MemoryStep: React.FC<Props> = ({ data, updateData }) => {
  const [hasExistingMemory, setHasExistingMemory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkMemory = async () => {
      try {
        const workspace = await window.clawster.readOpenClawWorkspace();
        setHasExistingMemory(workspace.hasMemory);
      } catch (error) {
        console.error('Failed to check memory:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkMemory();
  }, []);

  const handleSelect = (inherit: boolean) => {
    updateData({ migrateMemory: inherit });
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <iconify-icon icon="solar:spinner-linear" width="2rem" className="animate-spin text-neutral-500"></iconify-icon>
        <p className="text-sm text-neutral-500 mt-4">Checking for existing memory...</p>
      </div>
    );
  }

  if (!hasExistingMemory) {
    return (
      <div className="h-full px-8 pt-8">
        <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Starting Fresh</h2>
        <p className="text-sm text-neutral-400 mb-8">
          No existing conversation history was found. Clawster will start with a clean slate.
        </p>

        <div className="flex items-center justify-center p-8 bg-black/20 rounded-xl border border-white/5 border-dashed">
          <div className="text-center">
            <iconify-icon icon="solar:leaf-linear" width="2.5rem" className="text-neutral-600 mb-3"></iconify-icon>
            <p className="text-sm text-neutral-300">Fresh start, no memories.</p>
            <p className="text-xs text-neutral-500 mt-1">Conversations will be saved going forward.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full px-8 pt-8">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Migrate Your Memory?</h2>
      <p className="text-sm text-neutral-400 mb-8">
        We found existing conversation history in your OpenClaw workspace. Would you like to bring it over?
      </p>

      {/* Segmented Control */}
      <div className="bg-neutral-900/50 p-1 rounded-xl flex border border-white/5 mb-8 relative">
        {/* Slider Background */}
        <div
          className="absolute top-1 bottom-1 w-[calc(50%-0.25rem)] bg-neutral-800 rounded-lg shadow-sm border border-white/5 transition-transform duration-300 ease-in-out"
          style={{ transform: data.migrateMemory ? 'translateX(0)' : 'translateX(100%)' }}
        />

        <label className="flex-1 text-center relative z-10 cursor-pointer">
          <input
            type="radio"
            name="memory"
            value="inherit"
            className="peer sr-only"
            checked={data.migrateMemory}
            onChange={() => handleSelect(true)}
          />
          <div className={`py-2.5 text-sm font-medium transition-colors ${data.migrateMemory ? 'text-white' : 'text-neutral-400'}`}>
            Inherit Memory
          </div>
        </label>

        <label className="flex-1 text-center relative z-10 cursor-pointer">
          <input
            type="radio"
            name="memory"
            value="fresh"
            className="peer sr-only"
            checked={!data.migrateMemory}
            onChange={() => handleSelect(false)}
          />
          <div className={`py-2.5 text-sm font-medium transition-colors ${!data.migrateMemory ? 'text-white' : 'text-neutral-400'}`}>
            Start Fresh
          </div>
        </label>
      </div>

      <div className="flex items-center justify-center p-8 bg-black/20 rounded-xl border border-white/5 border-dashed">
        <div className="text-center">
          {data.migrateMemory ? (
            <>
              <iconify-icon icon="solar:book-linear" width="2.5rem" className="text-neutral-600 mb-3"></iconify-icon>
              <p className="text-sm text-neutral-300">Copy conversation history.</p>
              <p className="text-xs text-neutral-500 mt-1">Clawster will remember previous sessions.</p>
            </>
          ) : (
            <>
              <iconify-icon icon="solar:leaf-linear" width="2.5rem" className="text-neutral-600 mb-3"></iconify-icon>
              <p className="text-sm text-neutral-300">Start with a clean slate.</p>
              <p className="text-xs text-neutral-500 mt-1">Old memories stay in OpenClaw workspace.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
