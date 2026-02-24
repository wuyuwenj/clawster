import { useState } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

type Tab = 'identity' | 'soul';

export const PersonalityStep: React.FC<Props> = ({ data, updateData }) => {
  const [activeTab, setActiveTab] = useState<Tab>('identity');

  return (
    <div className="h-full px-8 pt-8 flex flex-col">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Customize Personality</h2>
      <p className="text-sm text-neutral-400 mb-6">Edit these files to give Clawster a unique persona.</p>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-white/10 mb-4">
        <button
          onClick={() => setActiveTab('identity')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'identity'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 hover:text-neutral-300 border-transparent'
          }`}
        >
          IDENTITY.md
        </button>
        <button
          onClick={() => setActiveTab('soul')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'soul'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 hover:text-neutral-300 border-transparent'
          }`}
        >
          SOUL.md
        </button>
      </div>

      {/* Identity Editor */}
      {activeTab === 'identity' && (
        <div className="flex-1 flex flex-col min-h-0">
          <p className="text-xs text-neutral-500 mb-2">Who am I? Name, appearance, capabilities.</p>
          <textarea
            value={data.identity}
            onChange={(e) => updateData({ identity: e.target.value })}
            className="flex-1 w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-4 font-mono text-xs leading-relaxed text-neutral-300 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/20 resize-none scrollbar-hide"
            placeholder="# Identity
Name: Clawster
Type: Desktop Assistant

You are a helpful, slightly enthusiastic desktop companion..."
          />
        </div>
      )}

      {/* Soul Editor */}
      {activeTab === 'soul' && (
        <div className="flex-1 flex flex-col min-h-0">
          <p className="text-xs text-neutral-500 mb-2">How do I behave? Communication style.</p>
          <textarea
            value={data.soul}
            onChange={(e) => updateData({ soul: e.target.value })}
            className="flex-1 w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-4 font-mono text-xs leading-relaxed text-neutral-300 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/20 resize-none scrollbar-hide"
            placeholder="# Rules
1. Be concise but friendly.
2. If you don't know something, admit it.
3. Use emojis sparingly..."
          />
        </div>
      )}
    </div>
  );
};
