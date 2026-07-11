import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

const LobsterSvg = () => (
  <svg width="120" height="120" viewBox="0 0 128 128">
    {/* Tail */}
    <path
      d="M 50 100 Q 64 125 78 100 Z"
      fill="#FF8C69"
      stroke="#C44536"
      strokeWidth="4"
      strokeLinejoin="round"
    />
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
    {/* Right Claw */}
    <g>
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
      {/* Belt/Band */}
      <path d="M 34 82 Q 64 92 94 82 L 94 88 Q 64 98 34 88 Z" fill="#008080" stroke="#006666" strokeWidth="2" />
      {/* Belt buckle */}
      <path d="M 75 85 L 88 108 L 68 102 Z" fill="#008080" stroke="#006666" strokeWidth="2" strokeLinejoin="round" />
      {/* Face - Eyes */}
      <circle cx="48" cy="55" r="7" fill="#1a1a1a" />
      <circle cx="80" cy="55" r="7" fill="#1a1a1a" />
      {/* Pupils */}
      <circle cx="46" cy="53" r="2.5" fill="#FFF" />
      <circle cx="78" cy="53" r="2.5" fill="#FFF" />
      {/* Mouth */}
      <path d="M 60 68 Q 64 71 68 68" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
    </g>
  </svg>
);

const FEATURES: { icon: string; label: string }[] = [
  { icon: 'solar:chat-round-line-linear', label: 'Chat with me' },
  { icon: 'solar:laptop-linear', label: 'Control your Mac' },
  { icon: 'solar:alarm-linear', label: 'Set timers & reminders' },
  { icon: 'solar:heart-linear', label: 'I remember things about you' },
];

export const WelcomeStep: React.FC<Props> = () => {
  return (
    <div className="h-full px-10 flex flex-col items-center justify-center text-center">
      <div className="mb-6 animate-happy-bounce relative">
        <LobsterSvg />
        <div className="absolute -inset-10 bg-[#FF8C69]/10 blur-3xl -z-10 rounded-full" />
      </div>

      <h1 className="text-3xl font-medium tracking-tight text-[var(--app-text-strong)] mb-3">
        Welcome to Clawster
      </h1>
      <p className="text-sm text-[var(--app-muted)] mb-7 max-w-sm mx-auto">
        Your desktop buddy. Here to help, hang out, and make your Mac more fun.
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-left max-w-md w-full mb-7">
        {FEATURES.map((f) => (
          <div key={f.label} className="flex items-center gap-3 text-sm ob-text-tertiary">
            <div className="ob-surface-icon w-8 h-8 rounded-lg flex items-center justify-center text-[var(--app-muted)] border ob-border-hairline shrink-0">
              <iconify-icon icon={f.icon} width="1.125rem"></iconify-icon>
            </div>
            {f.label}
          </div>
        ))}
      </div>

      {/* How to talk to me */}
      <div className="ob-surface-60 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ob-border-hairline">
        <span className="text-xs text-[var(--app-muted)]">Talk to me anytime with</span>
        <span className="flex items-center gap-1">
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-xs font-medium text-[var(--app-text)]">⌘</kbd>
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-xs font-medium text-[var(--app-text)]">⇧</kbd>
          <kbd className="ob-chip px-1.5 py-0.5 rounded border text-xs font-medium text-[var(--app-text)]">Space</kbd>
        </span>
      </div>
    </div>
  );
};
