import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

const WavingLobsterSvg = () => (
  <svg width="120" height="120" viewBox="0 0 128 128">
    {/* Tail */}
    <path d="M 50 100 Q 64 125 78 100 Z" fill="#FF8C69" stroke="#C44536" strokeWidth="4" strokeLinejoin="round" />
    {/* Left Claw */}
    <g>
      <path
        d="M 40 55 A 24 24 0 1 1 10 85 Q 20 80 25 75 Q 20 65 30 70 Z"
        fill="#FF8C69"
        stroke="#C44536"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Right Claw — raised, waving */}
    <g style={{ transformOrigin: '88px 55px', animation: 'wave-claw 0.8s ease-in-out infinite' }}>
      <path
        d="M 88 55 A 24 24 0 1 0 118 85 Q 108 80 103 75 Q 108 65 98 70 Z"
        fill="#FF8C69"
        stroke="#C44536"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Body */}
    <g>
      <rect x="34" y="28" width="60" height="75" rx="30" fill="#FF8C69" stroke="#C44536" strokeWidth="4" />
      <path d="M 34 82 Q 64 92 94 82 L 94 88 Q 64 98 34 88 Z" fill="#008080" stroke="#006666" strokeWidth="2" />
      <path d="M 75 85 L 88 108 L 68 102 Z" fill="#008080" stroke="#006666" strokeWidth="2" strokeLinejoin="round" />
      {/* Happy squinting eyes */}
      <path d="M 41 53 Q 48 48 55 53" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
      <path d="M 73 53 Q 80 48 87 53" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
      {/* Big smile */}
      <path d="M 54 65 Q 64 76 74 65" fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
    </g>
    <style>{`@keyframes wave-claw { 0%,100% { transform: rotate(-8deg); } 50% { transform: rotate(18deg); } }`}</style>
  </svg>
);

export const ReadyStep: React.FC<Props> = ({ data, updateData }) => {
  return (
    <div className="h-full px-10 flex flex-col items-center justify-center text-center">
      <div className="mb-5 relative">
        <WavingLobsterSvg />
        <div className="absolute -inset-8 bg-[#FF8C69]/20 blur-2xl -z-10 rounded-full" />
      </div>

      <h2 className="text-3xl font-medium tracking-tight text-[var(--app-text-strong)] mb-2">You're all set!</h2>
      <p className="text-sm text-[var(--app-muted)] mb-6">Say hi — I'm ready when you are.</p>

      {/* Try saying */}
      <div className="ob-surface-50 w-full max-w-sm border ob-border-hairline rounded-xl p-4 text-left mb-5">
        <div className="text-xs ob-text-quaternary mb-2">Try saying:</div>
        <div className="flex flex-wrap gap-2">
          <span className="px-2.5 py-1 rounded-full bg-[#FF8C69]/10 border border-[#FF8C69]/20 text-[#FF8C69] text-xs font-medium">“wave at me”</span>
          <span className="px-2.5 py-1 rounded-full bg-[#FF8C69]/10 border border-[#FF8C69]/20 text-[#FF8C69] text-xs font-medium">“what time is it”</span>
        </div>
      </div>

      {/* Hotkey reminder */}
      <div className="flex items-center gap-2.5 mb-6 text-xs text-[var(--app-muted)]">
        <span>Press</span>
        <span className="flex items-center gap-1">
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-[var(--app-text)] font-medium">⌘</kbd>
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-[var(--app-text)] font-medium">⇧</kbd>
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-[var(--app-text)] font-medium">Space</kbd>
        </span>
        <span>anytime to chat</span>
      </div>

      <label className="ob-surface-30 w-full max-w-sm flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] px-3 py-2.5 cursor-pointer">
        <span className="text-sm text-[var(--app-text)]">Launch on startup</span>
        <input
          type="checkbox"
          checked={data.launchOnStartup}
          onChange={(e) => updateData({ launchOnStartup: e.target.checked })}
          className="ob-checkbox h-4 w-4 rounded accent-[#FF8C69]"
        />
      </label>
    </div>
  );
};
